const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Docket = require('../../models/IncidentDocket');
const IncidentProfile = require('../../models/IncidentProfile');
const DocketArea = require('../../models/IncidentDocketArea');
const Zone = require('../../models/Zone');
const DocketSource = require('../../models/IncidentDocketSource');
const DocketType = require('../../models/IncidentDocketType');
const DocketHistory = require('../../models/IncidentDocketHistory');
const moment = require('moment-timezone');
const https = require('https');
const mongoose = require('mongoose');
const axios = require('axios');
const { getSignedUrlForFile } = require('../../utils/s3helper');
const bcrypt = require('bcryptjs');
const randtoken = require('rand-token');
const { sendNewProfileEmail } = require('../../utils/ses');

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
    const { q: searchTerm } = req.query;
    const companyId = new mongoose.Types.ObjectId(req.user.company);

    // Si no hay término de búsqueda o es muy corto, devolvemos un array vacío
    if (!searchTerm || searchTerm.length < 2) {
      return res.json([]);
    }

     const pipeline = [
      {
        $match: {
          company: companyId,
          docketId: { $regex: searchTerm.trim(), $options: 'i' }
        }
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
    check('lastname', 'El apellido es requerido').not().isEmpty(),
    check('dni', 'El DNI es requerido y debe ser numérico').isNumeric().not().isEmpty(),
    check('email', 'Por favor, incluye un email válido').isEmail(),
    check('gender', 'El género es requerido').not().isEmpty(),
    check('birthDate', 'La fecha de nacimiento es requerida').optional().isISO8601().toDate(),
   // check('transactionNumber', 'El número de trámite es requerido').optional().not().isEmpty(),
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        name,
        lastname,
        dni,
        transactionNumber,
        email,
        gender,
        birthDate,
    } = req.body;

    try {


        const companyId = new mongoose.Types.ObjectId(req.user.company);
        const genderForApi = gender === 'male' ? 'M' : gender === 'female' ? 'F' : '';
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
            last: lastname, 
            dni,
            transactionNumber,
            email,
            gender,
            birth: birthDate, 
            isVerified, 
            status: 1,
            password: hashedPassword
        });

       await newProfile.save();

       //add funcion send email
       if (email) {
        try {
          await sendNewProfileEmail({
            email,
            name,
            lastname,
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

   // console.log(req.body)

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

        const initialAreaIds = docketArea.map(area => new mongoose.Types.ObjectId(area._id));
        console.log(initialAreaIds)

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

router.post('/docket', [auth, [
    check('profile', 'El perfil es requerido').not().isEmpty(),
    check('docket_type', 'El tipo de legajo es requerido').not().isEmpty(),
    check('description', 'La descripción es requerida').not().isEmpty(),
    check('source', 'La fuente es requerida').not().isEmpty(),
    check('profile._id').custom(value => {
        if (!mongoose.Types.ObjectId.isValid(value)) {
            throw new Error('ID de perfil no válido');
        }
        return true;
    }),
    check('docket_type._id').custom(value => {
        if (!mongoose.Types.ObjectId.isValid(value)) {
            throw new Error('ID de tipo de legajo no válido');
        }
        return true;
    }),
    check('source.value').custom(value => {
        if (!mongoose.Types.ObjectId.isValid(value)) {
            throw new Error('ID de fuente no válido');
        }
        return true;
    }),
    check('docket_area').optional().isArray().withMessage('El área del legajo debe ser un array'),
    check('docket_area.*._id').optional().isMongoId().withMessage('ID de área no válido en el array'),
]], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const {
        profile: profileObj,
        docket_area,
        docket_type: docketTypeObj,
        description,
        source: sourceObj,
        details,
        address,
        docket_type_stage,
        sentiments
    } = req.body;

    try {
        const companyId = new mongoose.Types.ObjectId(req.user.company);

        const profileId = profileObj._id;
        const docketTypeId = docketTypeObj._id;
        const sourceId = sourceObj.value;
        let docket_type_predicted;
        let initialSentiment;

        let address = null;
        let location = null;

        if (details && details.address && details.address_location) {
            address = details.address;
            location = details.address_location;
        }
        console.log('details',JSON.stringify(details))

        //docket preddict
        //EVALUAR EN QUE ESTADOS SE DEBE HACER EL PREDICT Y SENTIMENT
        if(docket_type_stage != 'predict'){
          const url = `${process.env.TIGRESIRVE_NLP_URL}/predict`;
          const response = await axios.post(url, { text: description });
          console.log(response.data);

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
        }else{

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


      /*  // Validate existence of referenced documents
        const existingProfile = await IncidentProfile.findById(profileId);
        if (!existingProfile) {
            return res.status(400).json({ msg: 'Perfil no encontrado.' });
        }

        const existingDocketType = await DocketType.findById(docketTypeId);
        if (!existingDocketType) {
            return res.status(400).json({ msg: 'Tipo de legajo no encontrado.' });
        }

        const existingSource = await DocketSource.findById(sourceId);
        if (!existingSource) {
            return res.status(400).json({ msg: 'Fuente no encontrada.' });
        }*/

        // Map docket_area to an array of ObjectIds if provided
        const docketAreaIds = docket_area ? docket_area.map(area => new mongoose.Types.ObjectId(area._id)) : [];

       // const location = details && details.address_location ? details.address_location : null;

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
            docket_type_predicted
        });

        await newDocket.save();

        res.status(201).json(newDocket.docketId);

    } catch (err) {
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(400).json({ msg: 'ID con formato incorrecto' });
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
        console.log(predictionPayload)

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

        console.log(docketTypeInfo?.docket_area)

        const finalResponse = {
              prediction: {...topPrediction,
                  name:docketTypeInfo.name,
                  parent: docketTypeInfo.parent?.name || null,
                  fields:docketTypeInfo.fields,
                  docket_area: docketTypeInfo.docket_area // Added this
              },
              sentiment: predictionPayload.sentiment
          };

         res.status(200).send(finalResponse);

  } catch (error) {
     console.error(error.message);
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
      docketAreas, 
      status,     
      startDate,
      endDate,
      profile,
      zone,
      textSearch // Búsqueda de texto libre en la descripción
    } = req.body;

    console.log(req.body)

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

        // 2. Definir el pipeline para buscar todos los IDs descendientes
        const idSearchPipeline = [
            // Etapa 1: Empezar con los IDs seleccionados en el filtro
            { 
                $match: { _id: { $in: initialTypeIds } } 
            },
            
            // Etapa 2: Buscar recursivamente todos los hijos
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
            
            // Etapa 3: Proyectar un solo array que contenga el ID original Y todos sus descendientes
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
            
            // Etapa 4: "Desenrollar" (unwind) el array para tener una fila por cada ID
            { 
                $unwind: '$allRelatedIds' 
            },
            
            // Etapa 5: Agrupar por el ID para obtener un conjunto único de todos los IDs
            { 
                $group: { _id: '$allRelatedIds' } 
            }
        ];

        // 3. Ejecutar la agregación en el modelo DocketType
        const idDocs = await DocketType.aggregate(idSearchPipeline);
        
        // 4. Mapear los resultados a un array plano de ObjectIds
        const allIdsToFilter = idDocs.map(doc => doc._id);
        console.log('allIdsToFilter',JSON.stringify(allIdsToFilter))
        // 5. Usar este array final en tu condición de match
        if (allIdsToFilter.length > 0) {
            matchConditions.docket_type = { $in: allIdsToFilter };
        } else {
            // Fallback por si algo falla: usar solo los IDs originales
            matchConditions.docket_type = { $in: initialTypeIds };
        }
        
    }
    if (docketAreas && docketAreas.length > 0) {
      matchConditions.docket_area = { $in: docketAreas.map(p => new mongoose.Types.ObjectId(p._id)) };
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
      
      console.log('Zonas recibidas:', JSON.stringify(zone));

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

router.patch('/docket/update/status/:id', [auth, [
    check('status', 'El estado es requerido').not().isEmpty(),
]], async (req, res) => {
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

        const statusTranslations = {
            'new': 'Nuevo',
            'assigned': 'Asignado',
            'in_progress': 'En Progreso',
            'reassigned': 'Reasignado',
            'on_hold': 'En Espera',
            'resolved': 'Resuelto',
            'closed': 'Cerrado',
            'cancelled': 'Cancelado',
            'archived': 'Archivado',
            'deleted': 'Eliminado'
        };

       // const oldStatus = originalDocket.status;
      //  const translatedOldStatus = statusTranslations[oldStatus] || oldStatus;

        let historyContent = "";
        if (observation) {
            historyContent = observation;
        }else{
            const translatedNewStatus = statusTranslations[newStatus] || newStatus;
            historyContent  = `Cambio de estado: '${translatedNewStatus}'.`;
        }

        const newHistory = new DocketHistory({
            docket: id,
            user: req.user.id,
            userModel: 'users',
            status: newStatus,
            content: historyContent
        });
        await newHistory.save();

        originalDocket.status = newStatus;
        const updatedDocket = await originalDocket.save();

        res.status(200).json(updatedDocket.docketId);

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
  .populate({ path: 'docket_type', select: 'name parent', as:'docket_type' })
  .populate({ path: 'docket_area', select: 'name', as:'docket_area' })
  .populate({ path: 'profile', select: 'name last email', as:'profile' })
  .populate('source', 'name'); 

    const history = await DocketHistory.find({ docket: id })
      .sort({ createdAt: -1 })
      .populate('user', 'name last');

    // --- 3. Combinar los resultados ---
    const docketObject = docket.toObject();

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

    // Añadimos el array de historiales al objeto
    docketObject.history = history;
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
        const { docket_type, status, startDate, endDate } = req.body;

        console.log('startDate, endDate',startDate, endDate,req.body)

        const matchConditions = { company: companyId };

        // Si no se especifican estados, usamos un conjunto por defecto.
        const targetStatus = (status && status.length > 0) ? status : ['new', 'in_progress', 'resolved'];
        matchConditions.status = { $in: targetStatus };

        // Filtro por rango de fechas
        if (startDate || endDate) {
            matchConditions.createdAt = {};
            if (startDate) matchConditions.createdAt.$gte = new Date(startDate);
            if (endDate) matchConditions.createdAt.$lte = new Date(endDate);
        }
        console.log('matchConditions',matchConditions)
        // Filtro por tipo de legajo, incluyendo descendientes
        if (docket_type && docket_type.length > 0) {
            const initialTypeIds = docket_type.map(id => new mongoose.Types.ObjectId(id));

            const idSearchPipeline = [
                { $match: { _id: { $in: initialTypeIds } } },
                {
                    $graphLookup: {
                        from: 'incident.docket_types',
                        startWith: '$_id',
                        connectFromField: '_id',
                        connectToField: 'parent',
                        as: 'descendants',
                        maxDepth: 10
                    }
                },
                {
                    $project: {
                        allRelatedIds: { $concatArrays: [['$_id'], '$descendants._id'] }
                    }
                },
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

        const barPipeline = [
            { $match: matchConditions },
            {
                $group: {
                    _id: {
                        docket_type: '$docket_type',
                        status: '$status'
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $group: {
                    _id: '$_id.docket_type',
                    statuses: {
                        $push: {
                            k: '$_id.status',
                            v: '$count'
                        }
                    },
                    total: { $sum: '$count' }
                }
            },
            { $sort: { total: -1 } },
            { $limit: 8 },
            {
                $lookup: {
                    from: 'incident.docket_types',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'docketTypeInfo'
                }
            },
            {
                $unwind: {
                    path: '$docketTypeInfo',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 0,
                    type: '$docketTypeInfo.name',
                    ...targetStatus.reduce((acc, s) => {
                        acc[s] = {
                            $reduce: {
                                input: '$statuses',
                                initialValue: 0,
                                in: {
                                    $cond: [
                                        { $eq: ['$$this.k', s] },
                                        { $add: ['$$value', '$$this.v'] },
                                        '$$value'
                                    ]
                                }
                            }
                        };
                        return acc;
                    }, {})
                }
            }
        ];

        const piePipeline = [
            { $match: matchConditions },
            { 
                $group: { 
                    _id: '$source', 
                    value: { $sum: 1 } 
                } 
            },
            {
                $lookup: {
                    from: 'incident.source',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'sourceInfo'
                }
            },
            {
                $unwind: {
                    path: '$sourceInfo',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $project: {
                    _id: 0,
                    id: { $ifNull: ['$sourceInfo.name', 'unknown'] },
                    label: { $ifNull: ['$sourceInfo.name', 'Desconocido'] },
                    value: '$value'
                }
            }
        ];

        const [bar, pie] = await Promise.all([
            Docket.aggregate(barPipeline),
            Docket.aggregate(piePipeline)
        ]);

        res.json({ bar, pie, status: targetStatus });

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
        }).select('_id name').sort({ name: 1 });

        // Format the response as requested
        const formattedSources = sources.map(source => ({
            value: source._id,
            label: source.name
        }));

        res.json(formattedSources);

    } catch (error) {
        console.error("Error fetching docket sources:", error);
        res.status(500).send('Error del servidor');
    }
});

module.exports = router;