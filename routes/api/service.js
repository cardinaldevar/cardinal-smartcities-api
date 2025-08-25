const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
//const GpsData = require('../../models/GpsData');
const mongoose = require('mongoose');
const axios = require('axios');
const Service = require('../../models/Service');
const ServiceHistory = require('../../models/ServiceHistory');
const moment = require('moment');
const { decode, encode } = require("@googlemaps/polyline-codec");
var turf = require('@turf/turf');
const { EndPoint } = require("./../../utils/CONS")

// @route Get api/service
// @Desc Get current services
router.post('/list',[
    check('startDate','error payload').not().isEmpty(),
    check('endDate','bad payload').not().isEmpty()
  ],auth, async (req,res) => {
       
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    try{

     // console.log(req.user)

        const { startDate, endDate,status,routeID,typeRoute} = req.body;
        let companyID = new mongoose.Types.ObjectId(req.user.company);
        let sDate = moment(startDate).utcOffset(-3).toDate();
        let eDate = moment(endDate).utcOffset(-3).toDate();
        console.log(sDate,eDate)
        console.log(req.body)

        let query = [];
        query.push({company:companyID});

        if(sDate){
            
            query.push({ 
                $and: [ 
                    {deliveryDate: {$gte:sDate,$lte:eDate} }, 
                    {deliveryDate: { $ne:null}}
                ]
             });

        }

        if(typeRoute){
            query.push({typeOrder:typeRoute});
        }

        if(routeID){
            query.push({routeID:routeID});
        }
        query.push({status:{$ne:'deleted'}});

       // console.log(JSON.stringify(query))

        const ServiceList = await Service.aggregate([
                 { $match:{ $and: query } },
                 { $unwind: {path:"$to",preserveNullAndEmptyArrays:true} },
                 {
                    $facet: {
                      'iotsensor': [
                        {
                          $match: {
                            'to.type': 'iot.sensor',
                          },
                        },
                        {
                          $lookup: {
                            from: 'iot.sensor', // Nombre de la colección iot.sensor
                            localField: 'to.item',
                            foreignField: '_id',
                            as: 'to.itemData',
                          },
                        },
                        {
                          $unwind: '$to.itemData', // Desenrolla la referencia resuelta
                        },
                      ],
                      'mark': [
                        {
                          $match: {
                            'to.type': 'mark',
                          },
                        },
                        {
                          $lookup: {
                            from: 'mark', // Nombre de la colección mark.point
                            localField: 'to.item',
                            foreignField: '_id',
                            as: 'to.itemData',
                          },
                        },
                        {
                          $unwind: '$to.itemData', // Desenrolla la referencia resuelta
                        },
                      ],
                    },
                  },
                  {
                    $project: {
                     to: {
                        $concatArrays: ['$iotsensor', '$mark'],
                      },
                    },
                  },
                  {
                    $unwind: '$to',
                  },
                  {
                    $project: {
                      _id: '$to._id',
                      createAt: '$to.createAt',
                      deliveryDate: '$to.deliveryDate',
                      typeOrder: '$to.typeOrder',
                      assign: '$to.assign',
                      lastUpdate: '$to.lastUpdate',
                      estimatedTime: '$to.estimatedTime',
                      estimatedKm: '$to.estimatedKm',
                      estimatedVolume: '$to.estimatedVolume',
                      from: '$to.from',
                      status: '$to.status',
                      routeHash: '$to.routeHash',
                      company: '$to.company',
                      routeID: '$to.routeID',
                      to: {
                        position: '$to.to.position',
                        time: '$to.to.time',
                        kilometer: '$to.to.kilometer',
                        type: '$to.to.type',
                        _id: '$to.to._id',
                        sensorData: '$to.to.itemData',
                      },
                    },
                  },
                  {
                    $lookup: {
                        from: 'users',
                        localField: 'assign',
                        foreignField: '_id',
                        as: 'assignData',
                      },
                  },
                  { $unwind: { path: '$assignData', preserveNullAndEmptyArrays: true } },
                  {
                      $project: {
                          _id: 1,
                          createAt: 1,
                          deliveryDate: 1,
                          typeOrder: 1,
                          assign: {
                            $cond: {
                                if: { $eq: ['$assignData', null] },
                                then: null,
                                else: { _id: '$assignData._id', name: '$assignData.name' }
                            }
                        },
                          lastUpdate: 1,
                          estimatedTime: 1,
                          estimatedKm: 1,
                          estimatedVolume: 1,
                          from: 1,
                          status: 1,
                          routeHash: 1,
                          company: 1,
                          routeID: 1,
                          to: 1,
                      },
                  },
                  { $group: {
                      _id: '$_id',
                      createAt: { $first: '$createAt' },
                      deliveryDate: { $first: '$deliveryDate' },
                      typeOrder: { $first: '$typeOrder' },
                      assign: { $first: '$assign' },
                      lastUpdate: { $first: '$lastUpdate' },
                      estimatedTime: { $first: '$estimatedTime' },
                      estimatedKm: { $first: '$estimatedKm' },
                      estimatedVolume: { $first: '$estimatedVolume' },
                      from: { $first: '$from' },
                      status: { $first: '$status' },
                      routeHash: { $first: '$routeHash' },
                      company: { $first: '$company' },
                      routeID: { $first: '$routeID' },
                      to: { $push: '$to' },
                  }},
                  { $sort: { createAt: -1 } }
            ])
            .allowDiskUse(true)
            .then(function (res) {
              return  res
            });

      //  console.log('ServiceList ----',JSON.stringify(ServiceList))

        return res.status(200).json({list:ServiceList});


    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

//@route POST api/service
router.post('/add',[
    check('deliveryDate','error payload').not().isEmpty(),
    check('to','bad payload').isArray().not().isEmpty(),
    check('from','bad payload').isArray().not().isEmpty(),
  ],auth, async (req,res) => {
    
    console.info('service/add');
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    const { deliveryDate, typeRoute, to,from} = req.body;
    let companyID = new mongoose.Types.ObjectId(req.user.company);
    let newDate = moment(deliveryDate).utcOffset(-3).toDate();

   // console.log(JSON.stringify( { deliveryDate, typeRoute, to,from}))
    let routeTo = to.map(r => {
        return {
            item:new mongoose.Types.ObjectId(r._id),
            type: r.typeModel === 'iot' ? 'iot.sensor' : 'mark',  // iot.sensor - mark
            position:0,
            time:0,
            kilometer:0,
           // status:'new'
        }
    });
    
    try{

        const NewService = new Service({
            company:companyID,
            deliveryDate:newDate,
            typeRoute,
            to:routeTo,
            from,
            company: companyID,
            status:'new'
        });

        await NewService.save();

        console.log(NewService._id)
       
        return res.status(200).json({live: 'liveProcess',totalVehicle:'VehicleList'});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


//@route POST api/optimize
router.post('/route/optimize',[
    check('to','bad payload').isArray().not().isEmpty(),
    check('from','bad payload').isArray().not().isEmpty(),
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    const {to,from} = req.body;
    
    // IF POSITION IS 0 0 return error
    if(from[0] === 0 || from[1] === 0){
        return res.status(400).json({errors: 'GPS Location error'});
    }

    console.log('/planning/autoV5',to.length)
    console.log('/planning/autoV5',JSON.stringify(req.body))
    console.log('/planning/autoV5',JSON.stringify(req.user.country_code))

    let ordersFeature = [];
    let ordersInject = [];

    to.map(o => {

        ordersFeature.push( {"type":"Feature","properties":{_id:o._id,imei:o.sensorData.imei},"geometry":o.sensorData.location} );
        
    })

    var points = {
        type: "FeatureCollection",
        features: ordersFeature 
    }

   // console.log('-------------ordersFeature',JSON.stringify(ordersFeature.length))
   // URL de tu servidor OSRM en tu instancia de EC2 SWITCH
    const osrmUrl = EndPoint[req.user.country_code];
   
    // Coordenadas del origen y destinos
    const origen = from; // Latitud y longitud del origen
    const destinos = points.features.map(i => {
        return [i.geometry.coordinates[0],i.geometry.coordinates[1]]
    }); // Latitud y longitud de los destinos
   // console.log(JSON.stringify(destinos))
    // Construir la URL de la consulta
    const consultaUrl = `${osrmUrl}/table/v1/driving/${origen};${destinos.join(';')}?annotations=distance`;
    //console.log(consultaUrl)

    // Realizar la solicitud utilizando Axios
    let body = await axios.get(consultaUrl)
    .then(response => {
        // Manejar la respuesta aquí
        const matrizDistancias = response.data.distances.map(d => d.map(o => Math.round(o)));
        const matrizTime = response.data.durations;
      //  console.log('Matriz de distancias:', JSON.stringify(matrizDistancias));
      /*  console.log('Matriz de Nombres:', JSON.stringify(points.features.map(i => {
            return i.properties.address
        })));*/
        
      //  console.log('Matriz de response.data:', JSON.stringify(response.data));

        return {"city_names": [
            "Driver",
            ...points.features.map(i => {
                return i.properties.address
            })],"distance_matrix":matrizDistancias}
    })
    .catch(error => {
        console.error('Error en la consulta:', error);
    });

  // console.log('routeOSRM --------->',JSON.stringify(body));

   // POST TO NEW SERVICE PY OR TOOLS
    const postURL = 'http://ec2-18-119-17-129.us-east-2.compute.amazonaws.com:5000/ortools';
    const headers = {'Content-Type': 'application/json'};

    let route = await axios.post(postURL, body, { headers })
    .then(response => {
        //console.log('Respuesta del servidor:', response.data);
        return response.data.route;
    })
    .catch(error => {
        console.error('Error query ortools:', error);
    });

    let normalizePoint = [];
    route.map(i => {
        if(i>=1)
        normalizePoint.push(to[i-1]) 
    });

    //QUERY ROUTE TO OSRM GENERATE
   // console.log('RESPONSE-', JSON.stringify(normalizePoint));

    // Coordenadas del origen y destinos
    const origen2 = from; // Latitud y longitud del origen
    const destinos2 = normalizePoint.map(i => {
        return i.sensorData.location.coordinates
    });
    
    // Latitud y longitud de los destinos

   // console.log(JSON.stringify(destinos))
    // Construir la URL de la consulta
    const consultaUrl2 = `${osrmUrl}/route/v1/driving/${origen2};${destinos2.join(';')}?geometries=geojson&overview=full`; 
    //console.log(consultaUrl)

    let waypoint = [];
    // Realizar la solicitud utilizando Axios
    let calculateDistance = await axios.get(consultaUrl2)
    .then(response => {
        
       // console.log('Matriz de route:', JSON.stringify(response.data));
        // TEST DE REFINE DE LINE
        const simplifiedGeojson = turf.simplify( {
            type: 'LineString',
            coordinates: response.data.routes[0].geometry.coordinates
          }, { tolerance:0.0001 });

      //  console.log('simplifiedGeojson',JSON.stringify(simplifiedGeojson));
        //ENCODE GEOJSON 
        waypoint = encode(response.data.routes[0].geometry.coordinates.map(c => [c[1],c[0]]))
       // console.log('waypoint',waypoint);
        return response.data.routes[0].legs
    })
    .catch(error => {
        console.error('Error en la consulta:', error);
    });
   // console.log('calculateDistance',JSON.stringify(calculateDistance))

    calculateDistance.map((point,index) => {
        normalizePoint[index].duration = {"text": "0 mins", "value": point.duration};
        let dis = point.distance / 100
        normalizePoint[index].distance = {"text": `${dis.toFixed(2)}`, "value": point.distance};
    })

 //   console.log('calculateRoute',JSON.stringify(normalizePoint));

   try {

        return res.status(200).json({generated:normalizePoint,waypoint:waypoint});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});



//@route POST api/service
router.post('/route/save',[
    check('_id','error payload').not().isEmpty(),
    check('to','bad payload').isArray().not().isEmpty(),
    check('from','bad payload').isArray().not().isEmpty(),
  ],auth, async (req,res) => {
    
    console.info('service/route/save');
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    const { _id,waypoint, to,from,volumen,distance,duration} = req.body;
    let companyID = new mongoose.Types.ObjectId(req.user.company);
    console.log(req.body)
    try{    

      
        let data = { $set: { 
            from,routeHash:waypoint,
            to: to.map(i=> {
                return {
                    position:i.position,
                    time:i.time,
                    kilometer:i.kilometer,
                    _id: new mongoose.Types.ObjectId(i._id),
                    item: new mongoose.Types.ObjectId(i.sensorData._id),
                    type:i.type
                }
            }),
            lastUpdate:moment().utcOffset(-3).toDate(),
            estimatedTime:parseFloat(duration),
            estimatedKm:parseFloat(distance),
            estimatedVolume:parseFloat(volumen) }}

        let UpdateService = await Service.findOneAndUpdate({_id: new mongoose.Types.ObjectId(_id),company:companyID}, data);

        return res.status(200).json();

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});



//@route POST api/service
router.post('/assign',[
  check('_id','error payload').not().isEmpty(),
  check('employee','bad payload').not().isEmpty(),
],auth, async (req,res) => {
  
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const { _id,employee } = req.body;
  let companyID = new mongoose.Types.ObjectId(req.user.company);
  let employeeID = new mongoose.Types.ObjectId(employee);
  console.log(req.body)
  try{    

    
      let data = { $set: {assign:employeeID,lastUpdate:new Date()}}

      let UpdateService = await Service.findOneAndUpdate({_id: new mongoose.Types.ObjectId(_id),company:companyID}, data);

      return res.status(200).json();

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});




//@route POST api/service
router.post('/detail',[
  check('routeID','error payload').not().isEmpty()
],auth, async (req,res) => {
  
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const { routeID } = req.body;
  let companyID = new mongoose.Types.ObjectId(req.user.company);
  
  try{    

    
    let query = [];
    query.push({company:companyID});
    query.push({routeID:routeID});
    //query.push({status:{$ne:'deleted'}});

   // console.log(JSON.stringify(query))

   const ServiceList = await Service.aggregate([
        { $match:{ $and: query } },
        { $unwind: {path:"$to",preserveNullAndEmptyArrays:true} },
        {
          $facet: {
            'iotsensor': [
              {
                $match: {
                  'to.type': 'iot.sensor',
                },
              },
              {
                $lookup: {
                  from: 'iot.sensor', // Nombre de la colección iot.sensor
                  localField: 'to.item',
                  foreignField: '_id',
                  as: 'to.itemData',
                },
              },
              {
                $unwind: '$to.itemData', // Desenrolla la referencia resuelta
              },
            ],
            'mark': [
              {
                $match: {
                  'to.type': 'mark',
                },
              },
              {
                $lookup: {
                  from: 'mark', // Nombre de la colección mark.point
                  localField: 'to.item',
                  foreignField: '_id',
                  as: 'to.itemData',
                },
              },
              {
                $unwind: '$to.itemData', // Desenrolla la referencia resuelta
              },
            ],
          },
        },
        {
          $project: {
            to: {
              $concatArrays: ['$iotsensor', '$mark'],
            },
          },
        },
        {
          $unwind: '$to',
        },
        {
          $project: {
            _id: '$to._id',
            createAt: '$to.createAt',
            deliveryDate: '$to.deliveryDate',
            typeOrder: '$to.typeOrder',
            assign: '$to.assign',
            lastUpdate: '$to.lastUpdate',
            estimatedTime: '$to.estimatedTime',
            estimatedKm: '$to.estimatedKm',
            estimatedVolume: '$to.estimatedVolume',
            from: '$to.from',
            status: '$to.status',
            routeHash: '$to.routeHash',
            company: '$to.company',
            routeID: '$to.routeID',
            to: {
              position: '$to.to.position',
              time: '$to.to.time',
              kilometer: '$to.to.kilometer',
              lastUpdate: '$to.to.lastUpdate',
              type: '$to.to.type',
              _id: '$to.to._id',
              sensorData: '$to.to.itemData',
              status: '$to.to.status', 
            },
          },
        },
        {
          $lookup: {
            from: 'service.action', 
            localField: 'to.status',
            foreignField: '_id',
            as: 'to.statusData',
          },
        },
        { $unwind: { path: '$to.statusData', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            createAt: 1,
            deliveryDate: 1,
            typeOrder: 1,
            assign: 1,
            lastUpdate: 1,
            estimatedTime: 1,
            estimatedKm: 1,
            estimatedVolume: 1,
            from: 1,
            status: 1,
            routeHash: 1,
            company: 1,
            routeID: 1,
            to: {
              position: 1,
              time: 1,
              kilometer: 1,
              lastUpdate:1,
              type: 1,
              _id: 1,
              sensorData: 1,
              status: {
                _id: '$to.status',
                name: '$to.statusData.name',
                name_es: '$to.statusData.name_es',
                icon: '$to.statusData.icon',
                library: '$to.statusData.library',
                color: '$to.statusData.color',
                subcolor: '$to.statusData.subcolor',
              },
              
            },
          },
        },
        {
          $lookup: {
              from: 'users',
              localField: 'assign',
              foreignField: '_id',
              as: 'assignData',
            },
        },
        { $unwind: { path: '$assignData', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            createAt: 1,
            deliveryDate: 1,
            typeOrder: 1,
            assign: {
              $cond: {
                if: { $eq: ['$assignData', null] },
                then: null,
                else: { _id: '$assignData._id', name: '$assignData.name' },
              },
            },
            lastUpdate: 1,
            estimatedTime: 1,
            estimatedKm: 1,
            estimatedVolume: 1,
            from: 1,
            status: 1,
            routeHash: 1,
            company: 1,
            routeID: 1,
            to: 1,
          },
        },
        { $group: {
            _id: '$_id',
            createAt: { $first: '$createAt' },
            deliveryDate: { $first: '$deliveryDate' },
            typeOrder: { $first: '$typeOrder' },
            assign: { $first: '$assign' },
            lastUpdate: { $first: '$lastUpdate' },
            estimatedTime: { $first: '$estimatedTime' },
            estimatedKm: { $first: '$estimatedKm' },
            estimatedVolume: { $first: '$estimatedVolume' },
            from: { $first: '$from' },
            status: { $first: '$status' },
            routeHash: { $first: '$routeHash' },
            company: { $first: '$company' },
            routeID: { $first: '$routeID' },
            to: { $push: '$to' },
        }},
        { $sort: { deliveryDate:-1,createAt: -1 } }
    ])

    .allowDiskUse(true)
    .then(function (res) {
    return  res[0]
    });

        console.log('ServiceList',JSON.stringify(ServiceList))


        
        let queryHistory = [];
        queryHistory.push({company:companyID});
        queryHistory.push({service:new mongoose.Types.ObjectId(ServiceList._id)});

       
        const ServiceHistoryList = await ServiceHistory.aggregate([
          { $match: { $and: queryHistory } },
          {
            $lookup: {
              from: 'service.action',
              localField: 'action',
              foreignField: '_id',
              as: 'actionDetail'
            }
          },
          { $unwind: { path: '$actionDetail', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'users',
              localField: 'employee',
              foreignField: '_id',
              as: 'employeeDetail'
            }
          },
          { $unwind: { path: '$employeeDetail', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'iot.sensor',
              localField: '_idPoint',
              foreignField: '_id',
              as: 'iotSensorDetails'
            }
          },
          { $unwind: { path: '$iotSensorDetails', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'mark',
              localField: '_idPoint',
              foreignField: '_id',
              as: 'markDetails'
            }
          },
          { $unwind: { path: '$markDetails', preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              pointDetails: {
                $cond: {
                  if: { $eq: ['$typePoint', 'iot.sensor'] },
                  then: { $ifNull: ['$iotSensorDetails', null] },
                  else: { $ifNull: ['$markDetails', null] }
                }
              }
            }
          },
          {
            $project: {
              action: {
                _id:'$actionDetail._id',
                name:'$actionDetail.name',
                name_es:'$actionDetail.name_es',
                color:'$actionDetail.color',
                subcolor:'$actionDetail.subcolor'
              },
              employee: '$employeeDetail.name',
              _id: 1,
              createAt: 1,
              pointDetails: 1,
              observation: 1,
              typePoint:1,
              image: 1,
              location: 1
             
            }
          },
          { $sort: { createAt: 1 } }
        ]);
        
        console.log('ServiceHistoryList',JSON.stringify(ServiceHistoryList))

      return res.status(200).json({...ServiceList,history:ServiceHistoryList});

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});

module.exports = router;