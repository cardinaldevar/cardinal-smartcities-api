const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const GpsData = require('../../models/GpsData');
const Vehicle = require('../../models/Vehicle');
const moment = require('moment');

// @route Get api/Report
// @Desc Get Available Searchs

router.get('/',auth, async (req,res) => {
       
    try{
       /* const live = await GpsData.find();
       // res.json(live);
        return res.status(200).json({data: live});*/

       /* const live = await GpsData.find({"DeviceID":["121181261522"]}).distinct('DeviceID', function(error, ids) {
            // ids is an array of all ObjectIds
            console.log(ids);
        });
        return res.status(200).json({data: live});
*/      
        var id="5d5da2bfb92eb0dc02d55999";
        const VehicleList = await Vehicle.find({company:id})
        .select("DeviceID -_id")
        .then(vehiclelist => {              
            const vehiclelistID = vehiclelist.map(x => x.DeviceID);
        
           console.log(vehiclelistID);
            return vehiclelistID;
    
          });
        
       // return res.status(200).json({VehicleList});
        
        const live = await GpsData
        .aggregate([{ $match: { DeviceID: {$in:VehicleList}  } }])
        .sort({"DateConv":-1})
        .group({    
            _id: "$DeviceID",
            Speed: { $first: "$Speed" },
            Lat: { $first: "$Lat" },
            NS: { $first: "$NS" },
            Lng: { $first: "$Lng" },
            EW: { $first: "$EW" },
            timestamp: { $last: "$_id"},  
        })
        .exec();

        return res.status(200).json({data: live});


    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

//@route POST api/Report/fleetList
//@Desc  Get Available Searchs Fleet
//@access Private

router.get('/fleetList',auth, async (req,res) => {
    
    const fleetList = req.user.fleetAccess;
    
    try{
         
        // FALTA ARRASTRAR EL NAME DE LA FLOTA!

        SearchAvailableListProcess = [];
        const SearchAvailableList = await Vehicle.find({category: {$in:fleetList}})
        .select("DeviceID plate brand model color movilnum category _id")
        //.populate('category')
        .then(vehiclelist => {    

            vehiclelist.map((item, key) =>{
                SearchAvailableListProcess.push({
                    value:item.DeviceID, label: `${item.movilnum} - ${item.plate}`,
                })
              });
    
          });
         // console.log(SearchAvailableList);
         // console.log(SearchAvailableListProcess);
          
        return res.status(200).json({data: SearchAvailableListProcess});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


//@route POST api/report/route
//@Desc Create or update
//@access Private

router.post('/tracking',[
    check('Vehicles','Envie datos de vehiculos').not().isEmpty()
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }
    console.log('INIT TRACKING')
    console.log(req.body);
    const {Vehicles,endDate,endHr,startDate,startHr,ViewStop } = req.body;
    //res.status(200).json({vehicle})

   // var utcStart = new moment("2019-06-24T09:00", "YYYY-MM-DDTHH:mm").utc();
    startDateConv = moment(startDate).format("YYYY-MM-DD");
    startDateConv2 = `${startDate}T${startHr}:00`;
    startDateHrConv = moment.utc(`${startDateConv2}-03:00`).format();
   // startDateHrConv = moment(startDateConv2).subtract(3, 'hour').format('YYYY-MM-DDTHH:mm:ss');
    
    endDateConv = moment(endDate).format("YYYY-MM-DD");
    endDateConv2 = `${endDate}T${endHr}:00`;
    endDateHrConv = moment.utc(`${endDateConv2}-03:00`).format();
    
   // console.log('origin:'+startDateConv2);
   // console.log(startDateHrConv);
   // console.log('>'+endDateHrConv)
    try{

        //"2019-09-07T10:00:00.000Z"
      /*  var filterDate={from:`${startDateHrConv}.000`,to:`${endDateHrConv}.000`}
        console.log(new Date(filterDate.from));
        console.log('filter'+filterDate);*/
       // console.log(Vehicles);
       // console.log(Vehicles.length);
      //  console.log(ViewStop);
        Tracking = [];
        Stops = [];

        for (const [index, value] of Vehicles.entries()) {
            
            //console.log('init',value);

            var query=[{ deviceID: {$eq:value} }, 
                { "dateConv": { "$gte": new Date(startDateHrConv)}},
                { "dateConv": {"$lte": new Date(endDateHrConv) }}];
            const live = await GpsData
            .aggregate([
                { $match: { $and: query } },
                { $lookup: {from: 'vehicles', localField: 'deviceID', foreignField: 'DeviceID', as: 'vehicles'} }
            ])
            .sort({DateConv:-1})
            .exec();
            
            TrackingRoute=[];
            vehicleColor = [];
            vehicleSpeed = [];
            Routes = [];
           // console.log(live[index].vehicles[0].movilnum);
            Pointerize=[];
            PointerizeAngle=[];

            live.map((item, key) =>{
               /* LatStr = item.Lat.toString();
                LatGrade = parseInt(LatStr.slice(0,2));
                LatMin = parseFloat(LatStr.slice(2,9))/60;
                var decimalOnly = parseFloat(Math.abs(LatMin).toString().split('.')[1]);
                Lat = parseFloat('-'+LatStr.slice(0,2) + '.' + decimalOnly.toString().slice(0,6));
                LngStr = item.Lng.toString();
                LngGrade = parseInt(LngStr.slice(0,2));
                LngMin = parseFloat(LngStr.slice(2,9))/60;
                var LngdecimalOnly = parseFloat(Math.abs(LngMin).toString().split('.')[1]);
                Lng = parseFloat('-'+LngStr.slice(0,2) + '.' + LngdecimalOnly.toString().slice(0,6));
     */ 
               // console.log(item.DateConv,item.location.coordinates[1],item.location.coordinates[0])
                TrackingRoute.push([item.location.coordinates[1],item.location.coordinates[0]]);
                Routes.push([item.location.coordinates[1],item.location.coordinates[0]]);

                Pointerize.push({
                    type: "Feature",
                    geometry: {
                    type: "Point",
                    coordinates: [item.location.coordinates[1], item.location.coordinates[0]]
                    },
                    properties: {
                        deviceID:item.deviceID,
                        MovilNum:live[index].vehicles[0].movilnum,
                        Color:live[index].vehicles[0].color,
                        Speed: Number((item.speed).toFixed(2)),
                        Date:item.dateConv,
                        Heading:item.heading,
                    }
                });

                PointerizeAngle.push({
                    coordinates: [item.location.coordinates[1], item.location.coordinates[0]],
                    deviceID:item.deviceID,
                    MovilNum:live[index].vehicles[0].movilnum,
                    Color:live[index].vehicles[0].color,
                    Speed: Number((item.speed).toFixed(2)),
                    Date:item.dateConv,
                    Heading:item.heading
                });

                // FIX QUERY FOR COLOUR
                // vehicleColor = item.vehicles[0].color
               // vehicleColor.push(item.vehicles[0].color);
                vehicleSpeed.push(Number((item.speed).toFixed(2)));
            });

            Tracking.push({
                Vehicle:value,
                MovilNum:live[index].vehicles[0].movilnum,
                Color:live[index].vehicles[0].color,
                Route:TrackingRoute,
                RoutePoint:Pointerize,
                RoutePointAngle:PointerizeAngle,
                Speed: vehicleSpeed,
                FitBounds:Routes
            })
            
        }
       // console.log(Tracking);
        //Tracking.Route.map(item=>console.log(item));
        //  console.log(JSON.stringify(TrackingRoute));
        /* const TrackingStop = [
             {lat:-34.422319,lng:-58.5892597},
             {lat:-34.4227,lng:-58.5910197},
         ];*/
         if(ViewStop){

            for (const [index, value] of Vehicles.entries()) {

                var query2=[
                    { deviceID: {$eq:value} },
                    { "dateConv": { "$gte": new Date(startDateHrConv)} },
                    { "dateConv": {"$lte": new Date(endDateHrConv) } },
                    { "speed": {$lte: 0.1 } },
                    {"statusGPS":{$eq:"A"}}
                ];

                const live2 = await GpsData
                .aggregate([
                    { $match: { $and: query2 } },
                    { $lookup: {from: 'vehicles', localField: 'deviceID', foreignField: 'DeviceID', as: 'vehicles'} }
                ])
                .sort({DateConv:-1})
                .exec();

                TrackingStop=[];

                live2.map((item, key) =>{
        /*
                    LatStr = item.Lat.toString();
                    LatGrade = parseInt(LatStr.slice(0,2));
                    LatMin = parseFloat(LatStr.slice(2,9))/60;
                    var decimalOnly = parseFloat(Math.abs(LatMin).toString().split('.')[1]);
                    Lat = parseFloat('-'+LatStr.slice(0,2) + '.' + decimalOnly.toString().slice(0,6));
                    LngStr = item.Lng.toString();
                    LngGrade = parseInt(LngStr.slice(0,2));
                    LngMin = parseFloat(LngStr.slice(2,9))/60;
                    var LngdecimalOnly = parseFloat(Math.abs(LngMin).toString().split('.')[1]);
                    Lng = parseFloat('-'+LngStr.slice(0,2) + '.' + LngdecimalOnly.toString().slice(0,6));
*/
                    TrackingStop.push({
                        type: "Feature",
                        geometry: {
                        type: "Point",
                        coordinates: [item.location.coordinates[1], item.location.coordinates[0]]
                        },
                        properties: {
                            "title": "Cardinal",
                            "marker-symbol": "monument"
                        }
                    });

                    vehicleColor = item.vehicles[0].color;
                });
                
                Stops.push({
                    Vehicle: value,
                    Color: vehicleColor,
                    Stops: {"type": "FeatureCollection","features": TrackingStop }
                });

                }
            }

        //console.log(JSON.stringify(live2))
        
        return res.status(200).json({Tracking,Stops});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
    

})

module.exports = router;