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
      if(req.user.category.degree >= 2){
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



//SEARCH VEHICLES
router.post('/report',[
  check('vehicle','Error').not().isEmpty(),
  check('startDate','Error').not().isEmpty(),
  check('endDate','Error').not().isEmpty()
],auth, async (req,res) => {
  
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

 // console.log(req.body)
  const {vehicle,startDate,endDate,stop} = req.body;
  const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
  var company = new mongoose.Types.ObjectId(req.user.company);
    
  moment.tz.setDefault(req.user.timezone)

  //Find Device ID
  const {_id:vehicleID} = await Vehicle.findOne({DeviceID:vehicle,company}).select('_id')
 // console.log('vehicleID',vehicleID)

  let startDateConv = moment(startDate).toDate();
  let endDateConv = moment(endDate).toDate();

  //console.log(vehicle,startDate,endDate,stop)

  try {

      var query=[{ deviceID: {$eq:vehicle} }, 
        { statusGps: "A"},
        { dateConv: { $gte: startDateConv}},
        { dateConv: { $lte: endDateConv}}];

      const live = await GpsData.aggregate([
        { $match: { $and: query } },
        { $lookup: { from: 'vehicles', localField: 'deviceID', foreignField: 'DeviceID', as: 'vehicle' } },
        { $unwind: { path: "$vehicle", preserveNullAndEmptyArrays: true } },
        { 
          $lookup: {
            from: 'vehicles.category', // Ajusta el nombre de la colección de categorías según corresponda
            localField: 'vehicle.category', // El campo que contiene el ObjectId de la categoría
            foreignField: '_id',
            as: 'vehicleCategory'
          }
        },
        { $unwind: { path: "$vehicleCategory", preserveNullAndEmptyArrays: true } },
        { $sort: { dateConv: -1 } },
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
            vehicle: "$vehicle", // Asegúrate de que 'vehicle' sea un objeto
          },
        },
      ]).exec();
      // console.log('live',live)
     // logger.info(JSON.stringify(live, null, 2));
      if (live.length === 0) {
        return res.status(404).json({ message: 'No se encontraron datos.' });
      }
      
      let data = {route:[],vehicle:[],activity:[],data:[],status:false,startDate,endDate,distance:0}

      if(live.length >= 1){
        data['route'] = live[0].route.map(p => { return {
          _id: p._id,
          location: p.location,
          panic: p.panic,
          deviceID: p.deviceID,
          time:p.time,
          dateConv:p.dateConv,
          statusGps:p.statusGps,
          Lat:p.Lat,
          Lng:p.Lng,
          speed: p.speed,
          heading: p.heading,
          date: p.date,
          altitude:p.altitude,
          IOstatus: p.IOstatus,
          analogInput: p.analogInput,
          externalPower:p.externalPower,
          internalPower: p.internalPower,
          vehicle: {color:live[0].vehicle.color,plate:live[0].vehicle.plate},
          CSQ: p.CSQ,
          mileage: p.mileage}});

          data['vehicle'] = live[0].vehicle;
          data['status'] = true;
          data['data'] = {
          "type": "LineString",
          "coordinates":  live[0].route.map(a => a.location.coordinates)
        }

        const route = live[0].route;

        const primerMileage = route[0]?.mileage;
        const ultimoMileage = route[route.length - 1]?.mileage;
        const primerMileageKm = primerMileage ? primerMileage / 1000 : 0;
        const ultimoMileageKm = ultimoMileage ? ultimoMileage / 1000 : 0;
        const kmsRecorridos = (ultimoMileageKm - primerMileageKm).toFixed(2);
      
        data['distance'] = kmsRecorridos;
        
      }

      //GET Activity of ROUTE
      data['activity'] = await Activity.aggregate([
        { $match: { 
            company,
            refID:vehicleID,
            createdAt: { $gte: startDateConv, $lte: endDateConv } 
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
                coordinates:"$location.coordinates"
            }
        },
        { $sort:{createdAt:-1}}
    ])
    .allowDiskUse(true)
    .then(function (res) {
       // console.log(JSON.stringify(res));
        return res;
      });  

   //console.log('data[].coordinates',JSON.stringify(data['data'].coordinates))
      
      // CALCULATE MATCH MAPPING & DISTANCES
      // URL de tu servidor OSRM en tu instancia de EC2
     // const osrmUrl = 'http://ec2-18-219-5-50.us-east-2.compute.amazonaws.com:5000';
      const osrmUrl = EndPoint[req.user.country_code];

    //  let origin = live[0].route[0].location.coordinates;

     // console.log('osrmUrl',osrmUrl,req.user.country_code)
   //   console.log(JSON.stringify(origin))
      let destination = live[0].route;
      destination.shift(); // Elimina el primer elemento

      const destinos = destination.map(i => {
          return i.location.coordinates
      });
      
     // console.log('destination',destination.length)
    
      let t =  live[0].route.map(i=>i.location.coordinates )
     // t.push(origin) OJO CON ESTA LINEA REVISAR
      
      //FIX LINE - VERIFICAR LOS PUNTOS A TRAVES DEL TIEMPO SON SIEMPRE IGUALES
      const line = FixLineString({
        type: 'Feature',
        properties: {validate:true},
        geometry: {
          type: 'LineString',
          coordinates: t
        }
      });
    
     // console.log('---------> FixLineString',JSON.stringify(line))

      var options = {tolerance: 0.0000001, highQuality: true};
      var simplified = turf.simplify(line, options);
      let routeSimplified = simplified.geometry.coordinates;
     // routeSimplified.splice(routeSimplified.length - 1, 1) VERIFICAR SI ES NECESARIO QUITAR EL ITEM
    // console.log('---------> routeSimplified',JSON.stringify(routeSimplified))
      const consultaUrl = `${osrmUrl}/route/v1/driving/${routeSimplified.join(';')}?overview=false`;

    // console.log('live - routeSimplified.length',line.geometry.coordinates.length,routeSimplified.length)
    
      //Check distance with OSRM
   /*   data['distance'] = await axios.get(consultaUrl)
      .then(response => {

       const route = response.data.routes[0];
       
       const distance = route.distance / 1000; // La distancia se encuentra en metros, conviértela a kilómetros
       console.log(`Distancia recorrida: ${distance} km`);
          return distance;
      })
      .catch(error => {
          console.error('Error en la consulta:', error);
      });*/


      // FUNCTION
      function splitArray(arr, chunkSize) {
        let result = [];

        for (let i = 0; i < arr.length; i += chunkSize) {
            result.push(arr.slice(i, i + chunkSize));

        }
        
        return result;
      } 

      function mergeGeojsonRoutes(routes) {
        let mergedCoordinates = [];
        routes.forEach(route => {
            mergedCoordinates.push(...route.coordinates);
        });
        return {
            type: "LineString",
            coordinates: mergedCoordinates
        };
    }

    ///

      let chunkSize = 20;
      let segments = splitArray(routeSimplified, chunkSize);

      function fetchRoute(segment) {
        let coordsString = segment.map(coord => coord.join(',')).join(';');
        let osrmUrl = `http://ec2-18-219-5-50.us-east-2.compute.amazonaws.com:5000/match/v1/driving/${coordsString}?overview=full&geometries=geojson`;
    
        return fetch(osrmUrl)
            .then(response => response.json())
            .then(data => {
              if (data.matchings && data.matchings.length > 0 && data.matchings[0].geometry) {
                  return data.matchings[0].geometry; // Retorna la geometría si está disponible
              } else {
                 // console.error('No se encontraron coincidencias válidas en la respuesta.');
                  return null; // Maneja el caso cuando no hay coincidencias
              }
            })
            .catch(error => {
                console.error('Error en la solicitud:', error);
                return null; // Devuelve null en caso de error
            });
    }
    
    if(line.properties.validate){

          // LineRoute contain data - Realiza todas las consultas a OSRM en paralelo
          let routePromises = segments.map(segment => fetchRoute(segment));
          // let routePromises = [];
          // routePromises.push(fetchRoute(routeSimplified));
            
          let combinedRoute = await Promise.all(routePromises).then(results => {

                // Filtra las rutas exitosas
                let successfulRoutes = results.filter(route => route !== null);
                // Une las rutas exitosas
                let combinedRoute = mergeGeojsonRoutes(successfulRoutes);
            
                // Muestra la ruta en el mapa
                //console.log('combinedRoute',JSON.stringify(combinedRoute));
                return combinedRoute;
            });

      data['data'] = combinedRoute;
    }else{
      data['data'] = { type: "LineString", coordinates: line.geometry.coordinates};
    }
    return res.status(200).json(data);

  }catch(err){
    console.error(err.message);
    res.status(500).send('server error');
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
  const companyID = new mongoose.Types.ObjectId(req.user.company);
  try {

    const VehicleQuery = await Vehicle.aggregate([
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
              name: "$name"
          }
      }
  ]).sort({name:1})
  .limit(15)
  .allowDiskUse(true)
  .then(function (res) {
      return res;
  });
//console.log(JSON.stringify(VehicleQuery))
    return res.status(200).json(VehicleQuery);

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

    const objCompanyID = new mongoose.Types.ObjectId(req.user.company);
    
    let counter = [];
    const CategoryQuery = await VehicleCategory.find({ company: { $eq: objCompanyID }, status: {$gte:1}})
      .select('_id name status')
      .sort({name:1})
      .then((result) => {
          return result;
      });

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