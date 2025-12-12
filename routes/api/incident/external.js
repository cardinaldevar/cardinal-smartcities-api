const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('config');
const { check, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { nanoid } = require('nanoid');
const { sendNewPasswordEmail } = require('../../../utils/ses');
const multer = require('multer');
const { putObjectS3 } = require('../../../utils/s3');
const { uploadFileToS3 } = require('../../../utils/s3helper');

const upload = multer({ storage: multer.memoryStorage() });

const IncidentProfile = require('../../../models/IncidentProfile');
const IncidentDocket = require('../../../models/IncidentDocket');
const IncidentDocketHistory = require('../../../models/IncidentDocketHistory');
const authIncident = require('../../../middleware/authIncident');
const moment = require('moment');
const rateLimit = require('express-rate-limit');

// Rate limiter for password reset
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: 'Demasiadas solicitudes, intente en una hora.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    // Use X-Forwarded-For if available (when behind a proxy)
    // Fallback to remoteAddress if not (direct connection)
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  }
});

// @route   POST api/incident/external/login
// @desc    Authenticate user & get token
// @access  Public
router.post(
  '/login',
  [
    check('dni', 'Please include a valid DNI').not().isEmpty(),
    check('password', 'Password is required').exists(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { dni, password } = req.body;

    try {
      let user = await IncidentProfile.findOne({ dni });

      if (!user) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'Invalid Credentials' }] });
      }

      if (user.status !== 1) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'User not enabled' }] });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res
          .status(400)
          .json({ errors: [{ msg: 'Invalid Credentials' }] });
      }

      // Update lastConnect field
      user.lastConnect = Date.now();
      await user.save();

      const payload = {
        user: {
          id: user.id,
          name: user.name,
          last: user.last,
          email: user.email
        },
      };

      jwt.sign(
        payload, process.env.SEC_TOKEN_INCIDENT, { expiresIn: '1h' },
        (err, token) => {
          if (err) throw err;
          res.json({ token, user:payload.user });
        }
      );
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

// @route   POST api/incident/external/forgot
// @desc    Forgot password - generates and emails a new password
// @access  Public
router.post('/forgot', [
  forgotPasswordLimiter,
  check('dni', 'DNI is required').not().isEmpty(),
  check('email', 'Please include a valid email').isEmail(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { dni, email } = req.body;
    const user = await IncidentProfile.findOne({ dni, email });

    if (user) {
      // Check user status
      if (user.status !== 1) {
        return res.status(400).json({ errors: [{ msg: 'Usuario deshabilitado, contáctese con el administrador.' }] });
      }

      // Generate a new random password
      const newPassword = nanoid(10);

      // Hash the new password
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);

      await user.save();

      // Send email with the new password
      await sendNewPasswordEmail({
        email: user.email,
        newPassword: newPassword,
        company: user.company // Assuming user has a company field
      });
    }

    // Always return a success message to prevent user enumeration
    res.json({ msg: 'Si existe una cuenta con ese DNI y correo electrónico, se ha enviado una nueva contraseña.' });

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/incident/external/docket
// @desc    Get user's dockets
// @access  Private
router.get('/docket', authIncident, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    const dockets = await IncidentDocket.aggregate([
        {
            $match: {
                $or: [
                    { profile: userId },
                    { 'subscribers.profile': userId }
                ],
                status: { $nin: ['closed', 'cancelled', 'archived', 'deleted'] }
            }
        },
        { $sort: { updatedAt: -1, createdAt: -1 } },
        { $limit: 20 },
        {
            $lookup: {
                from: 'incident.history',
                let: { docketId: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$docket', '$$docketId'] } } },
                    { $sort: { createdAt: -1 } },
                    { $limit: 1 }
                ],
                as: 'latestHistory'
            }
        },
        {
            $unwind: {
                path: '$latestHistory',
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $project: {
                docketId: 1,
                description: 1,
                status: 1,
                createdAt: 1,
                updatedAt: 1,
                latestHistory: 1,
                isSubscribed: {
                    $and: [
                        { $ne: ["$profile", userId] },
                        { $in: [userId, { $ifNull: [ "$subscribers.profile", [] ] } ] }
                    ]
                }
            }
        }
    ]);

    res.json(dockets);
    
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/incident/external/docket/:docket_id/history
// @desc    Get last 2 history movements for a specific docket
// @access  Private
router.get('/docket/:docket_id/history', authIncident, async (req, res) => {
  try {
    const docketId = req.params.docket_id;
    const userId = req.user.id;

    // Validate docket_id as a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(docketId)) {
      return res.status(400).json({ msg: 'Invalid Docket ID' });
    }

    // First, check if the user has access to this docket
    const docket = await IncidentDocket.findOne({
      _id: docketId,
      $or: [
        { profile: userId },
        { 'subscribers.profile': userId }
      ]
    });

    if (!docket) {
      return res.status(404).json({ msg: 'Docket not found or user not authorized' });
    }

    const history = await IncidentDocketHistory.find({ docket: docketId,status:{$nin:['activity','deleted']} })

      .sort({ createdAt: -1 })
      .limit(4)
      .populate({
        path: 'user',
        select: 'name last', // Select name and last from the user model
        model: 'IncidentProfile' // Assuming IncidentProfile for external users
      })
      .select('status content requiresResponse createdAt'); // Select relevant fields

    history.reverse();

    res.json(history);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/incident/external/docket/:docket_id/reply
// @desc    Add a reply to a docket history
// @access  Private
router.post('/docket/:docket_id/reply', [
  authIncident,
  upload.array('files', 3), // Multer middleware for files
  check('historyId', 'historyId is required').isMongoId(),
  // Content is now optional if files are being uploaded
  check('content').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { docket_id: docketId } = req.params;
    const { historyId, content } = req.body;
    const userId = req.user.id;

    // If there's no content and no files, return an error
    if (!content && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ errors: [{ msg: 'Content or files are required' }] });
    }

    // Validate docketId
    if (!mongoose.Types.ObjectId.isValid(docketId)) {
      return res.status(400).json({ msg: 'Invalid Docket ID' });
    }

    // 1. Check if the user has access to this docket
    const docket = await IncidentDocket.findOne({
      _id: docketId,
      $or: [
        { profile: userId },
        { 'subscribers.profile': userId }
      ]
    });

    if (!docket) {
      return res.status(404).json({ msg: 'Docket not found or user not authorized' });
    }

    // 2. Update the history item that requires a response (if historyId is provided)
    if (historyId !== 'null' && historyId) {
      const updateResult = await IncidentDocketHistory.updateOne(
          { _id: historyId, docket: docketId },
          { $set: { requiresResponse: false } }
      );
  
      if (updateResult.matchedCount === 0) {
          return res.status(404).json({ msg: 'History item not found for this docket.' });
      }
    }


    // 3. Handle file uploads to S3
    const filesForHistory = [];
    if (req.files && req.files.length > 0) {
      const folder = 'docket'; // S3 folder for external incident replies
      const bucketName = process.env.S3_BUCKET_INCIDENT;

      if (!bucketName) {
          console.error("S3_BUCKET_INCIDENT environment variable not set.");
          return res.status(500).send('Server configuration error: S3 not set.');
      }

      const uploadPromises = req.files.map(file => uploadFileToS3(file, bucketName, folder));
      const uploadedFilesInfo = await Promise.all(uploadPromises);

      uploadedFilesInfo.forEach(uploadedFile => {
          filesForHistory.push({
              url: uploadedFile.url,
              key: uploadedFile.key,
              originalName: uploadedFile.originalName,
              fileType: uploadedFile.fileType,
              fileSize: uploadedFile.fileSize,
          });
      });
    }


    // 4. Create the new "activity" history entry (the reply)
    const newHistory = new IncidentDocketHistory({
      docket: docketId,
      user: userId,
      userModel: 'IncidentProfile',
      status: 'activity',
      content: content || '',
      files: filesForHistory,
    });

    await newHistory.save();

    // 5. Update docket timestamp
    docket.updatedAt = new Date();
    await docket.save();

    // 6. Return the newly created history entry
    res.json(newHistory);

  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


module.exports = router;