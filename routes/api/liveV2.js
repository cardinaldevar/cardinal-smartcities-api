const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
//const GpsData = require('../../models/GpsData');
const LiveData = require('../../models/LiveData');
const Vehicle = require('../../models/Vehicle');
const Mark = require('../../models/Mark' );
const Service = require('../../models/Service');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const _ = require('lodash');
// @route Get api/live
// @Desc Get current vehicles positions

router.get('/',auth, async (req,res) => {
       
    try{

        //console.log(req.user.company)

        const VehicleList = await Vehicle.find({company:  new mongoose.Types.ObjectId(req.user.company) })
        .select("DeviceID -_id")
        .then(vehiclelist => {              
            const vehiclelistID = vehiclelist.map(x => `${x.DeviceID}`);
        
          // console.log(vehiclelistID);
            return vehiclelistID;
    
          });
        
       // return res.status(200).json({VehicleList});
        
        const live = await GpsData
        .aggregate([
            { $match: { deviceID: {$in:VehicleList}  } },
            { $sort: {"dateConv":-1}},
            {$group: {    
                _id: "$deviceID",
                Speed: { $first: "$speed" },
                Lat: { $first: "$Lat" },
                NS: { $first: "$NS" },
                Lng: { $first: "$Lng" },
                EW: { $first: "$EW" },
                timestamp: { $last: "$_id"},
            }},
            { $sort: {"deviceID":-1}},
            {allowDiskUse: true}
        ])
        .exec();

        console.log(live);

        return res.status(200).json({data: live});


    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


router.post('/search',auth, async (req,res) => {
      
      const fleetList = req.user.fleetAccess;
      let companyID = new mongoose.Types.ObjectId(req.user.company);
      const {vehicle,type} = req.body;
      moment.tz.setDefault(req.user.timezone)
      console.log('/search',vehicle,type,req.user.timezone)
      try{


        var VehicleList = [];
        var liveProcess=[];
        var sensorQuery = [];

        if(type.includes('vehicle')){ 
          
            let query = {
                company: companyID,
               // category: { $in: fleetList },
                status: { $ne: new mongoose.Types.ObjectId("61106beedce13f38b602bf51") }
            };

            //check if admin
            if(req.user.category.degree >= 2){
                query.category = {$in:fleetList}; 
            }
              
            let vehicleFilter = _.filter(vehicle, { type: 'vehicle' });
            if (vehicleFilter.length >= 1) {
                 query._id = { $in: vehicleFilter.map(i=>i._id) };
            }

          VehicleList = await Vehicle.find(query)
          .select("DeviceID plate brand model -_id")
          .sort({DeviceID:-1})
          .then((result) => {
              const vehiclelistID = result.map(x =>`${x.DeviceID}`);
              return vehiclelistID
          });

          // si los vehiculos enviados es vacio, van todos
          // si posee vehiculos de type vehículos los matchea
  
          var start = moment().subtract(4,"hour").toDate();
         // start.setHours(start.getHours() - 4);
          var end = moment().add(1,"hour").toDate();
        //  end.setHours(end.getHours() + 1);
          var starte = moment().subtract(4,"hour").format();
         // console.log(start,end,starte)
         // console.log(VehicleList)

          const live = await LiveData.aggregate([
              { $match: { 
                  deviceID: {$in:VehicleList},
                  dateConv:{$gte: start, $lte: end}
              } },
              { $sort:{deviceID:-1}},
              { $group: {
                  _id: "$deviceID",
                  deviceID: { $first: "$deviceID" },
                  speed: { $first: "$speed" },
                  Lat: { $first: "$Lat" },
                  NS: { $first: "$NS" },
                  Lng: { $first: "$Lng" },
                  EW: { $first: "$EW" },
                  dateConv: { $first: "$dateConv" },
                  location: { $first: "$location" },
                  heading: { $first: "$heading" },
                  //timestamp: { $last: "$_id"},
                 // Vehicle: {$first:"$vehicles"}
              } },
              { $lookup: { from: 'vehicles', localField: 'deviceID', foreignField: 'DeviceID', as: 'vehicles'} },
              {
                  $project: {
                      _id: '$_id',
                      deviceID: '$deviceID',
                      speed: "$speed",
                      Lat:  "$Lat",
                      NS: "$NS",
                      Lng: "$Lng",
                      EW: "$EW",
                    //  category:''
                      dateConv: "$dateConv",
                      vehicle: "$vehicles",
                      location: "$location.coordinates",
                      heading: "$heading",
                  }
              },
              { $sort:{deviceID:-1}},
          ])
          .limit(VehicleList.length)
          .allowDiskUse(true)
          .then(function (res) {
              return res;
            });
            
         // console.log(VehicleList.length);
         // console.log(live);
          live.map((item, key) =>{
            
           // FIX OLD PARA MOSTRAR EN MAPA DEBE QUITARSE Y FIXEAR LOS NODOS!!!
            Lng = item.location[0];
            Lat = item.location[1];
            
            liveProcess.push({
                    _id:parseInt(item._id,10),
                    speed:item.speed.toFixed(2),
                    coordinates:item.location,
                    brand:item.vehicle[0].brand,
                    model:item.vehicle[0].model,
                    plate:item.vehicle[0].plate,
                    movilnum:item.vehicle[0].movilnum,
                    color:item.vehicle[0].color,
                    lastupdate:moment(item.dateConv).format("DD/MM/YYYY HH:mm"),
                    heading:item.heading,type:'vehicle'
                });

            });
            //console.log(liveProcess);
            const vehiclelistID2 = liveProcess.map(x => x._id);
            var temp = [];
            for (var i in VehicleList) {
                if(vehiclelistID2.indexOf(parseInt(VehicleList[i],10)) === -1){
                    temp.push(VehicleList[i]);
                  }
                   
              }
        }

        if(type.includes('sensor')){

            let query = [{
                company: companyID,
                status:{$ne:'deleted'}
              }];
                            
            let iotFilter = _.filter(vehicle, { type: 'iot' });
            if (iotFilter.length >= 1) {
                 query.push({_id:{ $in: iotFilter.map(i=> new mongoose.Types.ObjectId(i.value)) }});
            }

            sensorQuery = await IotSensor.aggregate([
                { $match:{ $and: query } },
                {
                        $lookup: {
                        from: 'mark.type',
                        localField: 'typePoint', // Campo en MarkSchema que contiene la referencia al typeSensor
                        foreignField: '_id', // Campo en mark.type que contiene el _id
                        as: 'sensorType'
                        }
                    },
                    { $unwind:{path:"$sensorType",preserveNullAndEmptyArrays:true}},
                    {
                        $lookup: {
                            from: "iot.live",
                            let: { sensorImei: "$imei" },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: { $eq: ["$imei", "$$sensorImei"] }
                                    }
                                },
                                { $sort: { createdAt: -1 } },
                                { $limit: 1 }
                            ],
                            as: "latestHistory"
                        }
                    },
                    {
                        $addFields: {
                            latestHistory: { $arrayElemAt: ["$latestHistory", 0] }
                        }
                    },
                    { $sort: { _id: -1 } },
                    {
                        $project: {
                            _id: '$_id',
                            createAt: '$createAt',
                            name: '$name',
                            imei: "$imei",
                            typeSensor: '$sensorType.name_es',
                            typeModel: '$sensorType.typeModel',
                            status: "$status",
                            model: "$model",
                            height: "$height",
                            width: "$width",
                            length: "$length",
                            capacity: "$capacity" ,
                            location: "$location",
                            action:{
                                _id: '$_id'
                            },
                            latestHistory: 1
                        }
                    }
            ]);

        }
       console.log('sensorQuery',JSON.stringify(sensorQuery))
        return res.status(200).json({live: liveProcess,totalVehicle:VehicleList.length,sensor:sensorQuery});
  
      }catch(err){
          console.error(err.message);
          res.status(500).send('server error');
      }
  });

//@route POST api/live/fleet
//@Desc Get Live Position of Vehicles in Authorized Fleet 
//@access Private

router.post('/fleet',auth, async (req,res) => {
    
  //  console.info('/fleet',req.user);

    const fleetList = req.user.fleetAccess;
    //console.log(typeof(fleetList));
   // console.log(JSON.stringify(fleetList));

    try{
         
        //var id=["5d5da431b92eb0dc02d5599b","5d6f07204ca75927807f5ad4"];   // id de flotas 
        
        const VehicleList = await Vehicle.find({category: {$in:fleetList},status: {$ne:new mongoose.Types.ObjectId("61106beedce13f38b602bf51")} })
        .select("DeviceID plate brand model -_id")
        .sort({DeviceID:-1})
        .then((result) => {
            const vehiclelistID = result.map(x =>`${x.DeviceID}`);
            return vehiclelistID
        });

        var start = new Date();
        start.setHours(start.getHours() - 4);
        var end = new Date();
        end.setHours(end.getHours() + 1);

        const live = await LiveData.aggregate([
            { $match: { 
                deviceID: {$in:VehicleList},
                dateConv:{$gte: start, $lt: end}
            } },
            { $sort:{deviceID:-1}},
            { $group: {
                _id: "$deviceID",
                deviceID: { $first: "$deviceID" },
                speed: { $first: "$speed" },
                Lat: { $first: "$Lat" },
                NS: { $first: "$NS" },
                Lng: { $first: "$Lng" },
                EW: { $first: "$EW" },
                dateConv: { $first: "$dateConv" },
                location: { $first: "$location" },
                heading: { $first: "$heading" },
                //timestamp: { $last: "$_id"},
               // Vehicle: {$first:"$vehicles"}
            } },
            { $lookup: { from: 'vehicles', localField: 'deviceID', foreignField: 'DeviceID', as: 'vehicles'} },
            {
                $project: {
                    _id: '$_id',
                    deviceID: '$deviceID',
                    speed: "$speed",
                    Lat:  "$Lat",
                    NS: "$NS",
                    Lng: "$Lng",
                    EW: "$EW",
                  //  category:''
                    dateConv: "$dateConv",
                    vehicle: "$vehicles",
                    location: "$location.coordinates",
                    heading: "$heading",
                }
            },
            { $sort:{deviceID:-1}},
        ])
        .limit(VehicleList.length)
        .allowDiskUse(true)
        .then(function (res) {
            //console.log(JSON.stringify(res));
            return res;
          });
          
        //console.log(VehicleList.length);
     //   console.log(">>>>"+JSON.stringify(live));

          liveProcess=[];

          live.map((item, key) =>{
            //console.log(item);
           /* LatStr = item.Lat.toString();
            LatGrade = parseInt(LatStr.slice(0,2));
            LatMin = parseFloat(LatStr.slice(2,9))/60;
            var decimalOnly = parseFloat(Math.abs(LatMin).toString().split('.')[1]);
            Lat = parseFloat('-'+LatStr.slice(0,2) + '.' + decimalOnly.toString().slice(0,6));
            LngStr = item.Lng.toString();
            LngGrade = parseInt(LngStr.slice(0,2));
            LngMin = parseFloat(LngStr.slice(2,9))/60;
            var LngdecimalOnly = parseFloat(Math.abs(LngMin).toString().split('.')[1]);
            Lng = parseFloat('-'+LngStr.slice(0,2) + '.' + LngdecimalOnly.toString().slice(0,6));*/

           // console.log(item.location.coordinates);
            Lng = item.location[1];
            Lat = item.location[0];
            //console.log(item.Vehicle[0].DeviceID);
          //  console.log(Lat +','+ Lng);
                liveProcess.push({
                    _id:parseInt(item._id,10),
                    speed:item.speed.toFixed(2),
                    coordinates:[Lng,Lat],
                    brand:item.vehicle[0].brand,
                    model:item.vehicle[0].model,
                    plate:item.vehicle[0].plate,
                    movilnum:item.vehicle[0].movilnum,
                    color:item.vehicle[0].color,
                    lastupdate:moment(item.dateConv).format("DD/MM/YYYY HH:mm"),
                    heading:item.heading,type:'vehicle'
                });

            });
            //console.log(liveProcess);
            const vehiclelistID2 = liveProcess.map(x => x._id);
            //console.log(vehiclelistID2);
            //console.log(vehiclelistID2.length);

            var temp = [];
            for (var i in VehicleList) {
               // console.log(VehicleList[i]+'-'+vehiclelistID2.indexOf(VehicleList[i])+':'+typeof(VehicleList[i]));
                if(vehiclelistID2.indexOf(parseInt(VehicleList[i],10)) === -1){
                    temp.push(VehicleList[i]);
                  }
                   
              }
              
          //  console.log('> Outside:'+VehicleList.length+'/'+vehiclelistID2.length);
          //  console.log(temp);
          //  console.log(temp.length);

            //compare(VehicleList,vehiclelistID2);
       //  console.log('liveProcess',liveProcess);
        return res.status(200).json({live: liveProcess,totalVehicle:VehicleList.length});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});



router.get('/data',auth, async (req,res) => {
    
  //  console.info('/data',req.user);
    let companyID = new mongoose.Types.ObjectId(req.user.company)
    moment.tz.setDefault(req.user.timezone)
    let dateStart = moment().startOf('day').toDate();
    let dateEnd = moment().endOf('day').toDate();

    try{
         
        let sensorCount = 0;
        sensorCount = await Mark.countDocuments({ company: companyID,modelType:'iot.sensor', status: {$ne:"deleted"} });

        let serviceCount =  0;
        serviceCount = await Service.countDocuments({company:companyID,deliveryDate: {$gte:dateStart,$lte:dateEnd}});

        return res.status(200).json({sensor: sensorCount,service:serviceCount});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});



module.exports = router;