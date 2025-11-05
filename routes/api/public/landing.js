const express = require('express');
const { check, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const IncidentDocketType = require('../../../models/IncidentDocketType');
const IncidentProfile = require('../../../models/IncidentProfile');
const authIncident = require('../../../middleware/authIncident');
const IncidentDocket = require('../../../models/IncidentDocket');
const DocketSource = require('../../../models/IncidentDocketSource');
const DocketHistory = require('../../../models/IncidentDocketHistory');
const multer = require('multer');
const https = require('https');
const upload = multer({ storage: multer.memoryStorage({}), limits: { fileSize: 10 * 1024 * 1024 } }); // Límite de 10MB por archivo
const { uploadFileToS3 } = require('../../../utils/s3helper');
const { sendDocketEmail } = require('../../../utils/ses');
const IncidentDocketTypeAI = require('../../../models/IncidentDocketTypeAI');

const companyId = new mongoose.Types.ObjectId('68e9c3977c6f1f402e7b91e0');

/**
 * @route   GET /api/public/categories/search
 * @desc    Busca tipos de expedientes (categorías) para el autocompletado del landing page.
 * @access  Public
 */
router.get('/categories/search', async (req, res) => {

  try {
    
    const { q: searchTerm } = req.query;
    if (!searchTerm || searchTerm.length < 3) {
      return res.json([]);
    }

    const pipeline = [
      {
        $search: {
          index: 'docketTypeSearch', // El nombre de tu índice de Atlas Search
          compound: {
            filter: [
              { equals: { path: 'status', value: 1 } },
              { equals: { path: 'company', value: companyId } } // <-- FILTRO AÑADIDO
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
        $limit: 10
      },
      {
        $lookup: {
          from: "incident.docket_types", // Asegúrate que el nombre de la colección sea correcto
          localField: "parent",
          foreignField: "_id",
          as: "parentDoc"
        }
      },
      {
        $project: {
          _id: 1,
          name: 1,
          parent: { $arrayElemAt: ["$parentDoc.name", 0] },
          fields: 1,
          score: { $meta: "searchScore" }
        }
      }
    ];

    const results = await IncidentDocketType.aggregate(pipeline);
    
    res.json(results);

  } catch (error) {
    console.error("Error en la búsqueda de categorías (Atlas):", error);
    res.status(500).send('Error del servidor');
  }
});

//@access Public
router.post('/predict', async (req, res) => {
    const { text } = req.body;

    try {
        // Predicción
        const url = `${process.env.TIGRESIRVE_NLP_URL}/predict`;
        const response = await axios.post(url, { text });
        const predictionPayload = response.data;

        if (!predictionPayload.categories || predictionPayload.categories.length === 0) {
            return res.status(500).json({ error: 'La API de predicción no devolvió categorías.' });
        }

        console.log('predictionPayload', JSON.stringify(predictionPayload));

        // Extraer todos los IDs de las categorías predichas
        const categoryIds = predictionPayload.categories.map(cat => cat._id).filter(id => id);

        if (categoryIds.length === 0) {
            // Si ninguna categoría tiene un ID, devolvemos el payload original.
            return res.status(200).json(predictionPayload);
        }

        // Buscar todos los IncidentDocketType correspondientes a los IDs
        const docketTypes = await IncidentDocketType.find({
            '_id': { $in: categoryIds }
        }).populate('parent');

        // Crear un mapa para un acceso eficiente a la información de cada tipo
        const docketTypesMap = new Map(docketTypes.map(dt => [dt._id.toString(), dt]));

        // Enriquecer las categorías originales con la información de la base de datos, manteniendo el orden
        const enrichedCategories = predictionPayload.categories.map(cat => {
            const docketTypeInfo = docketTypesMap.get(cat._id);
            if (docketTypeInfo) {
                return {
                    ...cat,
                    name: docketTypeInfo.name,
                    parent: docketTypeInfo.parent?.name || null,
                    fields: docketTypeInfo.fields
                };
            }
            return cat; 
        });

        const finalResponse = {
            prediction: enrichedCategories.length > 0 ? enrichedCategories[0] : null,
            categories: enrichedCategories,
            sentiment: predictionPayload.sentiment
        };

        return res.status(200).json(finalResponse);

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/register', [
    // --- 1. Validación de Entrada con express-validator ---
    check('name', 'El nombre es requerido').not().isEmpty(),
    check('lastName', 'El apellido es requerido').not().isEmpty(),
    check('email', 'Por favor, incluye un email válido').isEmail(),
    check('dni', 'El DNI es requerido y debe ser numérico').isNumeric().not().isEmpty(),
    check('transactionNumber', 'El número de trámite es requerido').not().isEmpty(),
    check('gender', 'Género es requerido').not().isEmpty(),
    check('password', 'La contraseña debe tener 6 o más caracteres').isLength({ min: 6 })
], async (req, res) => {
    // Si hay errores de validación, devuelve un error 400
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, lastName, email, dni, transactionNumber, gender, password, address, location, phone, birth } = req.body;

    try {

        console.log(req.body)
        // --- 2. Llamada a la API Externa para Validar DNI ---
        console.log('Iniciando validación de DNI...');

        // Mapeamos el género al formato que espera la API (ej: 'male' -> 'M')
        // ¡Debes confirmar el formato exacto que espera la API!
        const genderForApi = gender === 'male' ? 'M' : gender === 'female' ? 'F' : '';
        
        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });

        const dniValidationPayload = {
            token: process.env.token_service_tigre, 
            dni: dni,
            sexo: genderForApi,
            id_tramite: transactionNumber
        };

        const headers = {
            'Content-Type': 'application/json',
          //  'Cookie': 'ci_session=2228664e187ad9534b9381b378238fad1b0bdf8a' 
        };
        
        const dniApiUrl = 'https://www.tigre.gob.ar/Restserver/vigencia_dni';
        const dniValidationResponse = await axios.post(dniApiUrl, dniValidationPayload,{headers,httpsAgent});
        
        
        if (dniValidationResponse.data.error || dniValidationResponse.data.data.mensaje !== 'DNI VIGENTE') {
            console.log('La validación del DNI falló:', dniValidationResponse.data);
            
            // Usamos el mensaje de la API si está disponible, o uno genérico.
            const errorMessage = dniValidationResponse.data.data.mensaje || 'Los datos del DNI no son válidos o no se pudieron verificar.';
            return res.status(400).json({ msg: errorMessage });
        }
        
        console.log('DNI validado exitosamente.');
        
        // --- 4. Lógica de Creación de Usuario (Pasos siguientes) ---

        let user = await IncidentProfile.findOne({ $or: [{ email }, { dni }] });
          if (user) {
             return res.status(400).json({ msg: 'El usuario ya existe' });
          }

        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

         const newUser = new IncidentProfile({
             company:companyId,
             name,
             last:lastName,
             email,
             dni,
             transactionNumber,
             gender,
             password: hashedPassword,
             address,
             location,
             phone,
             birth,
             isVerified:true
        });
        
        
        await newUser.save();

        const payload = { user: { id: newUser.id } };
        jwt.sign(payload, process.env.SEC_TOKEN_INCIDENT, { expiresIn: '1h' }, (err, token) => {
             if (err) throw err;
             res.json({ token });
         });

    } catch (err) {
        // Manejo de errores, incluyendo si la llamada a la API externa falla
        console.error('Error en el endpoint /register:', err.message);
        if (err.response) {
            // El error vino de la API de DNI
            console.error('Data de la API:', err.response.data);
            console.error('Status de la API:', err.response.status);
        }
        res.status(500).send('Error del servidor');
    }
});


router.post('/login', [
    check('dni', 'Por favor, ingresa un DNI').not().isEmpty(),
    check('password', 'La contraseña es requerida').exists()
], async (req, res) => {
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { dni, password } = req.body;

    try {
        
        let user = await IncidentProfile.findOne({ dni });

        if (!user) {
            return res.status(400).json({ msg: 'Credenciales inválidas' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Credenciales inválidas' });
        }
        
        const payload = {
            user: {
                id: user.id
            }
        };
        
        jwt.sign(
            payload,
            process.env.SEC_TOKEN_INCIDENT, // Usa el secreto del archivo .env
            { expiresIn: '1h' }, // El token expirará en 5 horas
            (err, token) => {
                if (err) throw err;
                res.json({ token }); // Devuelve el token al cliente
            }
        );

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
});

router.post('/docket', [
    authIncident, 
    upload.array('files', 3) 
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {

         if (!req.body.data) {
            return res.status(400).json({ msg: 'No se encontraron los datos del formulario.' });
        }

        const { description, prediction, sentiment, details, address, location } = JSON.parse(req.body.data);

        console.log(description, prediction, details, address, location)

        if (!description || !prediction?._id) {
            return res.status(400).json({ msg: 'La descripción y la categoría son requeridas.' });
        }

        const files = req.files || [];
        const BUCKET = process.env.S3_BUCKET_INCIDENT; // Lees el bucket desde el .env

        if (files.length > 0) {
            // Procesar una imagen a la vez para evitar conflictos con Jimp
            const uploadedFilesData = [];
            for (const file of files) {
                try {
                    const result = await uploadFileToS3(
                        file, 
                        BUCKET, 
                        'docket',
                        { resize: true, width: 1000, quality: 80 }
                    );
                    uploadedFilesData.push(result);
                } catch (error) {
                    console.error(`❌ Error subiendo archivo ${file.originalname}:`, error);
                    // Continuar con los demás archivos
                }
            }
            console.log('uploadedFilesData', uploadedFilesData);
            details.files = uploadedFilesData;
        }


        console.log('Archivos recibidos:', files.length);
        console.log('Datos del formulario:', { description, prediction, details, address, location });

        const docketTypePredicted = {
            refId: prediction._id,
            name: prediction.name,
            confidence: prediction.score
        };

        const profileId = req.user.id;
        const userProfile = await IncidentProfile.findById(profileId);
        if (!userProfile) {
            return res.status(404).json({ msg: 'Perfil de usuario no encontrado.' });
        }

        const initialSentiment = {
            analysisStage: 'initial',
            sentiment: sentiment.tone, // ej: 'NEGATIVE'
            sentimentScore: { // Mapeamos de MAYÚSCULAS (payload) a minúsculas (schema)
                positive: sentiment.scores.POSITIVE,
                negative: sentiment.scores.NEGATIVE,
                neutral: sentiment.scores.NEUTRAL,
                mixed: sentiment.scores.MIXED
            }
        };
        
        // --- MODIFICACIÓN CLAVE ---
        // 1. Buscamos el ObjectId del 'source' correspondiente a la landing page
        const landingSource = await DocketSource.findOne({ name: 'landing' });

        // 2. Si no se encuentra, es un error de configuración del servidor
        if (!landingSource) {
            console.error("Error de configuración: No se encontró el 'source' con el nombre 'landing'");
            return res.status(500).json({ msg: "Error interno del servidor al procesar el origen del reclamo." });
        }
        // --- FIN DE LA MODIFICACIÓN ---

        const company = new mongoose.Types.ObjectId("68e9c3977c6f1f402e7b91e0"); //Company TS Tigre Sirve
        const newDocket = new IncidentDocket({
            company:company, // o usar segun la company del user userProfile.company,
            profile: profileId,
            description: description,
            docket_type: prediction._id,
            docket_area: prediction.parent?._id || null,
            address,
            location,
            details: details,
            source: landingSource._id,
            docket_type_predicted: docketTypePredicted,
            sentiments: [initialSentiment]
        });
        
        await newDocket.save();

        const initialHistoryEntry = new DocketHistory({
            docket: newDocket._id,      
            user: profileId,           
            userModel: 'IncidentProfile', 
            status: 'new',        
            content: 'Legajo iniciado desde la web pública.'
          //  observation: `Categoría predicha: ${prediction.name}` // Opcional: una nota interna
        });

        // 3. Guardar el registro de historial
        await initialHistoryEntry.save();

 
        

        res.status(201).json({
            msg: 'Legajo creado exitosamente',
            legajo: newDocket.docketId,
           // docket: newDocket
        });

    } catch (err) {
        console.error('Error en el endpoint dockets/new:', err.message);
        res.status(500).send('Error del servidor');
    }
});

router.post('/training', [
    check('text', 'El texto es requerido').not().isEmpty(),
    check('category', 'La categoría es requerida').not().isEmpty(),
    check('category', 'La categoría debe ser un ID de MongoDB válido').isMongoId(),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { text, category } = req.body;

    try {
        const newTrainingData = new IncidentDocketTypeAI({
            company: companyId,
            text,
            category,
            stage: 'initial'
        });

        await newTrainingData.save();

        res.status(201).json({ msg: 'Datos de entrenamiento guardados exitosamente', data: newTrainingData });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Error del servidor al guardar datos de entrenamiento: ' + err.message });
    }
});

module.exports = router;