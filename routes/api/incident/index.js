const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Docket = require('../../../models/IncidentDocket');
const IncidentProfile = require('../../../models/IncidentProfile');
const DocketArea = require('../../../models/IncidentDocketArea');
const Zone = require('../../../models/Zone');
const DocketSource = require('../../../models/IncidentDocketSource');
const DocketType = require('../../../models/IncidentDocketType');
const DocketHistory = require('../../../models/IncidentDocketHistory');
const moment = require('moment-timezone');
const https = require('https');
const mongoose = require('mongoose');
const axios = require('axios');
const { getSignedUrlForFile, uploadFileToS3 } = require('../../../utils/s3helper');
const { getURLS3 } = require('../../../utils/s3.js');
const PDFDocument = require('pdfkit');
const bcrypt = require('bcryptjs');
const randtoken = require('rand-token');
const { sendNewProfileEmail } = require('../../../utils/ses');
const { statusIncident } = require('../../../utils/CONS.js');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.get('/docket/name', auth, async (req, res) => {

    try {
        const { search: searchTerm } = req.query;
        const companyId  = new mongoose.Types.ObjectId(req.user.company);

        if (!searchTerm || searchTerm.length < 2) {
            return res.json([]);
        }

        const pipeline = [
                {
                    $search: {
                        index: 'docketTypeSearch',	
                        compound: {
                            filter: [
                                { equals: { path: 'status', value: 1 } },
                                { equals: { path: 'company', value: companyId } }
                            ],
                            must: [
                                {
                                    text: {
                                        query: searchTerm, 
                                        path: 'searchText'
                                    }
                                }
                            ]
                        }
                    }
                },
                {
                    $lookup: {
                    from: "incident.docket_types", 
                    localField: "parent",    
                    foreignField: "_id",       
                    as: "parentDoc" 
                    }
                },
                {
                    $addFields: {
                    sortPriority: {
                        $cond: { if: { $eq: ["$parent", null] }, then: 0, else: 1 }
                    },
                    parentName: { $arrayElemAt: ["$parentDoc.name", 0] }
                    }
                },
                {
                    $sort: {
                    sortPriority: 1,
                    name: 1
                    }
                },
                {
                    $project: {
                    _id: 1,
                    name: 1,
                    fields: 1,
                    category: '$slug',
                    parent: "$parentName",
                    score: { $meta: "searchScore" }
                    }
                }
                ];

        const results = await DocketType.aggregate(pipeline);
        res.json(results);

    } catch (error) {
        console.error("Error en la búsqueda de autocomplete con Atlas:", error);
        res.status(500).send('Error del servidor');
    }
});

router.get('/docket/subscriber', auth, async (req, res) => {
    try {
        const { id } = req.query;
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de legajo no válido o no proporcionado.' });
        }

        const docket = await Docket.findOne({ _id: id, company: companyId })
            .populate({
                path: 'subscribers.profile',
                select: 'name last email'
            });

        if (!docket || !docket.subscribers || docket.subscribers.length === 0) {
            return res.json([]);
        }

        const subscribersList = docket.subscribers.map(sub => {
            // Case 1: Subscriber is a registered profile and was populated
            if (sub.profile && typeof sub.profile === 'object') {
                let displayName = sub.profile.email; // Default to email
                if (sub.profile.name || sub.profile.last) {
                    displayName = `${sub.profile.name || ''} ${sub.profile.last || ''}`.trim();
                }
                return {
                    _id: sub.profile._id,
                    name: displayName
                };
            }
            
            // Case 2: Subscriber is just an email string
            if (sub.email && typeof sub.email === 'string') {
                return {
                    _id: null, // No profile ID available
                    name: sub.email
                };
            }
        
            // If the element is malformed, return null
            return null;
        }).filter(Boolean); // Filter out any null entries

        res.json(subscribersList);

    } catch (error) {
        console.error("Error fetching docket subscribers:", error);
        res.status(500).send('Error del servidor');
    }
});

router.post('/docket/subscriber', [auth, [
    check('id', 'ID de legajo no válido').isMongoId(),
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { id, profile, email } = req.body;
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        let updateQuery;
        let findQuery = { _id: id, company: companyId };

        if (profile && profile._id) {
            if (!mongoose.Types.ObjectId.isValid(profile._id)) {
                return res.status(400).json({ msg: 'ID de perfil no válido.' });
            }
            const profileId = new mongoose.Types.ObjectId(profile._id);
            updateQuery = { $addToSet: { subscribers: { profile: profileId } } };
        } else if (email) {
            if (!/^\S+@\S+\.\S+$/.test(email)) {
                 return res.status(400).json({ msg: 'Formato de email no válido.' });
            }
            updateQuery = { $addToSet: { subscribers: { email: email } } };
        } else {
            return res.status(400).json({ msg: 'Debe proporcionar un perfil o un email para suscribir.' });
        }

        const updatedDocket = await Docket.findOneAndUpdate(
            findQuery,
            updateQuery,
            { new: true }
        );

        if (!updatedDocket) {
            return res.status(404).json({ msg: 'Legajo no encontrado o no tiene permisos.' });
        }

        res.json({ id: updatedDocket._id, docketId:updatedDocket.docketId });

    } catch (error) {
        console.error("Error adding docket subscriber:", error);
        res.status(500).send('Error del servidor');
    }
});

router.delete('/docket/:id/subscriber/:subscriber', auth, async (req, res) => {
    const { id, subscriber } = req.params;
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ msg: 'ID de legajo no válido.' });
    }

    try {
        let pullQuery;

        if (mongoose.Types.ObjectId.isValid(subscriber)) {
            const profileId = new mongoose.Types.ObjectId(subscriber);
            pullQuery = { $pull: { subscribers: { profile: profileId } } };
        } else {
            pullQuery = { $pull: { subscribers: { email: subscriber } } };
        }

        const updatedDocket = await Docket.findOneAndUpdate(
            { _id: id, company: companyId },
            pullQuery,
            { new: true }
        );

        if (!updatedDocket) {
            return res.status(404).json({ msg: 'Legajo no encontrado.' });
        }

        res.json({ id: updatedDocket._id });

    } catch (error) {
        console.error("Error deleting docket subscriber:", error);
        res.status(500).send('Error del servidor');
    }
});


/**
 * @route   GET api/incident/docket/download/:id
 * @desc    Generate and upload a PDF report for a docket.
 * @access  Private
 */
router.get('/docket/download/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de legajo no válido.' });
        }

        // 1. Fetch all data
        const docket = await Docket.findOne({ _id: id, company: companyId })
            .populate('profile', 'name last dni email phone address')
            .populate('docket_type', 'name')
            .populate({
                path: 'docket_area',
                select: 'name parent',
                populate: { path: 'parent', select: 'name' }
            })
            .populate('source', 'name')
            .populate('company', 'logo')
            .lean();

        if (!docket) {
            return res.status(404).json({ msg: 'Legajo no encontrado.' });
        }

        const history = await DocketHistory.find({ docket: docket._id })
            .populate({
                path: 'user',
                select: 'name'
            })
            .sort({ 'createdAt': -1 }) // Sort history descending
            .lean();
        docket.history = history;

        // 2. Get Logo URLs and then fetch them as buffers
        const expiresInMinutes = 2880;
        const expiresInSeconds = expiresInMinutes * 60;

        const logoUrl = docket.company && docket.company.logo 
            ? await getURLS3(docket.company.logo, expiresInMinutes, '') 
            : '';
        const cardinalLogoUrl = await getSignedUrlForFile('logo_cardinal_sc.png', 'cardinal-sc-argentina', expiresInSeconds);

        let companyLogoBuffer = null;
        if (logoUrl) {
            try {
                const response = await axios.get(logoUrl, { responseType: 'arraybuffer' });
                companyLogoBuffer = Buffer.from(response.data);
            } catch (imgError) {
                console.error("Could not fetch company logo:", imgError.message);
            }
        }
        
        let cardinalLogoBuffer = null;
        if (cardinalLogoUrl) {
             try {
                const response = await axios.get(cardinalLogoUrl, { responseType: 'arraybuffer' });
                cardinalLogoBuffer = Buffer.from(response.data);
            } catch (imgError) {
                console.error("Could not fetch cardinal logo:", imgError.message);
            }
        }

        // 3. Get Mapbox Image
        let mapImageBuffer = null;
        const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN; // Get your Mapbox token from .env
        
        if (!MAPBOX_ACCESS_TOKEN) {
            console.error("MAPBOX_ACCESS_TOKEN is not set in environment variables.");
        }
        
        if (MAPBOX_ACCESS_TOKEN && docket.location && docket.location.coordinates && docket.location.coordinates.length === 2 && (docket.location.coordinates[0] !== 0 || docket.location.coordinates[1] !== 0)) {
            const [lon, lat] = docket.location.coordinates;
            const mapWidth = 540;
            const mapHeight = 300;
            const zoom = 16;
            // Construct the Mapbox Static Images API URL
            const mapImageUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/pin-s-marker+285A98(${lon},${lat})/${lon},${lat},${zoom},0/${mapWidth}x${mapHeight}?access_token=${MAPBOX_ACCESS_TOKEN}`;
            
            try {
                const response = await axios.get(mapImageUrl, { responseType: 'arraybuffer' });
                mapImageBuffer = Buffer.from(response.data);
            } catch (mapError) {
                console.error("Could not fetch Mapbox image:", mapError.message);
                // Decide if you want to stop or continue without the map
            }
        }


        // 4. Generate PDF
                const doc = new PDFDocument({
                    size: 'A4',
                    margins: { top: 90, bottom: 28.35, left: 28.35, right: 28.35 }, // 1cm sides/bottom, larger top for header
                    bufferPages: true
                });
        
                const buffers = [];
                doc.on('data', buffers.push.bind(buffers));
        
                // --- Reusable Header ---
                const drawHeader = () => {
                    const headerY = 20;
                    const companyLogoHeight = 40;
                    const cardinalLogoHeight = 35; // Reduced size
                    
                    // Use dynamic margins
                    const leftMargin = doc.page.margins.left;
                    const rightMargin = doc.page.margins.right;
        
                    if (companyLogoBuffer) {
                        doc.image(companyLogoBuffer, leftMargin, headerY, { height: companyLogoHeight });
                    }
        
                    if (cardinalLogoBuffer) {
                        doc.image(cardinalLogoBuffer, doc.page.width - rightMargin - 100, headerY, { height: cardinalLogoHeight, align: 'right' });
                    }
                    
                    // Use the taller of the two logos for line positioning
                    const tallerLogoHeight = Math.max(companyLogoHeight, cardinalLogoHeight);
                    doc.moveTo(leftMargin, headerY + tallerLogoHeight + 10)
                       .lineTo(doc.page.width - rightMargin, headerY + tallerLogoHeight + 10)
                       .strokeColor('#cecece')
                       .lineWidth(0.5)
                       .stroke();
                };        
                doc.on('pageAdded', drawHeader);
                drawHeader(); // Draw header on the first page
        
                // --- PDF Content ---
                doc.y = doc.page.margins.top; // Start after header
        
                const col1X = doc.page.margins.left;
                const col2X = doc.page.width / 2 + 10;
                const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2 - 20;
                const initialY = doc.y;
        
                doc.fontSize(9);
        
                // --- Left Column: Docket Info ---
                doc.font('Helvetica-Bold').text('Reporte de Legajo', col1X, initialY, { width: colWidth });
                const lineY = doc.y;
        
                // --- Status Badge Background (drawn first) ---
                const statusObj = statusIncident.find(s => s.value === docket.status);
                if (statusObj) {
                    const docketIdText = `#${docket.docketId}`;
                    const idWidth = doc.font('Helvetica').widthOfString(docketIdText);
        
                    const statusText = statusObj.label.toUpperCase();
                    const textWidth = doc.font('Helvetica-Bold').fontSize(7).widthOfString(statusText);
                    const padding = 5;
                    const badgeHeight = 9;
                    const badgeWidth = textWidth + (padding * 2);
        
                    const badgeX = col1X + idWidth +20;
                    // Calculate Y for the badge to be vertically centered on the line
                    const badgeY = lineY - 2; // Fine-tuned vertical alignment
        
                    // Draw rounded rectangle background
                    doc.roundedRect(badgeX , badgeY, badgeWidth, badgeHeight, 8)
                        .fill(statusObj.color);
                }
        
                // --- Docket ID and Status Text (drawn on top) ---
                // Set fill to black for docket ID
                doc.fillColor('black').font('Helvetica').text(`#${docket.docketId}`, col1X, lineY);
                
                if (statusObj) {
                    const docketIdText = `#${docket.docketId}`;
                    const idWidth = doc.font('Helvetica').widthOfString(docketIdText);
                    const statusText = statusObj.label.toUpperCase();
                    const textWidth = doc.font('Helvetica-Bold').widthOfString(statusText);
                    const padding = 5;
                    const badgeWidth = textWidth + (padding * 2);
                    const badgeX = col1X + idWidth + 32;
        
                    // Set fill to white for status text and draw it
                    doc.fillColor('white').font('Helvetica-Bold').text(statusText, badgeX, lineY, {
                        width: badgeWidth,
                        align: 'center'
                    });
                }
                        
                doc.fillColor('black'); // Reset fill color
                doc.moveDown(1.5);
        
                doc.font('Helvetica-Bold').text('Descripción', col1X, doc.y, { width: colWidth });
                doc.font('Helvetica').text(docket.description || 'N/A', col1X, doc.y, { width: colWidth });
                doc.moveDown();

                doc.font('Helvetica-Bold').text('Tipo', col1X, doc.y, { width: colWidth });
                doc.font('Helvetica').text(docket.docket_type ? docket.docket_type.name : 'N/A', col1X, doc.y, { width: colWidth });
                doc.moveDown();
        
                const areaNames = docket.docket_area.map(area => {
                    return area.parent ? `${area.parent.name} > ${area.name}` : area.name;
                }).join(', ') || 'N/A';
        
                doc.font('Helvetica-Bold').text('Área', col1X, doc.y, { width: colWidth });
                doc.font('Helvetica').text(areaNames, col1X, doc.y, { width: colWidth });
                doc.moveDown();
        
                doc.font('Helvetica-Bold').text('Dirección del Incidente', col1X, doc.y, { width: colWidth });
                doc.font('Helvetica').text(docket.address || 'N/A', col1X, doc.y, { width: colWidth });
                doc.moveDown();
        
                doc.font('Helvetica-Bold').text('Origen: ', col1X, doc.y, { continued: true });
                doc.font('Helvetica').text(docket.source ? docket.source.name : 'N/A', { width: colWidth });
                doc.moveDown();
                
                const createdAtFormatted = moment.utc(docket.createdAt).tz('America/Argentina/Buenos_Aires').format('DD/MM/YY HH:mm');
                const updatedAtFormatted = moment.utc(docket.updatedAt).tz('America/Argentina/Buenos_Aires').format('DD/MM/YY HH:mm');
        
                doc.font('Helvetica-Bold').text('Creado: ', col1X, doc.y, { continued: true });
                doc.font('Helvetica').text(createdAtFormatted, { width: colWidth });
                doc.moveDown();
        
                doc.font('Helvetica-Bold').text('Actualización: ', col1X, doc.y, { continued: true });
                doc.font('Helvetica').text(updatedAtFormatted, { width: colWidth });
                doc.moveDown();
                
                const leftColFinalY = doc.y;        
                // --- Right Column: Profile Info ---
                doc.y = initialY; // Reset Y for the second column
                if (docket.profile) {
                    const profile = docket.profile;
                    doc.font('Helvetica-Bold').text('Datos del Solicitante', col2X, doc.y, { width: colWidth });
                    doc.moveDown(1.5);
        
                    doc.font('Helvetica-Bold').text('Nombre', { width: colWidth });
                    doc.font('Helvetica').text(`${profile.name || ''} ${profile.last || ''}`, { width: colWidth });
                    doc.moveDown();
        
                    doc.font('Helvetica-Bold').text('Email', { width: colWidth });
                    doc.font('Helvetica').text(profile.email || 'N/A', { width: colWidth });
                    doc.moveDown();
        
                    doc.font('Helvetica-Bold').text('DNI', { width: colWidth });
                    doc.font('Helvetica').text(profile.dni || 'N/A', { width: colWidth });
                    doc.moveDown();
        
                    doc.font('Helvetica-Bold').text('Teléfono', { width: colWidth });
                    doc.font('Helvetica').text(profile.phone || 'N/A', { width: colWidth });
                    doc.moveDown();
        
                    doc.font('Helvetica-Bold').text('Dirección', { width: colWidth });
                    doc.font('Helvetica').text(profile.address || 'N/A', { width: colWidth });
                    doc.moveDown(); // Add a line break after address
                    doc.font('Helvetica-Bold').text('Suscriptos: ', { continued: true });
                    doc.font('Helvetica').text(docket.subscribers ? docket.subscribers.length.toString() : '0');
                }
                            
                const rightColFinalY = doc.y;        
                // Set Y to the bottom of the taller column before proceeding
                doc.y = Math.max(leftColFinalY, rightColFinalY) + 20;
        
                // Add a line after this section
                doc.moveTo(doc.page.margins.left, doc.y)
                    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
                    .strokeColor('#cecece')
                    .lineWidth(0.5)
                    .stroke();
                doc.moveDown();
        
                // --- History Section ---
                doc.font('Helvetica-Bold').fontSize(12).text('Historial', col1X, doc.y);
                doc.moveDown();
        
                doc.fontSize(9);
                doc.fillColor('black');
                
                for (const item of docket.history) {
                    const itemY = doc.y;
                    const statusObj = statusIncident.find(s => s.value === item.status);
                    
                    let obsX = col1X;
                    let obsY = itemY;
        
                    if (statusObj) {
                        const statusText = statusObj.label.toUpperCase();
                        const textWidth = doc.font('Helvetica-Bold').fontSize(6).widthOfString(statusText);
                        const padding = 4;
                        const badgeHeight = 10;
                        const badgeWidth = textWidth + (padding * 2);
        
                        // Draw badge
                        doc.roundedRect(col1X, itemY, badgeWidth, badgeHeight, 7).fill(statusObj.color);
                        doc.fillColor('white').text(statusText, col1X + padding, itemY + 2.5);
                        
                        obsX = col1X + badgeWidth + 10;
                        obsY = itemY + 2.5; // Align with text inside badge
                    }
        
                    // Draw observation text
                    doc.fillColor('black').font('Helvetica').fontSize(8).text(`obs: ${item.content || ''}`, obsX, obsY, {
                        width: doc.page.width - doc.page.margins.right - obsX
                    });
                    // moveDown is handled automatically by text wrapping
        
                    // Draw date and user
                    const dateFormatted = moment.utc(item.createdAt).tz('America/Argentina/Buenos_Aires').format('DD/MM/YY HH:mm');
                    const userText = item.user ? item.user.name : 'Sistema';
                    doc.fontSize(8).fillColor('#6B7280').text(`${dateFormatted} - ${userText}`, col1X);
                    doc.moveDown(0.8);
        
                    // Separator Line (if not the last item)
                    if (docket.history.indexOf(item) < docket.history.length - 1) {
                        doc.moveTo(col1X, doc.y)
                            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
                            .strokeColor('#EEEEEE') // Very light gray
                            .lineWidth(0.5)
                            .stroke();
                        doc.moveDown();
                    }
                }

                // --- Map Section ---
                if (mapImageBuffer) {
                    const mapSectionHeight = 250; // Estimated height for title, separator, and map
                    if (doc.y + mapSectionHeight > doc.page.height - doc.page.margins.bottom) {
                        doc.addPage();
                        drawHeader();
                        doc.y = doc.page.margins.top;
                    } else {
                        doc.moveDown(2);
                    }

                    doc.font('Helvetica-Bold').fontSize(9).text('Ubicación del Incidente', col1X, doc.y);
                    doc.moveDown();

                    // Separator line before the map
                    doc.moveTo(doc.page.margins.left, doc.y)
                       .lineTo(doc.page.width - doc.page.margins.right, doc.y)
                       .strokeColor('#cecece')
                       .lineWidth(0.5)
                       .stroke();
                    doc.moveDown();

                    const mapFitWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
                    doc.image(mapImageBuffer, {
                        fit: [mapFitWidth, 350],
                        align: 'center'
                    });
                }        			        
        // 4. Finalize PDF and get buffer
        const pdfPromise = new Promise(resolve => {
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.end();
        });

        const pdfBuffer = await pdfPromise;

        // 5. Upload to S3
        const filename = `${docket.docketId}_${moment().format('DDMMYY_HHmm')}.pdf`;
        const s3Bucket = 'cardinal-sc-argentina';
        const s3Folder = `docket/${docket.docketId}`;
        
        const fakeFile = {
            buffer: pdfBuffer,
            originalname: filename,
            mimetype: 'application/pdf'
        };

        const uploadedFile = await uploadFileToS3(fakeFile, s3Bucket, s3Folder);

        // 6. Get a downloadable URL
        const downloadUrl = await getSignedUrlForFile(uploadedFile.key, s3Bucket, 3600); // 1 hour expiration
        
        //console.log({ downloadUrl });
        res.json({ url:downloadUrl });

    } catch (error) {
        console.error("Error generating docket PDF:", error);
        res.status(500).send('Error del servidor');
    }
});


router.get('/docket/name/expand', auth, async (req, res) => {

    try {
        const { search: searchTerm } = req.query;
        const companyId  = new mongoose.Types.ObjectId(req.user.company);

        if (!searchTerm || searchTerm.length < 2) {
            return res.json([]);
        }

        const pipeline = [
                {
                    $search: {
                        index: 'docketTypeSearch',	
                        compound: {
                            filter: [
                                { equals: { path: 'status', value: 1 } },
                                { equals: { path: 'company', value: companyId } }
                            ],
                            must: [
                                {
                                    text: {
                                        query: searchTerm, 
                                        path: 'searchText'
                                    }
                                }
                            ]
                        }
                    }
                },
                {
                    $lookup: {
                    from: "incident.docket_types", 
                    localField: "parent",    
                    foreignField: "_id",       
                    as: "parentDoc" 
                    }
                },
                {
                    $addFields: {
                    sortPriority: {
                        $cond: { if: { $eq: ["$parent", null] }, then: 0, else: 1 }
                    },
                    parentName: { $arrayElemAt: ["$parentDoc.name", 0] }
                    }
                },
                // Add lookup for docket_area
                {
                    $lookup: {
                        from: "incident.docket_areas",
                        localField: "docket_area",
                        foreignField: "_id",
                        as: "docketAreaDetails"
                    }
                },
                // Unwind docketAreaDetails to process each area
                {
                    $unwind: {
                        path: "$docketAreaDetails",
                        preserveNullAndEmptyArrays: true
                    }
                },
                // Lookup parent of each docket area
                {
                    $lookup: {
                        from: "incident.docket_areas",
                        localField: "docketAreaDetails.parent",
                        foreignField: "_id",
                        as: "docketAreaDetails.parentInfo"
                    }
                },
                // Add parentName to docketAreaDetails
                {
                    $addFields: {
                        "docketAreaDetails.parentName": { $arrayElemAt: ["$docketAreaDetails.parentInfo.name", 0] }
                    }
                },
                // Group back to reconstruct the docket_area array
                {
                    $group: {
                        _id: "$_id",
                        name: { $first: "$name" },
                        fields: { $first: "$fields" },
                        category: { $first: "$category" },
                        parent: { $first: "$parent" },
                        parentName: { $first: "$parentName" },
                        score: { $first: "$score" },
                        docket_area: {
                            $push: {
                                _id: "$docketAreaDetails._id",
                                name: "$docketAreaDetails.name",
                                parent: "$docketAreaDetails.parentName"
                            }
                        }
                    }
                },
                {
                    $sort: {
                    sortPriority: 1,
                    name: 1
                    }
                },
                {
                    $project: {
                    _id: 1,
                    name: 1,
                    fields: 1,
                    category: '$slug',
                    parent: "$parentName",
                    score: { $meta: "searchScore" },
                    docket_area: 1 // Include the transformed docket_area
                    }
                }
                ];

        const results = await DocketType.aggregate(pipeline);
        res.json(results);

    } catch (error) {
        console.error("Error en la búsqueda de autocomplete con Atlas:", error);
        res.status(500).send('Error del servidor');
    }
});

/**
 * @route   GET api/incident/docket/search
 * @desc    Busca legajos por docketId para un autocompletado o búsqueda rápida.
 * @access  Private
 */
router.get('/search', auth, async (req, res) => {
  try {
    // 1. Obtenemos el término de búsqueda desde los query params (ej: /search?q=AB123)
    const { search: searchTerm } = req.query;
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    // Si no hay término de búsqueda o es muy corto, devolvemos un array vacío
    if (!searchTerm || searchTerm.length < 2) {
      return res.json([]);
    }

    //limiter for docket_area
    const matchConditions = {
        company: companyId,
        docketId: { $regex: searchTerm.trim(), $options: 'i' }
    };

    if (req.user.docket_area && req.user.docket_area.length > 0) {
        const initialAreaIds = req.user.docket_area.map(_id => new mongoose.Types.ObjectId(_id));

        const idSearchPipeline = [
            { $match: { _id: { $in: initialAreaIds } } },
            {
                $graphLookup: {
                    from: 'incident.docket_areas',
                    startWith: '$_id',
                    connectFromField: '_id',
                    connectToField: 'parent',
                    as: 'descendants',
                    maxDepth: 10
                }
            },
            {
                $project: {
                    allRelatedIds: {
                        $concatArrays: [ [ '$_id' ], '$descendants._id' ]
                    }
                }
            },
            { $unwind: '$allRelatedIds' },
            { $group: { _id: '$allRelatedIds' } }
        ];

        const idDocs = await DocketArea.aggregate(idSearchPipeline);
        const allIdsToFilter = idDocs.map(doc => doc._id);

        if (allIdsToFilter.length > 0) {
            matchConditions.docket_area = { $in: allIdsToFilter };
        } else {
            // Fallback to original IDs if something goes wrong
            matchConditions.docket_area = { $in: initialAreaIds };
        }
    }

    const pipeline = [
      {
        $match: matchConditions
      },
      {
        $lookup: {
          from: 'incident.profile', // Asegúrate que el nombre de la colección sea correcto
          localField: 'profile',
          foreignField: '_id',
          as: 'profile_info'
        }
      },
      {
        $unwind: {
          path: '$profile_info',
          preserveNullAndEmptyArrays: true 
        }
      },
      {
        $limit: 10
      },
      {
        $project: {
          _id: 1,
          url: { $concat: ['/incident/docket/detail/', { $toString: '$_id' }] },
          icon: 'tabler:file-info',
          category: 'Legajo',
          title: {
            $concat: [
              { $ifNull: ['$docketId', 'N/A'] },
              ' : ',
              { $ifNull: ['$profile_info.name', ''] },
              ' ',
              { $ifNull: ['$profile_info.last', 'Sin Perfil'] },
              ' - ',
              {
                // Formateamos la fecha a DD-MM-YYYY y la ajustamos a UTC-3
                $dateToString: {
                  format: '%d/%m/%Y',
                  date: '$createdAt',
                  timezone: '-03:00' // Zona horaria de Argentina
                }
              }
            ]
          }
        }
      }
    ];

    const results = await Docket.aggregate(pipeline);

    res.json(results);

  } catch (error) {
    console.error('Error en la búsqueda de legajos:', error);
    res.status(500).send('Error del servidor');
  }
});

router.get('/profile', auth, async (req, res) => {

    try {
        const { search: searchTerm } = req.query;
        const companyId  = new mongoose.Types.ObjectId(req.user.company);

        if (!searchTerm || searchTerm.length < 2) {
            return res.json([]);
        }

        const pipeline = [
                {
                    $search: {
                    index: 'incidentProfile', 
                    compound: {
                        must: [
                        {
                            autocomplete: {
                            query: searchTerm,
                            path: 'searchText'
                            }
                        }
                        ],
                        filter: [
                        { equals: { path: 'company', value: companyId  }},
                        { equals: { path: 'status', value: 1 } },
                        ]
                    }
                    }
                },
                {
                    $limit: 10 // Limita la cantidad de resultados para el autocompletado
                },
                {
                    $project: {
                    _id: 1,
                    name: {  $concat: [ "$name", " ", "$last", " (",  "$dni", ")"] },
                    score: { $meta: 'searchScore' }
                    }
                }
        ];

        const results = await IncidentProfile.aggregate(pipeline);
       // console.log('results',results)
        res.json(results);

    } catch (error) {
        console.error("Error en la búsqueda de autocomplete con Atlas:", error);
        res.status(500).send('Error del servidor');
    }
});

/**
 * @route   POST api/incident/profile
 * @desc    Crea un nuevo perfil de incidente (ciudadano)
 * @access  Private
 */
router.post('/profile', [auth, [
    check('name', 'El nombre es requerido').not().isEmpty(),
    check('last', 'El apellido es requerido').not().isEmpty(),
    check('dni', 'El DNI es requerido y debe ser numérico').isNumeric().not().isEmpty(),
    check('address').optional().custom(value => {
        if (!value || typeof value !== 'object') {
            // This case should be handled by optional() but as a safeguard
            return true; 
        }
        // If the address object is present but effectively empty, allow it.
        if ((!value.value || value.value.trim() === '') && !value.location) {
            return true;
        }

        if (!value.value || typeof value.value !== 'string' || value.value.trim() === '') {
            throw new Error('El campo "address.value" es requerido y debe ser un string no vacío.');
        }
        if (!value.location || typeof value.location !== 'object') {
            throw new Error('El campo "address.location" es requerido y debe ser un objeto.');
        }
        if (value.location.type !== 'Point') {
            throw new Error('El campo "address.location.type" debe ser "Point".');
        }
        if (!Array.isArray(value.location.coordinates) || value.location.coordinates.length !== 2) {
            throw new Error('El campo "address.location.coordinates" debe ser un array de 2 elementos.');
        }
        if (!value.location.coordinates.every(coord => typeof coord === 'number')) {
            throw new Error('Las coordenadas en "address.location.coordinates" deben ser números.');
        }
        return true;
    }),
    check('floor', 'El piso debe ser un string').optional().isString(),
    check('door', 'El departamento debe ser un string').optional().isString(),
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        name,
        last,
        dni,
        transactionNumber,
        phone,
        email: reqEmail,
        gender,
        birth,
        address, // Destructure address
        floor,   // Destructure floor
        door,    // Destructure door
        notify
    } = req.body;
    console.log(JSON.stringify(req.body))
    
    try {

        let email = reqEmail;

        // Generate fictitious email if not provided
        if (!email || email.trim() === '') {
            const timestamp = Date.now();
            email = `${dni}_${timestamp}@fakemail.com`;
            console.log(`Generated fictitious email: ${email}`);
        }

        const companyId = new mongoose.Types.ObjectId(req.user.company);
        const finalGender = (gender && gender.trim() !== '') ? gender : undefined;
        const genderForApi = finalGender === 'male' ? 'M' : finalGender === 'female' ? 'F' : '';
        const httpsAgent = new https.Agent({rejectUnauthorized: false});
        let isVerified = false;

        if(transactionNumber){
            const dniValidationPayload = {
                  token: process.env.token_service_tigre, 
                  dni: dni,
                  sexo: genderForApi,
                  id_tramite: transactionNumber
              };
      
              const headers = {'Content-Type': 'application/json' };
              const dniApiUrl = 'https://www.tigre.gob.ar/Restserver/vigencia_dni';
              const dniValidationResponse = await axios.post(dniApiUrl, dniValidationPayload,{headers,httpsAgent});
              
              if (dniValidationResponse.data.error || dniValidationResponse.data.data.mensaje !== 'DNI VIGENTE') {
                  return res.status(400).json({ message: 'Los datos del DNI no son válidos o no se pudieron verificar' });
              }
          }
          // Check if profile already exists for this company
         const orConditions = [];
          if (dni) orConditions.push({ dni, company: companyId });
          //if (email) orConditions.push({ email, company: companyId });

          if (orConditions.length > 0) {
              let user = await IncidentProfile.findOne({ $or: orConditions });
              if (user) {
                  return res.status(400).json({ message: 'Ya existe un perfil con el mismo DNI o Email' });
              }
          }

          // Auto-generate password (3 letters, 3 numbers) and hash it
          const chars = randtoken.generate(3, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
          const nums = randtoken.generate(3, '0123456789');
          let passwordArray = (chars + nums).split('');
          for (let i = passwordArray.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]];
          }
          const password = passwordArray.join('');
          
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(password, salt);

        const newProfile = new IncidentProfile({
            company: companyId,
            name,
            last, 
            dni,
            transactionNumber: transactionNumber || null,
            email,
            phone,
            gender: finalGender,
            birth: birth, 
            isVerified, 
            notify,
            status: 1,
            password: hashedPassword,
            address: address ? address.value : undefined,
            location: address ? address.location : undefined,
            floor,
            door,
            registerFrom:'dashboard'
        });

       await newProfile.save();

       //add funcion send email
       if (email) {
        try {
          
          await sendNewProfileEmail({
            email,
            name,
            lastname:last,
            dni,
            password, // The plain text password
            company: companyId
          });

        } catch (emailError) {
          console.error("Error sending new profile email:", emailError);
          // Decide if you want to fail the request or just log the error
        }
      }

      res.status(201).json({
          _id: newProfile._id,
          name: `${newProfile.name} ${newProfile.last} (${newProfile.dni})`
      });

    } catch (err) {
        console.error(err.message);
        if (err.code === 11000) {
             return res.status(400).json({ message: 'Error de duplicado. El DNI o Email ya existe.' });
        }
        res.status(500).send('Error del servidor');
    }
});


router.get('/profile/detail/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de perfil no válido.' });
        }

        const userProfile = await IncidentProfile.findOne({ _id: id, company: companyId })
            .select('-password')
            .populate('company', 'logo')
            .lean();

        if (!userProfile) {
            return res.status(404).json({ msg: 'Perfil no encontrado.' });
        }
        
        if (userProfile.avatar) {
            // Use bucket from environment or a default
            const bucketName = process.env.S3_BUCKET_USERS || 'cardinal-sc-argentina';
            userProfile.avatar = await getSignedUrlForFile(userProfile.avatar, bucketName);
        } else if (userProfile.company && userProfile.company.logo) {
            // Fallback to company logo
            userProfile.avatar = await getURLS3(userProfile.company.logo, 60);
        }

        res.json(userProfile);

    } catch (error) {
        console.error("Error fetching incident profile details:", error);
        res.status(500).send('Error del servidor');
    }
});

/**
 * @route   POST api/incident/profile/detail/search
 * @desc    Search for dockets of a specific profile with pagination and sorting
 * @access  Private
 */
router.post('/profile/detail/search', auth, async (req, res) => {
    try {
        const { 
            id, 
            page = 0, 
            pageSize = 10, 
            sortBy 
        } = req.body;
        
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de perfil no válido.' });
        }

        // --- Sorting ---
        const sortOptions = {};
        if (sortBy && sortBy.length > 0) {
            const sortField = sortBy[0].id;
            const sortOrder = sortBy[0].desc ? -1 : 1;
            sortOptions[sortField] = sortOrder;
        } else {
            sortOptions['updatedAt'] = -1; // Default sort
        }

        // --- Filtering Conditions ---
        const sixMonthsAgo = moment().subtract(6, 'months').toDate();
        const matchConditions = {
            profile: new mongoose.Types.ObjectId(id),
            company: companyId,
            createdAt: { $gte: sixMonthsAgo },
            status: { $ne: 'deleted' }
        };

        // --- Aggregation Pipeline ---
        const pipeline = [
            { $match: matchConditions },
            { $sort: sortOptions },
            {
                $facet: {
                    metadata: [{ $count: "totalDocs" }],
                    data: [
                        { $skip: page * pageSize },
                        { $limit: pageSize },
                        {
                            $lookup: {
                                from: 'incident.docket_types',
                                localField: 'docket_type',
                                foreignField: '_id',
                                as: 'docket_type_info'
                            }
                        },
                        {
                            $unwind: { path: '$docket_type_info', preserveNullAndEmptyArrays: true }
                        },
                        {
                            $lookup: {
                                from: 'incident.docket_types',
                                localField: 'docket_type_info.parent',
                                foreignField: '_id',
                                as: 'parent_info'
                            }
                        },
                        {
                            $unwind: { path: '$parent_info', preserveNullAndEmptyArrays: true }
                        },
                        {
                            $lookup: {
                                from: 'incident.docket_areas',
                                localField: 'docket_area',
                                foreignField: '_id',
                                as: 'docket_area_info'
                            }
                        },
                        {
                            $project: {
                                docketId: 1,
                                description: 1,
                                status: 1,
                                createdAt: 1,
                                updatedAt: 1,
                                address: 1,
                                docket_type: {
                                    _id: '$docket_type_info._id',
                                    name: '$docket_type_info.name',
                                    parent: '$parent_info.name'
                                },
                                docket_area:{
                                    $map: {
                                        input: '$docket_area_info',
                                        as: 'area',
                                        in: { _id: '$$area._id', name: '$$area.name' }
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        ];

        const results = await Docket.aggregate(pipeline);
        const dockets = results[0].data;
        const totalDocs = results[0].metadata[0] ? results[0].metadata[0].totalDocs : 0;

        // --- Response ---
        res.json({
            data: dockets,
            total: totalDocs,
            pagination: {
                total: totalDocs,
                page: page,
                pageSize,
                totalPages: Math.ceil(totalDocs / pageSize),
            }
        });

    } catch (error) {
        console.error("Error searching profile dockets:", error);
        res.status(500).send('Error del servidor');
    }
});


/**
 * @route   PATCH api/incident/profile/:id
 * @desc    Update an incident profile
 * @access  Private
 */
router.patch('/profile/:id', [auth, [
    check('name', 'El nombre es requerido').optional().not().isEmpty(),
    check('last', 'El apellido es requerido').optional().not().isEmpty(),
    check('dni', 'El DNI es requerido y debe ser numérico').optional().isNumeric().not().isEmpty(),
    check('email', 'El email no es válido').optional().isEmail(),
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { id } = req.params;
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de perfil no válido.' });
        }

        const profile = await IncidentProfile.findOne({ _id: id, company: companyId });

        if (!profile) {
            return res.status(404).json({ msg: 'Perfil no encontrado.' });
        }

        const {
            name,
            last,
            dni,
            transactionNumber,
            email,
            phone,
            birth,
            gender,
            password,
            address,
            floor,
            door,
            isVerified,
            notify
        } = req.body;

        // Update fields if they are provided in the request body
        if (name) profile.name = name;
        if (last) profile.last = last;
        if (dni) profile.dni = dni;
        if (transactionNumber) profile.transactionNumber = transactionNumber;
        if (email) profile.email = email;
        if (phone) profile.phone = phone;
        if (birth) profile.birth = birth;
        if (gender) profile.gender = gender;
        if (typeof isVerified !== 'undefined') profile.isVerified = isVerified;
        if (typeof notify !== 'undefined') profile.notify = notify;
        if (floor) profile.floor = floor;
        if (door) profile.door = door;

        // Handle nested address object
        if (address) {
            if (typeof address.value !== 'undefined') {
                profile.address = address.value;
            }
            if (typeof address.location !== 'undefined') {
                profile.location = address.location;
            }
        }

        // Handle password update only if a new password is provided
        if (password && password.length > 0) {
            const salt = await bcrypt.genSalt(10);
            profile.password = await bcrypt.hash(password, salt);
        }

        await profile.save();

        res.json(profile);

    } catch (error) {
        console.error("Error updating incident profile:", error);
        if (error.code === 11000) {
             return res.status(400).json({ message: 'Error de duplicado. El DNI o Email ya existe.' });
        }
        res.status(500).send('Error del servidor');
    }
});


router.get('/zone', auth, async (req, res) => {

    try {
        const { search: searchTerm } = req.query;
        const companyId  = new mongoose.Types.ObjectId(req.user.company);

        if (!searchTerm || searchTerm.length < 2) {
            return res.json([]);
        }
        
        const pipeline = [
                  {
                    $search: {
                      index: "zone",
                      compound: {
                        should: [
                          {
                            autocomplete: {
                              path: "keyword",
                              query: searchTerm,        
                              tokenOrder: "sequential",
                              fuzzy: { maxEdits: 1 }      
                            }
                          },
                          { phrase: { path: "keyword", query: searchTerm } },
                          { text: { path: "keyword", query: searchTerm } }
                        ],
                        minimumShouldMatch: 1,
                        filter: [
                          { equals: { path: "status", value: 1 } },
                          { equals: { path: "company", value: companyId } } // array de ObjectId OK
                        ]
                      }
                    }
                  },
                  { $limit: 10 },
                  { $project: { _id: 1, name: 1,location:1,locked:1,type:1 } } // score: { $meta: "searchScore" }
                ];

        const results = await Zone.aggregate(pipeline);
        res.json(results);

    } catch (error) {
        console.error("Error en la búsqueda de autocomplete con Atlas:", error);
        res.status(500).send('Error del servidor');
    }
});

router.post('/docket/search', auth, async (req, res) => {

  try {

    const companyId = new mongoose.Types.ObjectId(req.user.company);

    const {
      page = 0, 
      pageSize = 10,
      sortBy,
      docketId,
      docketTypes,
      docketArea, 
      status,     
      startDate,
      endDate,
      profile,
      zone,
      textSearch 

    } = req.body;

   

    const sortOptions = {};

    if (sortBy && sortBy.length > 0) {

      let sortField = sortBy[0].id;
      if (sortField === 'profile') {
        sortField = 'profile.name';
      }

      const sortOrder = sortBy[0].desc ? -1 : 1;
      sortOptions[sortField] = sortOrder;

    } else {
      sortOptions['createdAt'] = -1;
    }

    const matchConditions = { company: companyId, status: { $ne: 'deleted' } };

    if (docketId) { matchConditions.docketId = { $regex: docketId.trim(), $options: 'i' }; }

    if (status && status.length > 0) { matchConditions.status = { $in: status }; }

    if (docketTypes && docketTypes.length > 0) {

        const initialTypeIds = docketTypes.map(dock => new mongoose.Types.ObjectId(dock._id));

        const idSearchPipeline = [
            {  $match: { _id: { $in: initialTypeIds } } },
            {
                $graphLookup: {
                    from: 'incident.docket_types', // El nombre de tu colección
                    startWith: '$_id',             // Empezar la búsqueda desde el _id de los docs actuales
                    connectFromField: '_id',       // Campo del documento actual
                    connectToField: 'parent',      // Campo a conectar (buscará docs donde 'parent' == '_id')
                    as: 'descendants',             // Guardar los resultados en un array 'descendants'
                    maxDepth: 10                   // Límite de seguridad para evitar loops infinitos (ajústalo si es necesario)
                }
            },
            {
                $project: {
                    allRelatedIds: {
                        $concatArrays: [ 
                            [ '$_id' ], // El ID del "padre" (el seleccionado)
                            '$descendants._id' // Todos los IDs de los descendientes
                        ]
                    }
                }
            },
            {  $unwind: '$allRelatedIds' },
            {  $group: { _id: '$allRelatedIds' }  }
        ];

        const idDocs = await DocketType.aggregate(idSearchPipeline);
        const allIdsToFilter = idDocs.map(doc => doc._id);

        if (allIdsToFilter.length > 0) {
            matchConditions.docket_type = { $in: allIdsToFilter };
        } else {
            // Fallback por si algo falla: usar solo los IDs originales
            matchConditions.docket_type = { $in: initialTypeIds };
        }
    }

    if (docketArea && docketArea.length > 0) {

        let initialAreaIds;
        
        if(req.user.docket_area?.length >= 1){
            initialAreaIds = req.user.docket_area.map(_id => new mongoose.Types.ObjectId(_id));
        }else{
            initialAreaIds = docketArea.map(area => new mongoose.Types.ObjectId(area._id));
        }

        const idSearchPipeline = [
            {  $match: { _id: { $in: initialAreaIds } } },
            {
                $graphLookup: {
                    from: 'incident.docket_areas',
                    startWith: '$_id',
                    connectFromField: '_id',
                    connectToField: 'parent',
                    as: 'descendants',
                    maxDepth: 10
                }
            },
            {
                $project: {
                    allRelatedIds: {
                        $concatArrays: [ [ '$_id' ], '$descendants._id' ]
                    }
                }
            },
            { $unwind: '$allRelatedIds'  },
            { $group: { _id: '$allRelatedIds' } }
        ];

        const idDocs = await DocketArea.aggregate(idSearchPipeline);
        const allIdsToFilter = idDocs.map(doc => doc._id);

        if (allIdsToFilter.length > 0) {
            matchConditions.docket_area = { $in: allIdsToFilter };
        } else {
            matchConditions.docket_area = { $in: initialAreaIds };
        }
    }

    if (profile && profile.length > 0) {
      matchConditions.profile = { $in: profile.map(p => new mongoose.Types.ObjectId(p._id)) };
    }

    if (textSearch) {
        matchConditions.description = { $regex: textSearch.trim(), $options: 'i' };
    }

    if (startDate || endDate) {
        matchConditions.createdAt = {};
        if (startDate) matchConditions.createdAt.$gte = moment(startDate).startOf('D').toDate();
        if (endDate) matchConditions.createdAt.$lte = moment(endDate).endOf('D').toDate();
    }

    if (zone && zone.length > 0) {
      matchConditions.zone = { $in: zone.map(z => new mongoose.Types.ObjectId(z._id)) };
    }

    const pipeline = [
      { $match: matchConditions },
      { $lookup: { from: 'incident.docket_types', localField: 'docket_type', foreignField: '_id', as: 'docket_type_info' } },
      { $lookup: { from: 'incident.docket_areas', localField: 'docket_area', foreignField: '_id', as: 'docket_area_info' } },
      { $lookup: { from: 'incident.profile', localField: 'profile', foreignField: '_id', as: 'profile_info' } },
      { $unwind: { path: '$docket_type_info', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$profile_info', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
            from: 'incident.docket_types',
            localField: 'docket_type_info.parent',
            foreignField: '_id',
            as: 'parent_info'
        }
      },
      {
          $unwind: {
              path: '$parent_info',
              preserveNullAndEmptyArrays: true
          }
      },
      {
        $project: {
          docketId: 1, description: 1, status: 1, address: 1, createdAt: 1, updatedAt: 1,
          docket_type: '$docket_type_info.name',
          parent: { $ifNull: ['$parent_info.name', null] },
          docket_area: {
            $map: {
                input: '$docket_area_info',
                as: 'area',
                in: { _id: '$$area._id', name: '$$area.name' }
            }
          },
          profile: {
            _id: '$profile_info._id',
            name: { $concat: [
              { $ifNull: ['$profile_info.name', ''] },
              " ",
              { $ifNull: ['$profile_info.last', ''] }
            ]},
            sentiment:  {
                            $let: {
                            vars: {
                                initialSentiment: {
                                $arrayElemAt: [
                                    {
                                    $filter: {
                                        input: '$sentiments',
                                        as: 's',
                                        cond: { $eq: ['$$s.analysisStage', 'initial'] }
                                    }
                                    },
                                    0
                                ]
                              }
                            },
                            in: '$$initialSentiment.sentiment'
                            }
                        }
          },
          subscribers: { $size: { $ifNull: ['$subscribers', []] } }
        }
      },
      {
        $facet: {
          metadata: [{ $count: "totalDocs" }],
          data: [
            { $sort: sortOptions },    
            { $skip: page * pageSize },
            { $limit: pageSize }
          ]
        }
      }
    ];

    const result = await Docket.aggregate(pipeline);
    const data = result[0].data;
    const totalDocs = result[0].metadata[0] ? result[0].metadata[0].totalDocs : 0;

    res.json({
      data,
      total: totalDocs, 
      pagination: {
        total: totalDocs,
        page: page, 
        pageSize,
        totalPages: Math.ceil(totalDocs / pageSize),
      }
    });

  } catch (error) {
    console.error("Error en la búsqueda de dockets:", error);
    res.status(500).send('Error del servidor');
  }
});

router.post('/docket', auth, upload.array('files', 5), async (req, res) => {

    try {

        let data;

        // The client is sending the JSON payload in a single field in the FormData.
        // We find the first key in req.body and assume it's our JSON string.

        if (req.body && Object.keys(req.body).length > 0) {

            const dataField = Object.keys(req.body)[0];
            data = JSON.parse(req.body[dataField]);

        } else {
            return res.status(400).json({ errors: [{ msg: 'Request body is empty or does not contain the expected data field.' }] });
        }

        const {
            profile: profileObj,
            docket_area,
            docket_type: docketTypeObj,
            description,
            source: sourceObj,
            details: detailsFromData,
            docket_type_stage,
            sentiments,
            status
        } = data;

        // Manual validation of inner fields
        const validationErrors = [];

        if (!description) validationErrors.push({ param: 'description', msg: 'La descripción es requerida' });
        if (!profileObj || !mongoose.Types.ObjectId.isValid(profileObj._id)) validationErrors.push({ param: 'profile', msg: 'Perfil o ID de perfil no válido' });
        if (!docketTypeObj || !mongoose.Types.ObjectId.isValid(docketTypeObj._id)) validationErrors.push({ param: 'docket_type', msg: 'Tipo de legajo o ID de tipo no válido' });
        if (!sourceObj || !mongoose.Types.ObjectId.isValid(sourceObj.value)) validationErrors.push({ param: 'source', msg: 'Fuente o ID de fuente no válido' });
        if (docket_area) {
            if (!Array.isArray(docket_area)) {
                validationErrors.push({ param: 'docket_area', msg: 'El área del legajo debe ser un array' });
            } else {
                for (const item of docket_area) {
                    if (!mongoose.Types.ObjectId.isValid(item._id)) {
                        validationErrors.push({ param: 'docket_area._id', msg: 'ID de área no válido en el array' });
                    }
                }
            }
        }

        if (validationErrors.length > 0) {
            return res.status(400).json({ errors: validationErrors });
        }

        let details = detailsFromData;
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (req.files && req.files.length > 0) {

            const bucketName = process.env.S3_BUCKET_INCIDENT;
            if (!bucketName) {
                console.error("S3_BUCKET_INCIDENT environment variable not set.");
                return res.status(500).send('Error de configuración del servidor.');
            }

            const uploadPromises = req.files.map(file => uploadFileToS3(file, bucketName, 'docket'));
            const uploadedFiles = await Promise.all(uploadPromises);

            if (!details) details = {};
            details.files = uploadedFiles;

        }

        const profileId = profileObj._id;
        const docketTypeId = docketTypeObj._id;
        const sourceId = sourceObj.value;
        let docket_type_predicted;
        let initialSentiment;
        let address = null;
        let location = null;

        if (details && details.address && details.address.value && details.address.location) {
            address = details.address.value;
            location = details.address.location;
        }

        if(docket_type_stage != 'predict'){

            const url = `${process.env.TIGRESIRVE_NLP_URL}/predict`;
            const response = await axios.post(url, { text: description });

            if (response.data.categories && response.data.categories.length > 0) {
                const topPrediction = response.data.categories[0];
                docket_type_predicted = {
                    refId: topPrediction._id,
                    name: topPrediction.category,
                    score: topPrediction.score
                };

            }

            if(response.data.sentiment){

                const sentimentData = response.data.sentiment;
                initialSentiment = {
                    analysisStage: 'initial', 
                    sentiment: sentimentData.tone,
                    sentimentScore: {
                        positive: sentimentData.scores.POSITIVE,
                        negative: sentimentData.scores.NEGATIVE,
                        neutral: sentimentData.scores.NEUTRAL,
                        mixed: sentimentData.scores.MIXED
                    }
                };
            }

        } else {

            const sentimentData = sentiments[0];

            initialSentiment = {
                analysisStage: 'initial',
                sentiment: sentimentData.tone,
                sentimentScore: {
                    positive: sentimentData.scores.POSITIVE,
                    negative: sentimentData.scores.NEGATIVE,
                    neutral: sentimentData.scores.NEUTRAL,
                    mixed: sentimentData.scores.MIXED
                }
            };

            docket_type_predicted = {
                refId:docketTypeObj._id,
                name:docketTypeObj.category,
                score:docketTypeObj.score
            }
        }

        const docketAreaIds = docket_area ? docket_area.map(area => new mongoose.Types.ObjectId(area._id)) : [];

        const newDocket = new Docket({
            company: companyId,
            profile: profileId,
            docket_area: docketAreaIds,
            docket_type: docketTypeId,
            description,
            source: sourceId,
            details,
            address,
            location,
            sentiments: [initialSentiment],
            docket_type_predicted,
            status
        });



        await newDocket.save();

        const initialHistoryEntry = new DocketHistory({
            docket: newDocket._id,      
            user: req.user.id, 
            userModel: 'users',
            status,        
            content: 'Legajo iniciado'
        });

        await initialHistoryEntry.save();

        res.status(201).json(newDocket.docketId);

    } catch (err) {

        console.error(err.message);

        if (err.name === 'SyntaxError') {
            return res.status(400).json({ errors: [{ msg: 'The data payload is not valid JSON.' }] });
        }

        if (err.kind === 'ObjectId') {
            return res.status(400).json({ errors: [{ msg: 'ID con formato incorrecto' }] });
        }

        res.status(500).send('Error del servidor');
    }
});



router.patch('/docket/:id', auth, upload.array('files', 3), async (req, res) => {

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {

        return res.status(400).json({ msg: 'ID de legajo no válido.' });

    }

    try {

        const companyId = new mongoose.Types.ObjectId(req.user.company);
        const originalDocket = await Docket.findOne({ _id: id, company: companyId })
            .populate('docket_type', 'name')
            .populate('docket_area', 'name');

        if (!originalDocket) {
            return res.status(404).json({ msg: 'Legajo no encontrado o no tiene permisos para modificarlo.' });
        }

        let data;
        const dataFieldKey = Object.keys(req.body).find(key => {

            try { JSON.parse(req.body[key]); return true; }
            catch (e) { return false; }

        });

        if (dataFieldKey) {

            data = JSON.parse(req.body[dataFieldKey]);

        } else {

            return res.status(400).json({ errors: [{ msg: 'No JSON data payload found in the request.' }] });

        }



        const {
            profile: profileObj,
            docket_area,
            docket_type: docketTypeObj,
            description,
            details: detailsFromData,
            status
        } = data;

        const historyChanges = [];

        // Update fields and track changes

        if (description && description !== originalDocket.description) {

            historyChanges.push('Descripción actualizada.');
            originalDocket.description = description;

        }



        if (status && status !== originalDocket.status) {

            historyChanges.push(`Estado cambiado de '${originalDocket.status}' a '${status}'.`);
            originalDocket.status = status;

        }

        

        if(profileObj && profileObj._id.toString() !== originalDocket.profile.toString()) {
            originalDocket.profile = profileObj._id;
            historyChanges.push('Perfil actualizado.');
        }



        if(docketTypeObj && docketTypeObj._id.toString() !== originalDocket.docket_type._id.toString()) {

            const newDocketType = await DocketType.findById(docketTypeObj._id).select('name');
            const oldDocketTypeName = originalDocket.docket_type ? originalDocket.docket_type.name : 'ninguno';
            const newDocketTypeName = newDocketType ? newDocketType.name : 'ninguno';
            historyChanges.push(`Tipo de legajo cambiado de '${oldDocketTypeName}' a '${newDocketTypeName}'.`);
            originalDocket.docket_type = docketTypeObj._id;

        }



        const oldAreaIds = new Set(originalDocket.docket_area.map(a => a._id.toString()));
        const newAreaIds = new Set(docket_area.map(a => a._id.toString()));

        if(JSON.stringify([...oldAreaIds].sort()) !== JSON.stringify([...newAreaIds].sort())) {

            const oldAreaNames = originalDocket.docket_area.map(a => a.name).join(', ') || 'Ninguna';
            const newAreaDocs = await DocketArea.find({ _id: { $in: [...newAreaIds] } }).select('name');
            const newAreaNames = newAreaDocs.map(a => a.name).join(', ') || 'Ninguna';
            historyChanges.push(`Áreas reasignadas de '${oldAreaNames}' a '${newAreaNames}'.`);
            originalDocket.docket_area = [...newAreaIds].map(id => new mongoose.Types.ObjectId(id));

        }



        let updatedFiles = detailsFromData.files || [];

        if (req.files && req.files.length > 0) {

            historyChanges.push(`Se adjuntaron ${req.files.length} archivo(s).`);
            const bucketName = process.env.S3_BUCKET_INCIDENT;

            if (!bucketName) {

                console.error("S3_BUCKET_INCIDENT environment variable not set.");
                return res.status(500).send('Error de configuración del servidor.');

            }

            const uploadPromises = req.files.map(file => uploadFileToS3(file, bucketName, 'docket'));
            const newlyUploadedFiles = await Promise.all(uploadPromises);
            updatedFiles = [...updatedFiles, ...newlyUploadedFiles];

        }

        originalDocket.details = { ...originalDocket.toObject().details, ...detailsFromData, files: updatedFiles };

        if (detailsFromData && detailsFromData.address) {

            if(originalDocket.address !== detailsFromData.address.value) {

                historyChanges.push(`Dirección actualizada a '${detailsFromData.address.value}'.`);

            }

            originalDocket.address = detailsFromData.address.value;
            originalDocket.location = detailsFromData.address.location;

        }

        

        if (historyChanges.length > 0) {

            const newHistory = new DocketHistory({
                docket: id,
                user: req.user.id,
                userModel: 'users',
                status: 'activity',
                content: historyChanges.join(' ')
            });

            await newHistory.save();

        }


        await originalDocket.save();
        res.status(200).json(originalDocket.docketId);

    } catch (err) {

        console.error("Error updating docket:", err);

        if (err.name === 'SyntaxError') {
            return res.status(400).json({ errors: [{ msg: 'The data payload is not valid JSON.' }] });
        }
        res.status(500).send('Error del servidor');
    }
});



router.post('/docket/predict/', auth, async (req, res) => { 



  try {



     const { description } = req.body;

     console.log('/docket/predict/',description)
    
     const url = `${process.env.TIGRESIRVE_NLP_URL}/predict`;
        const response = await axios.post(url, { text:description });
        const predictionPayload = response.data;
        //console.log(predictionPayload)

        //findone docket_type
        if (!predictionPayload.categories || predictionPayload.categories.length === 0) { return res.status(500).json({ error: 'La API de predicción no devolvió categorías.' }); }
                
        const topPrediction = predictionPayload.categories[0];
        if (!topPrediction._id) { return res.status(200).json(predictionPayload); }
  
        let docketTypeInfo = await DocketType.findById(topPrediction._id)
            .populate('parent') // Populate parent of DocketType
            .populate({
                path: 'docket_area',
                select: 'name parent',
                populate: {
                    path: 'parent',
                    select: 'name'
                }
            })
            .lean(); // Use lean() to get a plain JS object

        if (docketTypeInfo.docket_area) {
            docketTypeInfo.docket_area = docketTypeInfo.docket_area.map(area => ({
                _id: area._id,
                name: area.name,
                parent: area.parent ? area.parent.name : null
            }));
        }

        const finalResponse = {
              prediction: {...topPrediction,
                  name:docketTypeInfo.name,
                  parent: docketTypeInfo.parent?.name || null,
                  fields:docketTypeInfo.fields,
                  docket_area: docketTypeInfo.docket_area ? docketTypeInfo.docket_area : []
              },
              sentiment: predictionPayload.sentiment
          };

         res.status(200).send(finalResponse);

  } catch (error) {
     console.error(error.message);
     res.status(500).send('Error del servidor');
  }

});

router.post('/docket/area/refine', auth, [
    check('areaIds', 'areaIds debe ser un array de Ids').isArray(),
    check('areaIds.*', 'Cada elemento de areaIds debe ser un MongoID válido').isMongoId(),
    check('coordinate', 'coordinate debe ser un array de 2 números').isArray({ min: 2, max: 2 }),
    check('coordinate.*', 'Las coordenadas deben ser números').isNumeric()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { areaIds, coordinate } = req.body;
        const [lng, lat] = coordinate;

        // 1. Find the zone that contains the coordinate
        const zone = await Zone.findOne({
            location: {
                $geoIntersects: {
                    $geometry: {
                        type: "Point",
                        coordinates: [lng, lat]
                    }
                }
            }
        });

        if (!zone) {
            // If no zone is found, it's not necessarily an error, maybe we should return an empty array or a specific message.
            // For now, let's return a 404, but this could be changed based on frontend requirements.
            return res.status(404).json({ msg: 'No se encontró una zona para la coordenada proporcionada.' });
        }

        // 2. Find the IncidentDocketArea that matches the zone and is in the provided list
        const docketArea = await DocketArea.findOne({
            _id: { $in: areaIds.map(id => new mongoose.Types.ObjectId(id)) },
            zone: zone._id
        })
        .populate({
            path: 'parent',
            select: 'name'
        });

        if (!docketArea) {
            return res.status(404).json({ msg: 'No se encontró un área de legajo que coincida con la zona y los IDs proporcionados.' });
        }
        
        // Construct the response object to match what might be expected from other endpoints
        const result = {
            _id: docketArea._id,
            name: docketArea.name,
            parent: docketArea.parent ? docketArea.parent.name : null
        };

        res.json(result);

    } catch (error) {
        console.error('Error al refinar el área del legajo:', error);
        res.status(500).send('Error del servidor');
    }
});


router.post('/docket/map/search', auth, async (req, res) => {

  try {
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    const {
      page = 0, 
      pageSize = 10,
      sortBy,
      docketId,
      docketTypes,
      docketArea, 
      status,     
      startDate,
      endDate,
      profile,
      zone,
      textSearch // Búsqueda de texto libre en la descripción
    } = req.body;

    //console.log(req.body)

    const sortOptions = {};
    if (sortBy && sortBy.length > 0) {
      let sortField = sortBy[0].id;
      
      if (sortField === 'profile') {
        sortField = 'profile.name';
      }

      const sortOrder = sortBy[0].desc ? -1 : 1;
      sortOptions[sortField] = sortOrder;
    } else {
      sortOptions['createdAt'] = -1;
    }

    // --- 2. Construir la etapa $match dinámicamente ---
    const matchConditions = {
      company: companyId,
      status: { $ne: 'deleted' }
    };

    if (docketId) {
      matchConditions.docketId = { $regex: docketId.trim(), $options: 'i' };
    }
    if (status && status.length > 0) {
      matchConditions.status = { $in: status };
    }
    if (docketTypes && docketTypes.length > 0) {
      matchConditions.docket_type = { $in: docketTypes.map(dock => new mongoose.Types.ObjectId(dock._id)) };
    }
    if (docketTypes && docketTypes.length > 0) {
        // 1. Obtener los IDs iniciales del filtro
        const initialTypeIds = docketTypes.map(dock => new mongoose.Types.ObjectId(dock._id));

        const idSearchPipeline = [
            { 
                $match: { _id: { $in: initialTypeIds } } 
            },
            {
                $graphLookup: {
                    from: 'incident.docket_types', // El nombre de tu colección
                    startWith: '$_id',             // Empezar la búsqueda desde el _id de los docs actuales
                    connectFromField: '_id',       // Campo del documento actual
                    connectToField: 'parent',      // Campo a conectar (buscará docs donde 'parent' == '_id')
                    as: 'descendants',             // Guardar los resultados en un array 'descendants'
                    maxDepth: 10                   // Límite de seguridad para evitar loops infinitos (ajústalo si es necesario)
                }
            },
            {
                $project: {
                    allRelatedIds: {
                        $concatArrays: [ 
                            [ '$_id' ], // El ID del "padre" (el seleccionado)
                            '$descendants._id' // Todos los IDs de los descendientes
                        ]
                    }
                }
            },
            { $unwind: '$allRelatedIds' },
            { $group: { _id: '$allRelatedIds' } }
        ];

        // 3. Ejecutar la agregación en el modelo DocketType
        const idDocs = await DocketType.aggregate(idSearchPipeline);
        
        // 4. Mapear los resultados a un array plano de ObjectIds
        const allIdsToFilter = idDocs.map(doc => doc._id);
        // 5. Usar este array final en tu condición de match
        if (allIdsToFilter.length > 0) {
            matchConditions.docket_type = { $in: allIdsToFilter };
        } else {
            // Fallback por si algo falla: usar solo los IDs originales
            matchConditions.docket_type = { $in: initialTypeIds };
        }
        
    }
    
    if (docketArea && docketArea.length > 0) {

        let initialAreaIds;
        
        if(req.user.docket_area?.length >= 1){
            initialAreaIds = req.user.docket_area.map(_id => new mongoose.Types.ObjectId(_id));
        }else{
            initialAreaIds = docketArea.map(area => new mongoose.Types.ObjectId(area._id));
        }

        const idSearchPipeline = [
            {  $match: { _id: { $in: initialAreaIds } } },
            {
                $graphLookup: {
                    from: 'incident.docket_areas',
                    startWith: '$_id',
                    connectFromField: '_id',
                    connectToField: 'parent',
                    as: 'descendants',
                    maxDepth: 10
                }
            },
            {
                $project: {
                    allRelatedIds: {
                        $concatArrays: [ [ '$_id' ], '$descendants._id' ]
                    }
                }
            },
            { $unwind: '$allRelatedIds'  },
            { $group: { _id: '$allRelatedIds' } }
        ];

        const idDocs = await DocketArea.aggregate(idSearchPipeline);
        const allIdsToFilter = idDocs.map(doc => doc._id);

        if (allIdsToFilter.length > 0) {
            matchConditions.docket_area = { $in: allIdsToFilter };
        } else {
            matchConditions.docket_area = { $in: initialAreaIds };
        }
    }

    if (profile && profile.length > 0) {
      matchConditions.profile = { $in: profile.map(p => new mongoose.Types.ObjectId(p._id)) };
    }
    if (textSearch) {
        matchConditions.description = { $regex: textSearch.trim(), $options: 'i' };
    }
    if (startDate || endDate) {
        matchConditions.createdAt = {};
        if (startDate) matchConditions.createdAt.$gte = new Date(startDate);
        if (endDate) matchConditions.createdAt.$lte = new Date(endDate);
    }

    if (zone && Array.isArray(zone) && zone.length > 0) {
      
      //console.log('Zonas recibidas:', JSON.stringify(zone));

      // 1. Buscamos si hay ALGUNA zona de tipo 'custom'
      const customZones = zone.filter(
        z => z.type === 'custom' && z.location && z.location.coordinates
      );

      if (customZones.length > 0) {
        // --- ESCENARIO 1: Hay zonas "custom" ---
        // Usamos consulta geoespacial ($geoWithin) con la ubicación del legajo.

        console.log('Modo de consulta: $geoWithin (Zonas personalizadas)');

        // Extraemos las coordenadas de cada polígono "custom"
        const multiPolygonCoordinates = customZones.map(
          z => z.location.coordinates
        );

        // Agregamos la condición $geoWithin a las condiciones del match.
        // Asumimos que tu schema 'Docket' tiene un campo 'location' con índice 2dsphere
        matchConditions.location = {
          $geoWithin: {
            $geometry: {
              type: 'MultiPolygon',
              // 'multiPolygonCoordinates' será un array de arrays de coordenadas.
              // Ej: [ [[[lng, lat], ...]], [[[lng, lat], ...]] ]
              coordinates: multiPolygonCoordinates
            }
          }
        };

      } else {
        // --- ESCENARIO 2: NO hay zonas "custom" ---
        // Usamos consulta por ID ($in) con el campo 'zone' del legajo.
        // (Todas las zonas son predefinidas, como "town")

        console.log('Modo de consulta: $in (Zonas predefinidas)');

        // Extraemos los _id de todas las zonas recibidas
        const zoneIds = zone
          .map(z => z._id)
          .filter(Boolean) // Filtramos por si alguno viene null/undefined
          .map(id => new mongoose.Types.ObjectId(id)); // Convertimos a ObjectId

        if (zoneIds.length > 0) {
          // Agregamos la condición $in al campo 'zone' (que es tu ObjectId)
          matchConditions.zone = {
            $in: zoneIds
          };
        }
      }
    }

    const pipeline = [
      { $match: matchConditions },
      { $lookup: { from: 'incident.docket_types', localField: 'docket_type', foreignField: '_id', as: 'docket_type_info' } },
      { $lookup: { from: 'incident.docket_areas', localField: 'docket_area', foreignField: '_id', as: 'docket_area_info' } },
      { $lookup: { from: 'incident.profile', localField: 'profile', foreignField: '_id', as: 'profile_info' } },
      { $unwind: { path: '$docket_type_info', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$docket_area_info', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$profile_info', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          docketId: 1, description: 1, status: 1, address: 1, createdAt: 1, updatedAt: 1, location:1,
          docket_type: '$docket_type_info.name',
          docket_area: '$docket_area_info.name',
          profile: {
            name: { $concat: [
              { $ifNull: ['$profile_info.name', ''] },
              " ",
              { $ifNull: ['$profile_info.last', ''] }
            ]},
            sentiment:  {
                            $let: {
                            vars: {
                                initialSentiment: {
                                $arrayElemAt: [
                                    {
                                    $filter: {
                                        input: '$sentiments',
                                        as: 's',
                                        cond: { $eq: ['$$s.analysisStage', 'initial'] }
                                    }
                                    },
                                    0
                                ]
                                }
                            },
                            in: '$$initialSentiment.sentiment'
                            }
                        }
          }
        }
      },
      {
        $facet: {
          metadata: [{ $count: "totalDocs" }],
          data: [
            { $sort: sortOptions },    
          //  { $skip: page * pageSize },
           // { $limit: pageSize }
          ]
        }
      }
    ];

    const result = await Docket.aggregate(pipeline);
    const data = result[0].data;
    const totalDocs = result[0].metadata[0] ? result[0].metadata[0].totalDocs : 0;

    res.json({
      data,
      total: totalDocs, 
      pagination: {
        total: totalDocs,
        page: page, // Devolvemos el page 0-based
        pageSize,
        totalPages: Math.ceil(totalDocs / pageSize),
      }
    });

  } catch (error) {
    console.error("Error en la búsqueda de dockets:", error);
    res.status(500).send('Error del servidor');
  }
});

router.patch('/docket/updatetype/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { docket_type: newDocketTypeId } = req.body;

    // --- Validación de IDs ---
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(newDocketTypeId)) {
      return res.status(400).json({ msg: 'Uno o más IDs proporcionados no son válidos.' });
    }

    console.log('req.body',req.body,id)
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    // --- 2. Buscar el legajo original (y popular su tipo actual) ---
    const originalDocket = await Docket.findOne({ _id: id, company: companyId })
                                               .populate('docket_type', 'name');

    if (!originalDocket) {
      return res.status(404).json({ msg: 'Legajo no encontrado o no tiene permisos para modificarlo.' });
    }

    const oldDocketTypeName = originalDocket.docket_type ? originalDocket.docket_type.name : 'Ninguno';
    const currentDocketStatus = originalDocket.status;

    const newDocketType = await DocketType.findById(newDocketTypeId).select('name');
    if (!newDocketType) {
        return res.status(404).json({ msg: 'El nuevo tipo de legajo no fue encontrado.' });
    }
    const newDocketTypeName = newDocketType.name;

    const historyContent = `Recategorizó el tipo de '${oldDocketTypeName}' a '${newDocketTypeName}'.`;

    const newHistory = new DocketHistory({
        docket: id,
        user: req.user.id, 
        userModel: 'users',
        status: currentDocketStatus, 
        content: historyContent
    });
    await newHistory.save();

    originalDocket.docket_type = newDocketTypeId;
    originalDocket.docket_type_predicted = undefined; // Invalidate old prediction
    let updatedDocket = await originalDocket.save();
    
    res.status(200).json(updatedDocket.docketId);

  } catch (error) {
    console.error("Error al actualizar el docket:", error);
    res.status(500).send('Error del servidor');
  }
});



router.patch('/docket/updatearea/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { docket_area: newDocketArea } = req.body; // Array of area objects

    console.log( req.body)
    // --- Validación de IDs ---
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: 'ID de legajo no válido.' });
    }

    if (!Array.isArray(newDocketArea)) {
        return res.status(400).json({ msg: 'El área del legajo debe ser un array.' });
    }

    const companyId = new mongoose.Types.ObjectId(req.user.company);

    // --- 2. Buscar el legajo original (y popular su area actual) ---
    const originalDocket = await Docket.findOne({ _id: id, company: companyId })
                                               .populate('docket_area', 'name');

    if (!originalDocket) {
      return res.status(404).json({ msg: 'Legajo no encontrado o no tiene permisos para modificarlo.' });
    }

    const oldDocketAreaNames = (originalDocket.docket_area || []).map(a => a.name).join(', ') || 'Ninguna';
    const currentDocketStatus = 'assigned';

    // Extraer solo los IDs de las nuevas áreas
    const newDocketAreaIds = newDocketArea.map(a => a._id);

    // Para el historial, buscamos los nombres de las nuevas áreas
    const newAreaDocs = await DocketArea.find({ '_id': { $in: newDocketAreaIds } }).select('name');
    const newDocketAreaNames = newAreaDocs.map(a => a.name).join(', ') || 'Ninguna';


    const historyContent = `Asignación de áreas: '${oldDocketAreaNames}' a '${newDocketAreaNames}'.`;

    const newHistory = new DocketHistory({
        docket: id,
        user: req.user.id, 
        userModel: 'users',
        status: currentDocketStatus, 
        content: historyContent
    });
    await newHistory.save();

    originalDocket.docket_area = newDocketAreaIds;
    originalDocket.status =currentDocketStatus;
    let updatedDocket = await originalDocket.save();
    
    res.status(200).json(updatedDocket.docketId);

  } catch (error) {
    console.error("Error al actualizar el área del legajo:", error);
    res.status(500).send('Error del servidor');
  }
});

router.patch('/docket/update/status/:id', auth, upload.single('file'), [
    check('status', 'El estado es requerido').not().isEmpty(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { id } = req.params;
        const { status: newStatus, observation } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de legajo no válido.' });
        }

        const companyId = new mongoose.Types.ObjectId(req.user.company);
        const originalDocket = await Docket.findOne({ _id: id, company: companyId });

        if (!originalDocket) {
            return res.status(404).json({ msg: 'Legajo no encontrado o no tiene permisos para modificarlo.' });
        }

        // Handle file upload
        let fileData = null;
        if (req.file) {
            const bucketName = process.env.S3_BUCKET_INCIDENT;
            if (!bucketName) {
                console.error("S3_BUCKET_INCIDENT environment variable not set.");
                return res.status(500).send('Error de configuración del servidor.');
            }
            // The uploadFileToS3 function returns an object that matches the history schema
            fileData = await uploadFileToS3(req.file, bucketName,'docket');
        }

        const statusTranslations = {
            'new': 'Nuevo',
            'assigned': 'Asignado',
            'in_progress': 'En Progreso',
            'reassigned': 'Reasignado',
            'on_hold': 'En Espera',
            'partially_resolved':'Parcialmente Resuelto',
            'resolved': 'Resuelto',
            'closed': 'Cerrado',
            'cancelled': 'Cancelado',
            'archived': 'Archivado',
            'deleted': 'Eliminado'
        };

        let historyContent = "";
        if (observation) {
            historyContent = observation;
        } else {
            const translatedNewStatus = statusTranslations[newStatus] || newStatus;
            historyContent  = `Cambio de estado: '${translatedNewStatus}'.`;
        }

        const newHistory = new DocketHistory({
            docket: id,
            user: req.user.id,
            userModel: 'users',
            status: newStatus,
            content: historyContent,
            files: fileData ? [fileData] : []
        });
        await newHistory.save();

        if (newStatus === 'activity') {
            // Only update the timestamp for 'activity' status
            originalDocket.updatedAt = new Date();
            await originalDocket.save();
        } else {
            // For any other status, update the status field and save
            originalDocket.status = newStatus;
            await originalDocket.save();
        }

        res.status(200).json(originalDocket.docketId);

    } catch (error) {
        console.error("Error al actualizar el estado del legajo:", error);
        res.status(500).send('Error del servidor');
    }
});


router.get('/docket/detail/:id', auth, async (req, res) => {
    console.log(req.params)
  try {
    const { id } = req.params;
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    // Validación del ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: 'ID de legajo no válido.' });
    }

    // Buscamos el legajo por su ID y el de la compañía para seguridad.
    const docket = await Docket.findOne({ _id: id, company: companyId })
      .populate({
          path: 'docket_type',
          select: 'name parent fields',
          populate: {
              path: 'parent',
              select: 'name'
          }
      })
      .populate({ path: 'docket_area', select: 'name' })
      .populate({ path: 'profile', select: 'name last email phone' })
      .populate('source', 'name label'); 

    const history = await DocketHistory.find({ docket: id })
      .sort({ createdAt: -1 })
      .populate('user', 'name last');

    // --- 3. Combinar los resultados ---
    if (!docket) {
        return res.status(404).json({ msg: 'Legajo no encontrado.' });
    }
    const docketObject = docket.toObject();

    // Transform the parent object into just the name
    if (docketObject.docket_type && docketObject.docket_type.parent && typeof docketObject.docket_type.parent === 'object') {
        docketObject.docket_type.parent = docketObject.docket_type.parent.name;
    }

    // 1. Define tu bucket (idealmente desde variables de entorno)
    const BUCKET_NAME = process.env.S3_BUCKET_INCIDENT; // Reemplaza con tu variable

    // 2. Verifica si el campo 'files' existe y es un array con contenido
    if (docketObject.details && Array.isArray(docketObject.details.files) && docketObject.details.files.length > 0) {
        
        // 3. Usa Promise.all para procesar todos los archivos en paralelo
        const updatedFiles = await Promise.all(
            docketObject.details.files.map(async (file) => {
                // Si el archivo tiene una 'key', genera la URL firmada
                if (file.key && BUCKET_NAME) {
                    const signedUrl = await getSignedUrlForFile(file.key, BUCKET_NAME);
                    // Devuelve una copia del objeto del archivo con la nueva URL
                    return { ...file, url: signedUrl };
                }
                // Si no hay 'key', devuelve el archivo sin cambios
                return file;
            })
        );
        
        // 4. Reemplaza el array de archivos original con el que tiene las URLs actualizadas
        docketObject.details.files = updatedFiles;
    }
    // --- FIN: NUEVO BLOQUE PARA PROCESAR ARCHIVOS S3 ---

    // --- NUEVO BLOQUE PARA PROCESAR ARCHIVOS DEL HISTORIAL ---
    if (history && history.length > 0 && BUCKET_NAME) {
        docketObject.history = await Promise.all(history.map(async (entry) => {
            const entryObject = entry.toObject();
            if (entryObject.files && entryObject.files.length > 0) {
                entryObject.files = await Promise.all(
                    entryObject.files.map(async (file) => {
                        if (file.key) {
                            try {
                                const signedUrl = await getSignedUrlForFile(file.key, BUCKET_NAME);
                                return { ...file, url: signedUrl };
                            } catch (urlError) {
                                console.error(`Failed to get signed URL for history file key ${file.key}:`, urlError);
                                return { ...file, url: null }; // Return with null URL on error
                            }
                        }
                        return file;
                    })
                );
            }
            return entryObject;
        }));
    } else {
        docketObject.history = history;
    }
    res.status(200).json(docketObject);

  } catch (error) {
    console.error("Error al obtener el detalle del docket:", error);
    res.status(500).send('Error del servidor');
  }
});


router.delete('/docket/delete/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de legajo no válido.' });
        }

        const docket = await Docket.findOne({ _id: id, company: companyId });

        if (!docket) {
            return res.status(404).json({ msg: 'Legajo no encontrado o no tiene permisos para eliminarlo.' });
        }

        docket.status = 'deleted';
        await docket.save();

        const newHistory = new DocketHistory({
            docket: docket._id,
            user: req.user.id,
            userModel: 'users',
            status: 'deleted',
            content: 'Legajo eliminado'
        });
        await newHistory.save();

        res.json({ msg: 'Legajo eliminado correctamente.', id: docket._id });

    } catch (error) {
        console.error("Error deleting docket:", error);
        res.status(500).send('Error del servidor');
        }
});

router.get('/docket/:id', auth, async (req, res) => {
    console.log(req.params)
  try {
    const { id } = req.params;
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    // Validación del ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ msg: 'ID de legajo no válido.' });
    }

    // Buscamos el legajo por su ID y el de la compañía para seguridad.
    const docket = await Docket.findOne({ _id: id, company: companyId })
      .populate({
          path: 'docket_type',
          select: 'name parent fields',
          populate: {
              path: 'parent',
              select: 'name'
          }
      })
      .populate({ path: 'docket_area', select: 'name' })
      .populate({ path: 'profile', select: 'name last email' })
      .populate('source', 'name label');

    // --- 3. Combinar los resultados ---
    if (!docket) {
        return res.status(404).json({ msg: 'Legajo no encontrado.' });
    }
    const docketObject = docket.toObject();

    // Transform the parent object into just the name
    if (docketObject.docket_type && docketObject.docket_type.parent && typeof docketObject.docket_type.parent === 'object') {
        docketObject.docket_type.parent = docketObject.docket_type.parent.name;
    }

    // 1. Define tu bucket (idealmente desde variables de entorno)
    const BUCKET_NAME = process.env.S3_BUCKET_INCIDENT; // Reemplaza con tu variable

    // 2. Verifica si el campo 'files' existe y es un array con contenido
    if (docketObject.details && Array.isArray(docketObject.details.files) && docketObject.details.files.length > 0) {
        
        // 3. Usa Promise.all para procesar todos los archivos en paralelo
        const updatedFiles = await Promise.all(
            docketObject.details.files.map(async (file) => {
                // Si el archivo tiene una 'key', genera la URL firmada
                if (file.key && BUCKET_NAME) {
                    const signedUrl = await getSignedUrlForFile(file.key, BUCKET_NAME);
                    // Devuelve una copia del objeto del archivo con la nueva URL
                    return { ...file, url: signedUrl };
                }
                // Si no hay 'key', devuelve el archivo sin cambios
                return file;
            })
        );
        
        // 4. Reemplaza el array de archivos original con el que tiene las URLs actualizadas
        docketObject.details.files = updatedFiles;
    }
    // --- FIN: NUEVO BLOQUE PARA PROCESAR ARCHIVOS S3 ---

    
    res.status(200).json(docketObject);

  } catch (error) {
    console.error("Error al obtener el detalle del docket:", error);
    res.status(500).send('Error del servidor');
  }
});

router.post('/profile/search',auth, async (req, res) => {

    try {
        const {
            name,
            dni,
            email,
            isVerified,
            zone,
            page = 0,
            pageSize = 10,
            sortBy = []
        } = req.body;

        const companyId = new mongoose.Types.ObjectId(req.user.company);

        console.log(JSON.stringify(req.body))

        const filter = {};
        filter.company = companyId;
        if (name) {
            const regexQuery = { $regex: name, $options: 'i'  }; 
            filter.$or = [
                { name: regexQuery },
                { last: regexQuery }
            ];
          
        }

        if (dni) {
            filter.dni = { $regex: dni, $options: 'i' };
        }

        if (email) {
            filter.email = { $regex: email, $options: 'i' };
        }

        if (isVerified === true) {
            filter.isVerified = true;
        }

        // --- (!!) MODIFICACIÓN: Búsqueda Geoespacial por Array de Zonas ---
        // 'zone' es ahora un array de objetos de zona completos
        if (zone && Array.isArray(zone) && zone.length > 0) {
            
            // 1. Extraer las coordenadas de *cada* polígono del array
            const allPolygonCoordinates = zone
                .map(z => {
                    // Validamos que el objeto de zona tenga la geometría
                    if (z && z.location && z.location.type === 'Polygon' && z.location.coordinates) {
                        // z.location.coordinates tiene el formato [[ [lng, lat], ... ]]
                        return z.location.coordinates;
                    }
                    return null; // Ignorar zonas malformadas
                })
                .filter(Boolean); // 'filter(Boolean)' elimina los nulls

            if (allPolygonCoordinates.length > 0) {
                const multiPolygonGeometry = {
                    type: "MultiPolygon",
                    coordinates: allPolygonCoordinates
                };

                filter.location = {
                    $geoWithin: {
                        $geometry: multiPolygonGeometry
                    }
                };
            }
        }
        
        const sort = {};
       
        if (Array.isArray(sortBy) && sortBy.length > 0) {
            sortBy.forEach(item => {
                if (item.id) {
                    sort[item.id] = item.desc ? -1 : 1; 
                }
            });
        }

        if (Object.keys(sort).length === 0) {
            sort.createdAt = -1;
        }

      
        const limit = parseInt(pageSize, 10);
        const skip = parseInt(page, 10) * limit;

        const pipeline = [];
        if (Object.keys(filter).length > 0) {
            pipeline.push({ $match: filter });
        }
        
        // STAGE 2: $sort
        pipeline.push({ $sort: sort });
        pipeline.push({
            $facet: {
                metadata: [{ $count: 'total' }],
                data: [
                    { $skip: skip },
                    { $limit: limit },
                    { $project: { password: 0 } }
                ]
            }
        });

        const collationOptions = {
            locale: 'es', // Español
            strength: 1   // Ignora acentos y mayúsculas/minúsculas
        };

        const results = await IncidentProfile.aggregate(pipeline).collation(collationOptions);

        const data = results[0].data;
        const totalCount = results[0].metadata[0] ? results[0].metadata[0].total : 0;
       // const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json({
            data,
           // page: parseInt(page, 10),
           // pageSize: limit,
           // totalPages,
            total:totalCount
        });

    } catch (error) {
        console.error("Error searching profiles:", error);
        // Manejo de errores (ej. error de índice geoespacial)
        if (error.code === 2 || (error.message && error.message.includes("geometry"))) {
             return res.status(400).json({ message: "Error en los parámetros de búsqueda geoespacial. Verifique el formato de las 'zonas'." });
        }
        res.status(500).json({ message: "Error interno del servidor" });
    }
});


router.get('/type/', auth, async (req, res) => {
  try {
    // 1. Extraer parámetros de REQ.QUERY y establecer valores por defecto
    const { search } = req.query;
    const page = parseInt(req.query.page) || 0;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    let sortBy = [];
    if (req.query.sortBy) {
      try {
        sortBy = JSON.parse(req.query.sortBy);
      } catch (e) {
        console.warn('sortBy query param no es un JSON válido:', req.query.sortBy);
        sortBy = [];
      }
    }

    // 2. Construir la consulta de filtro
    let matchQuery = { company: companyId };

    // Validar y añadir _id si existe y es válido
    if (search && 
        typeof search === 'object' && 
        search._id && 
        mongoose.Types.ObjectId.isValid(search._id)
    ) {
        
        const searchId = new mongoose.Types.ObjectId(search._id);

        try {
            // --- INICIO DE LA NUEVA LÓGICA ---
            const rootDoc = await DocketType.findById(searchId).select('slug').lean();

            if (rootDoc && rootDoc.slug) {
                // 2. Creamos una expresión regular para buscar todos los descendientes.
                // Ej: Si el slug es 'alerta_tigre', buscará todo lo que empiece con 'alerta_tigre_'
                const descendantsRegex = new RegExp('^' + rootDoc.slug + '_');

                // 3. Modificamos el matchQuery para incluir el documento raíz Y sus descendientes
                matchQuery = {
                    company: companyId, // Mantenemos el filtro de compañía
                    $or: [
                        { _id: searchId },             // 1. El propio documento raíz
                        { slug: descendantsRegex }     // 2. Todos sus descendientes
                    ]
                };

            } else {
                // No se encontró el doc o no tiene slug, solo buscar por _id
                matchQuery._id = searchId;
            }
            // --- FIN DE LA NUEVA LÓGICA ---

        } catch (e) {
            console.error("Error al buscar el slug del documento raíz:", e);
            // Fallback: buscar solo por el ID si la búsqueda del slug falla
            matchQuery._id = searchId;
        }

    }

    // 3. Construir las opciones de ordenamiento
   // let sortOptions = { position: 1, name: 1 };
    let sortOptions = { slug: 1 };
    
    if (sortBy && sortBy.length > 0) {
      sortOptions = sortBy.reduce((acc, sort) => {
        acc[sort.id] = sort.desc ? -1 : 1;
        return acc;
      }, {});
    }

    // 4. Construir el Pipeline de Agregación
    const dataPipeline = [
      // --- Filtro inicial
      { $match: matchQuery },
      { $sort: sortOptions },
      { $skip: page * pageSize },
      { $limit: pageSize },

      // --- Buscar el documento padre ---
      {
        $lookup: {
          from: 'incident.docket_types', // Nombre real de la colección
          localField: 'parent',
          foreignField: '_id',
          as: 'parentDoc',
        },
      },
      {
        $unwind: {
          path: '$parentDoc',
          preserveNullAndEmptyArrays: true,
        },
      },
      // --- Proyección: Formatear la salida final ---
      {
        $project: {
          _id: 1,
          name: 1,
          parent: 1,
          status: 1,
          slug: 1, // <--- CAMPO AÑADIDO
          position: 1, // <--- CAMPO AÑADIDO
          keywords: 1, // <--- CAMPO AÑADIDO
          parentName: { $ifNull: ['$parentDoc.name', null] }, // <--- CAMPO NUEVO
          
          // Transformar el array 'fields'
          fields: {
            $map: {
              input: { $ifNull: ['$fields', []] }, // Maneja si 'fields' no existe
              as: 'field',
              in: {
                label: '$$field.label',
                type: '$$field.fieldType', // Renombramos aquí
              },
            },
          },
        },
      },
    ];

    // 5. Ejecutar consultas de datos y conteo en paralelo
    const [data, total] = await Promise.all([
      DocketType.aggregate(dataPipeline), // <--- CAMBIO: Usamos aggregate
      DocketType.countDocuments(matchQuery), // Mantenemos el conteo simple
    ]);

    // 6. Enviar la respuesta final
    // ¡Ya no necesitamos el .map() aquí, la BD hizo el trabajo!
    res.status(200).json({ data, total });

  } catch (error) {
    console.error('Error al obtener DocketTypes:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});



router.get('/type/flow', auth, async (req, res) => {

  try {
   
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    const matchQuery = {};
    matchQuery.company = companyId;
    let sortOptions = { slug: 1 };

    // 4. Construir el Pipeline de Agregación
    const dataPipeline = [
      { $match: matchQuery },
      { $sort: sortOptions },
      {
        $lookup: {
          from: 'incident.docket_types', // Nombre real de la colección
          localField: 'parent',
          foreignField: '_id',
          as: 'parentDoc',
        },
      },
      {
        $unwind: {
          path: '$parentDoc',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          parent: 1,
          status: 1,
          slug: 1,
          position: 1, 
          keywords: 1,
          parentName: { $ifNull: ['$parentDoc.name', null] }, 
          fields: {
            $map: {
              input: { $ifNull: ['$fields', []] }, 
              as: 'field',
              in: {
                label: '$$field.label',
                type: '$$field.fieldType', 
              },
            },
          },
        },
      },
    ];

    const data = await DocketType.aggregate(dataPipeline);

    res.status(200).json(data);

  } catch (error) {
    console.error('Error al obtener DocketTypes:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

router.post('/type', [auth, [
    check('name', 'El nombre es requerido').not().isEmpty(),
    check('status', 'El estado es requerido').isNumeric(),
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        name,
        parent,
        position,
        fields,
        keywords,
        status,
        docket_area
    } = req.body;

    try {
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        let parentId = null;
        if (parent) {
            // Handle parent being an object { _id: '...' } or a string
            const idToTest = typeof parent === 'object' && parent !== null ? parent._id : parent;
            if (mongoose.Types.ObjectId.isValid(idToTest)) {
                parentId = idToTest;
            } else {
                return res.status(400).json({ errors: [{ msg: 'El ID del padre proporcionado no es válido.' }] });
            }
        }

        let docketAreaIds = [];
        if (docket_area && Array.isArray(docket_area)) {
            docketAreaIds = docket_area.map(area => new mongoose.Types.ObjectId(area._id));
        }

        const docketType = new DocketType({
            company: companyId,
            name,
            parent: parentId,
            position: position ? parseInt(position, 10) : 0,
            fields: fields, // Frontend sends the correct format
            keywords,
            status,
            docket_area: docketAreaIds
        });

        await docketType.save();

        res.json(docketType);

    } catch (err) {
        console.error(err.message);
        // The pre-save hook handles slug uniqueness, but a race condition could still cause a duplicate key error.
        if (err.code === 11000) {
            return res.status(400).json({ errors: [{ msg: 'El slug generado a partir del nombre ya existe. Pruebe con otro nombre.' }] });
        }
        if (err.kind === 'ObjectId') {
            return res.status(400).json({ msg: 'ID con formato incorrecto' });
        }
        res.status(500).send('Error del servidor');
    }
});

router.put('/type/:id', [auth, [
    check('name', 'El nombre es requerido').not().isEmpty(),
    check('status', 'El estado es requerido').isNumeric(),
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const {
        name,
        parent,
        position,
        fields,
        keywords,
        status,
        docket_area
    } = req.body;

    try {
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de tipo de legajo no válido.' });
        }

        let docketType = await DocketType.findOne({ _id: id, company: companyId });

        if (!docketType) {
            return res.status(404).json({ msg: 'Tipo de legajo no encontrado.' });
        }

        let parentId = null;
        if (parent) {
            const idToTest = typeof parent === 'object' && parent !== null ? parent._id : parent;
            if (mongoose.Types.ObjectId.isValid(idToTest)) {
                parentId = idToTest;
            } else {
                return res.status(400).json({ errors: [{ msg: 'El ID del padre proporcionado no es válido.' }] });
            }
        }

        let docketAreaIds = [];
        if (docket_area && Array.isArray(docket_area)) {
            docketAreaIds = docket_area.map(area => new mongoose.Types.ObjectId(area._id));
        }

        docketType.name = name;
        docketType.parent = parentId;
        docketType.position = position ? parseInt(position, 10) : 0;
        docketType.fields = fields;
        docketType.keywords = keywords;
        docketType.status = status;
        docketType.docket_area = docketAreaIds;

        await docketType.save();

        res.json(docketType);

    } catch (err) {
        console.error(err.message);
        if (err.code === 11000) {
            return res.status(400).json({ errors: [{ msg: 'El slug generado a partir del nombre ya existe. Pruebe con otro nombre.' }] });
        }
        if (err.kind === 'ObjectId') {
            return res.status(400).json({ msg: 'ID con formato incorrecto' });
        }
        res.status(500).send('Error del servidor');
    }
});


router.get('/type/detail/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de tipo de legajo no válido.' });
        }

        let docketType = await DocketType.findOne({ _id: id, company: companyId })
            .populate('parent', 'name slug')
            .populate({
                path: 'docket_area',
                select: 'name parent',
                populate: {
                    path: 'parent',
                    select: 'name'
                }
            })
            .lean();

        if (!docketType) {
            return res.status(404).json({ msg: 'Tipo de legajo no encontrado.' });
        }

        if (docketType.docket_area) {
            docketType.docket_area = docketType.docket_area.map(area => ({
                _id: area._id,
                name: area.name,
                parent: area.parent ? area.parent.name : null
            }));
        }

        res.json(docketType);

    } catch (error) {
        console.error("Error al obtener el detalle del tipo de legajo:", error);
        res.status(500).send('Error del servidor');
    }
});

// **************** AREA

router.get('/area/', auth, async (req, res) => {
  try {
    // 1. Extraer parámetros de REQ.QUERY y establecer valores por defecto
    const { search } = req.query;
    const page = parseInt(req.query.page) || 0;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    let sortBy = [];
    if (req.query.sortBy) {
      try {
        sortBy = JSON.parse(req.query.sortBy);
      } catch (e) {
        console.warn('sortBy query param no es un JSON válido:', req.query.sortBy);
        sortBy = [];
      }
    }

    // 2. Construir la consulta de filtro
    let matchQuery = { company: companyId };

    // Validar y añadir _id si existe y es válido
    if (search && 
        typeof search === 'object' && 
        search._id && 
        mongoose.Types.ObjectId.isValid(search._id)
    ) {
        
        const searchId = new mongoose.Types.ObjectId(search._id);

        try {
            // --- INICIO DE LA NUEVA LÓGICA ---
            const rootDoc = await DocketArea.findById(searchId).select('slug').lean();

            if (rootDoc && rootDoc.slug) {
                // 2. Creamos una expresión regular para buscar todos los descendientes.
                // Ej: Si el slug es 'alerta_tigre', buscará todo lo que empiece con 'alerta_tigre_'
                const descendantsRegex = new RegExp('^' + rootDoc.slug + '_');

                matchQuery = {
                    company: companyId, // Mantenemos el filtro de compañía
                    $or: [
                        { _id: searchId },             // 1. El propio documento raíz
                        { slug: descendantsRegex }     // 2. Todos sus descendientes
                    ]
                };

            } else {
                matchQuery._id = searchId;
            }

        } catch (e) {
            console.error("Error al buscar el slug del documento raíz:", e);
            matchQuery._id = searchId;
        }

    }

    // 3. Construir el Pipeline de Agregación
    const dataPipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: 'incident.docket_areas',
          localField: 'parent',
          foreignField: '_id',
          as: 'parentDoc',
        },
      },
      {
        $unwind: {
          path: '$parentDoc',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          // Usamos el slug del padre como campo de agrupación, o el propio slug si es un padre.
          sortGroup: { $ifNull: ['$parentDoc.slug', '$slug'] },
          // Un campo para asegurar que los padres (parent: null) vengan antes que los hijos.
          isParent: { $cond: { if: { $eq: ['$parent', null] }, then: 0, else: 1 } }
        }
      },
      // Ordenamos por el grupo, luego para poner al padre primero, y finalmente por el slug del item.
      { $sort: { sortGroup: 1, isParent: 1, slug: 1 } },
      { $skip: page * pageSize },
      { $limit: pageSize },
      {
        $project: {
          _id: 1,
          name: 1,
          parent: 1,
          status: 1,
          slug: 1,
          position: 1,
          keywords: 1,
          address: 1,
          notify: 1,
          emails: 1,
          parentName: { $ifNull: ['$parentDoc.name', null] },
          zone: { $size: { $ifNull: ['$zone', []] } }
        },
      },
    ];

    const [data, total] = await Promise.all([
      DocketArea.aggregate(dataPipeline),
      DocketArea.countDocuments(matchQuery),
    ]);

    // 6. Enviar la respuesta final
    res.status(200).json({ data, total });

  } catch (error) {
    console.error('Error al obtener DocketArea:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
}); 



router.get('/area/flow', auth, async (req, res) => {

  try {
   
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    const matchQuery = {};
    matchQuery.company = companyId;
    let sortOptions = { slug: 1 };

    // 4. Construir el Pipeline de Agregación
    const dataPipeline = [
      { $match: matchQuery },
      { $sort: sortOptions },
      {
        $lookup: {
          from: 'incident.docket_areas', // Nombre real de la colección
          localField: 'parent',
          foreignField: '_id',
          as: 'parentDoc',
        },
      },
      {
        $unwind: {
          path: '$parentDoc',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          parent: 1,
          status: 1,
          slug: 1,
          position: 1, 
          keywords: 1,
          parentName: { $ifNull: ['$parentDoc.name', null] }, 
          fields: {
            $map: {
              input: { $ifNull: ['$fields', []] }, 
              as: 'field',
              in: {
                label: '$$field.label',
                type: '$$field.fieldType', 
              },
            },
          },
        },
      },
    ];

    const data = await DocketArea.aggregate(dataPipeline);

    res.status(200).json(data);

  } catch (error) {
    console.error('Error al obtener DocketTypes:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

router.get('/area/name', auth, async (req, res) => {

    try {
        const { search: searchTerm } = req.query;
        const companyId  = new mongoose.Types.ObjectId(req.user.company);

        if (!searchTerm || searchTerm.length < 2) {
            return res.json([]);
        }

        const pipeline = [
                {
                    $search: {
                        index: 'docketAreaSearch',	
                        compound: {
                            filter: [
                                { equals: { path: 'status', value: 1 } },
                                { equals: { path: 'company', value: companyId } }
                            ],
                            must: [
                                {
                                    text: {
                                        query: searchTerm, 
                                        path: 'searchText'
                                    }
                                }
                            ]
                        }
                    }
                },
                {
                    $lookup: {
                    from: "incident.docket_areas", 
                    localField: "parent",    
                    foreignField: "_id",       
                    as: "parentDoc" 
                    }
                },
                {
                    $addFields: {
                    sortPriority: {
                        $cond: { if: { $eq: ["$parent", null] }, then: 0, else: 1 }
                    },
                    parentName: { $arrayElemAt: ["$parentDoc.name", 0] }
                    }
                },
                {
                    $sort: {
                    sortPriority: 1,
                    name: 1
                    }
                },
                {
                    $project: {
                    _id: 1,
                    name: 1,
                    parent: "$parentName",
                    score: { $meta: "searchScore" }
                    }
                }
                ];

        const results = await DocketArea.aggregate(pipeline);
        res.json(results);

    } catch (error) {
        console.error("Error en la búsqueda de autocomplete con Atlas:", error);
        res.status(500).send('Error del servidor');
    }
});

router.post('/report', [auth, [
    check('docket_type', 'Los tipos de legajo deben ser un array de IDs válidos').optional().isArray().custom(value => {
        if (value.some(id => !mongoose.Types.ObjectId.isValid(id))) {
            throw new Error('Algunos IDs de tipo de legajo no son válidos');
        }
        return true;
    }),
    check('status', 'Los estados deben ser un array de strings').optional().isArray().custom(value => {
        if (value.some(s => typeof s !== 'string')) {
            throw new Error('Algunos estados no son strings válidos');
        }
        return true;
    })
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const companyId = new mongoose.Types.ObjectId(req.user.company);
        const { docket_type, status, startDate, endDate, docket_area } = req.body;

        // 1. Build Initial Match Conditions
        const matchConditions = { company: companyId };

        const targetStatus = (status && status.length > 0) ? status : ['new', 'in_progress', 'resolved'];
        matchConditions.status = { $in: targetStatus };

        if (startDate || endDate) {
            matchConditions.createdAt = {};
            if (startDate) matchConditions.createdAt.$gte = moment(startDate).startOf('day').toDate();
            if (endDate) matchConditions.createdAt.$lte = moment(endDate).endOf('day').toDate();
        }

        if (docket_type && docket_type.length > 0) {
            const initialTypeIds = docket_type.map(id => new mongoose.Types.ObjectId(id));
            const idSearchPipeline = [
                { $match: { _id: { $in: initialTypeIds } } },
                { $graphLookup: { from: 'incident.docket_types', startWith: '$_id', connectFromField: '_id', connectToField: 'parent', as: 'descendants', maxDepth: 10 } },
                { $project: { allRelatedIds: { $concatArrays: [['$_id'], '$descendants._id'] } } },
                { $unwind: '$allRelatedIds' },
                { $group: { _id: '$allRelatedIds' } }
            ];
            const idDocs = await DocketType.aggregate(idSearchPipeline);
            const allIdsToFilter = idDocs.map(doc => doc._id);
            if (allIdsToFilter.length > 0) {
                matchConditions.docket_type = { $in: allIdsToFilter };
            } else {
                matchConditions.docket_type = { $in: initialTypeIds };
            }
        }
        
        if (docket_area && docket_area.length > 0) {
            const initialAreaIds = docket_area.map(id => new mongoose.Types.ObjectId(id));
            const idSearchPipeline = [
                { $match: { _id: { $in: initialAreaIds } } },
                { $graphLookup: { from: 'incident.docket_areas', startWith: '$_id', connectFromField: '_id', connectToField: 'parent', as: 'descendants', maxDepth: 10 } },
                { $project: { allRelatedIds: { $concatArrays: [['$_id'], '$descendants._id'] } } },
                { $unwind: '$allRelatedIds' },
                { $group: { _id: '$allRelatedIds' } }
            ];
            const idDocs = await DocketArea.aggregate(idSearchPipeline);
            const allIdsToFilter = idDocs.map(doc => doc._id);
            if (allIdsToFilter.length > 0) {
                matchConditions.docket_area = { $in: allIdsToFilter };
            } else {
                matchConditions.docket_area = { $in: initialAreaIds };
            }
        }

        // 2. Pre-aggregation to find top 8 docket types based on initial filters
        const topTypesPipeline = [
            { $match: matchConditions },
            { $group: { _id: '$docket_type', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
            { $project: { _id: 1 } }
        ];
        const topTypesResult = await Docket.aggregate(topTypesPipeline);
        const topTypesIds = topTypesResult.map(item => item._id).filter(id => id); // Filter out potential null/undefined IDs

        // 3. Finalize match conditions to only include dockets from the top types
        // This ensures all subsequent pipelines operate on the exact same dataset
        if (topTypesIds.length > 0) {
            matchConditions.docket_type = { $in: topTypesIds };
        } else {
            // If no types are found (e.g., empty result set), ensure no documents match.
            // Using an impossible condition.
            matchConditions.docket_type = { $in: [new mongoose.Types.ObjectId()] };
        }

        // 4. Define final pipelines using the unified matchConditions
        const barPipeline = [
            { $match: matchConditions },
            { $group: { _id: { docket_type: '$docket_type', status: '$status' }, count: { $sum: 1 } } },
            { $group: { _id: '$_id.docket_type', statuses: { $push: { k: '$_id.status', v: '$count' } }, total: { $sum: '$count' } } },
            { $sort: { total: -1 } },
            // The limit is no longer needed here as the filter is already applied in $match
            { $lookup: { from: 'incident.docket_types', localField: '_id', foreignField: '_id', as: 'docketTypeInfo' } },
            { $unwind: { path: '$docketTypeInfo', preserveNullAndEmptyArrays: true } },
            { // NEW: Lookup for parent docket type info
                $lookup: {
                    from: 'incident.docket_types', // Same collection
                    localField: 'docketTypeInfo.parent',
                    foreignField: '_id',
                    as: 'parentDocketTypeInfo'
                }
            },
            { // NEW: Unwind parent docket type info
                $unwind: {
                    path: '$parentDocketTypeInfo',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 0,
                    type: { $ifNull: ['$docketTypeInfo.name', 'Sin Tipo'] },
                    parent: { $ifNull: ['$parentDocketTypeInfo.name', null] },
                    ...targetStatus.reduce((acc, s) => {
                        acc[s] = {
                            $reduce: {
                                input: '$statuses',
                                initialValue: 0,
                                in: { $cond: [ { $eq: ['$$this.k', s] }, { $add: ['$$value', '$$this.v'] }, '$$value' ] }
                            }
                        };
                        return acc;
                    }, {})
                }
            }
        ];

        const piePipeline = [
            { $match: matchConditions },
            { $group: { _id: '$source', value: { $sum: 1 } } },
            { $lookup: { from: 'incident.source', localField: '_id', foreignField: '_id', as: 'sourceInfo' } },
            { $unwind: { path: '$sourceInfo', preserveNullAndEmptyArrays: true } },
            { $project: { _id: 0, id: { $ifNull: ['$sourceInfo.name', 'unknown'] }, label: { $ifNull: ['$sourceInfo.label', 'Desconocido'] }, value: '$value' } }
        ];
        

        const linePipeline = [
            { $match: matchConditions },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Argentina/Buenos_Aires' } },
                        status: '$status'
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: '$_id.date',
                    counts: { $push: { status: '$_id.status', count: '$count' } }
                }
            },
            { $sort: { _id: 1 } },
            {
                $project: {
                    _id: 0,
                    date: '$_id',
                    ...targetStatus.reduce((acc, s) => {
                        acc[s] = {
                            $reduce: {
                                input: '$counts',
                                initialValue: 0,
                                in: { $cond: [{ $eq: ['$$this.status', s] }, { $add: ['$$value', '$$this.count'] }, '$$value'] }
                            }
                        };
                        return acc;
                    }, {})
                }
            }
        ];

        const zonePipeline = [
                { $match: matchConditions },
                { $match: { zone: { $ne: null } } },
                { $group: { _id: '$zone', value: { $sum: 1 } } },
                { $project: { _id: 0, id: '$_id', value: '$value' } }
            ];
        
        // 5. Execute all pipelines in parallel
        const [bar, pie,zoneData ] = await Promise.all([ // eliminado line
            Docket.aggregate(barPipeline),
            Docket.aggregate(piePipeline),
          //  Docket.aggregate(linePipeline)
            Docket.aggregate(zonePipeline)
        ]);

        const zoneIds = zoneData.map(z => z.id);
        const zoneFeatures = await Zone.find({ _id: { $in: zoneIds } }).select('name location').lean();
        const features = zoneFeatures.map(zone => ({
                type: 'Feature',
                id: zone._id.toString(),
                properties: {
                    name: zone.name,
                },
                geometry: zone.location
            }));

        res.json({ 
            bar, pie, 
            zone: {
                data: zoneData,
                features: {
                    type: 'FeatureCollection',
                    features: features
                }
            },
            status: targetStatus });

    } catch (error) {
        console.error("Error en el endpoint /report:", error);
        res.status(500).send('Error del servidor');
    }
});


router.post('/area', [auth, [
    check('name', 'El nombre es requerido').not().isEmpty(),
    check('status', 'El estado es requerido').isNumeric(),
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        name,
        parent,
        position,
        keywords,
        status,
        address,
        zone,
        location,
        emails,
        notify
    } = req.body;

    try {
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        let parentId = null;
        if (parent) {
            const idToTest = typeof parent === 'object' && parent !== null ? parent._id : parent;
            if (mongoose.Types.ObjectId.isValid(idToTest)) {
                parentId = idToTest;
            } else {
                return res.status(400).json({ errors: [{ msg: 'El ID del padre proporcionado no es válido.' }] });
            }
        }

        const docketArea = new DocketArea({
            company: companyId,
            name,
            parent: parentId,
            position: position ? parseInt(position, 10) : 0,
            keywords,
            status,
            address,
            zone: zone ? zone.map(z => z._id) : [],
            location,
            emails,
            notify
        });

        await docketArea.save();

        res.json(docketArea);

    } catch (err) {
        console.error(err.message);
        if (err.code === 11000) {
            return res.status(400).json({ errors: [{ msg: 'El slug generado a partir del nombre ya existe. Pruebe con otro nombre.' }] });
        }
        if (err.kind === 'ObjectId') {
            return res.status(400).json({ msg: 'ID con formato incorrecto' });
        }
        res.status(500).send('Error del servidor');
    }
});

router.get('/area/detail/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de área no válido.' });
        }

        const docketArea = await DocketArea.findOne({ _id: id, company: companyId })
                                             .populate('parent', 'name slug')
                                             .populate('zone', 'name');

        if (!docketArea) {
            return res.status(404).json({ msg: 'Área no encontrada.' });
        }

        res.json(docketArea);

    } catch (error) {
        console.error("Error al obtener el detalle del área:", error);
        res.status(500).send('Error del servidor');
    }
});


router.patch('/area/:id', [auth, [
    check('name', 'El nombre es requerido').not().isEmpty(),
    check('status', 'El estado es requerido').isNumeric(),
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const {
        name,
        parent,
        position,
        keywords,
        status,
        address,
        zone,
        location,
        emails,
        notify
    } = req.body;

    try {
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ msg: 'ID de área no válido.' });
        }

        let docketArea = await DocketArea.findOne({ _id: id, company: companyId });

        if (!docketArea) {
            return res.status(404).json({ msg: 'Área no encontrada.' });
        }

        let parentId = null;
        if (parent) {
            const idToTest = typeof parent === 'object' && parent !== null ? parent._id : parent;
            if (mongoose.Types.ObjectId.isValid(idToTest)) {
                parentId = idToTest;
            } else {
                return res.status(400).json({ errors: [{ msg: 'El ID del padre proporcionado no es válido.' }] });
            }
        }

        docketArea.name = name;
        docketArea.parent = parentId;
        docketArea.position = position ? parseInt(position, 10) : 0;
        docketArea.keywords = keywords;
        docketArea.status = status;
        docketArea.address = address;
        docketArea.zone = zone ? zone.map(z => z._id) : [];
        docketArea.location = location;
        docketArea.emails = emails;
        docketArea.notify = notify;

        await docketArea.save();

        res.json(docketArea);

    } catch (err) {
        console.error(err.message);
        if (err.code === 11000) {
            return res.status(400).json({ errors: [{ msg: 'El slug generado a partir del nombre ya existe. Pruebe con otro nombre.' }] });
        }
        if (err.kind === 'ObjectId') {
            return res.status(400).json({ msg: 'ID con formato incorrecto' });
        }
        res.status(500).send('Error del servidor');
    }
});

router.post('/docket/:id/subscribe', [
    auth,
    check('email').optional().isEmail().withMessage('Por favor, provee un email válido.'),
    check('profileId').optional().isMongoId().withMessage('El ID de perfil no es válido.')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id: docketId } = req.params;
    const { email, profileId } = req.body;

    if ((!email && !profileId) || (email && profileId)) {
        return res.status(400).json({ msg: 'Debe proveer un `email` o un `profileId`, pero no ambos.' });
    }

    try {
        let newSubscriber;
        if (email) {
            newSubscriber = { email: email.toLowerCase() };
        } else {
            const profileExists = await IncidentProfile.findById(profileId);
            if (!profileExists) {
                return res.status(404).json({ msg: 'Perfil de suscriptor no encontrado.' });
            }
            newSubscriber = { profile: profileId };
        }

        const updatedDocket = await Docket.findByIdAndUpdate(
            docketId,
            { $addToSet: { subscribers: newSubscriber } },
            { new: true }
        ).populate('subscribers.profile', 'name last email');

        if (!updatedDocket) {
            return res.status(404).json({ msg: 'Legajo no encontrado.' });
        }

        res.json({ msg: 'Operación de suscripción completada.', docket: updatedDocket });

    } catch (error) {
        console.error("Error al suscribir al legajo:", error);
        res.status(500).send('Error del servidor');
    }
});


router.get('/source', auth, async (req, res) => {
    try {
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        // Find sources that are either specific to the user's company
        // or are global, locked sources (company: null, locked: true)
        const sources = await DocketSource.find({
            status: 1, // Only active sources
            $or: [
                { company: companyId },
                { company: null, locked: true }
            ]
        }).select('_id name label').sort({ position:1, name: 1 });

        // Format the response as requested
        const formattedSources = sources.map(source => ({
            value: source._id,
            label: source.label
        }));

        res.json(formattedSources);

    } catch (error) {
        console.error("Error fetching docket sources:", error);
        res.status(500).send('Error del servidor');
    }
});

module.exports = router;