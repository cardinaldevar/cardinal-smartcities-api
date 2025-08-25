const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Service = require('../../models/Service');
const MarkType = require('../../models/MarkType');
const IotSensor = require('../../models/IotSensor' );
const IotLive = require('../../models/IotLive' );
const Mark = require('../../models/Mark' );
const moment = require('moment');
const mongoose = require('mongoose');

// @route Get api/service
// @Desc Get current services
router.get('/type',auth, async (req,res) => {
       
    try{

        const TypeList = await MarkType.find({typeModel:'iot'});
        return res.status(200).json({TypeList});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

//@route POST api/Sensor Add
router.post('/add',[
    check('typeSensor','error payload').not().isEmpty(),
    check('name','bad payload').not().isEmpty()
  ],auth, async (req,res) => {
    
    console.info('sensor/add');
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    
  //  console.log(req.body)
    const { typeSensor, name,address,addressNumber,town,postalCode,location,model,width,height,length,capacity,imei} = req.body;
    let companyID = new mongoose.Types.ObjectId(req.user.company);
    let typePointID = new mongoose.Types.ObjectId(typeSensor);
    let heightFix = height ? parseFloat(height) : 0;
    let widthFix = width ? parseFloat(width) : 0;
    let lengthFix = length ? parseFloat(length) : 0;
    let capacityFix = capacity ? parseFloat(capacity) : 0;
    let addressNumberFix = addressNumber ? parseFloat(addressNumber) : 0;
    //GET ID of Type

    try{

        const NewIotSensor = new IotSensor({
           name,
           imei,
           typePoint:typePointID,
           company:companyID,
           model,
           height:heightFix,
           width:widthFix,
           length:lengthFix, //cm
           capacity:capacityFix,
           address,
           addressNumber:addressNumberFix,
           location,
           last_action:moment().toDate()
        });

        await NewIotSensor.save();

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }

    return res.status(200).json(true);
});

//@route POST api/sensor/list
router.post('/list',[
   // check('zone','error payload').not().isEmpty(),
   // check('typeSensor','bad payload').isArray().not().isEmpty()
  ],auth, async (req,res) => {
    
    console.info('sensor/list');
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    const {page,pageSize,sortField,sortOrder, typePoint } = req.body;
    let companyID = new mongoose.Types.ObjectId(req.user.company);
    
    //let newDate = moment(deliveryDate).utcOffset(-3).toDate();
    let nPerPage = pageSize;
    let pageNumber = page;
    let sort = {};
    
    try{

        let query = [];
        query.push({company:companyID});

        if(typePoint){

            if(typePoint.length >= 1){ 
                let typeSensorMap = typePoint.map(a=>new mongoose.Types.ObjectId(a));
                query.push({ 'typePoint': {$in: typeSensorMap} });
            }}


            if(sortField){
                switch (sortField) {
                    case 'driverAssign':
                        sort['driverAssign.name']  = sortOrder === 'asc' ? -1 : 1;
                        break;
                
                    default:
                        sort[sortField]  = sortOrder === 'asc' ? -1 : 1;
                        break;
                }
                sort['_id'] = 1;
            }else{
                sort = {_id:-1};
            }

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
                        _id: '$_id',
                        createAt: '$createAt',
                        name: '$name',
                        imei: "$imei",
                        typeSensor:'$typePoint.name_es',
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
                },
                { $sort:sort},
                { $skip: pageNumber > 0 ? ( ( pageNumber - 1 ) * nPerPage ) : 0 },
                { $limit: nPerPage }
              ]);

             // console.log(JSON.stringify(response))
       
        return res.status(200).json({list:response});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

//@route POST api/sensor/list
router.get('/live',auth, async (req,res) => {
     
    // console.info('sensor/live');
 
     let companyID = new mongoose.Types.ObjectId(req.user.company);
     
     try{

     
       
      //  console.log('result',JSON.stringify(result))

         const response = await IotSensor.aggregate([
            {
              $match: {
                company: companyID,
                status:{$ne:'deleted'}
              }
            },
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
        
         return res.status(200).json({list:response});
 
     }catch(err){
         console.error(err.message);
         res.status(500).send('server error');
     }
 });

 
//@route POST api/sensor/list
router.post('/detail',[
    check('_id','error payload').not().isEmpty()
   ],auth, async (req,res) => {
     
     console.info('sensor/detail');
     const errors = validationResult(req);
   
     if(!errors.isEmpty()){
         return res.status(400).json({errors: errors.array()});
     }
 
     const {_id} = req.body;
     
    console.info('sensor/live');

    let companyID = new mongoose.Types.ObjectId(req.user.company);
    let sensorID = new mongoose.Types.ObjectId(_id);
    try{

        let query = [];
        query.push({company:companyID,_id:sensorID});
        query.push({status:{$ne:'deleted'}});

            const response = await IotSensor.aggregate([
                { $match:{ $and: query } },
                { $lookup: { from: 'mark.type', localField: 'typePoint', foreignField: '_id', as: 'typePoint'} },
                { $unwind:{path:"$typePoint",preserveNullAndEmptyArrays:true}},
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
                        _id: '$_id',
                        createAt: '$createAt',
                        name: '$name',
                        imei: "$imei",
                        typeSensor: "$typePoint",
                        status: "$status",
                        model: "$model",
                        height: "$height",
                        typeOrder: "$typeOrder",
                        width: "$width",
                        length: "$length",
                        capacity: "$capacity" ,
                        location: "$location",
                        latestHistory: 1
                    }
                }
            ])
            .allowDiskUse(true)
            .then(function (res) {
              return  res.length > 0 ? res[0] : {};
            });

            console.log('response',JSON.stringify(response))
       
        return res.status(200).json({detail:response});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


// DELETE USER
router.post('/del',[
    check('_id','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
  
    //console.log(req.body);
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    if(req.user.category.degree >= 2){
        return res.status(400).json('No tienes permisos');
    }

    const {_id} = req.body;
    const userId = new mongoose.Types.ObjectId(_id);
  
    data = {$set:{
      status:'deleted'
    }};

    try{

        const userQuery = await IotSensor.findByIdAndUpdate({_id: userId}, data, { new:  true, runValidators:  true })
        return res.status(200).json({status:userQuery})
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
  
  });

module.exports = router;