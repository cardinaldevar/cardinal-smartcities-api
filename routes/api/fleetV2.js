const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Vehicle = require('../../models/Vehicle');
const VehicleBrand = require('../../models/VehicleBrand');
const VehicleModel = require('../../models/VehicleModel');
const VehicleCategory = require('../../models/VehicleCategory');
const VehicleStatus = require('../../models/VehicleStatus');
const VehicleStat = require('../../models/VehicleStat');
const GpsData = require('../../models/GpsData');
const LiveData = require('../../models/LiveData');
const Mark = require('../../models/Mark');
const MarkType = require('../../models/MarkType');
const IotSensor = require('../../models/IotSensor' );
const Activity = require('../../models/Activity' );
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const axios = require('axios');
const turf = require('@turf/turf');
const FixLineString = require("./../../utils/FixLineString")
const _ = require('lodash');
const ExcelJS = require('exceljs');
const { EndPoint } = require("./../../utils/CONS");
const logger = require('../../utils/logger'); 

//@route POST api/fleet - with TIMEOUT
//@Desc POST Vehicles in Authorized Fleet 
//@access Private

router.post('/list',auth, async (req,res) => {
    
    const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));

    try{

        const live = await Vehicle.aggregate([
            { $match: { 
                category: {$in:fleetList},
                status: {$ne:new mongoose.Types.ObjectId("61106beedce13f38b602bf51")}
            }, },
            //{ $sort:{DeviceID:-1}},
            { $lookup: { from: 'vehicles.category', localField: 'category', foreignField: '_id', as: 'category'} },
            { $lookup:{ from: 'vehicles.brand', localField: 'brand', foreignField: '_id', as: 'brand'} },
            { $lookup:{ from: 'vehicles.model', localField: 'model', foreignField: '_id', as: 'model'} },
            { $lookup:{ from: 'position.live', localField: 'DeviceID', foreignField: 'deviceID', as: 'dateConv'} },
            { $lookup:{ from: 'vehicles.status', localField: 'status', foreignField: '_id', as: 'status'} },
            {
                $project: {
                    _id: '$_id',
                    DeviceID: '$DeviceID',
                    category: { $arrayElemAt: [ "$category", 0 ] },
                    brand:{ $arrayElemAt: [ "$brand", 0 ] },
                    model:{ $arrayElemAt: [ "$model", 0 ] },
                    plate:'$plate',
                    color:'$color',
                    movilnum:'$movilnum',
                    latestHistory: { $arrayElemAt: [ "$dateConv.dateConv", 0 ] },
                    Speed: { $arrayElemAt: [ "$dateConv.speed", 0 ] },
                    LastPosition: { $arrayElemAt: [ "$dateConv.location", 0 ] },
                    status:{ $arrayElemAt: [ "$status", 0 ] },
                }
            },
            { $sort:{movilnum:1}},
        ])
        .allowDiskUse(true)
        .then(function (res) {
           // console.log(JSON.stringify(res));
            return res;
          });
       
        return res.status(200).json({data: live});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


//@route GET api/fleet
//@Desc Get Vehicles in Authorized Fleet 
//@access Private
router.get('/',auth, async (req,res) => {
    
  const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));

  try{
  

      const live = await Vehicle.aggregate([
          { $match: { 
              category: {$in:fleetList},
              status: {$ne:new mongoose.Types.ObjectId("61106beedce13f38b602bf51")}
          }, },
          //{ $sort:{DeviceID:-1}},
          { $lookup: { from: 'vehicles.category', localField: 'category', foreignField: '_id', as: 'category'} },
          { $lookup:{ from: 'vehicles.brand', localField: 'brand', foreignField: '_id', as: 'brand'} },
          { $lookup:{ from: 'vehicles.model', localField: 'model', foreignField: '_id', as: 'model'} },
          { $lookup:{ from: 'position.live', localField: 'DeviceID', foreignField: 'deviceID', as: 'dateConv'} },
          { $lookup:{ from: 'vehicles.status', localField: 'status', foreignField: '_id', as: 'status'} },
          {
              $project: {
                  _id: '$_id',
                  DeviceID: '$DeviceID',
                  category: { $arrayElemAt: [ "$category", 0 ] },
                  brand:{ $arrayElemAt: [ "$brand", 0 ] },
                  model:{ $arrayElemAt: [ "$model", 0 ] },
                  plate:'$plate',
                  color:'$color',
                  movilnum:'$movilnum',
                  DateU: { $arrayElemAt: [ "$dateConv.dateConv", 0 ] },
                  Speed: { $arrayElemAt: [ "$dateConv.speed", 0 ] },
                  LastPosition: { $arrayElemAt: [ "$dateConv.location", 0 ] },
                  status:{ $arrayElemAt: [ "$status", 0 ] },
              }
          },
          { $sort:{movilnum:1}},
      ])
      .allowDiskUse(true)
      .then(function (res) {
          //console.log(res);
          return res;
        });
     
      return res.status(200).json({data: live});

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});



//SEARCH VEHICLES
router.post('/search',auth, async (req,res) => {
  
  const {plate,movilnum,category} = req.body;
  const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
  var company = new mongoose.Types.ObjectId(req.user.company);
  
  try {

      let query=[
          
          {company: {$eq:company}},{status: {$ne:new mongoose.Types.ObjectId("61106beedce13f38b602bf51")}}
      ];

      //check if admin
      if(req.user.category.degree >= 1){
        query.push({category: {$in:fleetList}})
      }

      if(plate && movilnum){
        query.push({$or: [
          { plate: { $regex: plate, $options:'six' } }, 
          { movilnum: { $regex: movilnum, $options:'six' } },
        ]})
      }else if(plate){
          query.push({ $or: [{ 'plate': { $regex :plate, $options:'six' } } ] }); 
      }else if(movilnum){
        query.push( { movilnum: { $regex: movilnum, $options:'six' } })
      }

      if(category){
        query.push( { category: { $eq: new mongoose.Types.ObjectId(category) } })
      }

      const VehicleQuery = await Vehicle.aggregate([
      { $match: { $and: query } },
      { $lookup: { from: 'vehicles.category', localField: 'category', foreignField: '_id', as: 'category'} },
      { $lookup:{ from: 'vehicles.brand', localField: 'brand', foreignField: '_id', as: 'brand'} },
      { $lookup:{ from: 'vehicles.model', localField: 'model', foreignField: '_id', as: 'model'} },
      { $lookup:{ from: 'position.live', localField: 'DeviceID', foreignField: 'deviceID', as: 'dateConv'} },
      { $lookup:{ from: 'vehicles.status', localField: 'status', foreignField: '_id', as: 'status'} },
      {
          $project: {
              _id: '$_id',
              DeviceID: '$DeviceID',
              category: { $arrayElemAt: [ "$category", 0 ] },
              brand:{ $arrayElemAt: [ "$brand", 0 ] },
              model:{ $arrayElemAt: [ "$model", 0 ] },
              plate:'$plate',
              color:'$color',
              movilnum:'$movilnum',
              latestHistory: { $arrayElemAt: [ "$dateConv.dateConv", 0 ] },
              Speed: { $arrayElemAt: [ "$dateConv.speed", 0 ] },
              LastPosition: { $arrayElemAt: [ "$dateConv.location", 0 ] },
              status:{ $arrayElemAt: [ "$status", 0 ] },
          }
      },
      { $sort:{movilnum:1}}
  ])
  .allowDiskUse(true)
  .then(function (res) {
      return res;
  });
  
    return res.status(200).json(VehicleQuery);

  }catch(err){
    console.error(err.message);
    res.status(500).send('server error');
  }

});


router.post('/report', [
    check('vehicle', 'Error').not().isEmpty(),
    check('startDate', 'Error').not().isEmpty(),
    check('endDate', 'Error').not().isEmpty()
], auth, async (req, res) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { vehicle, startDate, endDate } = req.body;
    const company = new mongoose.Types.ObjectId(req.user.company);

    moment.tz.setDefault(req.user.timezone);

    let startDateConv = moment(startDate).add(1, 'minute').toDate();
    let endDateConv = moment(endDate).toDate();

    try {
        // Find Device ID para la consulta de Actividad
        const vehicleDoc = await Vehicle.findOne({ DeviceID: vehicle, company }).select('_id');
        if (!vehicleDoc) {
            return res.status(404).json({ message: 'Vehículo no encontrado.' });
        }
        const vehicleID = vehicleDoc._id;

        // 1. OBTENER DATOS DE LA RUTA ORDENADOS CRONOLÓGICAMENTE
        const query = [{ deviceID: { $eq: vehicle } },
       // { statusGps: "A" },
        { dateConv: { $gte: startDateConv } },
        { dateConv: { $lte: endDateConv } }];

        const liveResult = await GpsData.aggregate([
            { $match: { $and: query } },
            // Ordenamos del más antiguo al más reciente. ¡Este es el orden correcto!
            { $sort: { dateConv: 1 } },
            { $lookup: { from: 'vehicles', localField: 'deviceID', foreignField: 'DeviceID', as: 'vehicle' } },
            { $unwind: { path: "$vehicle", preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'vehicle_categories', // Corregido a un nombre de colección más estándar, ajústalo si es necesario.
                    localField: 'vehicle.category',
                    foreignField: '_id',
                    as: 'vehicleCategory'
                }
            },
            { $unwind: { path: "$vehicleCategory", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: null,
                    route: { $push: "$$ROOT" },
                    vehicle: {
                        $first: {
                            $mergeObjects: [
                                "$vehicle",
                                { category: "$vehicleCategory.name" }
                            ]
                        }
                    }
                },
            },
            {
                $project: {
                    _id: 0,
                    route: 1,
                    vehicle: "$vehicle",
                },
            },
        ]).exec();

        if (liveResult.length === 0 || liveResult[0].route.length === 0) {
            return res.status(404).json({ message: 'No se encontraron datos de GPS para el período seleccionado.' });
        }

        const live = liveResult[0];
        let data = { route: [], vehicle: {}, activity: [], data: {}, status: false, startDate, endDate, distance: 0 };

        // 2. FORMATEAR DATOS INICIALES
        data.route = live.route.map(p => ({
            _id: p._id, location: p.location, panic: p.panic, deviceID: p.deviceID,
            time: p.time, dateConv: p.dateConv, statusGps: p.statusGps, Lat: p.Lat, Lng: p.Lng,
            speed: p.speed, heading: p.heading, date: p.date, altitude: p.altitude,
            IOstatus: p.IOstatus, analogInput: p.analogInput, externalPower: p.externalPower,
            internalPower: p.internalPower, vehicle: { color: live.vehicle.color, plate: live.vehicle.plate },
            CSQ: p.CSQ, mileage: p.mileage
        }));
        data.vehicle = live.vehicle;
        data.status = true;

        // 3. OBTENER ACTIVIDADES
        data.activity = await Activity.aggregate([
            { $match: { company, refID: vehicleID, createdAt: { $gte: startDateConv, $lte: endDateConv } } },
            { $lookup: { from: 'activity.code', localField: 'internalCode', foreignField: 'id', as: 'internalCode' } },
            { $unwind: { path: "$internalCode", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: '$_id', createdAt: "$createdAt", value: "$value", title: "$title",
                    description: "$description", observation: "$observation", internalCode: "$internalCode.id",
                    internalColor: "$internalCode.color", coordinates: "$location.coordinates"
                }
            },
            { $sort: { createdAt: 1 } }
        ]).allowDiskUse(true);

        // 4. PROCESAMIENTO GEOGRÁFICO Y CÁLCULO DE DISTANCIA CON OSRM
        const allCoordinates = live.route.map(p => p.location.coordinates);

        const line = FixLineString({
            type: 'Feature',
            properties: { validate: true },
            geometry: { type: 'LineString', coordinates: allCoordinates }
        });

        if (!line.properties.validate || allCoordinates.length < 2) {
            data.data = { type: "LineString", coordinates: allCoordinates };
            data.distance = 0; // No se puede calcular la distancia
            return res.status(200).json(data);
        }

        var options = { tolerance: 0.0001, highQuality: false }; // Tolerancia ajustada
        var simplified = turf.simplify(line, options);
        let routeSimplified = simplified.geometry.coordinates;

        // FUNCIONES AUXILIARES PARA OSRM
        const splitArray = (arr, chunkSize) => {
            const result = [];
            for (let i = 0; i < arr.length; i += chunkSize) {
                result.push(arr.slice(i, i + chunkSize));
            }
            return result;
        };

        const mergeGeojsonRoutes = (geometries) => ({
            type: "LineString",
            coordinates: geometries.flatMap(geo => geo ? geo.coordinates : [])
        });

        const fetchRouteMatch = (segment) => {
            const coordsString = segment.map(coord => coord.join(',')).join(';');
            const osrmUrl = `${EndPoint[req.user.country_code]}/match/v1/driving/${coordsString}?overview=full&geometries=geojson`;
            
            return axios.get(osrmUrl)
                .then(response => {
                    const { data } = response;
                    if (data.matchings && data.matchings.length > 0) {
                        const match = data.matchings[0];
                        return {
                            geometry: match.geometry,
                            distance: match.distance // Distancia en metros
                        };
                    }
                    return null;
                })
                .catch(error => {
                    console.error('Error en la solicitud a OSRM:', error.message);
                    return null;
                });
        };

        // Dividir la ruta simplificada en segmentos y hacer las peticiones
        let chunkSize = 95; // OSRM a menudo tiene un límite de 100 coordenadas por petición
        let segments = splitArray(routeSimplified, chunkSize);
        let routePromises = segments.map(segment => fetchRouteMatch(segment));

        const combinedRouteData = await Promise.all(routePromises).then(results => {
            const successfulMatches = results.filter(r => r !== null && r.geometry);

            // Unir las geometrías para dibujar la línea en el mapa
            const combinedGeometry = mergeGeojsonRoutes(successfulMatches.map(r => r.geometry));

            // Sumar las distancias de cada segmento para obtener el total
            const totalDistanceInMeters = successfulMatches.reduce((sum, r) => sum + r.distance, 0);

            return {
                geometry: combinedGeometry,
                distance: totalDistanceInMeters / 1000 // Convertir a kilómetros
            };
        });

        // Asignar los resultados finales al objeto de respuesta
        data.data = combinedRouteData.geometry;
        data.distance = combinedRouteData.distance.toFixed(2); // Asignamos la distancia calculada por OSRM

        return res.status(200).json(data);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

/* -*********************************************************************************************************** */

router.get('/status',auth, async (req,res) => {
    
  try{
  
     const StatusList = await VehicleStatus.find()
      .select("_id name color position")
      .sort({position:1})
      .then((result) => {
          const vehiclelistID = result.map(item=>{return {
            value:item._id,label:item.name,color:item.color
          }});
          return vehiclelistID
      });

      return res.status(200).json({data: StatusList});

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});

router.post('/position',[
  check('deviceID','Error').not().isEmpty()
],auth, async (req,res) => {
  
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }
 // console.info(req.body);
  const {deviceID} = req.body;
  var company = new mongoose.Types.ObjectId(req.user.company);

  const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
  //get vehicles of fleet
  const check = await Vehicle.aggregate([
    { $match: { 
        category: {$in:fleetList}
    }, },
    {
        $project: {
            _id: '$_id',
            DeviceID: '$DeviceID'
        }
    },
    { $sort:{movilnum:1}},
])
.allowDiskUse(true)
.then(function (res) {
  //console.log(res)
    return res.find(dev => dev.DeviceID === deviceID);
  });

  if(check){

      try {

        var query=[{ deviceID: {$eq:deviceID} }, 
        //  { "DateConv": { "$gte": new Date() }},
          { "DateConv": {"$lte": new Date() }}];

        const live = await GpsData
        .aggregate([
            { $match: { $and: query } },
            {
                $project: {
                  // _id:'$_id',
                    DateConv:'$DateConv',
                    location: '$location'
                }
            },
          //  { $sort:{DateConv:1}}
        ])
       // .sort('DateConv',-1)
        .limit(10)
        .exec();
        console.log(live);

        return res.status(200).json([]);

        }catch(error) {
          console.error(error.message);
          res.status(500).send('server error');
        }

    }else{
      return res.status(200).json([]);
    }

  

});

router.post('/detail',[
  check('vehicle','Not Auth').not().isEmpty()
],auth, async (req,res) => {
    
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }
  const {vehicle} = req.body;
  
  var company = new mongoose.Types.ObjectId(req.user.company);

  //check if objectid
  const isValid = mongoose.Types.ObjectId.isValid(vehicle);
  if(!isValid){
    return res.status(400).send('vehicle not found');
  }

   try{

      const VehicleQuery = await Vehicle.findOne({_id:new mongoose.Types.ObjectId(vehicle),company}).populate('brand','name').populate('model','name').populate('status','name color').populate('category','name')
      .then((result) => {
        //console.log('VehicleQuery',result)
          return {
            deviceID:result.DeviceID,
            plate:result.plate,
            color:result.color,
            brand:result.brand ? result.brand.name : '',
            model:result.model ? result.model.name : '',
            movilnum:result.movilnum,
            category:result.category ? result.category.name : '',
            status:result.status
          };
      });

      const lastPosition = await LiveData.findOne({deviceID:VehicleQuery.deviceID})
      .then((result) => {
          return {location:result.location,
            createAt:result.dateConv,
            heading:result.heading
          };
      });

      return res.status(200).json({...VehicleQuery,position:{...lastPosition,coordinates:lastPosition.location.coordinates,color:VehicleQuery.color,plate:VehicleQuery.plate,movilnum:VehicleQuery.movilnum}});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

// GET BRANDS OF VEHICLES
router.post('/brand',[ 
  check('search','Bad request').not().isEmpty()
],auth, async (req,res) => {
  
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }
  const {search} = req.body;

  try {

    const VehicleBrandQuery = await VehicleBrand.aggregate([
      {
          $search: {
                  index: "brand_name",
                  "autocomplete": {
                  "query": search,
                  "path": 'name',
                  "tokenOrder": "any"
                }
          }
        },
     {
          $project: {
              value: '$_id',
              label: "$name"
          }
      }
  ]).sort({name:1})
  .limit(15)
  .allowDiskUse(true)
  .then(function (res) {
      return res;
  });

    return res.status(200).json(VehicleBrandQuery);

  }catch(err){
    console.error(err.message);
    res.status(500).send('server error');
  }

});

// GET MODELS OF BRANDS
router.post('/model',[
  check('brand','Bad Request').not().isEmpty()
],auth, async (req,res) => {

  //console.info(req.body);
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const { brand,search} = req.body;

  try {

    const objBrandID = new mongoose.Types.ObjectId(brand);

    const VehicleModelQuery = await VehicleModel.aggregate([
        {
            $search: {
                    index: "model_name",
                    "autocomplete": {
                    "query": search,
                    "path": 'name',
                    "tokenOrder": "any"
                  }
            }
          },
          {$match:{ brand: { $eq: objBrandID }} },
       {
            $project: {
                value: '$_id',
                label: "$name"
            }
        }
    ]).sort({name:1})
    .limit(15)
    .allowDiskUse(true)
    .then(function (res) {
        return res;
    });

    return res.status(200).json(VehicleModelQuery);

  }catch(err){
    console.error(err.message);
    res.status(500).send('server error');
  }


});


// GET BRANDS OF VEHICLES
router.post('/vehicle/search',[ 
  check('search','Bad request').not().isEmpty()
],auth, async (req,res) => {
  
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json([]);
  }
  const {search} = req.body;
  const { user } = req; 
  const companyID = new mongoose.Types.ObjectId(user.company);


  try {

     const pipeline = [
            {
                $search: {
                    index: "vehicle_name",
                    "autocomplete": {
                        "query": search,
                        "path": "name",
                        "tokenOrder": "any"
                    }
                }
            }
        ];

        let matchStage = {
            company: companyID 
        };

        // 3. Condición: Si el degree del usuario es mayor a 1, añade el filtro $in
        if (user.category && user.category.degree > 1) {
            const fleetAccessObjectIds = user.fleetAccess.map(id => new mongoose.Types.ObjectId(id));
            matchStage.category = { $in: fleetAccessObjectIds };
        }

        pipeline.push({ $match: matchStage });

        // 5. Agrega las etapas finales de proyección, orden y límite
        pipeline.push(
            {
                $project: {
                    value: '$DeviceID',
                    label: "$movilnum",
                    name: "$name",
                    category:"$category",
                    score: { $meta: "searchScore" } 
                }
            },
            { $sort: { name: 1 } }, // O { score: -1 } para ordenar por relevancia del search
            { $limit: 15 }
        );

        // 6. Ejecuta la pipeline de agregación
        const vehicleQuery = await Vehicle.aggregate(pipeline).allowDiskUse(true);
        return res.status(200).json(vehicleQuery);

  }catch(err){
    console.error(err.message);
    res.status(500).send('server error');
  }

});

// GET BRANDS OF VEHICLES
router.post('/vehiclesensor/search',[ 
  check('search','Bad request').not().isEmpty()
],auth, async (req,res) => {
  
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json([]);
  }
  const {search,type} = req.body;
  const companyID = new mongoose.Types.ObjectId(req.user.company);

  try { 

    var VehicleQuery = [];
    var sensorQuery = [];

    if(type.includes('vehicle')){

      VehicleQuery = await Vehicle.aggregate([
          {
              $search: {
                      index: "vehicle_name",
                      "autocomplete": {
                      "query": search,
                      "path": "name",
                      "tokenOrder": "any"
                    }
              }
            },
            {$match:{ company: { $eq: companyID }} },
        {
              $project: {
                  value: '$DeviceID',
                  label: "$movilnum",
                  name: "$name",
                  type: "vehicle"
              }
          }
      ]).sort({name:1})
      .limit(15)
      .allowDiskUse(true)
      .then(function (res) {
          return res;
      });
  

    }
    
    if(type.includes('sensor')){ 
          //get all iot type mark
          var iotType = await MarkType.find({typeModel:"iot"}).select('_id');
          iotType = iotType.map(i=> i._id)

          sensorQuery = await IotSensor.aggregate([
            {
                $search: {
                        index: "iotsensor_name",
                        "autocomplete": {
                        "query": search,
                        "path": "name",
                        "tokenOrder": "any"
                      }
                }
              },
            { $match:{ 
              company: { $eq: companyID },
              typePoint:{$in:iotType},
              status:{$ne:'deleted'}
              }
            },
          {
                $project: {
                    value: '$_id',
                    label: "$name",
                    name: "$name",
                    type:"iot",
                    typePointData:"$typePointData"
                }
            }
        ]).sort({name:1})
        .limit(15)
        .allowDiskUse(true)
        .then(function (res) {
            return res;
        });

    }
        
    return res.status(200).json([...VehicleQuery,...sensorQuery]);

  }catch(err){
    console.error(err.message);
    res.status(500).send('server error');
  }

});


// GET FLEET CATEGORY LIST
router.post('/listdetail',auth, async (req,res) => {

  const errors = validationResult(req);
  //console.log(req.user)
  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  //IF USER SUPERADMIN or ADMIN
  if(req.user.category.degree <= 1){
    //console.log('Admin FleetList')
    const companyID = new mongoose.Types.ObjectId(req.user.company);
    var queryCat = [{ $match: {  company: {$eq:companyID}, status: {$gte:1} } }, { $sort:{name:1}}];

  }else{ // ELSE ANOTHER CATEGORY
    //console.log('FleetList')
    const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
    var queryCat = [
      { $match: {  _id: {$in:fleetList}, status: {$gte:1} } }, { $sort:{name:1}}
    ];
  }

  try{

      const List = await VehicleCategory.aggregate(queryCat)
      .allowDiskUse(true)
      .then(function (res) {
         // console.log(res);
          return res;
        });
     
      return res.status(200).json({fleetList: List});

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }


});


// ADD FLEET 
router.post('/add',[
  check('brandID','Bad Payload').not().isEmpty(),
  check('modelID','Bad Payload').not().isEmpty(),
  check('category','Bad Payload').not().isEmpty(),
  check('movilnum','Bad Payload').not().isEmpty(),
  check('plate','Bad Payload').not().isEmpty(),
],auth, async (req,res) => {

 // console.info(req.body);
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {status,
  brand,
  brandID,
  plate,
  imei,
  movilnum,
  model,
  modelID,
  category,
  color} = req.body;

  const brand_id = new mongoose.Types.ObjectId(brandID);
  const model_id = new mongoose.Types.ObjectId(modelID);
  const status_id = new mongoose.Types.ObjectId(status);
  const category_id = new mongoose.Types.ObjectId(category);
  
  const colored = color.replace('#', '');
  const companyID = new mongoose.Types.ObjectId(req.user.company);

  try{

      let VehicleAdd = new Vehicle({
        status:status_id,
        DeviceID:imei,
        company:companyID,
        brand:brand_id,
        model:model_id,
        movilnum,
        plate,
        color:colored,
        category:category_id,
        name: `${plate} ${movilnum}`
      }); 

      
      await VehicleAdd.save();

      return res.status(200).json(true)

  }catch(err){
      console.error(err.message);
      res.status(500).json(false);
  }


});

// SAVE FLEET DETAIL
router.post('/edit',[
  check('_id','Debe seleccionar un Vehículo').not().isEmpty()
],auth, async (req,res) => {
  //console.log(req.body)
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {_id,movilnum,imei,color,status,statusID,brandID,model,modelID,category,plate} = req.body;
  const vehicleID = new mongoose.Types.ObjectId(_id);
  const colored = color.replace('#', '');

  data = {$set:{
    plate: plate,
    category: new mongoose.Types.ObjectId(category),
    brand: new mongoose.Types.ObjectId(brandID),
    model: new mongoose.Types.ObjectId(modelID),
    movilnum: movilnum,
    DeviceID: imei,
    color: colored,
    name: `${plate} ${movilnum}` 
  }};

  try{

      const VehicleQuery = await  Vehicle.findByIdAndUpdate({_id: vehicleID}, data, { new:  true, runValidators:  true })
      return res.status(200).send(true)

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }


});

// GET FLEET CATEGORIES
router.get('/category',auth, async (req,res) => {

  try {

    console.log('user',req.user)
    const user = req.user;
    const objCompanyID = new mongoose.Types.ObjectId(req.user.company);

    // 1. Inicia el objeto de consulta con las condiciones base que siempre se aplican.
    let queryConditions = {
        company: objCompanyID,
        status: { $gte: 1 }
    };

    // 2. Condición: Si el "degree" del usuario es mayor a 1 (no es admin/superadmin),
    //    entonces agregamos el filtro de fleetAccess a la consulta.
    if (user.category && user.category.degree > 1) {
        queryConditions._id = { $in: user.fleetAccess };
    }
    
    let counter = [];
    const CategoryQuery = await VehicleCategory.find(queryConditions)
        .select('_id name status')
        .sort({ name: 1 });



      CategoryQuery.map((item)=>{

        const FleetTemp = new mongoose.Types.ObjectId(item._id)
        counter.push(Vehicle.where({ 'category': FleetTemp }).countDocuments().exec())

      })

      Promise.all(counter).then(function(counts) {

       const Result = CategoryQuery.map((item,index) =>{
          return {
            _id:item._id,
            status:item.status,
            name:item.name,
            total:counts[index]
          }
        })
        return res.status(200).json(Result);
      });
    //  console.log(CategoryQuery);
    

  }catch(err){
    console.error(err.message);
    res.status(500).send('server error');
  }


});


// SAVE CATEGORY FLEET
router.post('/category/add',[
  check('name','shit happens').not().isEmpty()
],auth, async (req,res) => {

  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }
  console.log(req.body)
  const {name} = req.body;
  try{

    const companyID = new mongoose.Types.ObjectId(req.user.company);

    let CategoryAdd = new VehicleCategory({
      status:1,
      name,
      company:companyID
    }); 

      await CategoryAdd.save();
      return res.status(200).json(true)

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }


});

// CLEAR CATEGORY FLEET
router.post('/category/delete',[
  check('_id','shit happens').not().isEmpty()
],auth, async (req,res) => {

 // console.log(req.user.company); return;
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {_id} = req.body;
  const categoryID = new mongoose.Types.ObjectId(_id);

  let data = {$set:{
    status: 0
  }};

  try{

      const VehicleQuery = await VehicleCategory.findByIdAndUpdate({_id: categoryID}, data, { new:  true, runValidators:  true })
      return res.status(200).json(true)

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }


});


// NEW CATEGORY FLEET
router.post('/newcategory',[
  check('Category','Not Auth').not().isEmpty()
],auth, async (req,res) => {

  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }
  
  const {Category} = req.body;
  //console.log(Category); return;
  const companyID = new mongoose.Types.ObjectId(req.user.company);

  let CategoryAdd = new VehicleCategory({
    status:Category.status === null ? 2 : Category.status.value,
    name:Category.name,
    company:companyID
  }); 
  
  try{
      post = await CategoryAdd.save();
      return res.status(200).json({status:'Category ADD'})

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});


router.post('/detail/stat',[ check('vehicle','Not Auth').not().isEmpty()],auth, async (req,res) => {
    
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }
  const {vehicle,startDate,endDate} = req.body;
 // const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
  var company = new mongoose.Types.ObjectId(req.user.company);

  moment.tz.setDefault(req.user.timezone)

  let dateStart = moment(startDate).startOf('h').toDate();
  let dateEnd = moment(endDate).endOf('h').toDate();

  const startDate2 = new Date('2025-07-02T00:00:00Z');
const endDate2 = new Date('2025-07-03T00:00:00Z');
  /*console.log(req.body)
  console.log(dateStart,dateEnd)*/
  try{

    //vehicleID
    const deviceID = await Vehicle.findById(new mongoose.Types.ObjectId(vehicle), 'DeviceID')
    .populate({
      path: 'model',            
      select: 'name fuelConsumption DeviceID'  
    }).exec();

    const deviceID2 = deviceID.DeviceID; 
   console.log(JSON.stringify(deviceID))

   
const data = await GpsData.aggregate([
  {
    $match: {
      statusGps: "A",
      deviceID: deviceID2,
      dateConv: { $gte: startDate2, $lt: endDate2 }
    }
  },
  {
    $addFields: {
      hourBucket: {
        $dateToString: { format: "%Y-%m-%dT%H:00:00Z", date: "$dateConv" }
      }
    }
  },
  {
    $sort: { dateConv: 1 } // opcional: puede ser -1 si querés el más reciente por hora
  },
  {
    $group: {
      _id: "$hourBucket",
      doc: { $first: "$$ROOT" } // el primer doc de cada hora
    }
  },
  {
    $replaceWith: {
      _id: "$doc._id",
      dateAt: "$doc.dateConv",
      fuel: "$doc.fuel",
      mileage: "$doc.mileage",
      panic: "$doc.panic",
      alert: "$doc.alarm"
    }
  },
  {
    $sort: { dateAt: 1 } // para ordenar el resultado cronológicamente
  }
]);

console.log(JSON.stringify(data))
    
      const statQuery = await VehicleStat.aggregate([
          { $match: { 
              company,
              deviceID: {$eq:deviceID.DeviceID},
              dateAt: { $gte: dateStart, $lte: dateEnd } 
          }, },
          {
              $project: {
                  _id: '$_id',
                  dateAt:"$dateAt",
                  fuel:"$fuel",
                  mileage:"$mileage",
                  mileageDiff:"$mileageDiff",
                  panic:"$panic",
                  alert:"$alert",
              }
          },
          { $sort:{dateAt:1}}
      ])
      .allowDiskUse(true)
      .then(function (res) {
        //  console.log(JSON.stringify(res));
          return res;
        });
/*
        const result = statQuery.reduce((accumulator, current, index) => {
          const previousSum = index > 0 ? accumulator[index - 1].mileageDiff : 0;
          const cumulativeMileageDiff = (previousSum + current.mileageDiff).toFixed(2);

          accumulator.push({
              ...current,
              cumulativeMileageDiff: parseFloat(cumulativeMileageDiff) // Convierte a número para evitar strings
          });
      
          return accumulator;
      }, []);

      console.log('-----',JSON.stringify(result))*/
        let x = []
        let stat = []
        let statFuel = []
        let checkStart = moment(startDate).startOf('h').utcOffset(-3);
        let checkEnd = moment(endDate).endOf('h').utcOffset(-3);

        while(checkStart.isBefore(checkEnd)){

          x.push(checkStart.format('DD/MM HH'))

          //Validate Data between
          let HStemp = moment(checkStart).startOf('h').utcOffset(-3);
          let HEtemp = moment(checkStart).endOf('h').utcOffset(-3);
          let data = {}
          let dataFuel = {}
          statQuery.map((d,index) => {

            if(moment(d.dateAt).utcOffset(-3).isBetween(HStemp, HEtemp)){
              let a= 0;
              
              //process graph - make relative point with after values 
              
              if(index != 0){
                a = parseInt(d.mileageDiff)+parseInt(statQuery[index-1].mileageDiff)
              }else{
                a = parseInt(d.mileageDiff)
              }

              data = { 
                x:checkStart.format('DD/MM HH'), 
                y:d.mileageDiff,
                diff: parseFloat((d.mileageDiff).toFixed(2)),
               
              };

              dataFuel = {
                x:checkStart.format('DD/MM HH'), 
                y:(parseFloat((d.mileageDiff).toFixed(2))*deviceID.model.fuelConsumption).toFixed(2)
              }
            }
          });
          
          stat.push(data);
          statFuel.push(dataFuel)
          checkStart.add(1,'h');

        }

        stat = stat.filter(i => !_.isEmpty(i))
        statFuel = statFuel.filter(i => !_.isEmpty(i))
      return res.status(200).json({data:stat,dataFuel:statFuel,x,y:[]});

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});



router.post('/detail/activity',[ check('vehicle','Not Auth').not().isEmpty()],auth, async (req,res) => {
    
    const errors = validationResult(req);

    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    const {vehicle,startDate,endDate} = req.body;
    var company = new mongoose.Types.ObjectId(req.user.company);
    
    moment.tz.setDefault(req.user.timezone)

    let dateStart = moment(startDate).startOf('h').toDate();
    let dateEnd = moment(endDate).endOf('h').toDate();
    var vehicleID = new mongoose.Types.ObjectId(vehicle);
    
    //console.log(dateStart,dateEnd)
    //console.log(req.body)
    //console.log(req.user)
    try{

    const statQuery = await Activity.aggregate([
      { $match: { 
          company,
          refID:vehicleID,
          createdAt: { $gte: dateStart, $lte: dateEnd } 
      }, },
      { $lookup:{ from: 'activity.code', localField: 'internalCode', foreignField: 'id', as: 'internalCode'} },
      { $unwind: { path: "$internalCode", preserveNullAndEmptyArrays: true } },
      {
          $project: {
              _id: '$_id',
              createdAt:"$createdAt",
              value:"$value",
              title:"$title",
              description:"$description",
              observation:"$observation",
              internalCode:"$internalCode.id",
              internalColor:"$internalCode.color",
              location:"$location"
          }
      },
      { $sort:{createdAt:-1}}
  ])
  .allowDiskUse(true)
  .then(function (res) {
    //  console.log(JSON.stringify(res));
      return res;
    });   
  
      
    return res.status(200).json(statQuery);
           

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});

// EXPORT FLEET
router.get('/export',auth, async (req,res) => {

  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({error:errors.array() });
  }
  moment.tz.setDefault(req.user.timezone)
  var company = new mongoose.Types.ObjectId(req.user.company);
  
  try {

      var typeQueryStat = {
          company,
          status: {$ne:new mongoose.Types.ObjectId("61106beedce13f38b602bf51")}
      };
      
      var workbook = new ExcelJS.Workbook();

      workbook.creator = 'Cardinal';
      workbook.created = new Date();
      workbook.modified = new Date();

      workbook.views = [
          {
              x: 0, y: 0, width: 10000, height: 20000,
              firstSheet: 0, activeTab: 1, visibility: 'visible'
          }
      ];

      var worksheet = workbook.addWorksheet('Employee');
      
      var StatsQuery = [];

      //History Detailed Query
      StatsQuery.push(
          Vehicle.aggregate([
              { $match: typeQueryStat },
              { $lookup: { from: 'vehicles.category', localField: 'category', foreignField: '_id', as: 'category'} },
              { $lookup:{ from: 'vehicles.brand', localField: 'brand', foreignField: '_id', as: 'brand'} },
              { $lookup:{ from: 'vehicles.model', localField: 'model', foreignField: '_id', as: 'model'} },
              { $lookup:{ from: 'position.live', localField: 'DeviceID', foreignField: 'deviceID', as: 'dateConv'} },
              { $lookup:{ from: 'vehicles.status', localField: 'status', foreignField: '_id', as: 'status'} },
              { $unwind: { path: "$status", preserveNullAndEmptyArrays: true } },
              { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
              { $unwind: { path: "$brand", preserveNullAndEmptyArrays: true } },
              { $unwind: { path: "$model", preserveNullAndEmptyArrays: true } },
              { $unwind: { path: "$dateConv", preserveNullAndEmptyArrays: true } },
              {
                  $project: {
                      _id: '$_id',
                      DeviceID: '$DeviceID',
                      category: "$category.name",
                      brand:"$brand.name",
                      model:"$model.name",
                      plate:'$plate',
                      color:'$color',
                      movilnum:'$movilnum',
                      latestHistory:"$dateConv.dateConv",
                      speed:"$dateConv.speed",
                      lastPosition: "$dateConv.location",
                      status:"$status.name",
                  }
              },
              { $sort:{movilnum:1}}
          ])
          .allowDiskUse(true)
       );

  
      Promise.all(StatsQuery).then( ([ Total ]) => {

          console.log(JSON.stringify(Total))
          worksheet.columns = [
              { header: 'imei', key: 'imei' },
              { header: 'Movil', key: 'movilnum' },
              { header: 'Patente', key: 'plate' },
              { header: 'Grupo', key: 'category' },
              { header: 'Marca', key: 'brand' },
              { header: 'Modelo', key: 'model' },
              { header: 'Ult. Registro', key: 'latestHistory' },
              { header: 'Vel.', key: 'speed' },
              { header: 'Ult. Posición', key: 'lastPosition' },
              { header: 'Estado', key: 'status' }
          ];


          Total.map(item=>{
              
            worksheet.addRow({ 
              imei: item.DeviceID, 
              movilnum:item.movilnum,
              plate:item.plate,
              category:item.category,
              brand:item.brand,
              model:item.model,
              latestHistory:item.latestHistory? moment(item.latestHistory).format("DD/MM/YY HH:mm:ss"): "",
              speed:item.speed,
              lastPosition:item.lastPosition?item.lastPosition.coordinates:"",
              status:item.status
              });

          });

          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader("Content-Disposition", "attachment; filename=" + "Report.xlsx");
          workbook.xlsx.write(res)
              .then(function (data) {
                  res.end();
                  console.log('Export done...');
              });

      });


  } catch (error) {
      
      console.error(error.message);
      res.status(500).send('server error');

  }
});



// EXPORT FLEET
router.post('/report/export',auth, async (req,res) => {

  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({error:errors.array() });
  }

  moment.tz.setDefault(req.user.timezone)
  
  try {
      
      var workbook = new ExcelJS.Workbook();

      workbook.creator = 'Cardinal';
      workbook.created = new Date();
      workbook.modified = new Date();

      workbook.views = [
          {
              x: 0, y: 0, width: 10000, height: 20000,
              firstSheet: 0, activeTab: 1, visibility: 'visible'
          }
      ];

      var worksheet = workbook.addWorksheet('Report');
      
      worksheet.columns = [
        { header: 'Movil', key: 'movilnum' },
        { header: 'Patente', key: 'plate' },
        { header: 'Grupo', key: 'category' },
        { header: 'Desde', key: 'startDate' },
        { header: 'Hasta', key: 'endDate' },
        { header: 'Distancia', key: 'distance' },
        { header: 'Coords', key: 'coords' },
    ];


    req.body.map(item=>{
        
      worksheet.addRow({ 
        movilnum:item.vehicle.movilnum,
        plate:item.vehicle.plate,
        category:item.vehicle.category,
        startDate:item.startDate? moment(item.startDate).format("DD/MM/YY HH:mm"): "",
        endDate:item.endDate? moment(item.endDate).format("DD/MM/YY HH:mm"): "",
        distance:item.distance,
        coords:item.data?.coordinates.length
        });

    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader("Content-Disposition", "attachment; filename=" + "Report.xlsx");
    workbook.xlsx.write(res)
        .then(function (data) {
            res.end();
            console.log('Export done...');
        });


  } catch (error) {
      
      console.error(error.message);
      res.status(500).send('server error');

  }
});

module.exports = router;