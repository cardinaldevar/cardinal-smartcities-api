const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
//const GpsData = require('../../models/GpsData');
const LiveData = require('../../models/LiveData');
const Vehicle = require('../../models/Vehicle');
const Mark = require('../../models/Mark' );
const MarkType = require('../../models/MarkType' );
const Service = require('../../models/Service');
const moment = require('moment');
const mongoose = require('mongoose');
const MapZone = require('../../models/MapZone' );

// @route Get api/map
// @Desc Get current types

router.get('/marktype',auth, async (req,res) => {
       
    try{

        const MarkTypeList = await MarkType.find({typeModel:'point',subTypeModel:null}).sort({name_es:1});

        return res.status(200).json(MarkTypeList);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

router.post('/submarktype',[
  check('id','Error').not().isEmpty()
],auth, async (req,res) => {
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }
  
  const {id} = req.body;

  try{

      const SubMarkTypeList = await MarkType.find({typeModel:'point',subTypeModel: new mongoose.Types.ObjectId(id)}).sort({name_es:1});

      return res.status(200).json(SubMarkTypeList);

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});

//@route POST api/live/fleet
//@Desc Get Live Position of Vehicles in Authorized Fleet 
//@access Private

router.post('/fleet',auth, async (req,res) => {
    
    console.info('/fleet',req.user);

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
                    speed:item.speed.toFixed(2),
                    coordinates:[item.Lng,item.Lat],
                    brand:item.vehicle[0].brand,
                    model:item.vehicle[0].model,
                    plate:item.vehicle[0].plate,
                    movilnum:item.vehicle[0].movilnum,
                    color:item.vehicle[0].color,
                    lastupdate:moment(item.dateConv).utcOffset(-3).format("DD/MM/YYYY HH:mm"),
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
         //console.log(liveProcess);
        return res.status(200).json({live: liveProcess,totalVehicle:VehicleList.length});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


router.post('/addmark',[
  check('points','Error').not().isEmpty()
],auth, async (req,res) => {
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }
  
  const {points,description,typePoint,subTypePoint,typeLocation,name} = req.body;

  //console.log('/addmark',req.body)
  let companyID = new mongoose.Types.ObjectId(req.user.company)

  try{

  /*  let markPointData = points.map((or,index) => {

      return { insertOne : { "document" : {
          _id: new mongoose.Types.ObjectId(),
          name:points.length === 1 ? name : or.name,
          description:description,
          company:companyID,
          typePoint:new mongoose.Types.ObjectId(typePoint),
          subTypePoint:subTypePoint ? new mongoose.Types.ObjectId(subTypePoint): null
      } } };

  });*/

   // let MarkPointBulk = await MarkPoint.bulkWrite(markPointData);


    let markData = points.map((or,index) => {

      return { insertOne : { "document" : {
          name:points.length === 1 ? name : or.name,
          description:description,
          typePoint:new mongoose.Types.ObjectId(typePoint),
          subTypePoint:subTypePoint ? new mongoose.Types.ObjectId(subTypePoint): null,
          company:companyID,
          location: {type:typeLocation,coordinates:or.coordinates} 
      } } };

    }); 

    let MarkBulk = await Mark.bulkWrite(markData);

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }

  return res.status(200).json(true);

});



// GET BRANDS OF VEHICLES
router.post('/zone/search',[ 
    check('search','Bad request').not().isEmpty()
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json([]);
    }
    const {search} = req.body;
    const companyID = new mongoose.Types.ObjectId(req.user.company);

    let country_code = req.user.country_code;

    try {
        console.log('search',search)
      const VehicleQuery = await MapZone.aggregate([
        {
            $search: {
                    index: "mapzone",
                    "autocomplete": {
                    "query": search,
                    "path": "keyword",
                    "tokenOrder": "any"
                  }
            }
          },
        { $match: { 
                status: {$eq:1},
                country_code,
               // company:company
            } },
       {
            $project: {
                value: '$_id',
                location: '$location',
                label: "$name",
                name: "$name"
            }
        }
    ]).sort({name:1})
    .limit(15)
    .allowDiskUse(true)
    .then(function (res) {
        return res;
    });

    //console.log('search',VehicleQuery)
    
      return res.status(200).json(VehicleQuery);
  
    }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
    }
  
  });

module.exports = router;