const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Poll = require('../../models/Poll');
const MechanicalConfig = require('../../models/MechanicalConfig');
const MechanicalHistory = require('../../models/MechanicalHistory');
const VehicleStatus = require('../../models/VehicleStatus');
const CompanyNotification = require('../../models/CompanyNotification');
const Vehicle = require('../../models/Vehicle');
const User = require('../../models/User');
const PollQuestion = require('../../models/PollQuestion');
const moment = require('moment-timezone');
const ExcelJS = require('exceljs');
const { getURLS3, putObjectS3 } = require("../../utils/s3.js");
const mongoose = require('mongoose');
const fs = require('fs');
const sharp = require('sharp');
// @route POST API USER
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage({}) });


function dynamicsort(property,order) {
    var sort_order = 1;
    if(order === "desc"){
        sort_order = -1;
    }
    return function (a, b){
        // a should come before b in the sorted order
        if(a[property] < b[property]){
                return -1 * sort_order;
        // a should come after b in the sorted order
        }else if(a[property] > b[property]){
                return 1 * sort_order;
        // a and b are the same
        }else{
                return 0 * sort_order;
        }
    }
}

//@route GET api/garage/board
//@Desc List
//@access Private
router.get('/board',auth, async (req,res) => {

  /*  const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }*/

    var company = new mongoose.Types.ObjectId(req.user.company)
    const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
   // console.log(fleetList)
    //get server date now & check turn available

    let dates =  moment(new Date()).utcOffset(0)
    console.log('GET',dates.format('HH:mm:ss'));

    Number.prototype.pad = function(size) {
        var sign = Math.sign(this) === -1 ? '-' : '';
        return sign + new Array(size).concat([Math.abs(this)]).join('0').slice(-size);
      }

    try {

        promisesArr = [];

        let fleetQuery = await Vehicle.aggregate([{ $match: {  category: {$in:fleetList},  status: { $ne: new mongoose.Types.ObjectId('61106beedce13f38b602bf51')}  }},
            {
                $project: {
                    _id: '$_id',
                    plate: '$plate',
                    movilnum: '$movilnum'
                }
            },
            { $sort:{movilnum:1}},
            ])
            .allowDiskUse(true)
            .then(function (res) {
                return res;
            });


            const Survey = await MechanicalHistory.aggregate([
                { $match: { 
                    vehicleAssign: {$in: fleetQuery.map(i=>i._id) 
                    }
                }, },
                { $lookup: { from: 'vehicles', localField: 'vehicleAssign', foreignField: '_id', as: 'vehicle'} },
                { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user'} },
                { $unwind: "$user"},
                { $unwind: "$vehicle"},
                {
                    $lookup: { from: 'vehicles.category', localField: 'vehicle.category', foreignField: '_id', as: 'category' },
                  },
                  {
                    $project: {
                      _id: '$_id',
                      createAt: "$createAt",
                      endAt: "$endAt",
                      vehicleAssign: "$vehicleAssign",
                      audio: "$audio",
                      user: { _id: "$user._id", name: "$user.name", email: "$user.email" },
                      vehicle_id: "$vehicle._id", plate: "$vehicle.plate", movilnum: "$vehicle.movilnum", 
                      result: 1,
                      category: { $arrayElemAt: ['$category.name', 0] },
                      status: "$status",
                      pollCheck: {
                        $anyElementTrue: {
                          $map: {
                            input: { $ifNull: ["$result", []] },// Itera sobre el arreglo result
                            as: "resultItem",
                            in: { $eq: ["$$resultItem.option", 2] } // Comprueba si option es 2
                          }
                        }
                      }
                    }
                  },
                  {
                    $sort: { createAt: -1 }
                  },
                  {
                    $group: {
                        '_id': '$vehicleAssign', 
                        'lastDocument': {
                            '$first': '$$ROOT'
                        }
                    }
                }, {
                    $replaceRoot: {
                        'newRoot': '$lastDocument'
                    }
                },
                {$sort: { 'vehicle.movilnum': 1 } }
            ])
            .allowDiskUse(true)
            .then(function (result) {
                console.log('survey',JSON.stringify(result));
                //return res;
                return result
            });



           // console.log(JSON.stringify(fleetQuery));
            return res.status(200).json(Survey)
/*
        promisesArr.push(
        
            new Promise((resolve, reject) => { 

                MechanicalConfig.find({
                        company: {$eq: company},
                        status: 1}
                    ).then(function (res) {
                        
                    // console.log(res);
                        var format = 'HH:mm:ss';
                        
                        const timeSearch = res.map(item=>{
            
                            if(item.fromHr <= 9){
                                fromHour = item.fromHr.pad(2);
                            }else{
                                fromHour = item.fromHr;
                            }
                            if(item.fromMin <= 9){
                                fromMinute = item.fromMin.pad(2);
                            }else{
                                fromMinute = item.fromMin;
                            }
            
                            if(item.toHr <= 9){
                                toHour = item.toHr.pad(2);
                            }else{
                                toHour = item.toHr;
                            }
                            if(item.toMin <= 9){
                                toMinute = item.toMin.pad(2);
                            }else{
                                toMinute = item.toMin;
                            }
                            
                            var time = moment(dates.format('HH:mm:ss'),format),
                            beforeTime = moment(`${fromHour}:${fromMinute}:00`,format),
                            afterTime = moment(`${toHour}:${toMinute}:00`,format);
            
                          //  console.log(time.format('HH:mm:ss'),beforeTime.format('HH:mm:ss'), afterTime.format('HH:mm:ss'));
                          //  console.log(time.isBetween(beforeTime, afterTime));
                          
            
                            if (time.isBetween(beforeTime, afterTime)) {
            
                              // console.log('is between',item)
                                return item;
            
                            } else {
            
                                //console.log('is not between')
                                return null;
            
                            }
            
                        });
                        return timeSearch;
            
                    })
                    .then((e)=> resolve(e))
                })
            
        )
       
       // GET ALL VEHICLES
       promisesArr.push(
        new Promise((resolve, reject) => {

               resolve(Vehicle.aggregate([
                    { $match: { 
                        category: {$in:fleetList}
                    }, },
                    {
                        $project: {
                            _id: '$_id',
                        }
                    },
                    { $sort:{movilnum:1}},
                    ])
                    .allowDiskUse(true)
                    .then(function (res) {
                      //  console.log(res);
                        return res;
                    })
                )
            
            })
       )
       
        
      Promise.all(promisesArr).then(async values => { 
            
        //console.log(values[1]); // [3, 1337, "foo"] 
        const VehicleList = values[1].map(x => new mongoose.Types.ObjectId(x._id));

        const live = await MechanicalHistory.aggregate([
                { $match: { 
                    vehicleAssign: {$in:VehicleList}
                }, },
                { $lookup: { from: 'mechanical.question', localField: 'question._id', foreignField: '_id', as: 'question'} },
                { $lookup: { from: 'mechanical.result', localField: 'question._id', foreignField: '_id', as: 'result'} },
                { $lookup: { from: 'vehicles', localField: 'vehicleAssign', foreignField: '_id', as: 'vehicle'} },
                { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user'} },
                { "$unwind": "$user"},
                { "$unwind": "$vehicle"},
                { $group: 
                    {
                        _id: '$_id',
                        createAt:  { "$last": "$createAt" },
                        user: { "$last": {_id:"$user._id", name:"$user.name",email:"$user.email"} },
                        vehicle: { "$last": {_id:"$vehicle._id",plate:"$vehicle.plate",movilnum:"$vehicle.movilnum"} },
                        question: {"$last": "$question"},
                        status: {"$last": "$status"},
                        result: {"$last": "$result"},
                    }
                },
                {$sort:{createAt: -1}}
            ])
            .allowDiskUse(true)
            .then(function (result) {
              //  console.log('end',JSON.stringify(result));
                //return res;
                return res.status(200).json(result)
            });


          });*/

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});


// GET FLEET CATEGORY LIST
router.get('/group',auth, async (req,res) => {

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
       console.log(JSON.stringify(List))
        return res.status(200).json(List);
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
  
  
  });
  

// GET FLEET CATEGORY LIST
router.get('/config',auth, async (req,res) => {

    let company = new mongoose.Types.ObjectId(req.user.company);

    try{

        const MechanicalConfigQuery = await MechanicalConfig.aggregate([
            { $match: { 
                company: {$eq:company}
            } },
            { $project: {
                    _id: '$_id',
                    status:'$status',
                    from: { 
                        $dateToString: {
                        date: "$from",
                        timezone: "America/Argentina/Buenos_Aires",
                        format: "%H:%M"
                    } },
                    fromDate:'$from',
                    to: { 
                        $dateToString: {
                        date: "$to",
                        timezone: "America/Argentina/Buenos_Aires",
                        format: "%H:%M"
                    } },
                    toDate:'$to',
                }
            }
        ]).sort({from:1})
        .allowDiskUse(true)
        .then(function (res) {
          //  console.log(res)
            return res;
        });

        return res.status(200).json(MechanicalConfigQuery);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }

});


router.post('/config/delete',[
    check('_id','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {_id} = req.body;
    let company = new mongoose.Types.ObjectId(req.user.company)

    try{
       
        await MechanicalConfig.findOneAndRemove({_id,company:company});
        
        const MechanicalConfigQuery = await MechanicalConfig.aggregate([
            { $match: { 
                company: {$eq:company}
            } },
            { $project: {
                    _id: '$_id',
                    status:'$status',
                    from: { 
                        $dateToString: {
                        date: "$from",
                        timezone: "America/Argentina/Buenos_Aires",
                        format: "%H:%M"
                    } },
                    fromDate:'$from',
                    to: { 
                        $dateToString: {
                        date: "$to",
                        timezone: "America/Argentina/Buenos_Aires",
                        format: "%H:%M"
                    } },
                    toDate:'$to',
                }
            }
        ]).sort({from:1})
        .allowDiskUse(true)
        .then(function (res) {
            //  console.log(res)
            return res;
        });
    
        return res.status(200).json(MechanicalConfigQuery);
  
    }catch(err){

        console.error(err.message);
        res.status(500).send('server error');

    }

});


router.post('/config/add',[
    check('startDate','Error').not().isEmpty(),
    check('endDate','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {startDate,endDate} = req.body;
    console.log(startDate,endDate)

    var company = new mongoose.Types.ObjectId(req.user.company)

    try {
        
        let NewMechanicalConfig = new MechanicalConfig({
            status:1,
            from:startDate,
            to:endDate,
            company
        });

        // CHECK IF EXIST
        await NewMechanicalConfig.save();

        const MechanicalConfigQuery = await MechanicalConfig.aggregate([
            { $match: { 
                company: {$eq:company}
            } },
            { $project: {
                    _id: '$_id',
                    status:'$status',
                    from: { 
                        $dateToString: {
                        date: "$from",
                        timezone: "America/Argentina/Buenos_Aires",
                        format: "%H:%M"
                    } },
                    fromDate:'$from',
                    to: { 
                        $dateToString: {
                        date: "$to",
                        timezone: "America/Argentina/Buenos_Aires",
                        format: "%H:%M"
                    } },
                    toDate:'$to',
                }
            }
        ]).sort({from:1})
        .allowDiskUse(true)
        .then(function (res) {
            //  console.log(res)
            return res;
        });

        return res.status(200).json(MechanicalConfigQuery)

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});


router.post('/survey',[
    check('_id','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {_id} = req.body;
    let company = new mongoose.Types.ObjectId(req.user.company)
    //console.log('survey ',_id)
    try{
               
      
        const Survey = await MechanicalHistory.findOne({
            company,
            _id: new mongoose.Types.ObjectId(_id)
          })
          .populate('user')
          .populate({
            path: 'user',
            model: 'users',
            select: 'name _id email last_connect'
          })
          .populate({
            path: 'vehicleAssign',
            model: 'vehicles',
            select: 'movilnum plate'
          })
          .populate({
            path: 'result.id',
            model: 'mechanical.question',
            select: 'question description'
          })
          .select('-question')
          .exec()
          .then(function (result) {
            return {
                    _id:result._id,
                    status:result.status,
                    vehicleAssign:result.vehicleAssign,
                    createAt:result.createAt,
                    user:result.user,
                    endAt:result.endAt,
                    audio:result.audio,
                    result: result.result.map(a => {
                        return {
                            image: a.image,
                            observation: a.observation,
                            description: a.id.description,
                            question_id: a.id._id,
                            question: a.id.question,
                            option: a.option,
                            editAt: a.editAt,
                            _id: a._id
                          }
                    })
                }
           
          });

        Survey.audio = Survey.audio ? await getURLS3(Survey.audio,60, 'mechanical') : null;
        let ArrProm = Survey.result.map( a => {

            return new Promise(async (resolve, reject) => { 
                    resolve({                        
                        image: a.image ?  await getURLS3(a.image,60, 'mechanical') : null,
                        observation: a.observation,
                        description: a.description,
                        question_id: a._id,
                        question: a.question,
                        option: a.option,
                        editAt: a.editAt,
                        _id: a._id
                    });
                })
           
        });

        Survey.result = await Promise.all(ArrProm).then(values=>values);
        return res.status(200).json(Survey);
  
    }catch(err){

        console.error(err.message);
        res.status(500).send('server error');

    }

});

router.get('/report/option',auth, async (req,res) => {
    
    const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
    const company = new mongoose.Types.ObjectId(req.user.company);

    try{
    
        const fleetListQuery = await Vehicle.aggregate([
            { $match: { 
                category: {$in:fleetList},
                status: {$ne:new mongoose.Types.ObjectId("61106beedce13f38b602bf51")}
            }, },
            { $lookup:{ from: 'vehicles.category', localField: 'category', foreignField: '_id', as: 'category'} },
            { $unwind: '$category'},
            { $sort: { 'movilnum': 1, 'category.name': 1 } },
            {
                $project: {
                    value: '$_id',
                    label: { $concat: [ '$movilnum', " - ", "$category.name" ] } 
                }
            }           
        ])
        .allowDiskUse(true)
        .then(function (res) {
          //  console.log(JSON.stringify(res));
            return res;
          });
        
        //QUERY QUESTION

        const QuestionQuery = await PollQuestion.find({company: {$eq:company}})
        .select('_id question description')
        .sort('question')
        .then((result) => {

            return result;
        });

        let formatQuestionList = QuestionQuery.map(item =>({
            value: item._id,
            label: item.question,
            description: item.description
        }))

        //QUERY EMPLOYEES
     
        //5e55e2c748a14901005f392c - supervisor
        //5e55e2c748a14901005f392d - employee
        const UserCategory = [
            new mongoose.Types.ObjectId('5e55e2c748a14901005f392c'),
            new mongoose.Types.ObjectId('5e55e2c748a14901005f392d')
        ];
             
        const employeeListQuery = await User.find({category:{$in:UserCategory},company}).select('_id name')
        .sort({name:-1}).exec();

        const formatEmployeeList = employeeListQuery.map(employee => ({
            value: employee._id,
            label: employee.name
        }));
                

        return res.status(200).json({fleetList:fleetListQuery,employeeList:formatEmployeeList,questionList:formatQuestionList});
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }

    

});
  

// GET REPORT 
//@ POST - Obtiene el reporte de las encuestas realizadas
router.post('/report/',[
    check('startDate','Error').not().isEmpty(),
    check('endDate','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {startDate,endDate,vehicle,employee,question} = req.body;

    console.log('req.body',req.body);

    var company = new mongoose.Types.ObjectId(req.user.company);
  //  const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
   console.log('company',company)
  var Result = {
        startDate,endDate,
        QtyIssues:{},
        MonthIssues:{},
        vehicles:[]
    }

/* MODEL RESULT TABLE GENERAL
    {
       
            vehicle: '1650',
            '23/11': 1,
            '24/11': 'x',
            '25/11': 'x',
            '26/11': 'o',
            subRows: [
              {
                id: 0,
                '23/11': [
                  { title: 'encuesta 1', status: 1 },
                  { title: 'encuesta 2', status: 2 }
                ]
              }
            ]
        
    }*/

    var typeQueryStat = {
        company,
        createAt: {
            $gte: moment(startDate).utcOffset(-3).startOf('D').toDate(),
            $lte: moment(endDate).utcOffset(-3).endOf('D').toDate()
        }
    };

    if(vehicle.length >= 1){
        typeQueryStat.vehicleAssign = {$in:vehicle.map(v=> new mongoose.Types.ObjectId(v))}
    }

    if(employee.length >= 1){
        console.log('contiene employee')
        typeQueryStat = {
            ...typeQueryStat,
            user:{$in:EmployeeArray}
        }
    }

    if(question.length >= 1){
        console.log('contiene Question',QuestionArray)
        typeQueryStat = {
            ...typeQueryStat,
            
            "$and":[
              //  {"result.option":{$eq:0}},
                {"question.id":{$in:QuestionArray}}
            ]
        }
    }

    
const pipeline = [
    { $match: typeQueryStat },
    { $sort: {createAt:-1}},
    {
        $unwind: '$result',
      },
      {
        $lookup: {
          from: 'mechanical.question',
          localField: 'result.id',
          foreignField: '_id',
          as: 'questionInfo',
        },
      },
      {
        $unwind: '$questionInfo',
      },
      {
        $lookup: {
          from: 'vehicles',
          localField: 'vehicleAssign',
          foreignField: '_id',
          as: 'vehicle',
        },
      },
      {
        $unwind: '$vehicle',
      },
      {
        $project: {
          _id: 1,
          status: 1,
          survey: {
            title: '$questionInfo.question',
            status: '$result.option',
            id: '$result.id',
          },
          createAt: '$createAt',
          vehicleMovilNum: '$vehicle.movilnum',
        },
      },
      {
        $unwind: "$survey",
      },
      {
        $sort: { "survey.title": 1 },
      },
      {
        $group: {
          _id: {
            vehicleMovilNum: '$vehicleMovilNum',
            _id: '$_id',
          },
          status: { $first: '$status' },
          createAt: { $first: '$createAt' },
          vehicle: { $first: '$vehicleMovilNum' },
          survey: { $push: '$survey' },
        },
      }
  ];
  
  const result = await MechanicalHistory.aggregate(pipeline);

  var cols = [{Header:'Vehículos',accessor:'vehicle'}];
  var DateToday = moment(startDate).utcOffset(-3).add(1,'h');

   // console.log(DateToday.isBetween(moment(startDate).utcOffset(-3).startOf('D'), moment(endDate).utcOffset(-3).endOf('D')));

    while (DateToday.isBetween(moment(startDate).utcOffset(-3).startOf('D'), moment(endDate).utcOffset(-3).endOf('D'))) {
        cols.push( {  Header: `${DateToday.format('DD/MM')}`, accessor: `${DateToday.format('DDMMYYYY')}`, id: `${DateToday.format('DDMMYYYY')}`});
        DateToday.add(1,'d');
    }
   
  //console.log('RESULT!!!!!!!!!!!!',JSON.stringify(result))
 // console.log(JSON.stringify(cols));

    const groupedByVehicle = result.reduce((acc, item) => {
    const vehicleMovilNum = item._id.vehicleMovilNum;
  
    if (!acc[vehicleMovilNum]) {
      acc[vehicleMovilNum] = { vehicle: vehicleMovilNum, surveys: [] };
    }
  
    acc[vehicleMovilNum].surveys.push({
      status: item.status,
      createAt: item.createAt,
      survey: item.survey,
    });
  
    return acc;
  }, {});
  
  const resultArray = Object.values(groupedByVehicle);
  //console.log('resultArray----',JSON.stringify(resultArray));

    var refineResult = [];
    refineResult = resultArray.map(d => {
        let temp = { subRows: [{}]}

        d.surveys.map((dat,index) => { 

           temp[moment(dat.createAt).format('DDMMYYYY')] = dat.status;
           temp.subRows[0][moment(dat.createAt).format('DDMMYYYY')] = dat.survey;
        })

        return {
            vehicle:d.vehicle,
            ...temp
        }
    });

  //  console.log('refineResult----',JSON.stringify(refineResult));

  var StatsQuery = [];

    StatsQuery.push(
        MechanicalHistory.find(typeQueryStat).select('_id status')
    );
        
    StatsQuery.push(
        MechanicalHistory.find({...typeQueryStat,
            "result.option": {$eq:0} 
        }).select('_id status')
    );


    try {

        let qtyIssues = await Promise.all(StatsQuery).then(([ total, fails ]) => { 

            // console.log('QtyIssues',JSON.stringify(total),total.length)
            // console.log('fails',JSON.stringify(fails),fails.length)
             return {total:total.length,fail:fails.length}
     
         });
     
         var StatsQueryMonth = [];
         // Process By Month
         StatsQueryMonth.push(
             MechanicalHistory.aggregate([
                 { $match: typeQueryStat },
                 {
                  $group : { 
                     _id : { month : {$month : "$createAt"} },
                     // amountTotal: { $sum: "$amount" },
                      PollTotal: { $sum: 1 }
                     },
                 },{ $sort : { "_id.month" : 1} }
             ])
             .allowDiskUse(true)
          );
     
          StatsQueryMonth.push(
             MechanicalHistory.aggregate([
                 { $match: { 
                     ...typeQueryStat,
                     "result.option": { $eq: 0 }, 
                 }, },
                 {
                  $group : { 
                     _id : { month : {$month : "$createAt"} },
                     // amountTotal: { $sum: "$amount" },
                      PollTotal: { $sum: 1 }
                     },
                 },{ $sort : { "_id.month" : 1} }
             ])
             .allowDiskUse(true)
          );
     
     
          
           let MonthQuery = await MechanicalHistory.aggregate([
             { $match: { 
                 ...typeQueryStat
             }, },
             {
                 $group: {
                   _id: {
                     month: { $month: "$createAt" },
                     year: { $year: "$createAt" },
                     status: "$status"
                   },
                   total: { $sum: 1 }
                 }
               },
               {
                 $group: {
                   _id: { month: "$_id.month", year: "$_id.year" },
                   totals: { $push: { status: "$_id.status", total: "$total" } }
                 }
               },
               {
                 $project: {
                   _id: 0,
                   month: {
                     $switch: {
                       branches: [
                         { case: { $eq: ["$_id.month", 1] }, then: "Enero" },
                         { case: { $eq: ["$_id.month", 2] }, then: "Febrero" },
                         { case: { $eq: ["$_id.month", 3] }, then: "Marzo" },
                         { case: { $eq: ["$_id.month", 4] }, then: "Abril" },
                         { case: { $eq: ["$_id.month", 5] }, then: "Mayo" },
                         { case: { $eq: ["$_id.month", 6] }, then: "Junio" },
                         { case: { $eq: ["$_id.month", 7] }, then: "Julio" },
                         { case: { $eq: ["$_id.month", 8] }, then: "Agosto" },
                         { case: { $eq: ["$_id.month", 9] }, then: "Septiembre" },
                         { case: { $eq: ["$_id.month", 10] }, then: "Octubre" },
                         { case: { $eq: ["$_id.month", 11] }, then: "Noviembre" },
                         { case: { $eq: ["$_id.month", 12] }, then: "Diciembre" },
                       ],
                       default: "Mes Desconocido"
                     }
                   },
                   year: "$_id.year",
                   totals: 1
                 }
               },
               {
                 $sort: {
                   year: 1,
                   month: 1
                 }
               }
         ])
         .allowDiskUse(true);
        // console.log('MechanicalHistory',JSON.stringify(MonthQuery))
     
         monthIssues = MonthQuery
     
         return res.status(200).json({dataTable:{cols,data:refineResult},qtyIssues:qtyIssues,qtyMonth:monthIssues });


    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});


// GET REPORT 
//@ POST - Obtiene el reporte de las encuestas realizadas
router.post('/report/detail',[
    check('startDate','Error').not().isEmpty(),
    check('endDate','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {startDate,endDate,vehicle,question,employee} = req.body;

    console.log(req.body);

    var company = new mongoose.Types.ObjectId(req.user.company);

    var Result = {
        startDate,endDate,
        PollResult:[],
    }

    //console.log(questionParse);

    let listVehicle;

    console.log(moment(startDate).format('DD/MM/YYYY'),moment(endDate).format('DD/MM/YYYY'));

    var startMonth = moment(endDate);
    var endMonth = moment(endDate);
   
    try {

        var typeQueryStat = {
            company,
            createAt: {
                $gte: moment(startDate).utcOffset(-3).toDate(),
                $lte: moment(endDate).utcOffset(-3).toDate()
            }
        };

        if(vehicle.length >= 1  ){

            var vehicleID = vehicle.map(item => new mongoose.Types.ObjectId(item));
            typeQueryStat = { ...typeQueryStat,
                vehicleAssign:{$in:vehicleID}
            }

        }else{

            const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
            const SearchAvailableList = await Vehicle.find({category: {$in:fleetList}})
            .select("_id")
            .then(vehiclelist => {    
                return vehiclelist.map(i=>i._id)
            });

            typeQueryStat = { ...typeQueryStat,
                vehicleAssign:{$in:SearchAvailableList}
            }

        }
        

        if(question.length >= 1 ){
           var questionID = question.map(item => new mongoose.Types.ObjectId(item));

            typeQueryStat = {
                ...typeQueryStat, 
               // "result.id":{$elemMatch: { $eq:questionID } },
                "result.id":{$in: questionID },
                "result.option":{$eq:0}
                }
        }

        if(employee.length >= 1 ){
            var employeeID = employee.map(item => new mongoose.Types.ObjectId(item));
             typeQueryStat = {
                 ...typeQueryStat,
                 user:{$in: employeeID },
                 }
         }

       console.log(typeQueryStat);
        var StatsQuery = [];

        //History Detailed Query
        StatsQuery.push(
            MechanicalHistory.aggregate([
                { $match: typeQueryStat },
                { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user'} },
                { $lookup: { from: 'vehicles.status', localField: 'vehicleStatus', foreignField: '_id', as: 'vehicleStatus'} },
                { $lookup: { from: 'vehicles', localField: 'vehicleAssign', foreignField: '_id', as: 'vehicleAssign'} },
                { "$unwind": "$user"},
                { "$unwind": "$vehicleAssign"},
                { $project: {
                    _id: '$_id',
                    status:'$status',
                    statusVehicle:{$arrayElemAt: [ "$vehicleStatus", 0 ]},
                    date: {createAt:'$createAt',endAt: '$endAt'},
                    vehicleAssign:"$vehicleAssign.movilnum",
                    user:{name:'$user.name',last_connect:'$user.last_connect'},
                    result:'$result'
                }
            },
                { $sort : { "date.createAt" : -1} },
            ])
            .allowDiskUse(true)
         );

    
        Promise.all(StatsQuery).then( ([ Total ]) => {

            Total.map(item=>{
              
                Result.PollResult.push({
                    date:item.date.createAt,
                    movilnum:item.vehicleAssign,
                    employee:item.user,
                    time:item.date,
                    status:item.status,
                    statusVehicle:item.statusVehicle,
                    action:{_id:item._id,vehicleAssign:item.vehicleAssign},
                   // result:item.result,
                 }); 
                
            });

             return res.status(200).json(Result.PollResult);

          });


    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});

// EXPORT  REPORT 
//@ POST - Obtiene el reporte de las encuestas realizadas
router.post('/report/detail/export',[
    check('startDate','Error').not().isEmpty(),
    check('endDate','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {startDate,endDate,vehicle,question,employee} = req.body;
    //console.log(req.body);
    
    var company = new mongoose.Types.ObjectId(req.user.company);
    
    var Result = {
        startDate,endDate,
        PollResult:[],
    }

    let listVehicle;

    console.log(moment(startDate).format('DD/MM/YYYY'),moment(endDate).format('DD/MM/YYYY'));

    var startMonth = moment(endDate);
    var endMonth = moment(endDate);
   
    try {

        var typeQueryStat = {
            company,
            createAt: {
                $gte: moment(startDate).toDate(),
                $lte: moment(endDate).toDate()
            }
        };

        if(vehicle.length >= 1  ){

            var vehicleID = vehicle.map(item => new mongoose.Types.ObjectId(item));
            typeQueryStat = { ...typeQueryStat,
                vehicleAssign:{$in:vehicleID}
            }

        }else{

            const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
            const SearchAvailableList = await Vehicle.find({category: {$in:fleetList}})
            .select("_id")
            .then(vehiclelist => {    
                return vehiclelist.map(i=>i._id)
            });

            typeQueryStat = { ...typeQueryStat,
                vehicleAssign:{$in:SearchAvailableList}
            }

        }
        
        if(question.length >= 1 ){
            var questionID = question.map(item => new mongoose.Types.ObjectId(item));
 
             typeQueryStat = {
                 ...typeQueryStat, 
                // "result.id":{$elemMatch: { $eq:questionID } },
                 "result.id":{$in: questionID },
                 "result.option":{$eq:0}
                 }
         }
 
         if(employee.length >= 1 ){
             var employeeID = employee.map(item => new mongoose.Types.ObjectId(item));
              typeQueryStat = {
                  ...typeQueryStat,
                  user:{$in: employeeID },
                  }
          }


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

        var worksheet = workbook.addWorksheet('My Sheet');
        

        var StatsQuery = [];

        //History Detailed Query
        StatsQuery.push(
            MechanicalHistory.aggregate([
                { $match: typeQueryStat },
                { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user'} },
                { $lookup: { from: 'vehicles.status', localField: 'vehicleStatus', foreignField: '_id', as: 'vehicleStatus'} },
                { $lookup: { from: 'vehicles', localField: 'vehicleAssign', foreignField: '_id', as: 'vehicleAssign'} },
                { "$unwind": "$user"},
                { $project: {
                    _id: '$_id',
                    status:'$status',
                    statusVehicle:{$arrayElemAt: [ "$vehicleStatus", 0 ]},
                    date: {createAt:'$createAt',endAt: '$endAt'},
                    vehicleAssign:{$arrayElemAt: [ "$vehicleAssign", 0 ]},
                    user:{name:'$user.name',last_connect:'$user.last_connect'},

                }
            },
                { $sort : { "date.createAt" : -1} },
            ])
            .allowDiskUse(true)
         );

    
        Promise.all(StatsQuery).then( ([ Total ]) => {


            worksheet.columns = [
                { header: 'id_ph', key: 'id_ph' },
                { header: 'Fecha', key: 'createAt', width: 10,type: 'date', formulae: [new Date()] },
                { header: 'Interno', key: 'movilnum', width: 10 },
                { header: 'Personal', key: 'employee' },
                { header: 'Estado Encuesta', key: 'statusPoll' },
                { header: 'Estado Vehículo', key: 'statusVehicle' },
               // { header: 'D.O.B.', key: 'dob', width: 10, outlineLevel: 1, type: 'date', formulae: [new Date(2016, 0, 1)] }
            ];
    
            
            Total.map(item=>{
               // console.log(JSON.stringify(item))
               /* Result.PollResult.push({
                       date:item.date.createAt,
                       movilnum:item.vehicleAssign,
                       employee:item.user,
                       time:item.date,
                       status:item.status,
                       statusVehicle:item.statusVehicle,
                       action:item._id
                    }); */

                worksheet.addRow({ 
                    id_ph: item._id, 
                    createAt: moment(item.date.createAt).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'),
                    movilnum:item.vehicleAssign.movilnum,
                    employee:`${item.user.name}`,
                    statusPoll:item.status,
                    statusVehicle:`${item.statusVehicle.name}`

                });

                
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader("Content-Disposition", "attachment; filename=" + "Report.xlsx");
            workbook.xlsx.write(res)
                .then(function (data) {
                    
                    res.end();
                    console.log('Export done...');
                });

           // console.log('Total found',JSON.stringify(Result.PollResult));
            // return res.status(200).json(Result);

          });

         


    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});




// GET DAILY 
//@ POST - Obtiene el reporte de fallas diarias

router.post('/report/daily',[
    check('startDate','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }
    
    const {startDate,vehicle} = req.body;
    console.log(req.body);
    moment.tz.setDefault(req.user.timezone)
    var company = new mongoose.Types.ObjectId(req.user.company);

    var Result = {
        Date:startDate,
        PollResult:[],
    }

    //console.log(questionParse);

    console.log(moment(startDate).format('DD/MM/YYYY'));
   /* console.log(moment(FormDate).set({'h':00, 'm':00, 's':00}).format('DD/MM/YYYY HH:mm:ss'));
    console.log(moment(FormDate).add(1, 'days').set({'h':00, 'm':00, 's':00}).format('DD/MM/YYYY HH:mm:ss'));
    console.log(new Date().getTimezoneOffset())*/
   
    try {

        var typeQueryStat = {
            company,
            createAt: {
                $gte: moment(startDate).startOf('D').toDate(),
                $lte: moment(startDate).endOf('D').toDate()
            },
           // "result.option": {$eq:1}
        };

        if(vehicle.length >= 1  ){

            var vehicleID = vehicle.map(item => new mongoose.Types.ObjectId(item));
            typeQueryStat = { ...typeQueryStat,
                vehicleAssign:{$in:vehicleID}
            }

        }else{

            const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
            const SearchAvailableList = await Vehicle.find({category: {$in:fleetList}})
            .select("_id")
            .then(vehiclelist => {    
                return vehiclelist.map(i=>i._id)
            });

            typeQueryStat = { ...typeQueryStat,
                vehicleAssign:{$in:SearchAvailableList}
            }

        }
    
        console.log(typeQueryStat);

        const QueryMechanical = await MechanicalHistory.aggregate([
                { $match: typeQueryStat },  // Tu filtro inicial

                // Uniones para user, vehicleStatus y vehicle
                { $lookup: {
                    from: 'users',
                    localField: 'user',
                    foreignField: '_id',
                    as: 'user'
                }},
                { $lookup: {
                    from: 'vehicles.status',
                    localField: 'vehicleStatus',
                    foreignField: '_id',
                    as: 'vehicleStatus'
                }},
                { $lookup: {
                    from: 'vehicles',
                    localField: 'vehicleAssign',
                    foreignField: '_id',
                    as: 'vehicleAssign'
                }},

                // Unir mechanical.question antes de procesar result
                { $lookup: {
                    from: 'mechanical.question',
                    localField: 'result.id',
                    foreignField: '_id',
                    as: 'questionInfo'
                }},

                // Unwind questionInfo para poder unir con result
                { $unwind: '$questionInfo' }, 

                // Agregar información de questionInfo a result
                {
                    $group: {
                        _id: { _id: '$_id', user: '$user', vehicleStatus: '$vehicleStatus', vehicleAssign: '$vehicleAssign', status: '$status', createAt: '$createAt', endAt: '$endAt', audio: '$audio', question: '$question' }, 
                        result: { $push: { 
                            $mergeObjects: [
                                { $arrayElemAt: ['$result', { $indexOfArray: ['$result.id', '$questionInfo._id'] }] },
                                { question: '$questionInfo' }
                            ] 
                        } }
                    }
                }, 
                { $project: {
                    _id: '$_id._id',
                    user: '$_id.user',
                    vehicleStatus: '$_id.vehicleStatus',
                    vehicleAssign: '$_id.vehicleAssign',
                    status: '$_id.status',
                    createAt: '$_id.createAt',
                    endAt: '$_id.endAt',
                    audio: '$_id.audio',
                    question: '$_id.question',
                    result: '$result' 
                }},
                
                // Desempaquetar user y proyectar los campos
                { "$unwind": "$user"},
                { $project: {
                    _id: '$_id',
                    status:'$status',
                    statusVehicle:{$arrayElemAt: [ "$vehicleStatus", 0 ]},
                    date: {createAt:'$createAt',endAt: '$endAt'},
                    vehicleAssign:{$arrayElemAt: [ "$vehicleAssign", 0 ]},
                    user:{name:'$user.name',last_connect:'$user.last_connect'},
                    result:'$result',
                    audio:'$audio',
                    pollResult: {
                        $anyElementTrue: {
                            $map: {
                                input: '$result',
                                as: 'resultItem',
                                in: { $eq: ['$$resultItem.option', 2] }
                            }
                        }
                    }
                }},
                
                { $sort : { "date.createAt" : -1} },
            ])
            .allowDiskUse(true)
            .then(function (res) {
                return res;
            });

      //  console.log('query',JSON.stringify(QueryMechanical));

        var PromResult = [];

        QueryMechanical.map(item=>{            
           
            let failList = item.result.filter(i=>i.option===2).map(a=>{ return {name:a.question.question}})
            
            PromResult.push(    
                new Promise(async (resolve, reject) => { 
                    resolve({
                        date:item.date.createAt,
                        movilnum:item.vehicleAssign,
                        employee:item.user,
                        fail:failList,
                        action:{_id:item._id,vehicleAssign:item.vehicleAssign},
                        audio:item.audio ? await getURLS3(item.audio,60, 'mechanical'): null
                    });
                })
                );

        });

        //History Detailed Query


        Promise.all(PromResult).then( (Total) => { 
           // console.log('****',JSON.stringify(Total))
            return res.status(200).json(Total);

        });

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});



router.post('/report/daily/export',[
    check('startDate','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {startDate,vehicle} = req.body;
    var company = new mongoose.Types.ObjectId(req.user.company);

    
    try {

        var typeQueryStat = {
            company,
            createAt: {
                $gte: moment(startDate).utcOffset(-3).startOf('D').toDate(),
                $lte: moment(startDate).utcOffset(-3).endOf('D').toDate()
            },
            "result.option": {$eq:1}
        };

        if(vehicle.length >= 1  ){

            var vehicleID = vehicle.map(item => new mongoose.Types.ObjectId(item));
            typeQueryStat = { ...typeQueryStat,
                vehicleAssign:{$in:vehicleID}
            }

        }else{

            const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
            const SearchAvailableList = await Vehicle.find({category: {$in:fleetList}})
            .select("_id")
            .then(vehiclelist => {    
                return vehiclelist.map(i=>i._id)
            });

            typeQueryStat = { ...typeQueryStat,
                vehicleAssign:{$in:SearchAvailableList}
            }

        }
        
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

        var worksheet = workbook.addWorksheet('DailyReport');
        
        var StatsQuery = [];

        //History Detailed Query
        StatsQuery.push(
            MechanicalHistory.aggregate([
                { $match: typeQueryStat },
                { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user'} },
                { $lookup: { from: 'vehicles.status', localField: 'vehicleStatus', foreignField: '_id', as: 'vehicleStatus'} },
                { $lookup: { from: 'vehicles', localField: 'vehicleAssign', foreignField: '_id', as: 'vehicleAssign'} },
                { $lookup: { from: 'mechanical.question', localField: 'result.id', foreignField: '_id', as: 'result2'} },
                { "$unwind": "$user"},
                { $project: {
                    _id: '$_id',
                    status:'$status',
                    statusVehicle:{$arrayElemAt: [ "$vehicleStatus", 0 ]},
                    date: {createAt:'$createAt',endAt: '$endAt'},
                    vehicleAssign:{$arrayElemAt: [ "$vehicleAssign", 0 ]},
                    user:{name:'$user.name',last_connect:'$user.last_connect'},
                    result:'$result',
                    result2:'$result2'
                }
            },
                { $sort : { "date.createAt" : -1} },
            ])
            .allowDiskUse(true)
         );

    
        Promise.all(StatsQuery).then( ([ Total ]) => {

            worksheet.columns = [
             //   { header: 'id_ph', key: 'id_ph' },
                { header: 'Fecha', key: 'createAt', width: 10,type: 'date', formulae: [new Date()] },
                { header: 'Interno', key: 'movilnum', width: 10 },
                { header: 'Personal', key: 'employee' },
                { header: 'Fallas', key: 'FailResult' }
               // { header: 'D.O.B.', key: 'dob', width: 10, outlineLevel: 1, type: 'date', formulae: [new Date(2016, 0, 1)] }
            ];


            Total.map(item=>{
                
                let t1 =[];
                let t2 =[];
                if(item.result){

                    t1 = item.result.sort(dynamicsort("id","desc"));
                    // console.log('ORDER!!!!',JSON.stringify(t1))
                    t2 = item.result2.sort(dynamicsort("_id","desc"));

                }
                //filter Fails
                var FailResult = []
                t1.forEach((res,index)=>{
                    if(res.option === 0){
                        FailResult.push(t2[index].question);
                    }
                })
               // console.log(item)
                if(FailResult.length >= 1){

                 worksheet.addRow({ 
            //    id_ph: item._id, 
                    createAt: moment(item.date.createAt).utcOffset(-3).format('DD/MM/YYYY HH:mm:ss'),
                    movilnum:item.vehicleAssign.movilnum,
                    employee:`${item.user.name}`,
                    FailResult:FailResult
                });

                }
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




//@route GET api/poll/
//@Desc List
//@access Private
router.get('/survey/list',auth, async (req,res) => {

    let company = new mongoose.Types.ObjectId(req.user.company)

    try {
        
        const response = await Poll.aggregate([
            { $match: { 
                company: {$eq:company},
                status: {$lt:3}
            } },
            { $lookup: { from: 'vehicles', localField: 'vehicleAssign', foreignField: '_id', as: 'vehicle'} },
            {
                $project: {
                    _id: '$_id',
                    title: '$title',
                    createAt: '$createAt',
                    vehicleAssign: {$map: {
                        input: '$vehicle',
                        as: 'vehicles',
                        in: {
                          movilnum: '$$vehicles.movilnum',
                          plate: '$$vehicles.plate',
                          color: '$$vehicles.color'
                        }
                      }},
                    status: "$status",
                    action: '$_id',
                }
            },
        ]).sort({title:1})
        .allowDiskUse(true)
        .then(function (res) {
            return res;
        });
        return res.status(200).json(response)

    } catch (error) {
        
        console.error(err.message);
        res.status(500).send('server error');

    }
});






//@route POST api/mechanical/detail
//@Desc Create or update
//@access Private
router.post('/detail',[
    check('uid','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    company = new mongoose.Types.ObjectId(req.user.company);
    uid = new mongoose.Types.ObjectId(req.body.uid);//req.body.uid  '5e8a657857544803105ad8d5'
    //console.log(req.body);
    console.log(uid,company);

    try {
        
        const MechanicalHistoryQuery = await MechanicalHistory.findOne({ company: {$eq:company}, _id: uid}).populate('user vehicleAssign question.id')
        .then(async query => {
           
           resArr = query.result ? query.result.toBSON() : null;
           console.log(query.audio);
           let audioProm = await getURLS3(query.audio,60, 'mechanical');

            var ArrProm = [];
            if(resArr !== null){

                resArr.map((item)=>{


                    console.log(item);
                    if(item.image){
                        
                       // console.log('IN IMAGE');
    
                        ArrProm.push( 
                            new Promise(async (resolve, reject) => { 
                                resolve({
                                    id:item.id,
                                    option:item.option,
                                    editAt:item.editAt,
                                    image:await getURLS3(item.image,60, 'mechanical'),
                                    observation:item.observation
                                });
                            })
                        );
                    
                    }else{
                        //console.log('out IMAGE')
                        ArrProm.push( 
                            new Promise(async (resolve, reject) => { 
                                resolve (item);
                            })
                        );
                    }
                });
                //console.log(ArrProm);
                return Promise.all(ArrProm).then( values => { 
                    //console.log(values);
                   

                    return {
                         _id:query._id,
                         status:query.status,
                         result:values,
                         user: {
                             name:query.user.name,
                             email:query.user.email,
                             last_connect:query.user.last_connect
                         },
                         question: query.question,
                         vehicleAssign:query.vehicleAssign,
                         createAt:query.createAt,
                         endAt:query.endAt,
                         audio:query.audio ? audioProm : null
                     }
         
                  });


            }else{
                //return query

                return {
                    _id:query._id,
                    status:query.status,
                    result:ArrProm,
                    user: {
                        name:query.user.name,
                        email:query.user.email,
                        last_connect:query.user.last_connect
                    },
                    question: query.question,
                    vehicleAssign:query.vehicleAssign,
                    createAt:query.createAt,
                    endAt:query.endAt,
                    audio:query.audio ? audioProm : null
                }
            }

        });

       // console.log('final',MechanicalHistoryQuery);
        return res.status(200).json(MechanicalHistoryQuery);

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});

//@route POST api/mechanical/config/add
//@Desc Create or update
//@access Private
router.post('/config/add',[
    check('from','Error').not().isEmpty(),
    check('to','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {from,to} = req.body;

    var company = new mongoose.Types.ObjectId(req.user.company)

    try {
        
        let NewMechanicalConfig = new MechanicalConfig({
            status:1,
            from,
            to,
            company
        });

        // CHECK IF EXIST
        await NewMechanicalConfig.save();
        return res.status(200).json({created:NewMechanicalConfig})

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});

//@route GET api/mechanical/config/
//@Desc LIST
//@access Private
router.get('/config',auth, async (req,res) => {

    company = new mongoose.Types.ObjectId(req.user.company)

    try{

        const MechanicalConfigQuery = await MechanicalConfig.aggregate([
            { $match: { 
                company: {$eq:company}
            } },
            { $project: {
                    _id: '$_id',
                    status:'$status',
                    from: { 
                        $dateToString: {
                        date: "$from",
                        timezone: "America/Argentina/Buenos_Aires",
                        format: "%H:%M"
                    } },
                    fromDate:'$from',
                    to: { 
                        $dateToString: {
                        date: "$to",
                        timezone: "America/Argentina/Buenos_Aires",
                        format: "%H:%M"
                    } },
                    toDate:'$to',
                }
            }
        ]).sort({from:1})
        .allowDiskUse(true)
        .then(function (res) {
          //  console.log(res)
            return res;
        });

        return res.status(200).json(MechanicalConfigQuery);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }

});

//@route POST api/mechanical/config/del
//@Desc Delete
//@access Private
router.post('/config/del',[
    check('id','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {id} = req.body;
    company = new mongoose.Types.ObjectId(req.user.company)

    try{
        
        await MechanicalConfig.findOneAndRemove({_id: id,company:company});
        
        return res.status(200).json();
  
    }catch(err){

        console.error(err.message);
        res.status(500).send('server error');

    }

});

// Retrieve USERS FOR REPORT 
//@ GET - Obtiene el historial de las encuestas realizadas
router.get('/users',auth, async (req,res) => {

    const company = new mongoose.Types.ObjectId(req.user.company);
   // const _user = new mongoose.Types.ObjectId(req.user.id);

    //5e55e2c748a14901005f392c - supervisor
    //5e55e2c748a14901005f392d - employee
    const UserCategory = [
        new mongoose.Types.ObjectId('5e55e2c748a14901005f392c'),
        new mongoose.Types.ObjectId('5e55e2c748a14901005f392d')
    ];

    try {
        
        const QueryHistory = await User.find({category:{$in:UserCategory},company}).select('_id name')
        .sort({name:-1}).exec();
       // console.log(QueryHistory);
        return res.status(200).json(QueryHistory);

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});

// GET REPORT 
//@ POST - Obtiene el reporte de las encuestas realizadas
router.post('/report2/',[
    check('startDate','Error').not().isEmpty(),
    check('endDate','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {startDate,endDate,vehicleAssign,Question,Employee} = req.body;

    console.log(req.body);

    var company = new mongoose.Types.ObjectId(req.user.company);
    const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
    var Result = {
        startDate,endDate,
        QtyIssues:{},
        MonthIssues:{},
        vehicles:[]
    }

    //Check if options empty
    console.log('from out',vehicleAssign,typeof(vehicleAssign),JSON.parse(vehicleAssign),typeof(JSON.parse(vehicleAssign)));
   
    let listVehicle;
    var vehiclesArray = JSON.parse(vehicleAssign);

    if(vehiclesArray.length >= 1){
        var temparry = vehiclesArray.map(x => new mongoose.Types.ObjectId(x.value))
        listVehicle = await Vehicle.find({company,_id:{$in: temparry }}).populate("status brand model").select('_id status movilnum brand model plate color');
    }else{
        listVehicle = await Vehicle.find({company,category:{$in:fleetList}}).populate("status brand model").select('_id status movilnum brand model plate color');
    }

    vehiclesArray = vehiclesArray.length >= 1 ? vehiclesArray.map(x => new mongoose.Types.ObjectId(x)) : listVehicle.map(item=>item._id);
    console.log('vehiclesArray',vehiclesArray);

    var QuestionArray = question;
    QuestionArray = QuestionArray.length >= 1  ?  QuestionArray.map(x => new mongoose.Types.ObjectId(x)) : [];
    QuestionArray2 = QuestionArray.length >= 1  ?  question.map(x => x) : [];
    console.log('QuestionArray',QuestionArray);

    var EmployeeArray = employee;
    EmployeeArray = EmployeeArray.length >= 1  ? EmployeeArray.map(x => new mongoose.Types.ObjectId(x)) : [];
    console.log('EmployeeArray',EmployeeArray);

    console.log(moment(startDate).format('DD/MM/YYYY'),moment(endDate).format('DD/MM/YYYY'));

    var startMonth = moment(endDate);
    
    var endMonth = moment(endDate);
    endMonth.subtract(6,'month');


  //  console.log('BarQuery:',startMonth.format('DD/MM/YYYY'),endMonth.format('DD/MM/YYYY'));

    try {

        var typeQueryStat = {company,
            createAt: {
                $gte: moment(startDate).toDate(),
                $lte: moment(endDate).toDate()
            },
            vehicleAssign:{$in:vehiclesArray}
        };

        if(EmployeeArray.length >= 1){
            console.log('contiene employee')
            typeQueryStat = {
                ...typeQueryStat,
                user:{$in:EmployeeArray}
            }
        }

        if(QuestionArray.length >= 1){
            console.log('contiene Question',QuestionArray)
            typeQueryStat = {
                ...typeQueryStat,
                
                "$and":[
                  //  {"result.option":{$eq:0}},
                    {"question.id":{$in:QuestionArray}}
                ]
            }
        }

        var StatsQuery = [];

        StatsQuery.push(
            MechanicalHistory.find(typeQueryStat).select('_id status')
        );
        
        StatsQuery.push(
            MechanicalHistory.find({...typeQueryStat,
                "result.option": {$eq:0} 
            }).select('_id status')
        );

        // Process By Month
        StatsQuery.push(
           MechanicalHistory.aggregate([
               { $match: typeQueryStat },
               {
                $group : { 
                   _id : { month : {$month : "$createAt"} },
                   // amountTotal: { $sum: "$amount" },
                    PollTotal: { $sum: 1 }
                   },
               },{ $sort : { "_id.month" : 1} }
           ])
           .allowDiskUse(true)
        );

        StatsQuery.push(
           MechanicalHistory.aggregate([
               { $match: { 
                   ...typeQueryStat,
                   "result.option": { $eq: 0 }, 
               }, },
               {
                $group : { 
                   _id : { month : {$month : "$createAt"} },
                   // amountTotal: { $sum: "$amount" },
                    PollTotal: { $sum: 1 }
                   },
               },{ $sort : { "_id.month" : 1} }
           ])
           .allowDiskUse(true)
        );


        //History Detailed Query
        StatsQuery.push(
            MechanicalHistory.aggregate([
                //{$unwind: '$result'},
                { $match: typeQueryStat },
                { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user'} },
                { $lookup: { from: 'vehicles.status', localField: 'vehicleStatus', foreignField: '_id', as: 'vehicleStatus'} },
                { $lookup: { from: 'vehicles', localField: 'vehicleAssign', foreignField: '_id', as: 'vehicleAssign'} },
                { $lookup: { from: 'mechanical.question', localField: 'result.id', foreignField: '_id', as: 'result2'} },
                { "$unwind": "$user"},          
                {
                 $group : { 
                    _id : { day : {$dayOfMonth : "$createAt"}, year: { $year: "$createAt" },month: { $month: "$createAt" } },
                   // fullDate :  "$createAt",
                    Poll: { $push:  { _id:"$_id",createAt:"$createAt",endAt:"$endAt",user:{_id:"$user._id",name:"$user.name"},
                            result: "$result",
                            result2: "$result2",
                           // resulttest:  { _id:"$result._id",image:"$result.image",observation:"$result.observation",option:"$result.option",question:{$arrayElemAt: [ "$result2.question", 0 ]}  } ,
                            vehicleAssign:{plate:{ $arrayElemAt: [ "$vehicleAssign.plate", 0 ] },color:{ $arrayElemAt: [ "$vehicleAssign.color", 0 ] },movilnum:{ $arrayElemAt: [ "$vehicleAssign.movilnum", 0 ] } },
                            vehicleStatus: {name:{ $arrayElemAt: [ "$vehicleStatus.name", 0 ] },color:{ $arrayElemAt: [ "$vehicleStatus.color", 0 ] },position:{ $arrayElemAt: [ "$vehicleStatus.position", 0 ] }} } },
                    Qty: { $sum: 1 },
                    createAt: { $last: { $dateToString: { format: "%d%m%Y", date: "$createAt" } } }
                    }
                },
                { $sort : { "_id.month" : 1,"_id.day" : 1} },
            ])
            .allowDiskUse(true)
         );

    
        Promise.all(StatsQuery).then( ([ Total, Fails,MonthQty,MonthFail,DetailHistory ]) => {

            console.log('Total found',Total.length);
            console.log('Fails found',Fails.length);

           //{total:Total.length,fail:Fails.length}
          // DetailHistory.map(i=>{ console.log(i.Poll) })

            Result.QtyIssues = {
                labels: ["Encuestas Generadas", "Fallas"],
                datasets: [
                   {
                      data: [Total.length, Fails.length],
                      backgroundColor: [
                         "rgba(224, 224, 224, 0.8)",
                         "rgba(229, 57, 53, 0.8)",
                      ]
                   }
                ]
             }
            // Process By Month
            Result.MonthIssues = {};

          /*  console.log('result bar query',MonthQty,MonthFail,MonthFail.map(item=>item.PollTotal),
            typeof(MonthFail.map(item=>item.PollTotal)),
            MonthQty.map(item=>moment().month(item._id.month-1).format('MMM'))
            );*/

             MonthQty.map(item=>{
                 console.log(moment().month(item._id.month-1).format('MMM'));
                 
             })
             
            Result.MonthIssues = {
                labels: MonthQty.map(item=>moment().month(item._id.month-1).format('MMM')),
                datasets: [
                   {
                      label: "Encuestas Realizadas",
                      data: MonthQty.map(item=>item.PollTotal) ,
                      backgroundColor: "rgba(3, 155, 229, 0.8)",
                      borderColor: "rgba(148,159,177,1)",
                      pointBackgroundColor: "rgba(148,159,177,1)",
                      pointBorderColor: "#fff",
                      pointHoverBackgroundColor: "#fff",
                      pointHoverBorderColor: "rgba(148,159,177,0.8)"
                   },
                   {
                      data: MonthFail.map(item=>item.PollTotal),
                      label: "Fallas",
                      backgroundColor: "rgba(244, 67, 54, 0.8)",
                      borderColor: "rgba(148,159,177,1)",
                      pointBackgroundColor: "rgba(148,159,177,1)",
                      pointBorderColor: "#fff",
                      pointHoverBackgroundColor: "#fff",
                      pointHoverBorderColor: "rgba(148,159,177,0.8)"
                   }
                ]
             };
            

             // Process Detail History
             //prepare cols of tables
             var cols = [{Header:'Vehículos',accessor:'movilnum'}];
             var DateToday = moment(startDate).utcOffset(-3).add(1,'h');

             console.log(DateToday.isBetween(moment(startDate), moment(endDate)));

             while (DateToday.isBetween(moment(startDate), moment(endDate))) {
                    cols.push( {  Header: `${DateToday.format('DD/MM/YYYY')}`, accessor: `${DateToday.format('DDMMYYYY')}`, id: `${DateToday.format('DDMMYYYY')}`});
                    DateToday.add(1,'d');
             }
           //  console.log(cols);
            // console.log(JSON.stringify(DetailHistory),cols);
             console.log(listVehicle);
             //refactor array data
             var data = [];

            // const miPrimeraPromise = new Promise((resolve, reject) => {
                 
               listVehicle.map(item => {

                    var subdata = {}
                    subdata.movilnum = item.movilnum;
                    var subRows = {}
                    subRows.movilnum = "Fallas";
                    subdata.subRows = [];
                    // CREATE A SUBROWS!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
                   // subdata.subRows = [{"14072020":[],"15072020":[4],"movilnum":"Fallas"}];
                    console.log(subdata.movilnum);

                    cols.map(colItem=>{
                        
                         if(colItem.accessor!=='movilnum'){
                            // if data match
                          //  console.log('+++DIA',colItem.accessor);
                            const found = DetailHistory.find(detail => colItem.accessor === detail.createAt);
                          //  console.log('+',found);
                            subdata[colItem.accessor] = [];
                            subRows[colItem.accessor] = [];
                            if(found){

                                found.Poll.map((founded,index)=>{

                                   // console.log('--',founded)
                                    if(founded.vehicleAssign.movilnum===item.movilnum){
                                        //  console.log('+MOVIL:',item.movilnum,found.Poll[0].vehicleAssign.movilnum);
                                          subdata[colItem.accessor].push(founded.vehicleStatus.position);
                                         
                                          var arrayFail = [];

                                          let t1 =[];
                                          let t2 =[];

                                          //FOUND ERROR & PUSH Make fail array
                                          if(founded.result){

                                            t1 = founded.result.sort(dynamicsort("id","desc"));
                                            t2 = founded.result2.sort(dynamicsort("_id","desc"));

                                          t1.map((item,index) => {

                                            if(QuestionArray.length >= 1){

                                                // unitario hacer find
                                              //  find result2 _id
                                              
                                               const fQuery = QuestionArray2.includes(item.id.toString());
                                               if(fQuery){
                                                arrayFail.push({question:t2[index].question,option:founded.result[index].option})
                                               }
                                               //console.log('**',item.id,typeof(item.id),fQuery,QuestionArray2);

                                            }else{
                                                // without question
                                                arrayFail.push({question:t2[index].question,option:founded.result[index].option})
                                            }

                                           /* if(item.option === 0){ // is Fail

                                                // Check if question array is empty
                                                if(QuestionArray.length >= 1){

                                                    // unitario hacer find
                                                  //  find result2 _id
                                                  
                                                   const fQuery = QuestionArray2.includes(item.id.toString());
                                                   if(fQuery){
                                                    arrayFail.push({question:t2[index].question,option:founded.result[index].option})
                                                   }
                                                   console.log('**',item.id,typeof(item.id),fQuery,QuestionArray2);

                                                }else{
                                                    // without question
                                                    arrayFail.push({question:t2[index].question,option:founded.result[index].option})
                                                }
                                              //  console.log('FOUND ERR',founded.result2[index].question,founded.result[index].option)
                                                

                                            }else{

                                                arrayFail.push({question:t2[index].question,option:founded.result[index].option})
                                              //  console.log('NOT FOUND ERR',founded.result2[index].question,founded.result[index].option)

                                            }*/

                                          });
                                        }
                                          subRows[colItem.accessor].push(arrayFail);

                                      }

                                });
                               // console.log('+++++++',found)
                               // subdata[colItem.accessor]=`found date`;
                                
                               // const found2 = found.Poll.find(detail => item.movilnum === PollItem.vehicleAssign.movilnum);
                             //   console.log('+MOVIL:',item.movilnum,found2);

                            }
                         }
     
                     });
                    // console.log(subRows);
                    subdata.subRows.push(subRows);
                    data.push(subdata);
    
                 });
                
             // });
               //  console.log('+final',data)
         //  miPrimeraPromise.then(e=> console.log(e));

             Result.dataTable = {
                 cols,
                 data
             };

             
        //console.log('DetailHistory',JSON.stringify(DetailHistory));

             return res.status(200).json(Result);

          });


    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});

// TEST DE REPORT


//@ POST - Obtiene el reporte de las encuestas realizadas
router.post('/report/test',[
    check('startDate','Error').not().isEmpty(),
    check('endDate','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {startDate,endDate,vehicleAssign,Question,Employee} = req.body;

    console.log(req.body);

    var company = new mongoose.Types.ObjectId(req.user.company);
    const fleetList = req.user.fleetAccess.map(x => new mongoose.Types.ObjectId(x));
    var Result = {
        startDate,endDate,
        QtyIssues:{},
        MonthIssues:{},
        vehicles:[]
    }

    //Check if options empty
    console.log('from out',vehicleAssign,typeof(vehicleAssign),JSON.parse(vehicleAssign),typeof(JSON.parse(vehicleAssign)));
   
    let listVehicle;
    var vehiclesArray = JSON.parse(vehicleAssign);

    if(vehiclesArray.length >= 1){
        var temparry = vehiclesArray.map(x => new mongoose.Types.ObjectId(x.value))
        listVehicle = await Vehicle.find({company,_id:{$in: temparry }}).populate("status brand model").select('_id status movilnum brand model plate color');
    }else{
        listVehicle = await Vehicle.find({company,category:{$in:fleetList}}).populate("status brand model").select('_id status movilnum brand model plate color');
    }

    vehiclesArray = vehiclesArray.length >= 1 ? vehiclesArray.map(x => new mongoose.Types.ObjectId(x.value)) : listVehicle.map(item=>item._id);
    console.log('vehiclesArray',vehiclesArray);

    var QuestionArray = JSON.parse(Question);
    QuestionArray = QuestionArray.length >= 1  ?  QuestionArray.map(x => new mongoose.Types.ObjectId(x.value)) : [];
    console.log('QuestionArray',QuestionArray);

    var EmployeeArray =  JSON.parse(Employee);
    EmployeeArray = EmployeeArray.length >= 1  ? EmployeeArray.map(x => new mongoose.Types.ObjectId(x.value)) : [];
    console.log('EmployeeArray',EmployeeArray);

    console.log(moment(startDate).format('DD/MM/YYYY'),moment(endDate).format('DD/MM/YYYY'));

    var startMonth = moment(endDate);
    
    var endMonth = moment(endDate);
    endMonth.subtract(6,'month');

  //  console.log('BarQuery:',startMonth.format('DD/MM/YYYY'),endMonth.format('DD/MM/YYYY'));

    try {

        var typeQueryStat = {company,
            createAt: {
                $gte: moment(startDate).toDate(),
                $lte: moment(endDate).toDate()
            },
            vehicleAssign:{$in:vehiclesArray}
        };

        if(EmployeeArray.length >= 1){
            console.log('contiene employee')
            typeQueryStat = {
                ...typeQueryStat,
                user:{$in:EmployeeArray}
            }
        }

        if(QuestionArray.length >= 1){
            console.log('contiene Question',QuestionArray)
            typeQueryStat = {
                ...typeQueryStat,
                 "$and": [ {"result":{ $elemMatch:{'option':0}}}, { "question.id":{$in:QuestionArray}} ] 
               
            }
        }

        var StatsQuery = [];

        StatsQuery.push(
            MechanicalHistory.find(typeQueryStat).select('_id status')
        );
        
        StatsQuery.push(
            MechanicalHistory.find({...typeQueryStat,
                "result.option": {$eq:0} 
            }).select('_id status')
        );

        //History Detailed Query
        StatsQuery.push(
            MechanicalHistory.aggregate([
                //{$unwind: '$result'},
                { $match: typeQueryStat },
                { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user'} },
                { $lookup: { from: 'vehicles.status', localField: 'vehicleStatus', foreignField: '_id', as: 'vehicleStatus'} },
                { $lookup: { from: 'vehicles', localField: 'vehicleAssign', foreignField: '_id', as: 'vehicleAssign'} },
                { $lookup: { from: 'mechanical.question', localField: 'result.id', foreignField: '_id', as: 'result2'} },
                { "$unwind": "$user"},
                //{ "$unwind": "$result"},
                {
                 $group : { 
                    _id : { day : {$dayOfMonth : "$createAt"}, year: { $year: "$createAt" },month: { $month: "$createAt" } },
                   // fullDate :  "$createAt",
                    Poll: { $push:  { _id:"$_id",createAt:"$createAt",endAt:"$endAt",user:{_id:"$user._id",name:"$user.name"},
                            result: "$result",
                            result2: "$result2",
                           // resulttest:  { _id:"$result._id",image:"$result.image",observation:"$result.observation",option:"$result.option",question:{$arrayElemAt: [ "$result2.question", 0 ]}  } ,
                            vehicleAssign:{plate:{ $arrayElemAt: [ "$vehicleAssign.plate", 0 ] },color:{ $arrayElemAt: [ "$vehicleAssign.color", 0 ] },movilnum:{ $arrayElemAt: [ "$vehicleAssign.movilnum", 0 ] } },
                            vehicleStatus: {name:{ $arrayElemAt: [ "$vehicleStatus.name", 0 ] },color:{ $arrayElemAt: [ "$vehicleStatus.color", 0 ] },position:{ $arrayElemAt: [ "$vehicleStatus.position", 0 ] }} } },
                    Qty: { $sum: 1 },
                    createAt: { $last: { $dateToString: { format: "%d%m%Y", date: "$createAt" } } }
                    }
                },
                { $sort : { "_id.month" : 1,"_id.day" : 1} },
            ])
            .allowDiskUse(true)
         );

    
        Promise.all(StatsQuery).then( ([ Total, Fails,DetailHistory ]) => {

            console.log('Total found',Total.length);
            console.log('Fails found',Fails.length);

           //{total:Total.length,fail:Fails.length}
          // DetailHistory.map(i=>{ console.log(i.Poll) })

          //console.log(JSON.stringify(DetailHistory))
             var data = [];

             return res.status(200).json(DetailHistory);

          });


    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});





// Generate Poll 
//@ POST - Obtiene el id del vehículo y crea una encuesta a realizar.

router.post('/poll/generate',[
    check('uid','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }


    // Search Poll in Vehicle
    const _idVehicle = new mongoose.Types.ObjectId(req.body.uid);
    const company = new mongoose.Types.ObjectId(req.user.company);
    const _user = new mongoose.Types.ObjectId(req.user.id);
    //STATUS SET OK
    const vehicleStatus = new mongoose.Types.ObjectId('5ec48bd109bcd63cc4c3b13a');

    //console.log(_idVehicle,_user);

    let SelectedPoll = await Poll.findOne({company,vehicleAssign:_idVehicle,status:1}).populate('question.id',['question','description']).exec();
   // console.log(SelectedPoll);
    if(SelectedPoll){
        // found available poll

        // filter
    const QuestionModel = SelectedPoll.question.map(item => {

        return {
            id:new mongoose.Types.ObjectId(item.id._id),
            position:item.position,
        }
    });

    const QuestionApp = SelectedPoll.question.map(item => {
        return {id:item.id._id,question:item.id.question,description:item.id.description,position:item.position}
    });

   // console.log(QuestionModel,QuestionApp);
   const today = moment();

  // console.log(moment(today).subtract(2, 'h').toDate(),today.toDate())

    try {
        
        // IF POLL HISTORY EXIST user/vehicle & today
        const HistoryCheck = await MechanicalHistory.findOne({
            vehicleAssign:_idVehicle,user:_user,status:1,
            createAt: {
                $gte: moment(today).subtract(2, 'h').toDate(),
                $lte: today.toDate()
            }
        },{
            id:'$_id',
            createAt:'$createAt',
            question:[{id:'$question.id',description:'$question.description',position:'$question.position'}]}, { sort: { createAt : -1 } })
        .populate('question.id',['question','description'])
        .select({
            id:'$_id'
        })
        .exec();

        if(HistoryCheck){
            
           // console.log('HISTORYRESULT:',JSON.stringify(HistoryCheck))
           // console.log('----------------------------------------------:')
            const filterHisCheck = HistoryCheck.question.map(i =>{
                return {id:i.id._id,description:i.id.description,question:i.id.question,position:i.position}
            });
           // console.log(filterHisCheck);

            return res.status(200).json({Poll:filterHisCheck,PollID:HistoryCheck._id,createAt:HistoryCheck.createAt});

        }else{

            console.log('not history today')

            let NewMechanicalHistory = new MechanicalHistory({
                status:1,
                company,
                user:_user,
                vehicleAssign:_idVehicle,
                question:QuestionModel,
                result:null,
                createAt: new Date(),
                endAt:null,
                vehicleStatus
            });
    
            await NewMechanicalHistory.save();
    
           // console.log({Poll:QuestionApp,PollID:NewMechanicalHistory._id});
            
            return res.status(200).json({Poll:QuestionApp,PollID:NewMechanicalHistory._id,createAt:NewMechanicalHistory.createAt});

        }


    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }

    }else{

        res.status(204).send('Not Poll');

    }
    
    
});

// Save APP Poll 
//@ POST - Guarda la encuesta generada previamente con imagenes y resultados

router.post('/poll/save',
 upload.array('gallery'),
[check('result','Error').not().isEmpty(),check('pollID','Error').not().isEmpty()],auth,
    async (req,res)=>{

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const company = new mongoose.Types.ObjectId(req.user.company);
    const _user = new mongoose.Types.ObjectId(req.user.id);
    const _pollID = new mongoose.Types.ObjectId(req.body.pollID);
    //console.log('SAVING',req.body)
   // console.log('files:',req.files.length);
    
    var ResultArray = JSON.parse(req.body.result);
    //console.log(ResultArray);
    //var filesProm = [];
    console.log(req.files.length);
    if(req.files){

        for (const [index, itemFile] of req.files.entries()) {
        const timestamp = Date.now();
        // Limpiamos el nombre original y aseguramos la extensión .jpg
        const originalNameClean = itemFile.originalname.split('.').slice(0, -1).join('_').replace(/\s/g, '_');
        const filename = `${timestamp}_${originalNameClean}.jpg`;

        // Subir imagen original
        await putObjectS3(itemFile.buffer, filename, "mechanical");

        // Crear y subir la versión optimizada con sharp
        const resized = await sharp(itemFile.buffer)
            .resize({ width: 1000 }) // Redimensiona a 1000px de ancho, manteniendo aspect ratio
            .jpeg({ quality: 70 })   // Asegura el formato JPEG con 70% de calidad
            .toBuffer();
        
        await putObjectS3(resized, `xs_${filename}`, "mechanical");
        
        ResultArray[index].image = filename;
    }

    }

    try {

        const StatusRelFail = new mongoose.Types.ObjectId('5ec48bd109bcd63cc4c3b13c');
        const StatusRelOk = new mongoose.Types.ObjectId('5ec48bd109bcd63cc4c3b13a');
        
        var vehicleStatus = StatusRelOk;

        // if fail change status of vehicle
        const found = ResultArray.find(element => element.option === 0);
        if(found){
            // Refs Taller core.section
            const section = new mongoose.Types.ObjectId('5e63fb82a75acb4b587e65da');

            // change status vehicle
            vehicleStatus = StatusRelFail;
            const vehicleId = await  MechanicalHistory.findOne({ _id: _pollID }).populate('vehicleAssign').select('vehicleAssign').exec();
            const filter = { _id: vehicleId.vehicleAssign._id };
            const update = { status: vehicleStatus };

            const VehicleUpdate = await Vehicle.updateOne(filter, update).exec();

            console.log(found);
            // Generate Notification
            var obsText = found.observation ? `Obs.: ${found.observation}` : '';

            let NewNotify = new CompanyNotification({
                status:1,
                company,
                topic:`Se encontró una falla en el vehículo ${vehicleId.vehicleAssign.movilnum}. ${obsText}`,
                vehicleAssign:vehicleId.vehicleAssign,
                codeError:5,
                section,
            });

            await NewNotify.save();
            
        }

        var ResultArray = ResultArray.map(item => {

            data = {
                id: new mongoose.Types.ObjectId(item.id),
                option:item.option,
                editAt: item.editAt,
            }

            if(item.option === 0){
                data.image = item.image;
                data.observation = item.observation;
            }

           return data;
        })

        //console.log('>>>>',ResultArray);
        data = { $set:{
            status: 2,
            endAt: new Date(),
            result:ResultArray,
            vehicleStatus
        }};

        const PollQuery = await  MechanicalHistory.findByIdAndUpdate({_id: _pollID}, data, { new:  true, runValidators:  true });
       // console.log(PollQuery);
        return res.status(200).json({status:2})

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});

// Retrieve History 
//@ GET - Obtiene el historial de las encuestas realizadas

router.get('/poll/user/list',auth, async (req,res) => {

    //console.log('CALL');
    const company = new mongoose.Types.ObjectId(req.user.company);
    const _user = new mongoose.Types.ObjectId(req.user.id);

    try {
        
        const QueryHistory = await MechanicalHistory.find({user:_user,company}).populate('vehicleAssign').select('status _id vehicleAssign createAt endAt')
        .sort({createAt:-1}).limit(50).exec();
        
        return res.status(200).json(QueryHistory);

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});

module.exports = router;