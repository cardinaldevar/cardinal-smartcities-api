
const turf = require('@turf/turf');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const GpsData = require('../models/GpsData');
const Alert = require('../models/Alert');
const Activity = require('../models/Activity');
const {evaluationTypeDescription} = require('./CONS');

let Alerts = [];
let DeviceID = [];
let changeStream;

const GetAlert = async () => {

    let query=[ {status: {$nin: ['deleted', 'inactive'] }} ];
   
    const List = await Alert.aggregate([
      { $match: { $and: query } },
      {
        $lookup: {
            from: 'vehicles',
            let: { originId: "$originID" },
            pipeline: [
                { $match: { $expr: { $in: ["$_id", "$$originId"] } } },
                { $project: { _id: 1, DeviceID: 1,company:1 } } // Selecciona los campos específicos de vehicles
            ],
            as: "vehicleDetails"
        }
    },
    {
        $lookup: {
            from: 'iot.sensor',
            let: { originId: "$originID" },
            pipeline: [
                { $match: { $expr: { $in: ["$_id", "$$originId"] } } },
                { $project: { _id: 1, sensorSpecificField: 1 } } // Selecciona los campos específicos de iot.sensor
            ],
            as: "sensorDetails"
        }
    },
    {
        $lookup: {
            from: 'company',
            localField: 'company',
            foreignField: '_id',
            as: 'companyDetails'
        }
    },
    {
        $addFields: {
            originDetails: { $concatArrays: ["$vehicleDetails", "$sensorDetails"] } // Combina ambos resultados
        }
    },
    {
        $addFields: {
            timezone: { $arrayElemAt: ["$companyDetails.timezone", 0] } // Extrae el campo `timezone`
        }
    },
    {
        $project: {
            _id: 1,
            name: 1,
            modelType: 1,
            evaluationType: 1,
            originDetails: 1, // Incluye el array combinado
            value: 1,
            location: 1,
            status: 1,
            timezone: 1 
        }
    },
    { $sort: { name: 1 } }
    ])
    .allowDiskUse(true)
    .then(function (res) {
      // console.log('GetAlert>>>>>>>>>>>>>',JSON.stringify(res));
        return res;
      });

      Alerts = List;
      //OBTENER TODOS LOS DEVICE ID LIST
      DeviceID = List.flatMap(alert => alert.originDetails.map(origin => origin.DeviceID));

      console.log('Devices',DeviceID)
      updatePipeline(); 

}

// Función para construir el pipeline dinámico
const buildPipeline = () => {
    return [{
        $match: {
            $or: [{ operationType: 'insert' }, { operationType: 'update' }],
            'fullDocument.statusGps': "A", 'fullDocument.deviceID': {$in:DeviceID}
        }
    }, {
        $project: {
            'fullDocument._id': 1,
            'fullDocument.deviceID': 1,
            'fullDocument.Lat': 1,
            'fullDocument.Lng': 1,
            'fullDocument.speed': 1,
            'fullDocument.dateConv': 1,
            'operationType': 1
        }
    }];
}

// Función para actualizar y reiniciar el change stream
const updatePipeline = () => {

    if (changeStream) {
        changeStream.close(); // Cerrar el change stream actual
    }
    console.log('INIT WATCH GPS')

    const pipeline = buildPipeline();
    changeStream = GpsData.watch(pipeline, { fullDocument: 'updateLookup' })
        .on('change', data => {
          //  GetAlert(); 
          
        //  console.log('DATA FILTERED',JSON.stringify(data))
          //VALIDATE VEHICLE IF IS IN ALERT 
          checkAlert(data.fullDocument)

        })
        .on('error', error => {
            console.error('Ocurrió un error en el change stream:', error);
        });
}

const checkAlert = async (doc) => {
  //  console.warn(doc)

    //GET COMPANY OF DEVICEID
    // VALIDATE IF doc.deviceID is in Alerts DeviceID
    const matchingAlerts = Alerts.map(alert => {
    // Filtrar el originDetails para obtener solo el DeviceID específico
    const matchingDetails = alert.originDetails.find(detail => detail.DeviceID === doc.deviceID);
    if (matchingDetails) {
      return {
        ...alert,
        originID: matchingDetails
      };
    }
    
    return null; 
  }).filter(alert => alert !== null);


  const coordinate = [doc.Lng,doc.Lat];
    //CHECK ALL ALERTS CONDITIONS
   // console.warn('MATCHED ALERTS ARRAY',matchingAlerts)

    matchingAlerts.forEach(async alert => {

        // Convierte la coordenada y el polígono de la alerta en objetos Turf
        const point = turf.point(coordinate);
        const polygon = turf.polygon(alert.location.coordinates);
      
        // Verifica si la coordenada está dentro o fuera del polígono
        const isInside = turf.booleanPointInPolygon(point, polygon);
      
        if (alert.evaluationType === 'in') {
          if (isInside) {
            console.log(`La coordenada está dentro del polígono de la alerta: ${alert.name} ${alert.originID.DeviceID}`);

            // IF IS INSIDE CHECK LAST ACTIVITY

            let timeCheck = moment(doc.dateConv).subtract(1,'h').toDate();

           // console.log('---TIME',timeCheck)

            //VALIDAR SI EXISTE EN LA ULTIMA HR - MARGEN DE 1 HR
            let checkActivity = await Activity.findOne({ refID: alert.originID._id, internalCode: 24,createdAt:{$gte:timeCheck} }).sort({ createdAt: -1 }).select('internalCode _id');
            if(checkActivity && checkActivity.internalCode != 24){


                const NewData = new Activity({
                    createdAt:doc.dateConv,
                    refPoint: doc._id,
                    refID:alert.originID._id,
                    company:alert.originID.company,
                    title:`${alert.name}`,
                    description:evaluationTypeDescription[alert.evaluationType],
                    observation:`${evaluationTypeDescription[alert.evaluationType]}`,
                    location:{
                        type:'Point',
                        coordinates:coordinate
                    },
                    modelType:'vehicles',
                    internalCode:24,
                    modelEmployee:'bot',
                    employee:new mongoose.Types.ObjectId('6728ee329ad1a4f6231eb876')
                });
                await NewData.save();

            }else if(!checkActivity){

                const NewData = new Activity({
                    createdAt:doc.dateConv,
                    refPoint: doc._id,
                    refID:alert.originID._id,
                    company:alert.originID.company,
                    //title:`Alerta - ${alert.name}`,
                    title:`${alert.name}`,
                    observation:`${evaluationTypeDescription[alert.evaluationType]}`,
                    description:evaluationTypeDescription[alert.evaluationType],
                    location:{
                        type:'Point',
                        coordinates:coordinate
                    },
                    modelType:'vehicles',
                    internalCode:24,
                    modelEmployee:'bot',
                    employee:new mongoose.Types.ObjectId('6728ee329ad1a4f6231eb876')
                });
                await NewData.save();

            }
            

          } else {
            //console.log(`La coordenada está fuera del polígono de la alerta: ${alert.name} ${alert.originID.DeviceID}`);

          }

        } else if (alert.evaluationType === 'out') {
          // FLOW OUT ZONE

          if (!isInside) {
          //  console.log(`La coordenada está fuera del polígono de la alerta: ${alert.name} ${alert.originID.DeviceID}`);


            //GET TIMEZONE OF COMPANY
            let timeCheck = moment(doc.dateConv).subtract(1,'h').toDate();
            console.log('---TIME',timeCheck)

            //VALIDAR SI EXISTE EN LA ULTIMA HR - MARGEN DE 1 HR
            let checkActivity = await Activity.findOne({ refID: alert.originID._id, internalCode: 25,createdAt:{$gte:timeCheck} }).sort({ createdAt: -1 }).select('internalCode _id');            
            if(checkActivity && checkActivity.internalCode != 25){

                const NewData = new Activity({
                    createdAt:doc.dateConv,
                    refPoint: doc._id,
                    refID:alert.originID._id,
                    company:alert.originID.company,
                    title:`${alert.name}`,
                    observation:`${evaluationTypeDescription[alert.evaluationType]}`,
                    description:evaluationTypeDescription[alert.evaluationType],
                    location:{
                        type:'Point',
                        coordinates:coordinate
                    },
                    modelType:'vehicles',
                    internalCode:25,
                    modelEmployee:'bot',
                    employee:new mongoose.Types.ObjectId('6728ee329ad1a4f6231eb876')
                });
                await NewData.save();

            }else if(!checkActivity){

                const NewData = new Activity({
                    createdAt:doc.dateConv,
                    refPoint: doc._id,
                    refID:alert.originID._id,
                    company:alert.originID.company,
                    title:`${alert.name}`,
                    observation:`${evaluationTypeDescription[alert.evaluationType]}`,
                    description:evaluationTypeDescription[alert.evaluationType],
                    location:{
                        type:'Point',
                        coordinates:coordinate
                    },
                    modelType:'vehicles',
                    internalCode:25,
                    modelEmployee:'bot',
                    employee:new mongoose.Types.ObjectId('6728ee329ad1a4f6231eb876')
                });
                await NewData.save();

            }


          } else {
           // console.log(`La coordenada está dentro del polígono de la alerta: ${alert.name} ${alert.originID.DeviceID}`);
          }
        }
      });


}


const AlertJob = () => {
    console.log('ALERTJOB INIT -')
    GetAlert()
    //UPDATE LIST ALERT
    //VALIDAR PERFORMANCE DE DEJAR TODAS LAS MODIFICACIONES 
    const pipeline = [{
            $match: {
                $or: [{ operationType: 'insert' }, { operationType: 'update' }],
              //  'fullDocument.company': {$eq:new mongoose.Types.ObjectId('637cdd6ac20f220428ba8ff5')},
              //  'fullDocument._id': {$eq:new mongoose.Types.ObjectId('64664247382f2dfb657a9d7f')},
              //  'fullDocument.status': "active"
            }
        },{ $project: { 'fullDocument._id': 1, 'fullDocument.name': 1, 'fullDocument.evaluationType': 1,'fullDocument.value': 1,'fullDocument.originID': 1, 
        'fullDocument.modelType': 1,'fullDocument.company': 1,
        'fullDocument.location': 1,'operationType':1 } }
    ];


    const changeStream = Alert.watch(pipeline, {fullDocument: 'updateLookup'}).on('change', data => {
      // console.log('changeStream = Alert.watch')
        // RELOAD ALERTS LIST
        GetAlert();
    })
    .on('error', error => {
      console.error('Ocurrió un error en el change stream:', error);
    })
    
}

module.exports = AlertJob;