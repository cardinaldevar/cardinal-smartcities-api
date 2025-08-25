const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const GpsData = require('../../models/GpsData');
const Vehicle = require('../../models/Vehicle');
const moment = require('moment');
const mongoose = require('mongoose');

// @route Get api/Report
//@route POST api/Report/fleetList
//@Desc  Get Available Searchs Fleet
//@access Private

router.post('/fleet',[
    check('data','No posee Flotas autorizadas').not().isEmpty()
],auth, async (req,res) => {
    
  //  console.info(req.body);
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
   // const fleetList = req.body.fleetAccess;
   
    const ImportData = req.body.data.map(item => {
      return {
        DeviceID:0,
        brand: new mongoose.Types.ObjectId(item.brand),
        model: new mongoose.Types.ObjectId(item.model),
        plate:item.plate,
        movilnum:`${item.movilnum}`,
        color:'ffffff',
        category:new mongoose.Types.ObjectId(item.category),
        company:new mongoose.Types.ObjectId('5eb4b361e2c70b15e8d5a4d1'),
        status:1,
        type: new mongoose.Types.ObjectId(item.type)
      }
    })

    console.log(ImportData);
    try{
         
      
      Vehicle.insertMany(ImportData)
    // CHECK IF EXIST
       
        return res.status(200).json({data: ''});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

router.get('/status',auth, async (req,res) => {
  
//  console.info(req.body);
  try{
       
    
   // Vehicle.insertMany(ImportData)

    Vehicle.updateMany(
      {  },
      { $set: { status: new mongoose.Types.ObjectId('5ec48bd109bcd63cc4c3b13a') } },
      function(err, result) {
        if (err) {
          res.send(err);
        } else {
          res.send(result);
        }
      }
    );
     
      return res.status(200).json({data: ''});

  }catch(err){
      console.error(err.message);
      res.status(500).send('server error');
  }
});



module.exports = router;