const express = require('express');
const router = express.Router();

const Employee = require('../../models/Employee');
const User = require('../../models/User');
const UserCategory = require('../../models/UserCategory');
const EmployeeType = require('../../models/EmployeeType');
const UserAccess = require('../../models/UserAccess');
const AccessNode = require('../../models/AccessNode');
const EmployeeWorkshift = require('./../../models/EmployeeWorkshift');
const moment = require('moment');
const ExcelJS = require('exceljs');
moment.locale('es');
const {BloodType,StatusGeneral} = require('./../../utils/CONS');
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const { getURLS3, putObjectS3 } = require("../../utils/s3.js");

const fs = require('fs');
const sharp = require('sharp');
// @route POST API USER
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage({}) });


router.post('/',auth,
  upload.single('avatar'),
  async (req,res)=>{
   
    const errors = validationResult(req);
    
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    const {status,name,last,dni,art,cuil,phone,birth,phoneEmergency,nameEmergency,email,typeEmployee,bloodType,fileNumber,workshift,biometric} = req.body;

    let bloodtypeConv = bloodType ? parseInt(bloodType) : 0;
    let typeEmployeeConv = typeEmployee ? new mongoose.Types.ObjectId(typeEmployee) : null;
    let workShiftConv = workshift ? new mongoose.Types.ObjectId(workshift) : null;

    let userBiometric = biometric ? new mongoose.Types.ObjectId(biometric) : null;
    let companyID = new mongoose.Types.ObjectId(req.user.company);
       
    let Tempfilename = null;

    if (req.file) {

         console.log('Uploading file...');
        Tempfilename = `${Date.now()}_${req.file.originalname}`;
        await putObjectS3(req.file.buffer, Tempfilename, "employee");

        // Procesamiento de thumbnail con sharp
        const resized = await sharp(req.file.buffer)
            .resize({
                width: 500,
                height: 500,
                fit: 'cover' // 'cover' recorta para encajar sin deformar la imagen
            })
            .jpeg({ quality: 70 })
            .toBuffer();
            
        const thumbKey = `xs_${Tempfilename}`;
        await putObjectS3(resized, thumbKey, "employee");

    } 
    
    
    try {

        //see if user exist3
        if(email){
            let employee = await Employee.findOne({email});
            if(employee){
                return res.status(400).json({errors: [{msg:'El usuario ya existe'}]});
            }
        }
        
        const NewEmployee = new Employee({
            fileNumber,
            name,
            email,
            avatar:Tempfilename ? Tempfilename : null,
            company: companyID,
            status,
            name,last,
            dni,
            cuil,
            art,
            birth:birth,
            phone,
            phoneEmergency,
            nameEmergency,
            email,
            typeEmployee:typeEmployeeConv,
            bloodtype:bloodtypeConv,
            userBiometric,
            workShift:workShiftConv,
            searchText: `${name} ${last}`
        });

        await NewEmployee.save();

        res.json({created:NewEmployee.id});


    // return jsonwebtoken
    }catch(err){
        console.error(err);
        res.status(500).send('server error');
    }
    
});

router.post('/list',auth, async (req,res) => {
        
    let company = new mongoose.Types.ObjectId(req.user.company);
    const {fileNumber,category} = req.body;
    try{

        let QueryEmployee = [];
        QueryEmployee.push({ company: {$eq:company}, status:{$lt: 3} })

        if(category && category.length >= 1){
            QueryEmployee.push({ typeEmployee: {$in:category.map(e=>new mongoose.Types.ObjectId(e))} });
        }

        if(fileNumber != ''){
            QueryEmployee.push({ fileNumber: {$eq:fileNumber} })
        }

        const response = await Employee.aggregate([
                { $match:{ $and: QueryEmployee } },
                { $sort:{name:-1}},
                { $lookup: { from: 'users.access', localField: 'userBiometric', foreignField: '_id', as: 'userBiometric'} },
                { $lookup: { from: 'employee.type', localField: 'typeEmployee', foreignField: '_id', as: 'typeEmployee'} },
                { $unwind: { path: "$typeEmployee", preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: '$_id',
                        name: '$name',
                        last: "$last",
                        email: "$email",
                        avatar:  "$avatar",
                        //bloodtype: "$bloodtype",
                        //art: "$art",
                        dni: "$dni",
                        createAt: "$createAt",
                        userBiometric:{ $arrayElemAt: [ "$userBiometric", 0 ] } ,
                        typeEmployee:"$typeEmployee.name" ,
                        fileNumber: "$fileNumber",
                        phone:"$phone",
                        status: "$status",
                        timeAssign:"$timeAssign"
                    }
                },
            // { $sort:{DeviceID:-1}},
            ])
            .allowDiskUse(true)
            .then(function (res) {
            //   console.log(res);
            
            return res;
            });

        const resFilter = response.map(async item =>{
           // console.log(item,item.userBiometric ? true : false);
            return {
                _id: item._id,
                name: item.name,
                last: item.last,
                email: item.email,
                dni: item.dni,
                phone: item.phone,
                fileNumber: item.fileNumber,
                typeEmployee: item.typeEmployee,
                avatar: {
                   picture: item.avatar === null ? null : await getURLS3(item.avatar,60, 'employee'),
                   pictureBiometric: item.userBiometric ? await getURLS3(item.userBiometric.profile_image,60, 'employee') : null
                },
                status: {
                    _id:item._id,
                    status:item.status
                },
                action:{
                    _id: item._id,
                    name: `${item.fileNumber} - ${item.name} ${item.last}`
                }
            }
        });

        Promise.all(resFilter).then(values => { 
           // console.log(values);
           return res.status(200).json(values);
         });

        

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

// CHANGE USER STATUS
router.post('/status',[
    check('_id','shit happens').not().isEmpty(),
    check('status','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
  
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
  
    const {_id,status} = req.body;
    const userID = new mongoose.Types.ObjectId(_id);
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
        
        const userQuery = await Employee.findByIdAndUpdate({_id: userID}, data, { new:  true, runValidators:  true })
        return res.status(200).json(userQuery)
  
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
    check('_id','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
  
    //console.log(req.body);
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
  
    const {_id} = req.body;
    const typeId = new mongoose.Types.ObjectId(_id);
  
    data = {$set:{ status: 0 }};

    try{

        const TypeQuery = await  EmployeeType.findByIdAndUpdate({_id: typeId}, data, { new:  true, runValidators:  true })
        return res.status(200).json({status:TypeQuery})
  
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

      const EmployeeQuery = await Employee.aggregate([
        {
            $search: {
                    index: "employee_name",
                    "autocomplete": {
                    "query": search,
                    "path": "searchText",
                    "tokenOrder": "any"
                  }
            }
          },
          {$match:{ company: { $eq: companyID }} },
          {
            $project: {
                value: '$_id',
                label: { $concat: [ '$name'," ", "$last" ] }
            }
          }
    ]).sort({label:1})
    .limit(15)
    .allowDiskUse(true)
    .then(function (res) {
        return res;
    });

      return res.status(200).json(EmployeeQuery);
  
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
    //console.log(req.user)
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



router.post('/detail',[
    check('_id','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
        
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }

    let company = new mongoose.Types.ObjectId(req.user.company);
    let uid = new mongoose.Types.ObjectId(req.body._id);

    try{
        
      const response = await Employee.aggregate([
            { $match: { 
                company: {$eq:company},
                _id: uid,
            } },
            { $sort:{name:-1}},
            { $lookup: { from: 'users.access', localField: 'userBiometric', foreignField: '_id', as: 'userBiometricData'} },
            { $lookup: { from: 'employee.workshift', localField: 'workShift', foreignField: '_id', as: 'workShift'} },
            { $unwind: { path: "$workShift", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$userBiometricData", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: '$_id',
                    name: '$name',
                    last: "$last",
                    email: "$email",
                    avatar:  "$avatar",
                    bloodtype: "$bloodtype",
                    gender: "$gender",
                    art: "$art",
                    dni: "$dni",
                    birth: "$birth",
                    cuil: "$cuil",
                    createAt: "$createAt",
                    userBiometric:"$userBiometric",
                    userBiometricData:"$userBiometricData" ,
                    typeEmployee:"$typeEmployee",
                    fileNumber: "$fileNumber",
                    phone:"$phone",
                    phoneEmergency:"$phoneEmergency",
                    nameEmergency:"$nameEmergency",
                    status: "$status",
                    workShift: "$workShift._id" 
                }
            },
           // { $sort:{DeviceID:-1}},
        ])
        .allowDiskUse(true)
        .then(function (res) {
          //  console.log(res);
          return res;
        });

        const resFilter = response.map(async item =>{
          
            return {
                _id: item._id,
                name: item.name,
                last: item.last,
                email: item.email,
                dni: item.dni,
                phone: item.phone,
                phoneEmergency:item.phoneEmergency,
                nameEmergency:item.nameEmergency,
                fileNumber: item.fileNumber,
                bloodtype: item.bloodtype,
                gender: item.gender,
                birth: item.birth,
                art: item.art,
                dni: item.dni,
                cuil: item.cuil,
                createAt:item.createAt,
                userBiometric:{
                    _id:item.userBiometric,
                    value:item.userBiometric ? item.userBiometric : null,
                    label:  item.userBiometricData ? item.userBiometricData.user_name : null,
                    image:  item.userBiometricData ? item.userBiometricData.profile_image : null,
                    imageGet:  item.userBiometricData ? await getURLS3(item.userBiometricData.profile_image,60, 'employee') : null,
                },
                biometric:item.userBiometric,
                typeEmployee:item.typeEmployee,
                avatar: item.avatar,
                status: item.status,
                workShift:item.workShift
            }
        });

        Promise.all(resFilter).then(values => { 
        
           return res.status(200).json(values[0]);
        });

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


// EDIT USER 
router.post('/edit', upload.single('avatar'),auth, async (req,res)=>{

    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
   
    console.log('POST...',req.body);
    

    const {status,name,last,dni,art,cuil,phone,phoneEmergency,nameEmergency,email,typeEmployee,bloodtype,fileNumber,biometric,birth,gender,_id,workShift} = req.body;

    const userID = new mongoose.Types.ObjectId(_id);

    let bloodtypeConv = 0;
    let employeeTypeConv = null;
    let genderConv = null;

    if(bloodtype){ bloodtypeConv = parseInt(bloodtype); }
    if(gender){ genderConv = parseInt(gender); }
    if(typeEmployee){ employeeTypeConv = new mongoose.Types.ObjectId(typeEmployee) }

    let workShiftData = null;
    if(workShift){
        workShiftData = new mongoose.Types.ObjectId(workShift);
    }

    let statusConv;
        if(status){ parseInt(status);}
    let dniConv;
        if(dni){ dniConv = parseInt(dni); }
   

    let cuilConv;
    if(cuil){ cuilConv = parseInt(cuil);}

    let phoneConv;
    if(phone){ phoneConv = parseInt(phone);}

    let phoneEmergencyConv;
    if(phoneEmergency){ phoneEmergencyConv = parseInt(phoneEmergency);}
    let userBiometricData = null;
    if(biometric){
        userBiometricData = new mongoose.Types.ObjectId(biometric);
    }

    let companyID = new mongoose.Types.ObjectId(req.user.company);

    data = {
        $set:{
            fileNumber,
            name,
            last,
            email,
           // avatar:Tempfilename ? Tempfilename.trim() : null,
            status:statusConv,
            dni:dniConv,
            cuil:cuilConv,
            birth:birth,
            art,
            phone:phoneConv,
            phoneEmergency:phoneEmergencyConv,
            nameEmergency,
            typeEmployee:employeeTypeConv,
            bloodtype:bloodtypeConv,
            gender:genderConv,
            userBiometric:userBiometricData,
            workShift:workShiftData,
            searchText: `${name} ${last}`
    }};
  
    try{
        
        const userQuery = await Employee.findByIdAndUpdate({_id: userID,company:companyID}, data, { new:  true, runValidators:  true })
        console.log('userQuery',userQuery)
        return res.status(200).json({})
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
  
  
  });

  
// DELETE EMPLOYEE
router.post('/delete',[
    check('_id','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
  
    //console.log(req.body);
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
  
    const {_id} = req.body;
    const employeeId = new mongoose.Types.ObjectId(_id);
  
    data = {$set:{
      status: 3
    }};

    try{

        const TypeQuery = await  Employee.findByIdAndUpdate({_id: employeeId}, data, { new:  true, runValidators:  true })
        return res.status(200).json({status:TypeQuery})
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
  
  });


  
router.get('/export',auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    var company = new mongoose.Types.ObjectId(req.user.company);
    
    try {

        var typeQueryStat = {
            company,
            status: {$lt:3}
        };
        
        var workbook = new ExcelJS.Workbook();

        workbook.creator = 'Cardinal';
        workbook.created = new Date();
        workbook.modified = new Date();

        workbook.views = [
            {
                x: 0, y: 0, width: 10000, height: 20000,
                firstSheet: 0, activeTab: 1, visibility: 'visible'
            }
        ];

        var worksheet = workbook.addWorksheet('Employee');
        
        var StatsQuery = [];

        //History Detailed Query
        StatsQuery.push(
            Employee.aggregate([
                { $match: typeQueryStat },
            { $lookup: { from: 'users.access', localField: 'userBiometric', foreignField: '_id', as: 'userBiometricData'} },
            { $lookup: { from: 'employee.type', localField: 'typeEmployee', foreignField: '_id', as: 'typeEmployeeData'} },
            { $unwind: { path: "$typeEmployeeData", preserveNullAndEmptyArrays: true } },
            { $unwind: { path: "$userBiometricData", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: '$_id',
                    name: '$name',
                    last: "$last",
                    email: "$email",
                    avatar:  "$avatar",
                    bloodtype: "$bloodtype",
                    art: "$art",
                    dni: "$dni",
                    cuil: "$cuil",
                    createAt: "$createAt",
                    userBiometric:"$userBiometric",
                    userBiometricData:"$userBiometricData" ,
                    typeEmployeeData:"$typeEmployeeData" ,
                    typeEmployee:"$typeEmployee",
                    fileNumber: "$fileNumber",
                    phone:"$phone",
                    phoneEmergency:"$phoneEmergency",
                    nameEmergency:"$nameEmergency",
                    status: "$status",
                    timeAssign: "$timeAssign"
                }
            },
            { $sort:{name:1,last:1,fileNumber:1}},
            ])
            .allowDiskUse(true)
         );

    
        Promise.all(StatsQuery).then( ([ Total ]) => {

           // console.log(Total)
            worksheet.columns = [
                { header: 'Legajo', key: 'fileNumber' },
                { header: 'Nombre', key: 'name' },
                { header: 'Apellido', key: 'last' },
                { header: 'DNI', key: 'dni' },
                { header: 'Cuil', key: 'cuil' },
                { header: 'Art', key: 'art' },
                { header: 'Sector', key: 'typeEmployee' },
                { header: 'Tel.', key: 'phone' },
                { header: 'Sangre', key: 'bloodType' },
                { header: 'Estado', key: 'status' },
                { header: 'Creado', key: 'createAt', width: 10,type: 'date', formulae: [new Date()] },
            ];


            Total.map(item=>{
                
              worksheet.addRow({ 
                fileNumber: item.fileNumber, 
                name:item.name,
                last:item.last,
                dni:item.dni,
                cuil:item.cuil,
                art:item.art,
                typeEmployee:item.typeEmployeeData.name,
                phone:item.phone,
                bloodType:item.bloodtype ? BloodType[item.bloodtype].label : '',
                status:item.status ? StatusGeneral[item.status].label : '',
                createAt: moment(item.createAt).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'),
                });

            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader("Content-Disposition", "attachment; filename=" + "Report.xlsx");
            workbook.xlsx.write(res)
                .then(function (data) {
                    res.end();
                    console.log('Export done...');
                });

        });


    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});


// GET EMPLOYEE TYPES
router.get('/workshift/list',auth, async (req,res) => {
    
    let company = new mongoose.Types.ObjectId(req.user.company);

    try{
        const TypeQuery = await EmployeeWorkshift.find({company: {$eq:company},status:1})
        .select('_id name timeAssign')
        .then((result) => {
            return result;
        });
       // console.log('EmployeeWorkshift',JSON.stringify(TypeQuery));
        return res.status(200).json(TypeQuery);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


// NEW EMPLOYEE WORKSHIFT
router.post('/workshift',[
    check('name','shit happens').not().isEmpty(),
    check('timeAssign','shit happens').not().isEmpty(),
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {name,timeAssign} = req.body;
   
    let timeAssignConvFix;
    if(timeAssign !== undefined){ 

        timeAssignConvFix = timeAssign.map(i=> {
            return {
                day: i.day,
                from: moment(i.from).utcOffset(-3).toDate(),
                to: moment(i.to).utcOffset(-3).toDate(),
                percent:i.percent,
                nextDay:i.nextDay
            }
        });
    }

    let company = new mongoose.Types.ObjectId(req.user.company);

    try{

        let NewWorkshift = new EmployeeWorkshift({
            name,
            company,
            timeAssign:timeAssignConvFix
        });

        // CHECK IF EXIST
        await NewWorkshift.save();
        return res.status(200).json([]);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


// EDIT EMPLOYEE WORKSHIFT
router.post('/workshift/edit',[
    check('uid','shit happens').not().isEmpty(),
    check('name','shit happens').not().isEmpty(),
    check('timeAssign','shit happens').not().isEmpty(),
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {name,timeAssign,uid} = req.body;
    
    let timeAssignConv;
    let timeAssignConvFix;
    if(timeAssign !== undefined){ 

        timeAssignConv = JSON.parse(timeAssign); 
        timeAssignConvFix = timeAssignConv.map(i=> {
            return {
                day: i.day,
                from: moment(i.from).utcOffset(-3).toDate(),
                to: moment(i.to).utcOffset(-3).toDate(),
                percent:i.percent,
                nextDay:i.nextDay
            }
        });
    }


    let idWorkshift = new mongoose.Types.ObjectId(uid);
    let company = new mongoose.Types.ObjectId(req.user.company);

    try{

        let data = {
            $set:{
                name,
                company,
                timeAssign:timeAssignConvFix
          }};
        
        const TypeQuery = await EmployeeWorkshift.findByIdAndUpdate({_id: idWorkshift, company}, data, { new:  true, runValidators:  true });
        return res.status(200).json([]);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


// DELETE WORKSHIFT
router.post('/workshift/delete',[
    check('_id','shit happens').not().isEmpty(),
  ],auth, async (req,res) => {
    
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {_id} = req.body;
    let docUID = new mongoose.Types.ObjectId(_id)
    let company = new mongoose.Types.ObjectId(req.user.company);

    try{

        let data = {
            $set:{
            status: 3
          }};
        
        const TypeQuery = await  EmployeeWorkshift.findByIdAndUpdate({_id: docUID, company}, data, { new:  true, runValidators:  true })
        return res.status(200).json({status:TypeQuery});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

module.exports = router;