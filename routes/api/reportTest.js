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

router.post('/fleetList',[
    check('fleetAccess','No posee Flotas autorizadas').not().isEmpty()
],auth, async (req,res) => {
    
  //  console.info(req.body);
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const fleetList = req.body.fleetAccess;
    
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
    
    console.log('origin:'+startDateConv2);
   // console.log(startDateHrConv);
    console.log('>'+endDateHrConv)
    try{

        //"2019-09-07T10:00:00.000Z"
      /*  var filterDate={from:`${startDateHrConv}.000`,to:`${endDateHrConv}.000`}
        console.log(new Date(filterDate.from));
        console.log('filter'+filterDate);*/
        console.log(Vehicles);
        console.log(Vehicles.length);
        console.log(ViewStop);
        Tracking = [];
        Stops = [];

        for (const [index, value] of Vehicles.entries()) {
            
            console.log(value);

            var query=[{ DeviceID: {$eq:value} }, { "DateConv": { "$gte": new Date(startDateHrConv)}},{ "DateConv": {"$lte": new Date(endDateHrConv) }}];
            const live = await GpsData
            .aggregate([
                { $match: { $and: query } },
                { $lookup: {from: 'vehicles', localField: 'DeviceID', foreignField: 'DeviceID', as: 'vehicles'} }
            ])
            .sort({DateConv:-1})
            .exec();

            TrackingRoute=[];
            vehicleColor = [];
            vehicleSpeed = [];
            Routes = [];

            console.log(live[index].vehicles[0].movilnum);
            live.map((item, key) =>{
              
                TrackingRoute.push([item.location.coordinates[1],item.location.coordinates[0]]);
                Routes.push([item.location.coordinates[1],item.location.coordinates[0]]);
                // FIX QUERY FOR COLOUR
                // vehicleColor = item.vehicles[0].color
               // vehicleColor.push(item.vehicles[0].color);
                vehicleSpeed.push(Number((item.Speed).toFixed(2)));
            });

            Tracking.push({
                Vehicle:value,
                MovilNum:live[index].vehicles[0].movilnum,
                Color:live[index].vehicles[0].color,
                Route:TrackingRoute,
                Speed: vehicleSpeed,
                FitBounds:Routes
            })
            
        }
        //console.log(Tracking);
         //  console.log(JSON.stringify(TrackingRoute));
        /* const TrackingStop = [
             {lat:-34.422319,lng:-58.5892597},
             {lat:-34.4227,lng:-58.5910197},
         ];*/
         if(ViewStop){

            for (const [index, value] of Vehicles.entries()) {

                var query2=[
                    { DeviceID: {$eq:value} },
                    { "DateConv": { "$gte": new Date(startDateHrConv)} },
                    { "DateConv": {"$lte": new Date(endDateHrConv) } },
                    { "Speed": {$lte: 0.1 } },
                    {"StatusGPS":{$eq:"A"}}
                ];

             /*   const live3 = await GpsData
                .find(
                  { 'address.coord':
                    { $near :
                      { $geometry:
                        { type: "Point",  coordinates: [ -34.446639, -58.661683 ] },
                          $maxDistance: 100
                      }
                    }
                  }
                ).toArray(function(err, docs) {
                  assert.equal(err, null);
                  console.log("Found the following records");
                  console.log(docs);
                  callback(docs);
                });  */
                ///////////////////////////////////////// QUERY NEAR /////////////////////
                const live3 = await GpsData.find({
                    location: {
                     $near: {
                      $maxDistance: 1,
                      $geometry: {
                       type: "Point",
                       coordinates: [-34.446639,-58.661683]
                      }
                     }
                    }
                   }).find((error, results) => {
                    if (error) console.log(error);
                   // console.log(JSON.stringify(results, 0, 2));
                   // results.map(item => console.log(item.location.coordinates[0]+','+item.location.coordinates[1]+' '+item.DateConv+' : '+item.Speed))
                   });

                   const live4 = await GpsData.aggregate([
                    {
                        $geoNear: {
                           near: { type: "Point", coordinates: [ -34.465839, -58.554853] },
                           distanceField: "dist.calculated",
                           maxDistance: 100,
                         //  query: { category: "Parks" },
                           includeLocs: "dist.location",
                           spherical: true
                        }
                      },
                    { $match: { $and: query2 } }
                 ]).exec();
                   ///////////////////////////////////////// QUERY NEAR /////////////////////
                   
                //console.log(live4);
               // live4.map(item => console.log(item.location.coordinates[0]+','+item.location.coordinates[1]+' '+item.DateConv+' : '+item.Speed))
                
               
               const live5 = await GpsData.aggregate([
                {
                  $geoNear: {
                    near: {
                      type: "Point",
                      coordinates: [
                        -34.465839, -58.554853
                      ]
                    },
                    spherical: true,
                    distanceField: "distance",
                    distanceMultiplier: 0.0001
                  }
                },
                { $match: { $and: query2 } },
                {
                  $bucket: {
                    groupBy: "$distance",
                    boundaries: [
                      0,1
                    ],
                    default: "greater than 500km",
                    output: {
                      count: {
                        $sum: 1
                      },
                      docs: {
                        $push: "$$ROOT"
                      }
                    }
                  }
                }
            ]);
            
            live5.map(item =>{
                console.log(item)
               // item.docs.map(loc => console.log(loc.location.coordinates[0]+','+loc.location.coordinates[1]+' '+loc.DateConv+' : '+loc.Speed));
              // console.log(item.docs[0].location.coordinates[0]+','+item.docs[0].location.coordinates[1]+' '+item.docs[0].DateConv+' : '+item.docs[0].Speed)
               /* if(item!==undefined){
                    console.log(item.docs.location.coordinates[0]+','+item.docs.location.coordinates[1]+' '+item.docs.DateConv+' : '+item.docs.Speed)
                }*/
            });
               //////////////////////////////////

                const live2 = await GpsData
                .aggregate([
                    { $match: { $and: query2 } },
                    { $lookup: {from: 'vehicles', localField: 'DeviceID', foreignField: 'DeviceID', as: 'vehicles'} }
                ])
                .sort({DateConv:-1})
                .exec();

                TrackingStop=[];

                live2.map((item, key) =>{

                    TrackingStop.push({
                        type: "Feature",
                        geometry: {
                        type: "Point",
                        coordinates: [item.location.coordinates[1], item.location.coordinates[0]]
                        },
                        properties: {
                            "title": "Mapbox DC",
                            "marker-symbol": "monument"
                        }
                    });

                    vehicleColor = item.vehicles[0].color
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