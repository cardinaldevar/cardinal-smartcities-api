const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('config');
const { check, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { nanoid } = require('nanoid');
const { sendNewPasswordEmail } = require('../../../utils/ses');

const IncidentProfile = require('../../../models/IncidentProfile');
const IncidentDocket = require('../../../models/IncidentDocket');
const IncidentDocketHistory = require('../../../models/IncidentDocketHistory');
const authIncident = require('../../../middleware/authIncident');
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
          res.json({ token });
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
    const dockets = await IncidentDocket.find({
      $or: [
        { profile: req.user.id },
        { 'subscribers.profile': req.user.id }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('docketId description status createdAt updatedAt profile subscribers')
    .lean();

    const userId = req.user.id;
    const responseDockets = dockets.map(docket => {
      // Explicitly check if the user is in the subscribers list
      const isListedAsSubscriber = docket.subscribers?.some(sub => sub.profile?.toString() === userId) || false;
      
      // A user is considered "subscribed" only if they are in the subscribers list AND not the main owner.
      const isSubscribed = isListedAsSubscriber && docket.profile.toString() !== userId;

      const { profile, subscribers, ...rest } = docket;
      return { ...rest, isSubscribed };
    });

    res.json(responseDockets);
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

    const history = await IncidentDocketHistory.find({ docket: docketId })
      .sort({ createdAt: -1 })
      .limit(2)
      .populate({
        path: 'user',
        select: 'name last', // Select name and last from the user model
        model: 'IncidentProfile' // Assuming IncidentProfile for external users
      })
      .select('status content createdAt'); // Select relevant fields

    res.json(history);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;