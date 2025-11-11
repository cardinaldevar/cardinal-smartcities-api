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
const sharp = require('sharp');
// @route POST API USER
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage({}) });

// CREATE USER
router.post('/', upload.single('avatar'),auth, async (req,res)=>{

    const {status,name,email,password,category,fleetAccess,access,backend,alert,alertPhone,docket_area} = req.body;
    
    let accessN = {};
    if (access) {
        const accessArr = JSON.parse(access);
        const filteredAccess = accessArr.filter(item => item.value !== 0);
        const sectionIds = filteredAccess.map(item => new mongoose.Types.ObjectId(item.id));

        if (sectionIds.length > 0) {
            const sections = await CoreSection.find({ '_id': { $in: sectionIds } }).select('_id key');
            const sectionMap = sections.reduce((map, section) => {
                map[section._id.toString()] = section.key;
                return map;
            }, {});

            for (const item of filteredAccess) {
                const key = sectionMap[item.id];
                if (key) {
                    let permission = 'read'; // Default to read for value 1
                    if (item.value === 2) {
                        permission = 'write';
                    }
                    accessN[key] = permission;
                }
            }
        }
    }

    let docketAreaN = [];
    if (docket_area) {
        const parsedDocketArea = JSON.parse(docket_area); // Assuming it comes as a JSON string
        docketAreaN = parsedDocketArea.map(area => new mongoose.Types.ObjectId(area._id));
    }

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
        await putObjectS3(req.file.buffer, Tempfilename, "employee");

        // Procesamiento con sharp
        const resized = await sharp(req.file.buffer)
            .resize(256, 256)
            .jpeg({ quality: 70 })
            .toBuffer();
            
        const thumbKey = `xs_${Tempfilename}`;
        await putObjectS3(resized, thumbKey, "employee");
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
            company: companyID,
            status:statusN,
            category:categoryN,
            fleetAccess:fleetAccessN,
            access:accessN,
            docket_area: docketAreaN,
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
        
        let user = await User.findOne({_id, company})
            .populate({
                path: 'docket_area',
                select: 'name parent',
                populate: {
                    path: 'parent',
                    select: 'name'
                }
            })
            .lean();

        if (!user) {
            return res.status(404).json({ msg: 'User not found' });
        }

        if (user.access) {
            const accessKeys = Object.keys(user.access);
            const sections = await CoreSection.find({ 'key': { $in: accessKeys } }).select('_id key');
            
            const keyToIdMap = sections.reduce((map, section) => {
                map[section.key] = section._id;
                return map;
            }, {});

            const newAccess = [];
            for (const [key, permission] of Object.entries(user.access)) {
                const sectionId = keyToIdMap[key];
                if (sectionId) {
                    let value = 0;
                    if (permission === 'read') {
                        value = 1;
                    } else if (permission === 'write') {
                        value = 2;
                    }
                    newAccess.push({ id: sectionId, value: value });
                }
            }
            user.access = newAccess;
        }

        if (user.docket_area) {
            user.docket_area = user.docket_area.map(area => ({
                _id: area._id,
                name: area.name,
                parent: area.parent ? area.parent.name : null
            }));
        }

        return res.status(200).json(user);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


// EDIT USER
router.post('/edit', upload.single('avatar'),auth, async (req,res)=>{

    //console.log('POST...',req.user);
    if(req.user.category.degree >= 2){
        return res.status(400).json('No tienes permisos');
    }

    const {status,name,email,password,category,fleetAccess,access,backend,alert,alertPhone,docket_area} = req.body;
    
    let accessN = {};
    if (access) {
        const accessArr = JSON.parse(access);
        const filteredAccess = accessArr.filter(item => item.value !== 0);
        const sectionIds = filteredAccess.map(item => new mongoose.Types.ObjectId(item.id));

        if (sectionIds.length > 0) {
            const sections = await CoreSection.find({ '_id': { $in: sectionIds } }).select('_id key');
            const sectionMap = sections.reduce((map, section) => {
                map[section._id.toString()] = section.key;
                return map;
            }, {});

            for (const item of filteredAccess) {
                const key = sectionMap[item.id];
                if (key) {
                    let permission = 'read'; // Default to read for value 1
                    if (item.value === 2) {
                        permission = 'write';
                    }
                    accessN[key] = permission;
                }
            }
        }
    }

    let docketAreaN = [];
    if (docket_area) {
        const parsedDocketArea = JSON.parse(docket_area);
        docketAreaN = parsedDocketArea.map(area => new mongoose.Types.ObjectId(area._id));
    }

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

        console.log('Uploading file...');
        Tempfilename = `${Date.now()}_${req.file.originalname}`;
        await putObjectS3(req.file.buffer, Tempfilename, "employee");

        // Procesamiento con sharp
        const resized = await sharp(req.file.buffer)
            .resize(256, 256)
            .jpeg({ quality: 70 })
            .toBuffer();
            
        const thumbKey = `xs_${Tempfilename}`;
        await putObjectS3(resized, thumbKey, "employee");

    } 
    
    try {

        let data = {
            $set:{
                name,
                email,
                company: companyID,
                status:statusN,
                category:categoryN,
                fleetAccess:fleetAccessN,
                access:accessN,
                docket_area: docketAreaN,
                appMechanical:false,
                appSystem:backendN,
                phone:phoneN,
                panicAlert:alertN
        }};

        if (req.file) {
            data.$set.avatar = Tempfilename;
        }
        
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
        .select().sort('degree name')
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
        return res.status(400).json({ msg:'No tienes permisos'});
    }

    const {_id} = req.body;
    const userId = new mongoose.Types.ObjectId(_id);
    const PROTECTED_CATEGORY_ID = '5e55e2c748a14901005f392b';

    try{
        // Find the user to be deleted
        const userToDelete = await User.findById(userId);

        if (!userToDelete) {
            return res.status(404).json({ msg: 'Usuario no encontrado.' });
        }

        // Check if the user's category is the protected one
        if (userToDelete.category.toString() === PROTECTED_CATEGORY_ID) {
            return res.status(400).json({ msg: 'No se puede eliminar un usuario con esta categoría.' });
        }

        data = {$set:{
          status: 3
        }};

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
        .select().populate('parentId','title')
        .sort({ order: 1})
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


// EDIT USER
router.post('/account',auth, async (req,res)=>{

   
    const {name,password} = req.body;
    
    const userID = new mongoose.Types.ObjectId(req.user.id);
    const companyID = new mongoose.Types.ObjectId(req.user.company);

    try {

        let data = {
            $set:{ name }};
        
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

module.exports = router;