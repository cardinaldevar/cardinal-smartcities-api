const express = require('express');
const router = express.Router();

const Employee = require('../../models/Employee');
const User = require('../../models/User');
const UserCategory = require('../../models/UserCategory');
const EmployeeType = require('../../models/EmployeeType');
const UserAccess = require('../../models/UserAccess');
const AccessNode = require('../../models/AccessNode');
const UserTime = require('../../models/UserTime');
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const moment = require('moment');
const ExcelJS = require('exceljs');
const { getURLS3, putObjectS3 } = require("../../utils/s3.js");
const fs = require('fs');
const Jimp = require('jimp');
// @route POST API USER
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage({}) });

router.post('/', upload.single('avatar'),auth, async (req,res)=>{

    //console.log('POST...',req.body);
    
    const {status,name,last,dni,art,cuil,phone,phoneEmergency,nameEmergency,email,employeeType,bloodtype,fileNumber} = req.body;

    if(bloodtype !== undefined){ bloodtypeConv = JSON.parse(bloodtype); }
    if(employeeType !== undefined){ employeeTypeConv = JSON.parse(employeeType); }
    
    let statusConv = JSON.parse(status);
    let dniConv = parseInt(dni);
    let cuilConv = parseInt(cuil);
    let phoneConv = parseInt(phone);
    let phoneEmergencyConv = parseInt(phoneEmergency);
    let userBiometric = new mongoose.Types.ObjectId(req.body.userBiometric);

    let companyID = new mongoose.Types.ObjectId(req.user.company);
    
    //console.log(name,last,statusConv,dniConv,cuilConv,dni,art,cuil,phoneConv,phoneEmergencyConv,nameEmergency,email,employeeTypeConv,bloodtypeConv,userBiometric);
   
    let Tempfilename = null;
    let url, urlXs;

    if (req.file) {

        //var raw = new Buffer.from(req.file.buffer, 'base64')

        Tempfilename = `${Date.now()}_${req.file.originalname}`;
        // 2) Subida original
        await putObjectS3(req.file.buffer, Tempfilename,"employee");
        // 3) Genera thumbnail y lo sube
        const img = await Jimp.read(req.file.buffer);
        const resized  = await img.resize(500, 500).quality(70).getBufferAsync(Jimp.AUTO);
        const thumbKey = `xs_${Tempfilename}`;
        await putObjectS3(resized, thumbKey,"employee");
        // 4) Genera URLs firmadas
        url   = await getURLS3(Tempfilename,60, 'employee');
        urlXs = await getURLS3(thumbKey,60, 'employee');

    } else {
        console.log('No File in REQUEST');
    }
    
    try {

        //see if user exist3
        const existing = await Employee.findOne({ email });
        if (existing) {
          return res.status(400).json({ errors: [{ msg: 'El usuario ya existe' }] });
        }
        
        const NewEmployee = new Employee({
            fileNumber,
            name,
            email,
            avatar:Tempfilename ? Tempfilename : null,
            company: companyID,
            status:statusConv.value,
            name,last,
            dni:dniConv,
            cuil:cuilConv,
            art,
            phone:phoneConv,
            phoneEmergency:phoneEmergencyConv,
            nameEmergency,
            email,
            employeeType:new mongoose.Types.ObjectId(employeeTypeConv.value),
            bloodtype:bloodtypeConv.value,
            userBiometric
        });

        await NewEmployee.save();

        res.json({created:NewEmployee.id});


    // return jsonwebtoken
    }catch(err){
        console.error(err);
        res.status(500).send('server error');
    }
    
});

router.post('/list',[
    check('startDate','shit happens').not().isEmpty(),
],auth, async (req,res) => {
    
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const {category} = req.body;
    let startDate = moment(req.body.startDate).utcOffset(-3);
    let company = new mongoose.Types.ObjectId(req.user.company);
    
   /* const companyDevices = await AccessNode.find({company: {$eq:company}})
    .select('_id device_id')
    .then((result) => {
        return result.map(i=>i.device_id);
    });*/

    let queryEmployee = [];
    queryEmployee.push({company: {$eq:company},status:1});
    if(category && category.length >= 1){
        queryEmployee.push({typeEmployee:{$in:category.map(i => new mongoose.Types.ObjectId(i))}});
    }
    
    //Get Employee connected with biometric
    const EmployeeList = await Employee.aggregate([ 
        { $match:{ $and: queryEmployee } },
        { $lookup: { from: 'users.access', localField: 'userBiometric', foreignField: '_id', as: 'userAccess'} },
        { $lookup: { from: 'employee.type', localField: 'typeEmployee', foreignField: '_id', as: 'typeEmployee'} },
        { $unwind:{path:"$userAccess",preserveNullAndEmptyArrays:true}},
        {
            $project: {
                _id: '$_id',
                userBiometric: "$userAccess",
                name:'$name',
                last:'$last',
                fileNumber:'$fileNumber',
                avatar:'$avatar',
                typeEmployee:'$typeEmployee'
            }
        },
    ])
    .sort({name:1,last:1})
    .allowDiskUse(true)
    .then(function (res) {
        //filter only linked user 
        return res.filter(i=>i.userBiometric);
    });

    // GET ALL EMPLOYEE BIOMETRIC CONNECTED
    const response = await UserAccess.aggregate([
        { $match: {
            _id: {$in:EmployeeList.map(i=>new mongoose.Types.ObjectId(i.userBiometric._id))}
        } },
        {
            $project: {
                _id: '$_id',
                user_id: '$user_id',
                user_name:  "$user_name",
                device_id:  "$device_id",
                profile_image:  "$profile_image",
            }
        },
    ]).sort({user_id:1})
    .allowDiskUse(true)
    .then(function (res) {
        return res;
    });

    try{

      //  console.log('DATE',datenow.set({'h':00, 'm':00, 's':00}).format('DD MM YYYY HH:mm:ss'),datenow.set({'h':23, 'm':59, 's':00}).format('DD MM YYYY HH:mm:ss'))
        // GET ALL DATA BIOMETRIC CONNECTED
        const biometricData = await UserTime.aggregate([
            { 
                $match: {
                  $or: [
                    { access_in: { $eq: null } },
                    {
                      access_in: {
                        $gte: startDate.startOf('D').utcOffset(-3).toDate(),
                        $lte: startDate.endOf('D').utcOffset(-3).toDate()
                      }
                    }
                  ],
                  $expr: {
                    $in: [{ $concat: ["$user_id", "_", "$device_id"] }, response.map(i => i.user_id + "_" + i.device_id)]
                  }
                }
              },
              { $sort: { _id: -1 } },
              {
                $group: {
                  _id: '$user_id',
                  device_id: { $first: '$device_id' },
                  access_id: { $first: '$_id' }, // Usa $first para obtener el primer documento después de la clasificación
                  access_in: { $first: '$access_in' },
                  access_out: { $first: '$access_out' },
                  comment: { $first: '$comment' }
                }
              }
        ])
        .allowDiskUse(true)
        .then(function (res) {
           // console.log('***************************************res access time',JSON.stringify(res))
            return res;
        });
        
        
        if(biometricData.length === 0){

            return res.status(200).json([]);

        }else{

           
            const resFilter = EmployeeList.map(async (item,index) =>{
               // console.log(item,index);

                // compare user item 
                //biometricData _id match dos array el biometric con el de user y filtrar solo los user q tengan data
                const found = biometricData.find(element => element._id === item.userBiometric.user_id && element.device_id === item.userBiometric.device_id );

                if(found){
                    return {
                        _id: item._id,
                        name: item.name,
                        last: item.last,
                        fileNumber: item.fileNumber,
                        user_id:found._id,
                        typeEmployee:item.typeEmployee[0].name,
                        avatar: {
                           picture: item.avatar === null ? null : await getURLS3(item.avatar,60, 'employee'),
                           pictureBiometric: item.userBiometric === null ? null : await getURLS3(item.userBiometric.profile_image,60, 'employee')
                        },
                        access_in: {
                            access_in: found.access_in,
                            access_out: found.access_out,
                        },
                        access_out:{
                            access_in: found.access_in,
                            access_out: found.access_out,
                        },
                        hour:{
                            access_in: found.access_in,
                            access_out: found.access_out,
                        },
                        action:{
                            _id:found.access_id,
                            access_in:found.access_in,
                            access_out: found.access_out,
                            name: item.name,
                            fileNumber: item.fileNumber,
                            last: item.last,
                            comment:found.comment ? found.comment : ''
                        }
                    }
                }

                
            });
           // console.log(resFilter);
    
            Promise.all(resFilter).then(values => { 
                
                const resVal = values.filter(i=> i !== undefined);
          // console.log('FINAL',resVal);
               return res.status(200).json(resVal);
            });

        }
       

       // return res.status(200).json([]);
        

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

router.post('/list/history',[
    check('startDate','shit happens').not().isEmpty(),
    check('endDate','shit happens').not().isEmpty(),
],auth, async (req,res) => {
    
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const {startDate,endDate,employee} = req.body;

    let from = moment(startDate).startOf('D').utcOffset(-3);
    let to = moment(endDate).endOf('D').utcOffset(-3);
    let company = new mongoose.Types.ObjectId(req.user.company);

    let queryEmployee = [];
    queryEmployee.push({company: {$eq:company},status:1});
    if(employee){
        queryEmployee.push({_id:new mongoose.Types.ObjectId(employee)});
    }
    
    //Get Employee connected with biometric
    const EmployeeList = await Employee.aggregate([ 
        { $match:{ $and: queryEmployee } },
        { $lookup: { from: 'users.access', localField: 'userBiometric', foreignField: '_id', as: 'userAccess'} },
        { $lookup: { from: 'employee.type', localField: 'typeEmployee', foreignField: '_id', as: 'typeEmployee'} },
        { $unwind:{path:"$userAccess",preserveNullAndEmptyArrays:true}},
        { $unwind:{path:"$typeEmployee",preserveNullAndEmptyArrays:true}},
        {
            $project: {
                _id: '$_id',
               // userBiometric: '$userBiometric',
                userBiometric: "$userAccess.user_id",
                name:'$name',
                last:"$last",
                fileNumber:'$fileNumber',
                typeEmployee:'$typeEmployee.name'
            }
        },
    ])
    .sort({name:1,last:1})
    .allowDiskUse(true)
    .then(function (res) {
        //filter only linked user 
        return res.filter(i => i.userBiometric);
    });


    try{

       // GET ALL DATA BIOMETRIC CONNECTED
        const biometricData = await UserTime.aggregate([
            { $match: {
                user_id: {$in:EmployeeList.map(a=> a.userBiometric)},
                access_in: {
                    $gte: from.toDate(),
                    $lte: to.toDate()
                }
            } },
        // { $lookup: { from: 'users', localField: 'userAccess', foreignField: '_id', as: 'userAccess'} },
        // { $lookup: { from: 'users', localField: 'technicalAssigned', foreignField: '_id', as: 'technicalAssigned'} },
        {
            $project:
              {
                _id: '$user_id',
                access_id:  '$_id',
                access_in: '$access_in',
                access_out:'$access_out',
                comment: '$comment',
                createAt:'$createAt'
              }
           }
        ])
        .sort({access_in:-1,access_out:1})
        .allowDiskUse(true)
        .then(function (res) {
          //  console.log('res access time',res)
            return res;
        });
        
      //  console.log('biometricData',biometricData);
        if(biometricData.length === 0){

            return res.status(200).json([]);

        }else{

            let bio = biometricData.map(item => {

                //find userBiometric
                let found = EmployeeList.find(a => item._id === a.userBiometric);

                return {
                    dateIn: item.access_in,
                    _id: item.access_id,
                    name: found.name,
                    last: found.last,
                    fileNumber: found.fileNumber,
                    user_id:item._id,
                    access_in: {
                        access_in: item.access_in,
                        access_out: item.access_out,
                    },
                    access_out:{
                        access_in: item.access_in,
                        access_out: item.access_out,
                    },
                    hour:{
                        access_in: item.access_in,
                        access_out: item.access_out,
                    },
                    comment:item.comment,
                    action:{
                        _id:item.access_id,
                        access_in:item.access_in,
                        access_out: item.access_out,
                        name: found.name,
                        fileNumber: found.fileNumber,
                        last: found.last,
                        comment:item.comment
                    }
                }

            });
        
            res.status(200).json(bio);

        }


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
        return res.status(200).json(userQuery)
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
  
  
  });

  
// GET NODES
router.get('/nodes',auth, async (req,res) => {
    
    let company = new mongoose.Types.ObjectId(req.user.company);

    try{
        const TypeQuery = await AccessNode.find({company: {$eq:company}})
        // .select('_id name')
         .then((result) => {
             return result;
         });
        // console.log(TypeQuery)

        return res.status(200).json(TypeQuery);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

// GET EMPLOYEE TYPES
router.get('/type',auth, async (req,res) => {
    
    let company = new mongoose.Types.ObjectId(req.user.company);

    try{
        const TypeQuery = await EmployeeType.find({company: {$eq:company},status:1})
        .select('_id name')
        .then((result) => {
            return result;
        });

        return res.status(200).json(TypeQuery);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

// NEW TYPE EMPLOYEE
router.post('/type/new',[
    check('name','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
  
    const { name } = req.body;
    const companyID = new mongoose.Types.ObjectId(req.user.company);
  
    try{
        
        let NewType = new EmployeeType({
            name,
            company:companyID,
        });
        // CHECK IF EXIST
        await NewType.save();
        return res.status(200).json({created:NewType})
  
    }catch(err){

        console.error(err.message);
        res.status(500).send('server error');

    }
});

// CLEAR EMPLOYEE Type
router.post('/type/del',[
    check('uid','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
  
    //console.log(req.body);
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
  
    const {uid} = req.body;
    const typeId = new mongoose.Types.ObjectId(uid);
  
    data = {$set:{
      status: 0
    }};

    try{

        const TypeQuery = await  EmployeeType.findByIdAndUpdate({_id: typeId}, data, { new:  true, runValidators:  true })
        return res.status(200).json({status:TypeQuery})
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
  
  });

// SEARCH BIOMETRIC
router.post('/biometric',[
    check('search','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    let company = new mongoose.Types.ObjectId(req.user.company);
    const {search} = req.body;
    // GET DEVICES OF COMPANY
    const companyDevices = await AccessNode.find({company: {$eq:company}})
    .select('_id device_id')
    .then((result) => {
        return result.map(i=>i.device_id);
    });

    try{
        
        const response = await UserAccess.aggregate([
            { $match: { 
               // status: {$gte:1},
                user_name: { $regex: `${search}`, $options: "i" },
                device_id: {$in:companyDevices}
            } },
           // { $lookup: { from: 'users', localField: 'userAccess', foreignField: '_id', as: 'userAccess'} },
           // { $lookup: { from: 'users', localField: 'technicalAssigned', foreignField: '_id', as: 'technicalAssigned'} },
            {
                $project: {
                    _id: '$_id',
                    value: '$_id',
                    label:  "$user_name",
                    image:  "$profile_image",
                }
            },
        ]).sort({user_name:1})
        .limit(20)
        .allowDiskUse(true)
        .then(function (res) {
            return res;
        });

        return res.status(200).json(response);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

// SEARCH BIOMETRIC EMPLOYEE IMAGE
router.post('/biometric/image',[
    check('image','shit happens').not().isEmpty()
  ],auth, async (req,res) => {

    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    const {image} = req.body;

    try{
        
        const response = await getURLS3(image,60, 'employee');
        return res.status(200).json(response);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});



// SEARCH EMPLOYEE
router.post('/employee/search',[
    check('search','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    //console.log(req.user)
    let company = new mongoose.Types.ObjectId(req.user.company);
    const {search} = req.body;
    

    try{
        
        const response = await Employee.aggregate([
            { $match: { 
               // status: {$gte:1},
                company: {$eq:company},
                $or: [ 
                    {fileNumber: { $regex: `${search}`, $options: "i" }},
                    {name: { $regex: `${search}`, $options: "i" }},
                    {last: { $regex: `${search}`, $options: "i" }},
                ]    
            } },
            
           // { $lookup: { from: 'users', localField: 'userAccess', foreignField: '_id', as: 'userAccess'} },
           // { $lookup: { from: 'users', localField: 'technicalAssigned', foreignField: '_id', as: 'technicalAssigned'} },
            {
                $project: {
                    _id: '$_id',
                    value: '$_id',
                    label:  {$concat: ['( ','$fileNumber',' )',' - ','$name', ' ', '$last']},
                }
            },
        ]).sort({user_name:1})
        .limit(20)
        .allowDiskUse(true)
        .then(function (res) {
            return res;
        });
       // console.log(response);
        return res.status(200).json(response);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});



// SEARCH EMPLOYEE
router.post('/employee/search/detail',[
    check('search','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    //console.log(req.user)
    let company = new mongoose.Types.ObjectId(req.user.company);
    const {search} = req.body;
    

    try{
        
        const response = await Employee.aggregate([
            { $match: { 
               // status: {$gte:1},
                company: {$eq:company},
                $or: [ 
                    {fileNumber: { $regex: `${search}`, $options: "i" }},
                    {name: { $regex: `${search}`, $options: "i" }},
                    {last: { $regex: `${search}`, $options: "i" }},
                ]    
            } },
            
           // { $lookup: { from: 'users', localField: 'userAccess', foreignField: '_id', as: 'userAccess'} },
           // { $lookup: { from: 'users', localField: 'technicalAssigned', foreignField: '_id', as: 'technicalAssigned'} },
            {
                $project: {
                    _id: '$_id',
                    value: '$_id',
                    label:  {$concat: ['( ','$fileNumber',' )',' - ','$name', ' ', '$last']},
                    biometric:  '$userBiometric',
                    name:'$name',
                    last:'$last',
                    fileNumber:'$fileNumber'
                }
            },
        ]).sort({user_name:1})
        .limit(20)
        .allowDiskUse(true)
        .then(function (res) {
            return res;
        });
       // console.log(response);
        return res.status(200).json(response);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});



router.post('/export/report',[
    check('access_in','shit happens').not().isEmpty(),
    check('access_out','shit happens').not().isEmpty()
  ],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {employee,access_in,access_out} = req.body;


    var company = new mongoose.Types.ObjectId(req.user.company);
    let fromDate = moment(access_in).utcOffset(-3);
    let toDate = moment(access_out).utcOffset(-3);

    // CHECK Employee array

    let QueryEmployee = [];
    QueryEmployee.push({ company: {$eq:company} })

    if(employee){

        QueryEmployee.push({
            _id: {$in:[new mongoose.Types.ObjectId(employee)]}
        });

    }

    const response = await Employee.aggregate([
        { $match:{ $and: QueryEmployee } },
        { $lookup: { from: 'users.access', localField: 'userBiometric', foreignField: '_id', as: 'userAccess'} },
        { $lookup: { from: 'employee.workshift', localField: 'workShift', foreignField: '_id', as: 'workShift'} },
        { $unwind:{path:"$workShift",preserveNullAndEmptyArrays:true}},
        { $unwind:{path:"$userAccess",preserveNullAndEmptyArrays:true}},
        {
            $project: {
                _id: '$_id',
                name: '$name',
                last: '$last',
                workShift:"$workShift.timeAssign",
                user_id: "$userAccess.user_id",
                fileNumber: '$fileNumber'
            }
        },
    ]).sort({fileNumber:1})
    .allowDiskUse(true)
    .then(function (res) {
        return res;
    });
    

    
    try {

     
      
        // Calculate Time of Employees
        const TimeAccess = await UserTime.aggregate([
            { $match: {
                user_id: {$in:response.map(i=>i.user_id)},
                access_in: {
                    $gte: fromDate.toDate()
                },
                access_out: {
                    $lte: toDate.toDate()
                }
            } },
            {
                $group:{
                    _id:'$user_id',
                    timeTime: { 
                        $push: { 
                        access_in: '$access_in',
                        access_out:'$access_out',
                        } 
                    }
                }
            }
        ]).sort({user_id:1})
        .allowDiskUse(true)
        .then(function (res) {
            return res;
        });



       // console.log('TimeAccess',JSON.stringify(TimeAccess));    
       //

        let TimeConstruct = [];
        
        TimeAccess.map(item => {

            let EmployeeData = { }
          //  found user_id
            const found = response.find(element => element.user_id === item._id);
            //console.log('FOUNDDDD',found);
            
            if(found){ 
                //Process Time, return response item
                EmployeeData = {
                    ...EmployeeData,
                    user_id:found.user_id,
                    _id:found._id,
                    name:found.name,
                    last:found.last,
                    fileNumber:found.fileNumber,
                    Monday:0,
                    Tuesday:0,
                    Wednesday:0,
                    Thursday:0,
                    Friday:0,
                    Saturday:0,
                    Sunday:0,
                    extraHour:0
                }
                let times = [];
                let WorkHour = 0;
               // console.log('----',item.timeTime)
                //Process Day

                item.timeTime.map(time => {

                 /*   WorkHour = WorkHour + parseFloat(moment(time.access_out).utcOffset(-3).diff(moment(time.access_in).utcOffset(-3), 'hours',true).toFixed(2));
                    // suma access in + out
                    let DayNumber = parseInt(moment(time.access_in).utcOffset(-3).format('E')); //day of the week ISO
                    let timeAccesIn = moment(time.access_in).utcOffset(-3);
                    let timeAccesOut = moment(time.access_out).utcOffset(-3);

                    times.push({
                      month:moment(time.access_in).utcOffset(-3).get('month'),
                      day:moment(time.access_in).utcOffset(-3).format('D'),
                      dayName:moment(time.access_in).utcOffset(-3).format('dddd'),
                      dayWeek:DayNumber,
                      access_in:time.access_in,
                      access_out:time.access_out,
                      hour:parseFloat(moment(time.access_out).utcOffset(-3).diff(moment(time.access_in).utcOffset(-3), 'hours',true).toFixed(2))
                    });*/

                    let DayNumber = parseInt(moment(time.access_in).utcOffset(-3).format('E')); //day of the week ISO
                    let timeAccesIn = moment(time.access_in).utcOffset(-3);
                    let timeAccesOut = moment(time.access_out).utcOffset(-3);
                    
                    console.log('----------------/',timeAccesIn.format('DD/MM/YYYY HH:mm Z'),timeAccesOut.format('DD/MM/YYYY HH:mm Z'))
                    console.log(moment(time.access_in).utcOffset(-3).format('E'),moment(time.access_in).utcOffset(-3).format('dddd'));
                    // Evaluar horas extras, traer el timeAssign segun el dia y validar si esta dentro o fuera.
                   // console.log('time asignado',found.workShift);
                    // validar que tipo de dia es y el % de cobro.
                    // get range hour of day
                    const dayAssigned = found.workShift.find(dayAssign => dayAssign.day === DayNumber);
                    if(dayAssigned){

                        console.log('founded day ',dayAssigned,DayNumber,'nextDay?',dayAssigned.nextDay)

                        //Eval enter Range
                       /* _id: null,
                            day: 5,
                            to: 2020-10-02T20:00:00.801Z,
                            from: 2020-10-02T12:00:00.801Z,
                            percent: 100*/
                        
                       // Check UTFoffset
                        let entranceTime = moment(time.access_in).hour(moment(dayAssigned.from).get('h')).minute(moment(dayAssigned.from).get('m')).second(moment(dayAssigned.from).get('s')).utcOffset(-3);
                        let entranceSum = entranceTime.clone();
                        let entranceTimeBefore = entranceTime.clone();
                        entranceTimeBefore.subtract(15,'minute');
                        let entranceTimeAfter = entranceTime.clone();
                        entranceTimeAfter.add(15,'minute');

                        let exitTime = moment(time.access_out).hour(moment(dayAssigned.to).get('h')).minute(moment(dayAssigned.to).get('m')).second(moment(dayAssigned.to).get('s')).utcOffset(-3);
                        let exitSum = exitTime.clone();
                        let exitTimeBefore = exitTime.clone();
                        exitTimeBefore.subtract(15,'minute');
                        let exitTimeAfter = exitTime.clone();
                        exitTimeAfter.add(15,'minute');

                      /*  if(dayAssigned.nextDay){
                            //fecha de chequeo al siguiente dia
                            exitTime.add(1,'day');
                            exitSum.add(1,'day');
                            exitTimeBefore.add(1,'day');
                            exitTimeAfter.add(1,'day');
                        }*/

                        console.log({
                            name:found.name,
                            entranceDay:moment(time.access_in).locale('en').format('dddd'),
                            enUTC:moment(time.access_in).utcOffset(0).format('DD/MM/YYYY HH:mm Z'),
                            saUTC:moment(time.access_out).utcOffset(0).format('DD/MM/YYYY HH:mm Z'),
                            entrada: moment(time.access_in).utcOffset(-3).format('DD/MM/YYYY HH:mm Z'),
                            salida: moment(time.access_out).utcOffset(-3).format('DD/MM/YYYY HH:mm Z'),
                            checkEntrance: timeAccesIn.isBetween(entranceTimeBefore, entranceTimeAfter),
                            dateHOURcheck: entranceTimeBefore.format('DD/MM/YYYY HH:mm Z'),
                            checkExit: timeAccesOut.isBetween(exitTimeBefore, exitTimeAfter),
                            dateHOURExitcheck: exitTimeBefore.format('DD/MM/YYYY HH:mm Z'),
                            entranceSum:entranceSum.utcOffset(-3).format('DD/MM/YYYY HH:mm Z'),
                            exitSum:exitSum.utcOffset(-3).format('DD/MM/YYYY HH:mm Z')

                        });

                        let letterDay = moment(time.access_in).locale('en').format('dddd');
                        
                        if(timeAccesIn.isBetween(entranceTimeBefore, entranceTimeAfter) && timeAccesOut.isBetween(exitTimeBefore, exitTimeAfter)){
                        
                           // check entrance if 15 mins margin
                            console.log('IN ENTRANCE RANGE',timeAccesIn.format('DD/MM/YYYY HH:mm'),'--',entranceTimeBefore.format('DD/MM/YYYY HH:mm'),entranceTimeAfter.format('DD/MM/YYYY HH:mm'));
                            console.log('OUT ENTRANCE RANGE',timeAccesOut.format('DD/MM/YYYY HH:mm'),'--',exitTimeBefore.format('DD/MM/YYYY HH:mm'),exitTimeAfter.format('DD/MM/YYYY HH:mm'));
                            console.log('----------------------')
                            /////////////////////////////////////////////////////////////
                            console.log('working day complete',entranceSum.format('DD/MM/YYYY HH:mm:ss'),exitSum.format('DD/MM/YYYY HH:mm:ss'));
                            let TodayWorkHour = parseFloat(moment(exitSum).utcOffset(-3).diff(moment(entranceSum).utcOffset(-3), 'hours',true).toFixed(2));
                           
                            // EXAMPLE SUM IN OUT FROM WORKSHIFT add time jornada entera + sum a work total
                            // Suma horas al total del dia
                            WorkHour = WorkHour + TodayWorkHour;
                            
                            // EXAMPLE SUM IN OUT FROM EMPLOYEE add time jornada entera + sum a work total
                            //WorkHour = WorkHour + parseFloat(moment(time.access_out).utcOffset(-3).diff(moment(time.access_in).utcOffset(-3), 'hours',true).toFixed(2));
                            
                            // suma access in + out
                            times.push({
                                month:moment(time.access_in).utcOffset(-3).get('month'),
                                day:moment(time.access_in).utcOffset(-3).locale('en').format('D'),
                                dayName:moment(time.access_in).utcOffset(-3).locale('en').format('dddd'),
                                dayWeek:DayNumber,
                                access_in:time.access_in,
                                access_out:time.access_out,
                                hour:parseFloat(moment(time.access_out).utcOffset(-3).diff(moment(time.access_in).utcOffset(-3), 'hours',true).toFixed(2))
                            });

                            switch (letterDay) {
                                case 'Monday':
                                    EmployeeData.Monday = EmployeeData.Monday+TodayWorkHour;
                                    break;
                                case 'Tuesday':
                                    EmployeeData.Tuesday = EmployeeData.Tuesday+TodayWorkHour;
                                    break;
                                case 'Wednesday':
                                    EmployeeData.Wednesday = EmployeeData.Wednesday+TodayWorkHour;
                                    break;
                                case 'Thursday':
                                    EmployeeData.Thursday = EmployeeData.Thursday+TodayWorkHour;
                                    break;
                                case 'Friday':
                                    EmployeeData.Friday = EmployeeData.Friday+TodayWorkHour;
                                    break;
                                case 'Saturday':
                                    EmployeeData.Saturday = EmployeeData.Saturday+TodayWorkHour;
                                    break;
                                case 'Sunday':
                                    EmployeeData.Sunday = EmployeeData.Sunday+TodayWorkHour;
                                    break;
                                default:
                                    break;
                            }

                        }else{
                        //else if(timeAccesIn.isBetween(entranceTimeBefore, entranceTimeAfter, undefined, '[]') && !timeAccesOut.isBetween(exitTimeBefore, exitTimeAfter, undefined,)){
                        //check if entrance in range but exit not
                            
                            let hourExtras = 0;
                            let WorkHourDay = 0;
                            let hourAfter = 0;

                            console.log('working day OUT RANGE','EXIT SUM',exitSum.format('DD/MM/YYYY HH:mm:ss'))
                            // evaluar horas extras antes
                            console.log('* Calculate extra before ','Entrada fisica:',moment(time.access_in).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'),'Horario Entrada:',moment(entranceSum).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'))
                            
                            
                            let hourBefore = parseFloat(moment(entranceSum).utcOffset(-3).diff(moment(time.access_in).utcOffset(-3), 'hours',true).toFixed(2))
                            console.log('calculo horas before',Math.round(hourBefore));
                            console.log('hourBefore',hourBefore);
                            console.log('hourAfter',moment(time.access_out).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'),'hasta',moment(exitSum).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'),hourAfter);
                            if(hourBefore>=1){
                                hourExtras= hourExtras+hourBefore;
                                // puedo redondear o no, depende el client
                            }

                            //chequear si la hora de salida fisica es antes a exitSum (su horario de salida seteada)
                            console.log('verify salida',moment(time.access_out).utcOffset(-3).isSameOrBefore(moment(exitSum).utcOffset(-3)))
                            if(moment(time.access_out).utcOffset(-3).isSameOrBefore(moment(exitSum).utcOffset(-3))){
                                console.log('salio antes que deberia salir');
                                let outEmployee = parseFloat(moment(exitSum).utcOffset(-3).diff(moment(time.access_out).utcOffset(-3), 'minutes',true).toFixed(2));
                                console.log('- El empleado salío ',outEmployee,' antes');
                                //entonces calcula el tiempo desde la hora fisica hacia la hora seteada de salida.
                            }else{

                                //si se fué despues del horario de salida y esas horas superan a 1
                                hourAfter = parseFloat(moment(exitSum).utcOffset(-3).diff(moment(time.access_out).utcOffset(-3), 'hours',true).toFixed(2));
                                if(hourAfter>=1){
                                    hourExtras= hourExtras+hourAfter;
                                    // puedo redondear o no, depende el client
                                }

                            }
                            

                            console.log('* Calculate extra after ','Salida fisica:',moment(time.access_out).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'),'Horario Salida:',moment(exitSum).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'))
                            console.log('calculo horas after',Math.round(hourAfter),hourAfter)

                            // calcular horas extras después
                            console.log('Total horas extras',hourExtras);
                            //suma el total horas extras al empleado
                            EmployeeData.extraHour = EmployeeData.extraHour + hourExtras;

                            console.log('CHECK ENTRADA',entranceSum.isBetween(time.access_in, time.access_out))
                            console.log('CHECK SALIDA',exitSum.isBetween(time.access_in, time.access_out))

                            let tempTime = 0;
                            //evaluar si cumple en su totalidad el rango de horas laborales
                            if(entranceSum.isBetween(time.access_in, time.access_out) && exitSum.isBetween(time.access_in, time.access_out)){
                                // si el acceso
                                WorkHourDay = parseFloat(moment(exitSum).utcOffset(-3).diff(moment(entranceSum).utcOffset(-3), 'hours',true).toFixed(2));
                                 // hace el push del record a Times general
                                times.push({
                                    month:moment(time.access_in).utcOffset(-3).get('month'),
                                    day:moment(time.access_in).utcOffset(-3).locale('en').format('D'),
                                    dayName:moment(time.access_in).utcOffset(-3).locale('en').format('dddd'),
                                    dayWeek:DayNumber,
                                    access_in:time.access_in,
                                    access_out:time.access_out,
                                    hour:WorkHourDay
                                });

                            }else{
                               
                                //en el caso que trabajó menos horas, se fué antes
                                tempTime = moment(time.access_out).utcOffset(-3).diff(moment(entranceSum).utcOffset(-3), 'hours',true).toFixed(2);
                                console.log('se fue antes */*/**/','trabajó',tempTime)
                                //resta las horas extras previamente calculadas
                                //en el caso que trabajó menos horas, se fué antes

                                WorkHourDay = parseFloat(tempTime);

                                times.push({
                                    month:moment(time.access_in).utcOffset(-3).get('month'),
                                    day:moment(time.access_in).utcOffset(-3).locale('en').format('D'),
                                    dayName:moment(time.access_in).utcOffset(-3).locale('en').format('dddd'),
                                    dayWeek:DayNumber,
                                    access_in:time.access_in,
                                    access_out:time.access_out,
                                    hour:WorkHourDay
                                });
                            }
                            console.log('TESTEEEEEEEE', WorkHour+(WorkHourDay))
                            WorkHour = WorkHour+(WorkHourDay); // suma hora del dia al total consolidado
                            // suma al total de horas del dia consolidado
                            switch (letterDay) {
                                case 'Monday':
                                    EmployeeData.Monday = EmployeeData.Monday+(WorkHourDay+hourExtras);
                                    break;
                                case 'Tuesday':
                                    EmployeeData.Tuesday = EmployeeData.Tuesday+(WorkHourDay+hourExtras);
                                    break;
                                case 'Wednesday':
                                    EmployeeData.Wednesday = EmployeeData.Wednesday+(WorkHourDay+hourExtras);
                                    break;
                                case 'Thursday':
                                    EmployeeData.Thursday = EmployeeData.Thursday+(WorkHourDay+hourExtras);
                                    break;
                                case 'Friday':
                                    EmployeeData.Friday = EmployeeData.Friday+(WorkHourDay+hourExtras);
                                    break;
                                case 'Saturday':
                                    EmployeeData.Saturday = EmployeeData.Saturday+(WorkHourDay+hourExtras);
                                    break;
                                case 'Sunday':
                                    EmployeeData.Sunday = EmployeeData.Sunday+(WorkHourDay+hourExtras);
                                    break;
                                default:
                                    break;
                            }

                            console.log('HORAS TRABAJADAS del DIA',WorkHourDay,'extras',hourExtras)
                        }

                        console.log('*******************************************************')

                    }else{
                        //Cuando el turno no fué el dia asignado, definir que hacer con horas en dias con horarios
                        // no asignados
                        console.log('NOT found day ','nextDay?')
                    }
                    
                });
                
                EmployeeData.Times = times;
                EmployeeData.TotalHour = WorkHour.toFixed(2);
            }
            TimeConstruct.push(EmployeeData);

        })

       // console.log('-------------',JSON.stringify(TimeConstruct));
        // CREAR FUNCION PARA HACERLO CONSOLIDADO


        var workbook = new ExcelJS.Workbook();

        workbook.creator = 'Cardinal';
        //workbook.lastModifiedBy = 'Her';
        workbook.created = new Date();
        workbook.modified = new Date();
       // workbook.lastPrinted = new Date(2016, 9, 27);
       // workbook.properties.date1904 = true;

        workbook.views = [
            {
                x: 0, y: 0, width: 10000, height: 20000,
                firstSheet: 0, activeTab: 1, visibility: 'visible'
            }
        ];

        var worksheet = workbook.addWorksheet('Access');

        worksheet.columns = [
            { header: 'Legajo', key: 'fileNumber' },
            { header: 'Nombre', key: 'name' },
            { header: 'Apellido', key: 'last' },
            { header: 'Total Horas', key: 'TotalHour' },
            { header: 'Extras', key: 'extras' },
            { header: 'Lunes', key: 'Monday' },
            { header: 'Martes', key: 'Tuesday' },
            { header: 'Miércoles', key: 'Wednesday' },
            { header: 'Jueves', key: 'Thursday' },
            { header: 'Viernes', key: 'Friday' },
            { header: 'Sábado', key: 'Saturday' },
            { header: 'Domingo', key: 'Sunday' },
          /*   { header: 'Sector', key: 'typeEmployee' },
            { header: 'Tel.', key: 'phone' },
            { header: 'Sangre', key: 'bloodType' },
            { header: 'Estado', key: 'status' },
            { header: 'Creado', key: 'createAt', width: 10,type: 'date', formulae: [new Date()] },*/
        ];


        TimeConstruct.map(item=>{
            
            

          worksheet.addRow({ 
            fileNumber: item.fileNumber, 
            name:item.name,
            last:item.last,
            TotalHour:item.TotalHour,
            extras:item.extraHour,
            Monday:item.Monday,
            Tuesday:item.Tuesday,
            Wednesday:item.Wednesday,
            Thursday:item.Thursday,
            Friday:item.Friday,
            Saturday:item.Saturday,
            Sunday:item.Sunday,
         /*   art:item.art,
            typeEmployee:item.typeEmployeeData.name,
            phone:item.phone,
            bloodType:BloodType[item.bloodtype].label,
            status:StatusGeneral[item.status].label,
            createAt: moment(item.createAt).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'),*/
            });

        });


        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader("Content-Disposition", "attachment; filename=" + "Access.xlsx");
            workbook.xlsx.write(res)
                .then(function (data) {
                    res.end();
                    console.log('Export done...');
                });

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});



router.post('/export/daily',[
    check('access_in','shit happens').not().isEmpty(),
    check('access_out','shit happens').not().isEmpty()
  ],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    console.log('/export/daily','EXPORTTTTTTTTTTT',req.body)
    
    
    const {employee,access_in,access_out,typeEmployee} = req.body;

    var company = new mongoose.Types.ObjectId(req.user.company);
    let fromDate = moment(access_in).utcOffset(-3);
    let toDate = moment(access_out).utcOffset(-3);

    let QueryEmployee = [];
    QueryEmployee.push({ company: {$eq:company} })

    if(employee){

        QueryEmployee.push({
            _id: {$in:[new mongoose.Types.ObjectId(employee)]} 
        });

    }

    //Check if employee in group
    if(typeEmployee){
        QueryEmployee.push({ typeEmployee:new mongoose.Types.ObjectId(typeEmployee) });
    }

    //Get Employee connected with biometric
    const EmployeeList = await Employee.aggregate([ 
        { $match:{ $and: QueryEmployee } },
        { $lookup: { from: 'users.access', localField: 'userBiometric', foreignField: '_id', as: 'userAccess'} },
        { $lookup: { from: 'employee.type', localField: 'typeEmployee', foreignField: '_id', as: 'typeEmployee'} },
        { $unwind:{path:"$typeEmployee",preserveNullAndEmptyArrays:true}},
        { $unwind:{path:"$userAccess",preserveNullAndEmptyArrays:true}},
        {
            $project: {
                _id: '$_id',
                userBiometric: "$userAccess.user_id",
                name:'$name',
                last:'$last',
                fileNumber:'$fileNumber',
                avatar:'$avatar',
                typeEmployee:'$typeEmployee.name'
            }
        },
    ])
    .sort({name:1,last:1})
    .allowDiskUse(true)
    .then(function (res) {
        //filter only linked user 
        return res.filter(i => i.userBiometric);
    });
    


    try {
        
        // GET ALL DATA BIOMETRIC CONNECTED
        const biometricData = await UserTime.aggregate([
            { $match: {
                user_id: {$in:EmployeeList.map(i=>i.userBiometric)},
                access_in: {
                    $gte: fromDate.toDate(),
                    $lte: toDate.toDate()
                }
            } },
            {$project:
              {
                _id: '$user_id',
                access_id:   '$_id' ,
                access_in:   '$access_in' ,
                access_out:  '$access_out' ,
                comment: '$comment',
              }
           }
        ])
        .sort({access_in:1})
        .allowDiskUse(true)
        .then(function (res) {
          // console.log('res access time',JSON.stringify(res))
            return res;
        });
        
        //PROCESS DATA
        if(biometricData.length === 0){

            return res.status(204).json('');

        }else{


            //RECORRIENDO BIOMETRIC DATA
            const resFilter = biometricData.map(async (item,index) =>{

                //biometricData _id match dos array el biometric con el de user y filtrar solo los user q tengan data
                const found = EmployeeList.find(element => element.userBiometric === item._id);
                if(found){
                  //  console.log('************************',found)
                    return {
                        _id: item._id,
                        name: found.name,
                        last: found.last,
                        fileNumber: found.fileNumber,
                        user_id:found._id,
                        typeEmployee:found.typeEmployee,
                        access: {
                            access_in: item.access_in,
                            access_out: item.access_out,
                        }
                    }
                }else{
                    return {
                        _id: item._id,
                        name: item.name,
                        last: item.last,
                        fileNumber: item.fileNumber,
                        user_id:0,
                        typeEmployee:item.typeEmployee,
                        access: {
                            access_in: null,
                            access_out: null
                        },
                    }
                }

                
            });
           
           // console.log('resFilter',JSON.stringify(resFilter));
    
            Promise.all(resFilter).then(values => { 
                
                const resVal = values.filter(i=> i !== undefined);
              //  console.log('FINAL',JSON.stringify(resVal));

                //GET DAYS GENERATE XLS
                var workbook = new ExcelJS.Workbook();

                workbook.creator = 'Cardinal';
                //workbook.lastModifiedBy = 'Her';
                workbook.created = new Date();
                workbook.modified = new Date();
               // workbook.lastPrinted = new Date(2016, 9, 27);
               // workbook.properties.date1904 = true;
        
                workbook.views = [
                    {
                        x: 0, y: 0, width: 10000, height: 20000,
                        firstSheet: 0, activeTab: 1, visibility: 'visible'
                    }
                ];

                var given = toDate.endOf('day');
                var current = fromDate.startOf('day');

                   //Difference in number of days
               //    console.log('asDays',Math.round(moment.duration(given.diff(current)).asDays()),typeof(Math.round(moment.duration(given.diff(current)).asDays())))
                /* for (var i = 0; i = Math.round(moment.duration(given.diff(current)).asDays()); i++) {
                    console.log(i)
                 }*/
                 let count = 0;
                 let startDate = fromDate;
                 var worksheet = workbook.addWorksheet(startDate.format('DD-MM-YYYY'));
                 console.log(Math.round(moment.duration(given.diff(current)).asDays())+1)
                 while(count <= Math.round(moment.duration(given.diff(current)).asDays())+1){
                    // console.log(count)

                     if(count ===0){
                        console.log(startDate.format('DD'))
                     }else{
                        startDate.add(1,'day');
                        console.log(startDate.format('DD'));
                        worksheet = workbook.addWorksheet(startDate.format('DD-MM-YYYY'));
                     }
                     
        
                    worksheet.columns = [
                        { header: 'Legajo', key: 'fileNumber' },
                        { header: 'Nombre', key: 'name' },
                        { header: 'Apellido', key: 'last' },
                        { header: 'Tipo', key: 'typeEmployee' },
                        { header: 'Ingreso', key: 'access_in' },
                        { header: 'Egreso', key: 'access_out' },
                        { header: 'Total Horas', key: 'hour' },
                    ];
                    
                    let tempStartDate = startDate;
                    let tempEndDate = startDate;
                    resVal.map(item=>{

                        //CHECK DAY
                     //   console.log(tempStartDate.set({'h':00, 'm':00, 's':00}).toDate(),tempEndDate.set({'h':23, 'm':59, 's':00}).toDate())
                     //   console.log('access_in',moment(item.access.access_in).utcOffset(-3).toDate())
                        
                    //   console.log('CHECK DAY', moment(item.access.access_in).utcOffset(-3).isBetween(tempStartDate.set({'h':00, 'm':00, 's':00}), tempEndDate.set({'h':23, 'm':59, 's':00}),'day','[]' ) )

                       if(moment(item.access.access_in).utcOffset(-3).isBetween(tempStartDate.set({'h':00, 'm':00, 's':00}), tempEndDate.set({'h':23, 'm':59, 's':00}),'day','[]' )){

                       
                        let status = "";
                        if(item.access.access_in && !item.access.access_out){
                            status = "En Empresa"
                        }else if (!item.access.access_in && !item.access.access_out){
                            status = "Sin registro"
                        }

                        worksheet.addRow({ 
                            fileNumber: item.fileNumber, 
                            name:item.name,
                            last:item.last,
                            hour:item.access.access_out ? parseFloat(moment(item.access.access_out).utcOffset(-3).diff(moment(item.access.access_in).utcOffset(-3), 'hours',true)).toFixed(2) : "-",
                            typeEmployee:item.typeEmployee,
                            access_in: item.access.access_in ? moment(item.access.access_in).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss') : "-",
                            access_out: item.access.access_out ? moment(item.access.access_out).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss') : status
                        });
                        
                        }
                    });


                     count++;
                 }

                  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                      res.setHeader("Content-Disposition", "attachment; filename=" + "AccessDaily.xlsx");
                      workbook.xlsx.write(res)
                          .then(function (data) {
                              res.end();
                              console.log('Export done...');
                          });
          

              // return res.status(200).json('resVal');
            });

        }

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});

// EDIT ACCESS TIME
router.post('/edit',[
    check('_id','shit happens').not().isEmpty(),
    check('access_in','shit happens').not().isEmpty(),
    check('access_out','shit happens').not().isEmpty(),
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    const {_id,access_in,access_out,comment} = req.body;
    let EmployeeId = new mongoose.Types.ObjectId(_id);

    try{
        
        let data = {
          $set:{
          access_in: moment(access_in).utcOffset(0).toDate(),
          access_out: moment(access_out).utcOffset(0).toDate(),
          comment,
          edited:new mongoose.Types.ObjectId(req.user.id),
          editedAt:moment().utcOffset(0).toDate()
        }};
      
        const AccessQuery = await UserTime.findByIdAndUpdate({_id:EmployeeId}, data, { new:  true, runValidators:  true })
        .then((result) => {
            return result;
        });

        console.log('AccessQuery',AccessQuery)
        
        return res.status(200).json({});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

module.exports = router;