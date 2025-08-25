const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Zone = require('../../models/Zone');
const moment = require('moment');
const mongoose = require('mongoose');

//@route POST api/zone
//@Desc Get Zones in Authorized users 
//@access Private

router.post('/',[
    check('user','Error de ingreso').not().isEmpty()
],auth, async (req,res) => {
    
    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const {user} = req.body;
    userId = new mongoose.Types.ObjectId(user);

    try{
    
        const Zones = await Zone.findOne({ user: userId })
        //.select("_id zone status user")
        .then((result) => {
            return result ? JSON.parse(result.zone) : null;
            
        });
        
        return res.status(200).json({data: Zones ? Zones : {type: 'FeatureCollection',features: []} });

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});


//@route POST api/zone/save
//@Desc Save Zones Authorized users 
//@access Private

router.post('/save',[
    check('zone','No posee zonas autorizadas').not().isEmpty(),
    check('user','Error de ingreso').not().isEmpty()
],auth, async (req,res) => {
    
  //  console.info(req.body);

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({errors: errors.array()});
    }
    
    const {zone,user} = req.body;
    userId = new mongoose.Types.ObjectId(user);
    zoneString = JSON.stringify(zone);
    //console.log(user);

    //SEARCH ZONE

    const searchzone = await Zone.findOneAndDelete({ user: userId }, function (err) {
            if(err) console.log(err);
           // console.log("Successful deletion");
        });

    try{
    
        zoneData = new Zone({
            zone:zoneString,
            status:1,
            public:false,
            user:userId
        });
        await zoneData.save();

        return res.status(200).json({zones: []});

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

module.exports = router;