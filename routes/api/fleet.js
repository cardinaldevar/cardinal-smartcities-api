const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Vehicle = require('../../models/Vehicle');
const VehicleBrand = require('../../models/VehicleBrand');
const VehicleModel = require('../../models/VehicleModel');
const VehicleCategory = require('../../models/VehicleCategory');
const GpsData = require('../../models/GpsData');
const moment = require('moment');
const mongoose = require('mongoose');

//@route POST api/fleet - with TIMEOUT
//@Desc POST Vehicles in Authorized Fleet 
//@access Private

router.post('/',auth, async (req,res) => {
    
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


//@route GET api/fleet
//@Desc Get Vehicles in Authorized Fleet 
//@access Private

router.get('/',auth, async (req,res) => {
    
  const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));

  try{
  
    /*  const VehicleList = await Vehicle.find({category: {$in:fleetList}})
      .select("DeviceID plate brand model color category company _id")
      .sort({DeviceID:-1})
      .then((result) => {

          //console.log(entryResult);
          const vehiclelistID = result.map(item=>item.DeviceID);
         // console.log('-->'+JSON.stringify(vehiclelistID));
          return vehiclelistID
      });*/

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


router.post('/position',[
  check('deviceID','Error').not().isEmpty()
],auth, async (req,res) => {
  
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }
  console.info(req.body);
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
    check('fleetDetail','No posee Flotas autorizadas').not().isEmpty()
],auth, async (req,res) => {
    
    console.info(req.body);
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const {fleetDetail,endDate,endHr,startDate,startHr } = req.body;
  //  const fleetList = req.body.fleetAccess.map(x => new mongoose.Types.ObjectId(x));

  const VehicleQuery = await Vehicle.find({DeviceID: {$eq:fleetDetail}})
  .select()
  .then((result) => {
      return result;
  });
  console.log(VehicleQuery);

 // var utcStart = new moment("2019-06-24T09:00", "YYYY-MM-DDTHH:mm").utc();
  startDateConv = moment(startDate).format("YYYY-MM-DD");
  startDateConv2 = `${startDate}T${startHr}:00`;
  startDateHrConv = moment.utc(`${startDateConv2}-03:00`).format();
 // startDateHrConv = moment(startDateConv2).subtract(3, 'hour').format('YYYY-MM-DDTHH:mm:ss');
  
  endDateConv = moment(endDate).format("YYYY-MM-DD");
  endDateConv2 = `${endDate}T${endHr}:00`;
  endDateHrConv = moment.utc(`${endDateConv2}-03:00`).format();

  /////////
 // startDateConv3 = `${startDate}T00:00:00`;

 // console.log('Crudo:'+moment.utc(`${startDate}T00:00:00-00:00`))

/*
  const DateDesde = moment(`${startDate}T12:00:00Z`);
  const DateHasta = moment(`${startDate}T12:30:00Z`);
*/
  /*console.log('+2:'+moment(DateN).utc().format())
  console.log('+3:'+DateN.add(30, 'm').utc().format())
  console.log('+3:'+DateN.add(30, 'm').utc().format())

  console.log('origin:'+startDateConv2);*/
 // console.log(startDateHrConv);
  console.log('>'+startDateConv2,endDateHrConv)

    try{
    
        var query=[
            { DeviceID: {$eq:fleetDetail} }, 
            { "DateConv": { "$gte": new Date(startDateHrConv)}},
            { "DateConv": {"$lte": new Date(endDateHrConv) }},
            { "Speed": {$lte: 0.1 } },
            {"StatusGPS":{$eq:"A"}}
        ];
        
        const data1 = [];

    /*    for (var i = 0; i < 48; i++) {
            console.log('vuelta'+i);
            minute = 30;
            desde = DateDesde.add(minute, 'm').utc().format();
            hasta = DateHasta.add(minute, 'm').utc().format();
            console.log(desde,hasta);
           // console.log(DateN.add(minuteD, 'm').utc().format());

           const live2 = await GpsData.findOne({ DeviceID: {$eq:fleetDetail},DateConv: {$gte: new Date(desde) }, DateConv: {$lte: new Date(hasta) } })
           .select('Tank').sort({DateConv:-1});
            console.log(live2);
            data1.push(live2.Tank);
        }*/


  /*      
        const live = await GpsData
        .aggregate([
            { $match: { $and: query } },
            {
                $project: {
                   // _id:'$_id',
                    Tank:'$Tank',
                    DateConv:'$DateConv',
                  //  location: '$location'
                }
            },
            { $sort:{DateConv:1}}
        ])
        .limit(108)
        .exec();
      // console.log(live);
        const datatank = live.map(item => item.Tank);
        console.log(datatank);
*/

        const periods = 48; //time intervals to process data
        const minutesAgo = 15;
        let startDate = new Date(2019,10,15,12,00,0);
        startDate.setMinutes(startDate.getMinutes()-minutesAgo)
        const endDate = new Date(2019,10,15,15,00,0);
        
        console.log(startDate,endDate);
        const live2 = await GpsData
        .aggregate([
            {
              $match: {
                  dateConv: {$gte: new Date(startDateHrConv), $lt: new Date(endDateHrConv)},
                  deviceID: {$eq:fleetDetail}, 
                  speed: {$lte: 0.1 },
                }
              },
              {
                $group: {
                  _id: {
                    $add: [
                        { $subtract: [
                            { $subtract: [ "$dateConv", new Date(0) ] },
                            { $mod: [
                                { $subtract: [ "$dateConv", new Date(0) ] },
                                1000 * 60 * 30
                            ]}
                        ]}, new Date(0)]
                  },
                  Tank: {$first: "$Tank"},
                }
              },
              {
                $project: {
                  _id: 1,
                  Tank: '$Tank'
                }
              },
              {
                $sort: {
                  _id: 1
                }
              }
        ])
        .exec();
        
        console.log('>>'+JSON.stringify(live2),live2.length);
        const datatank = live2.map(item=>item.Tank);
        const labelData = live2.map(item=>moment(item._id).format('HH:mm'));
        const LineChartData = {
            data: {
             /*  labels: ["00:00", "00:30", "01:00", "01:30", "02:00", "02:30", "03:00", "03:30", "04:00", "04:30", "05:00", "05:30", "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00",
               "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30",
               "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30", "23:00", "23:30", "24:00"
            ],*/
            labels: labelData,
               datasets: [
                  {
                     data: datatank,
                     label: "Data Tank",
                     fill: false,
                     borderDash: [5, 5],
                     borderColor: "#9C27B0",
                     pointBorderColor: "#9C27B0",
                     pointBackgroundColor: "#FFF",
                     pointBorderWidth: 2,
                     pointHoverBorderWidth: 2,
                     pointRadius: 4
                  }
                /*  {
                     data: [28, 48, 40, 19, 8, 27, 9],
                     label: "My Second dataset",
                     fill: false,
                     borderDash: [5, 5],
                     borderColor: "#00A5A8",
                     pointBorderColor: "#00A5A8",
                     pointBackgroundColor: "#FFF",
                     pointBorderWidth: 2,
                     pointHoverBorderWidth: 2,
                     pointRadius: 4
                  },
                  {
                     data: [45, 25, 16, 36, 67, 18, 76],
                     label: "My Third dataset - No bezier",
                     lineTension: 0,
                     fill: false,
                     borderColor: "#FF7D4D",
                     pointBorderColor: "#FF7D4D",
                     pointBackgroundColor: "#FFF",
                     pointBorderWidth: 2,
                     pointHoverBorderWidth: 2,
                     pointRadius: 4
                  }*/
               ]
            },
            options: {
               animation: {
                  duration: 1000, // general animation time
                  easing: "easeOutBack"
               },
               hover: {
                  animationDuration: 1000, // duration of animations when hovering an item
                  mode: "label"
               },
               responsiveAnimationDuration: 1000, // animation duration after a resize
               responsive: true,
               maintainAspectRatio: false,
               legend: {
                  position: "bottom"
               },
               scales: {
                  xAxes: [
                     {
                        display: true,
                        gridLines: {
                           color: "#f3f3f3",
                           drawTicks: false
                        },
                        scaleLabel: {
                           display: true,
                           labelString: "Hora"
                        }
                     }
                  ],
                  yAxes: [
                     {
                        display: true,
                        gridLines: {
                           color: "#f3f3f3",
                           drawTicks: false
                        },
                        scaleLabel: {
                           display: true,
                           labelString: "Tanque Combustible"
                        }
                     }
                  ]
               },
               title: {
                  display: true,
                  text: `Historial de Combustible / ${moment(startDateConv2).format('DD-MM-YY HH:mm')}`
               }
            }
         };
       
        return res.status(200).json({data: LineChartData});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

// GET BRANDS OF VEHICLES
router.get('/brand',[
],auth, async (req,res) => {
  
  console.info(req.body);
  const errors = validationResult(req);
  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  try {

    const VehicleBrandQuery = await VehicleBrand.find()
      .select('_id name')
      .sort({name:1})
      .then((result) => {
          return result;
      });

    return res.status(200).json({brand: VehicleBrandQuery});

  }catch(err){
    console.error(err.message);
    res.status(500).send('server error');
  }

});

// GET MODELS OF BRANDS
router.post('/model',[
  check('BrandID','Debe seleccionar una flota').not().isEmpty()
],auth, async (req,res) => {

  //console.info(req.body);
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const { BrandID } = req.body;

  try {

    const objBrandID = new mongoose.Types.ObjectId(BrandID);

    const VehicleModelQuery = await VehicleModel.find({ brand: { $eq: objBrandID }})
      .select('_id name')
      .sort({name:1})
      .then((result) => {
          return result;
      });
     // console.log(VehicleModelQuery);
    return res.status(200).json({model: VehicleModelQuery});

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


// SAVE FLEET DETAIL
router.post('/savedetail',[
  check('vehicle','Debe seleccionar un Vehículo').not().isEmpty()
],auth, async (req,res) => {

 // console.info(req.body);
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {vehicle} = req.body;
  const vehicleID = new mongoose.Types.ObjectId(vehicle.id);
  const colored = vehicle.color.replace('#', '');
  data = {$set:{
    plate: vehicle.plate,
    category: new mongoose.Types.ObjectId(vehicle.category.value),
    brand: new mongoose.Types.ObjectId(vehicle.brand.value),
    model: new mongoose.Types.ObjectId(vehicle.model.value),
    movilnum: vehicle.movilnum,
   // DeviceID: vehicle.DeviceID,
    color: colored
  }};

  try{

      const VehicleQuery = await  Vehicle.findByIdAndUpdate({_id: vehicleID}, data, { new:  true, runValidators:  true })

      //console.log(VehicleQuery);
      return res.status(200).json({data: {movilnum:VehicleQuery.movilnum,plate:VehicleQuery.plate}})

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }


});

// GET FLEET CATEGORIES
router.post('/category',auth, async (req,res) => {

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
router.post('/savecategory',[
  check('CategoryDetail','shit happens').not().isEmpty()
],auth, async (req,res) => {

  //console.info(req.body);
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {CategoryDetail} = req.body;
  const categoryID = new mongoose.Types.ObjectId(CategoryDetail.id);

  data = {$set:{
    name: CategoryDetail.name,
    status: CategoryDetail.status.value
  }};

  try{

      const VehicleQuery = await  VehicleCategory.findByIdAndUpdate({_id: categoryID}, data, { new:  true, runValidators:  true })

      //console.log(VehicleQuery);
      return res.status(200).json({name:CategoryDetail.name})

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }


});

// CLEAR CATEGORY FLEET
router.post('/clearcategory',[
  check('Category','shit happens').not().isEmpty()
],auth, async (req,res) => {

 // console.log(req.user.company); return;
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {Category} = req.body;
  const categoryID = new mongoose.Types.ObjectId(Category);

  data = {$set:{
    status: 0
  }};

  try{

      const VehicleQuery = await  VehicleCategory.findByIdAndUpdate({_id: categoryID}, data, { new:  true, runValidators:  true })

      //console.log(VehicleQuery);
      return res.status(200).json({status:'Category Cleared'})

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



module.exports = router;