const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const GpsData = require('../../models/GpsData');
const moment = require('moment');
const mongoose = require('mongoose');

//@route GET api/position/
//@Desc List
//@access Private
router.post('/',auth, async (req,res) => {

   /* const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });
    }*/

    company = new mongoose.Types.ObjectId(req.user.company)
    console.log(new Date(1584667600000));
    try {
        
       /* const response = await GpsData.findOne( { 
              //  DateConv: {$gte:new Date("2018/02/01"),$lte:new Date("2020/02/01")}
            } )
        .sort({DateConv:1})
        .then(function (res) {
            return res;
        });*/

        return res.status(200).json(response)

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
});


router.post('/delete',auth, async (req,res) => {

    /* const errors = validationResult(req);
     if(!errors.isEmpty()){
         return res.status(400).json({error:errors.array() });
     }*/
 
     
    company = new mongoose.Types.ObjectId(req.user.company)
    console.log(moment([2020, 02, 01]).format('DD MM YYYY'));
    try {
        
        const response = await GpsData.find( { 
               dateConv: {$lte:moment([2020, 01, 01]).toDate(),$lte:moment([2020, 02, 01]).toDate()}
            } )
        .maxTimeMS(300000)  
        .limit(10);
        
        return res.status(200).json(response)

    } catch (error) {
        
        console.error(error.message);
        res.status(500).send('server error');

    }
 });



module.exports = router;