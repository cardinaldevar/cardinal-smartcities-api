const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Vehicle = require('../../models/Vehicle');
const Alert = require('../../models/Alert');
const VehicleCategory = require('../../models/VehicleCategory');
const Mark = require('../../models/Mark');
const MarkType = require('../../models/MarkType');
const IotSensor = require('../../models/IotSensor' );
const Activity = require('../../models/Activity' );
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const axios = require('axios');
const turf = require('@turf/turf');
const FixLineString = require("../../utils/FixLineString")
const _ = require('lodash');
const ExcelJS = require('exceljs');

//@route GET api/fleet
//@Desc Get Vehicles in Authorized Fleet 
//@access Private
router.get('/fleet',auth, async (req,res) => {
    
  const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
  let companyID = new mongoose.Types.ObjectId(req.user.company);

  try{
      //GET ALL VEHICULES
      const live = await Vehicle.aggregate([
          { $match: { 
              company:{$eq:companyID},
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
                  value: '$_id',
                  DeviceID: '$DeviceID',
                  category: { $arrayElemAt: [ "$category", 0 ] },
                  brand:{ $arrayElemAt: [ "$brand", 0 ] },
                  model:{ $arrayElemAt: [ "$model", 0 ] },
                  plate:'$plate',
                  color:'$color',
                  label:'$movilnum',
                  DateU: { $arrayElemAt: [ "$dateConv.dateConv", 0 ] },
                  Speed: { $arrayElemAt: [ "$dateConv.speed", 0 ] },
                  LastPosition: { $arrayElemAt: [ "$dateConv.location", 0 ] },
                  status:{ $arrayElemAt: [ "$status", 0 ] },
              }
          },
          { $sort:{label:1}}
      ])
      .allowDiskUse(true)
      .then(function (res) {
         // console.log(JSON.stringify(res));
          return res;
        });
     
      return res.status(200).json(live);

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});

router.get('/sensor',auth, async (req,res) => {
    
  const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
  let companyID = new mongoose.Types.ObjectId(req.user.company);

  try{
      //GET ALL VEHICULES
      let query = [];
      query.push({company:companyID});

      const response = await IotSensor.aggregate([
              { $match: { $and: query } },
              {
                  $lookup: {
                    from: 'mark.type',
                    localField: 'typePoint', // Campo en MarkSchema que contiene la referencia al typeSensor
                    foreignField: '_id', // Campo en mark.type que contiene el _id
                    as: 'typePoint'
                  }
                },
                {
                  $unwind: {path:"$typePoint",preserveNullAndEmptyArrays:true} // Descomponer el array 'to' en documentos separados
                },
                {
                  $lookup: {
                      from: "iot.history",
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
                      value: '$_id',
                      label: '$name',
                      imei: "$imei",
                      typeSensor:'$typePoint.name_es',
                      status: "$status",
                      model: "$model",
                      height: "$height",
                      width: "$width",
                      length: "$length",
                      capacity: "$capacity" ,
                      location: "$location",
                      latestHistory: 1
                  }
              },
              { $sort:{label:1}}
            ]);
     //console.log(JSON.stringify(response))
      return res.status(200).json(response);

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


// GET FLEET CATEGORY LIST
router.get('/fleet',auth, async (req,res) => {

  const companyID = new mongoose.Types.ObjectId(req.user.company);
    //IF USER SUPERADMIN or ADMIN
  if(req.user.category.degree <= 1){
    //console.log('Admin FleetList')
    
    var queryCat = [{ $match: {  company: {$eq:companyID}, status: {$gte:1} } },
      { $project: {label: '$name', value:'$name'}},
      { $sort:{name:1}}];

  }else{ // ELSE ANOTHER CATEGORY
    //console.log('FleetList')
    const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
    var queryCat = [
      { $match: {  _id: {$in:fleetList},company:companyID, status: {$gte:1} } }, 
      { $project: {label: '$name', value:'$name'}},
      { $sort:{name:1}}
    ];
  }

  try{

      const List = await VehicleCategory.aggregate(queryCat)
      .allowDiskUse(true)
      .then(function (res) {
         // console.log(res);
          return res;
        });

   //  console.log(JSON.stringify(List))

      return res.status(200).json(List);

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }


});


// ADD ALERT 
router.post('/',[
  check('evaluationType','Bad Payload').not().isEmpty(),
  check('modelType','Bad Payload').not().isEmpty(),
  check('name','Bad Payload').not().isEmpty()
],auth, async (req,res) => {

 // console.info(req.body);
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {status,evaluationType, geojson, modelType, name,vehicle,value} = req.body;

  const companyID = new mongoose.Types.ObjectId(req.user.company);

  //validate type
  let location = {};
  let originID = [];

  const StatusGeneral = [
    'created',
    'active',
    'inactive',
    'deleted'
  ]

  if(modelType === 'vehicles'){
    location = geojson.features[0].geometry;
    originID = vehicle.map(a => new mongoose.Types.ObjectId(a) )
  }

  try{

      let AlertAdd = new Alert({
        status:StatusGeneral[status],
        name:name,
        company:companyID,
        originID,
        modelType,
        evaluationType,
        value,
        location
      }); 
      
      await AlertAdd.save();

      return res.status(200).json(true)

  }catch(err){
      console.error(err.message);
      res.status(500).json(false);
  }


});



// GET LIST
router.post('/list',auth, async (req,res) => {

  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {name,modelType} = req.body;
  const companyID = new mongoose.Types.ObjectId(req.user.company);
 

  try{

     let query=[ {company: {$eq:companyID}},{status: {$ne:'deleted'}} ];

      const List = await Alert.aggregate([
        { $match: { $and: query } },
        {
          $project: {
              _id: '$_id',
              name: '$name',
              modelType: "$modelType",
              evaluationType:"$evaluationType",
              originID:{ $size: '$originID' },
              value:'$value',
              createAt:'$createAt',
              status:"$status",
          }
      },
      { $sort:{name:1,createAt:1}}
      ])
      .allowDiskUse(true)
      .then(function (res) {
       //  console.log(res);
          return res;
        });

      return res.status(200).json(List);

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }


});


router.post('/status',[
  check('_id','Bad Payload').not().isEmpty()
],auth, async (req,res) => {

 // console.info(req.body);
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {_id,status} = req.body;

  const companyID = new mongoose.Types.ObjectId(req.user.company);

  try{

    let data = {$set:{ status: status === 'active' ? 'inactive' : 'active' }};
    const AlertQuery = await Alert.findByIdAndUpdate({_id: new mongoose.Types.ObjectId(_id),company:companyID}, data, { new:  true, runValidators:  true })
    return res.status(200).json(true)

  }catch(err){
      console.error(err.message);
      res.status(500).json(false);
  }


});

router.post('/delete',[
  check('_id','Bad Payload').not().isEmpty()
],auth, async (req,res) => {

 // console.info(req.body);
  const errors = validationResult(req);

  if(!errors.isEmpty()){
      return res.status(400).json({errors: errors.array()});
  }

  const {_id} = req.body;

  const companyID = new mongoose.Types.ObjectId(req.user.company);

  try{

    let data = {$set:{ status: 'deleted' }};
    const AlertQuery = await Alert.findByIdAndUpdate({_id: new mongoose.Types.ObjectId(_id),company:companyID}, data, { new:  true, runValidators:  true })
    return res.status(200).json(true)

  }catch(err){
      console.error(err.message);
      res.status(500).json(false);
  }


});


module.exports = router;