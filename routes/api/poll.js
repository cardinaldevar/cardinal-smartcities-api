const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Poll = require('../../models/Poll');
const PollQuestion = require('../../models/PollQuestion');
const moment = require('moment');
const mongoose = require('mongoose');

//@route GET api/poll/
//@Desc List
//@access Private
router.get('/',auth, async (req,res) => {

    company = new mongoose.Types.ObjectId(req.user.company)

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
                    vehicleAssign: "$vehicle" ,
                    status: "$status",
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

//@route POST api/poll/add
//@Desc Create or update
//@access Private
router.post('/add',[
    check('status','Error').not().isEmpty(),
    check('title','Error').not().isEmpty()
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {status,title,vehicle,question} = req.body;

    const company = new mongoose.Types.ObjectId(req.user.company)
    
    const vehicleAssignList = vehicle.map(x => new mongoose.Types.ObjectId(x));
    const questionList = question.map((x,index) => { return {id:new mongoose.Types.ObjectId(x.value),position:index } });
    
    try {
        
        let NewPoll = new Poll({
            status,
            title,
            company,
            vehicleAssign:vehicleAssignList,
            question:questionList
        });
        // CHECK IF EXIST
        await NewPoll.save();
        return res.status(200).json({created:NewPoll})

    } catch (error) {
        
        console.error(err.message);
        res.status(500).send('server error');

    }
});


// CHANGE USER STATUS
router.post('/status',[
    check('id','shit happens').not().isEmpty(),
    check('status','shit happens').not().isEmpty()
  ],auth, async (req,res) => {
  
    const errors = validationResult(req);
  
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
  
    const {id,status} = req.body;
    const pollID = new mongoose.Types.ObjectId(id);
    
    data = {
        $set:{
      status
    }};
  
    try{
        
        const pollQuery = await Poll.findByIdAndUpdate({_id: pollID}, data, { new:  true, runValidators:  true })
        return res.status(200).json(pollQuery)
  
    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
  
  
});

//@route POST api/poll/question/add
//@Desc Create or update
//@access Private
router.post('/question/add',[
    check('question','Error').not().isEmpty(),
    check('description','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {question,description,id} = req.body;
    company = new mongoose.Types.ObjectId(req.user.company);
    var idUpdate;
    if(id){
       var idUpdate = new mongoose.Types.ObjectId(id);
    }

    try{
        
        if(idUpdate){
            // is update

            let UpdateData = {
                question,
                description
              };
              
              await PollQuestion.updateOne({ _id: idUpdate }, UpdateData).exec();
            return res.status(200).json({created:true});

        }else{

            // is new
            let NewQuestion = new PollQuestion({
                question,
                description,
                company
            });
            // CHECK IF EXIST
            await NewQuestion.save();
            return res.status(200).json({created:NewQuestion})
        }
  
    }catch(err){

        console.error(err.message);
        res.status(500).send('server error');

    }

});


//@route POST api/poll/load
//@Desc Create or update
//@access Private
router.post('/load',[
    check('uid','Error').not().isEmpty(),
],auth, async (req,res) => {

  //  console.log('call load init')
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {uid} = req.body;
    const company = new mongoose.Types.ObjectId(req.user.company);
    var idUpdate = new mongoose.Types.ObjectId(uid);

    try{
        
        const PollLoad = await Poll.findOne({ _id: idUpdate }).exec();
       // console.log(PollLoad);
        return res.status(200).json(PollLoad);
  
    }catch(err){

        console.error(err.message);
        res.status(500).send('server error');

    }

});

//@route POST api/poll/edit
//@Desc Create or update
//@access Private
router.post('/edit',[
    check('uid','Error').not().isEmpty(),
    check('status','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {status,title,vehicleAssign,question,description,uid} = req.body;

    var company = new mongoose.Types.ObjectId(req.user.company);
    var PollID = new mongoose.Types.ObjectId(uid);

    vehicleAssignArr = JSON.parse(vehicleAssign);
    questionArr = JSON.parse(question);
    
    const vehicleAssignList = vehicleAssignArr.map(x => new mongoose.Types.ObjectId(x.value));
    const questionList = questionArr.map((x,index) => { return {id:new mongoose.Types.ObjectId(x.id),position:index } });

    try{


        let UpdateData = {
            status,
            title,
            company,
            vehicleAssign: vehicleAssignList,
            question: questionList
          };
          
          await Poll.updateOne({ _id: PollID }, UpdateData).exec();
        return res.status(200).json({created:true});
  
    }catch(err){

        console.error(err.message);
        res.status(500).send('server error');

    }

});

//@route POST api/poll/question/del
//@Desc Delete
//@access Private
router.post('/question/del',[
    check('id','Error').not().isEmpty(),
],auth, async (req,res) => {

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }

    const {id} = req.body;
    company = new mongoose.Types.ObjectId(req.user.company)

    try{
        
        await PollQuestion.findOneAndRemove({_id: id,company:company});
        return res.status(200).json();
  
    }catch(err){

        console.error(err.message);
        res.status(500).send('server error');

    }

});

//@route GET api/poll/question/list
//@Desc LIST
//@access Private
router.get('/question/list',auth, async (req,res) => {

    company = new mongoose.Types.ObjectId(req.user.company)

    try{

        const QuestionQuery = await PollQuestion.find({company: {$eq:company}})
        .select('_id question description')
        .sort('question')
        .then((result) => {

            return result;
        });

        let ArrFilter = QuestionQuery.map(item => {return {id:item._id,content:item.question,description:item.description} })
        //console.log(ArrFilter)
        return res.status(200).json(ArrFilter);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }

});



module.exports = router;