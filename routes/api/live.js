const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
//const GpsData = require('../../models/GpsData');
const LiveData = require('../../models/LiveData');
const Vehicle = require('../../models/Vehicle');
const moment = require('moment');
const mongoose = require('mongoose');
// @route Get api/live
// @Desc Get current vehicles positions

router.get('/',auth, async (req,res) => {
       
    try{
        
        var id="5d5da2bfb92eb0dc02d55999";
        const VehicleList = await Vehicle.find({company:id})
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

       // console.log(live);

        return res.status(200).json({data: live});


    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

//@route POST api/live/fleet
//@Desc Get Live Position of Vehicles in Authorized Fleet 
//@access Private

router.get('/fleet',auth, async (req,res) => {
    
   // console.info(req.user);

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

       /* var start = new Date();
        start.setHours(start.getHours() - 3);
        var end = new Date();
        //end.setHours(23,59,59,999);
        end.setHours(end.getHours() + 3);*/

        var start = new Date();
        start.setHours(start.getHours() - 4);
        var end = new Date();
        end.setHours(end.getHours() + 1);

   /*   const VehicleList2 = await LiveData.find({DeviceID: {$in:ve}})
        .select("DeviceID _id")
        //.sort({DateConv:-1})
        .then((result) => {

            console.log(">LIVEDATA:"+JSON.stringify(result));
            
           // console.log('-->'+JSON.stringify(vehiclelistID));
           // return vehiclelistID
        });*/

       //const docs = await LiveData.find();
       /*.exec(function(err, animals) {
            console.log(err);
            console.log(animals);
          });*/
        
       // console.log("LIVE FIND:"+docs);

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
        //console.log(">>>>"+JSON.stringify(live));

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
            //console.log(Lat +','+ Lng);
                liveProcess.push({
                    _id:parseInt(item._id,10),
                    Speed:item.speed.toFixed(2),
                    Lat,
                    Lng,
                    Brand:item.vehicle[0].brand,
                    Model:item.vehicle[0].model,
                    Plate:item.vehicle[0].plate,
                    MovilNum:item.vehicle[0].movilnum,
                    Color:item.vehicle[0].color,
                    Date:moment(item.dateConv).utcOffset(-3).format("DD/MM/YYYY HH:mm"),
                    Heading:item.heading
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
         //console.log(liveProcess);
        return res.status(200).json({data: liveProcess,VehicleAuth:VehicleList.length});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


//@route POST api/profile/me
//@Desc Create or update
//@access Private
/*
router.post('/:',[auth,[
    check('status', 'Status is required').not().isEmpty(),
]],async (req,res)=>{

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });

    }
    const {company} = req.body;
    try{

        res.status(200).json({company})

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
    

})*/

module.exports = router;