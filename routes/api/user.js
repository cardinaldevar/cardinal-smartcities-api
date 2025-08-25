const express = require('express');
const router = express.Router();

const User = require('../../models/User');
const UserCategory = require('../../models/UserCategory');
const CoreSection = require('../../models/CoreSection');
const auth = require('../../middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('config');
const { check, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const fs = require('fs');
const { getURLS3, putObjectS3 } = require("../../utils/s3.js");
const Jimp = require('jimp');
// @route POST API USER
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage({}) });

// CREATE USER
router.post('/', upload.single('avatar'),auth, async (req,res)=>{

    const {status,name,email,password,category,fleetAccess,access,backend,alert,alertPhone} = req.body;
    let accessN = JSON.parse(access)?.filter(a=>a.value!=0).map(a => {return {id:new mongoose.Types.ObjectId(a.id),value:a.value} });

    let statusN = JSON.parse(status);
    let categoryN = new mongoose.Types.ObjectId(category);
    let fleetAccessN = JSON.parse(fleetAccess) ? JSON.parse(fleetAccess).map(a => new mongoose.Types.ObjectId(a)) : [];
    let phoneN = alertPhone ? JSON.parse(alertPhone) : null;
    let backendN = JSON.parse(backend);
    let alertN = JSON.parse(alert);

    Tempfilename = null;
    const companyID = new mongoose.Types.ObjectId(req.user.company);
    
    if (req.file) {

        console.log('Uploading file...');
        Tempfilename = `${Date.now()}_${req.file.originalname}`;
        await putObjectS3(req.file.buffer, Tempfilename,"employee");
        const img = await Jimp.read(req.file.buffer);
        const resized  = await img.resize(256, 256).quality(70).getBufferAsync(Jimp.AUTO);
        const thumbKey = `xs_${Tempfilename}`;
        await putObjectS3(resized, thumbKey,"employee");

    } else {
        console.log('No File in REQUEST');
    }
    
    try {

        //see if user exist3
        let user = await User.findOne({email});
        if(user){
            return res.status(400).json('El usuario ya existe');
        }
        
        user = new User({
            name,
            email,
            avatar:Tempfilename ? Tempfilename : null,
            password,
            status:statusN,
            company: companyID,
            status:status,
            category:categoryN,
            fleetAccess:fleetAccessN,
            access:accessN,
           // appMechanical:accessArr.mechanicalApp,
            appSystem:backendN,
            phone:phoneN,
            panicAlert:alertN
        });

        // encrypt pass
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password,salt);
        await user.save();

        res.json({created:user.id});

    }catch(err){
        console.error(err);
        res.status(500).send('server error');
    }
    
});


router.post('/detail',[
    check('_id','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
        
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    let company = new mongoose.Types.ObjectId(req.user.company);
    let _id = new mongoose.Types.ObjectId(req.body._id);

    try{
        
        const response = await User.findOne({_id,company}).populate('access');
       
        return res.status(200).json(response);
       

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


// EDIT USER
router.post('/edit', upload.single('avatar'),auth, async (req,res)=>{

    //console.log('POST...',req.user);

    const {status,name,email,password,category,fleetAccess,access,backend,alert,alertPhone} = req.body;
    
    let accessN = JSON.parse(access)?.filter(a=>a.value!=0).map(a => {return {id:new mongoose.Types.ObjectId(a.id),value:a.value} });

    let statusN = JSON.parse(status);
    let categoryN = new mongoose.Types.ObjectId(category);
    let fleetAccessN = JSON.parse(fleetAccess) ? JSON.parse(fleetAccess).map(a => new mongoose.Types.ObjectId(a)) : [];
    let phoneN = alertPhone ? JSON.parse(alertPhone) : null;
    let backendN = JSON.parse(backend);
    let alertN = JSON.parse(alert);

    Tempfilename = null;
    const userID = new mongoose.Types.ObjectId(req.body._id);
    const companyID = new mongoose.Types.ObjectId(req.user.company);
    
    if (req.file) {

        var raw = new Buffer.from(req.file.buffer, 'base64')

        console.log('Uploading file...');
        Tempfilename = `${Date.now()}_${req.file.originalname}`;
        await putObjectS3(req.file.buffer, Tempfilename,"employee");
        const img = await Jimp.read(req.file.buffer);
        const resized  = await img.resize(256, 256).quality(70).getBufferAsync(Jimp.AUTO);
        const thumbKey = `xs_${Tempfilename}`;
        await putObjectS3(resized, thumbKey,"employee");

    } else {
        console.log('No File in REQUEST');
    }
    
    try {

        let data = {
            $set:{
                name,
                email,
                avatar:Tempfilename ? Tempfilename : null,
                company: companyID,
                status:statusN,
                category:categoryN,
                fleetAccess:fleetAccessN,
                access:accessN,
                appMechanical:false,
                appSystem:backendN,
                phone:phoneN,
                panicAlert:alertN
        }};
        
        if(password){
            const salt = await bcrypt.genSalt(10);
            data.$set.password = await bcrypt.hash(password,salt);
        }
        
        const userQuery = await User.findByIdAndUpdate({_id: userID,company:companyID}, data, { new:  true, runValidators:  true })
        return res.status(200).json({})

    }catch(err){
        console.error(err);
        res.status(500).send('server error');
    }
    
});

router.post('/list',auth, async (req,res) => {
    
    const {category} = req.body;

    let company = new mongoose.Types.ObjectId(req.user.company)

    try{

        let query = [{
            company: {$eq:company},
            status: { $gte: 1, $lt: 3 }
        }];
        
        if(category.length >= 1){
            query.push({ category: { $in: category.map(a=>new mongoose.Types.ObjectId(a)) } });
        }
        
        const response = await User.aggregate([
            { $match: { $and: query } },
            { $lookup: { from: 'vehicles.category', localField: 'fleetAccess', foreignField: '_id', as: 'fleetAccess'} },
            { $lookup: { from: 'users.category', localField: 'category', foreignField: '_id', as: 'category'} },
            { $lookup: { from: 'company', localField: 'company', foreignField: '_id', as: 'company'} },
            { $lookup: { from: 'users.access', localField: 'access.id', foreignField: '_id', as: 'accessData'} },
            {
                $lookup: {
                  from: 'employee',
                  localField: 'employee',
                  foreignField: '_id',
                  as: 'employeeData'
                }
              },
              {
                $unwind: {
                  path: '$employeeData',
                  preserveNullAndEmptyArrays: true
                }
              },
              {
                $unwind: {
                  path: '$category',
                  preserveNullAndEmptyArrays: true
                }
              },
            {
                $project: {
                    _id: '$_id',
                    name: '$name',
                    email: "$email",
                    date: "$date",
                    fleetAccess: "$fleetAccess",
                    category: "$category.name" ,
                    categoryDegree: "$category.degree" ,
                    status: "$status",
                    companyIMG: { $arrayElemAt: [ "$company.logo", 0 ] } ,
                    appMechanical:"$appMechanical",
                    appSystem:"$appSystem",
                    panicAlert:"$panicAlert",
                    phone:"$phone",
                    access:"$access",
                    accessData: { $arrayElemAt: [ "$accessData", 0 ] } ,
                    employee: "$employeeData"
                }
            },
        ]).sort({categoryDegree:1,name:1})
        .allowDiskUse(true)
        .then(function (res) {
           // console.log(JSON.stringify(res));
          
            return res;
        });

        const resFilter = response.map(async item =>{
            //console.log(item);
            //console.log();
            return {
                _id: item._id,
                name: item.name,
                employee: item.employee,
                email: item.email,
                date: item.date,
                fleetAccess: item.fleetAccess,
                access: item.access,
                category: item.category,
                categoryDegree: item.categoryDegree,
                status: item.status,
                appMechanical:item.appMechanical,
                appSystem:item.appSystem,
                panicAlert:item.panicAlert,
                phone:item.phone,
            }
        })

        Promise.all(resFilter).then(values => { 
            //console.log(values);
           return res.status(200).json(values);
        });


    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});



// CHANGE USER STATUS
router.post('/status',[
    check('user','shit happens').not().isEmpty(),
    check('status','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
  
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
  
    const {user,status} = req.body;

    if(req.user.category.degree >= 2){
        return res.status(400).json('User not admin');
    }
    
    const userID = new mongoose.Types.ObjectId(user);

    if(status == 1){
        statusTemp = 2;
    }else{
        statusTemp = 1;
    }
    data = {
        $set:{
      status: statusTemp
    }};
  
    try{
        
        const userQuery = await User.findByIdAndUpdate({_id: userID}, data, { new:  true, runValidators:  true })
        return res.status(200).json(userQuery._id)
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
  
  
  });


// GET USER CATEGORY
router.get('/category',auth, async (req,res) => {
   
    try{
        
        const UserQuery = await UserCategory.find({degree: {$gte:1}})
        .select().sort('name')
        .then((result) => {
            return result.map(a=> {
                return {value:a._id,label:a.name};
            });
        });

        return res.status(200).json(UserQuery);

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
      status: 3
    }};

    try{

        const userQuery = await  User.findByIdAndUpdate({_id: userId}, data, { new:  true, runValidators:  true })
        return res.status(200).json({status:userQuery})
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
  
  });

// GET SECTIONS 
router.get('/section',auth, async (req,res) => {
   
    try{
        
        const SectionQuery = await CoreSection.find({status: {$eq:1}})
        .select()
        .sort({ position: 1})
        .then((result) => {
            return result;
        });

        return res.status(200).json(SectionQuery);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


// GET BRANDS OF VEHICLES
router.post('/search',[ 
    check('search','Bad request').not().isEmpty()
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    const {search} = req.body;
    const companyID = new mongoose.Types.ObjectId(req.user.company);

    try {

      const UserQuery = await User.aggregate([
        {
            $search: {
                    index: "user_autocomplete",
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
                value: '$_id',
                label: '$name'
            }
          }
    ]).sort({label:1})
    .limit(15)
    .allowDiskUse(true)
    .then(function (res) {
        return res;
    });

      return res.status(200).json(UserQuery);
  
    }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
    }
  
});

module.exports = router;