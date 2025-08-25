const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const Profile = require('../../models/Profile');
const Vehicle = require('../../models/Vehicle');
const VehicleCategory = require('../../models/VehicleCategory');
const Live = require('../../models/LiveData');
const Company = require('../../models/Company');
const User = require('../../models/User');
const CompanyNotification = require('../../models/CompanyNotification');
const mongoose = require('mongoose');

// @route Get api/profile/me
//@Desc Get current user profile

router.get('/me',auth, async (req,res) => {
    try{
        const profile = await Profile.findOne({user: req.user.id}).populate('user',['name','avatar'])
        if(!profile){
            return res.status(400).json({msg:'No profile user'});
        }
        res.json(profile);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }
});

//@route GET api/dashboard/
//@Desc Create or update
//@access Private

router.get('/',[auth,[
  //  check('company', 'Failed Permission').not().isEmpty(),
]],async (req,res)=>{

    //GET COMPANY
    const company = new mongoose.Types.ObjectId(req.user.company);
    
    try{

        const VehicleQuery = await Vehicle.find({company: {$eq:company},status: {$ne:new mongoose.Types.ObjectId("61106beedce13f38b602bf51")}})
        .select()
        .then((result) => {
            return result;
        });

        const CategoryQuery = await VehicleCategory.find({status: {$gt:0},company: {$eq:company}})
        .exec()
        .then((result) => {
            return result.length;
        });

        const DeviceLive = VehicleQuery.map(item=>`${item.DeviceID}`);
        var start = new Date();
        start.setHours(start.getHours() - 6);
        var end = new Date();
        end.setHours(end.getHours() + 1);
        //console.log(new Date(),start,end)

        const VehicleLiveQuery = await Live.aggregate([
            { $match: { 
                deviceID: {$in:DeviceLive},
                dateConv:{$gte: start, $lt: end}
            }, },
            {
                $project: {
                    _id: '$_id',
                    DeviceID: '$deviceID',
                    DateConv: '$dateConv'
                }
            },
            { $sort:{DeviceID:1}},
        ])
        .allowDiskUse(true)
        .then(function (res) {
           // console.log(res);
            return res;
        });

        // status obj 
        const repair = new mongoose.Types.ObjectId("5ec48bd109bcd63cc4c3b13c");
        const VehicleRepairQuery = await Vehicle.aggregate([
            { $match: { 
                DeviceID: {$in:DeviceLive},
              //  dateConv:{$gte: start, $lt: end},
                status:repair
            }, },
            {
                $project: {
                    _id: '$_id',
                    DeviceID: '$DeviceID'
                }
            },
            { $sort:{DeviceID:1}},
        ])
        .allowDiskUse(true)
        .then(function (res) {
           // console.log(res);
            return res;
        });

    //  console.log('Vehiculos:'+VehicleQuery.length,"CON DATA:"+VehicleLiveQuery.length);
        const dashboard = {
            VehicleCount: VehicleQuery.length,
            CategoryCount: CategoryQuery,
            VehicleLiveCount:VehicleLiveQuery.length,
            VehicleMechanical:VehicleRepairQuery.length
        }
        
        return res.status(200).json(dashboard);

    }catch(err){
        console.error(err.message);
        res.status(500).send('server error');
    }


});

router.get('/notice',auth,async (req,res)=>{
  
      //GET COMPANY
      const company = new mongoose.Types.ObjectId(req.user.company);
    
      try{
  
          const NotificationQuery = await CompanyNotification.aggregate([
              { $match: { 
                  company: {$eq:company}
              }, },
              { $lookup: { from: 'vehicles', localField: 'vehicleAssign', foreignField: '_id', as: 'vehicle'} },
              { $lookup: { from: 'core.section', localField: 'section', foreignField: '_id', as: 'section'} },
              {
                  $project: {
                      _id: '$_id',
                      topic: '$topic',
                      status: '$status',
                      codeError: '$codeError',
                      vehicle: {$arrayElemAt: [ "$vehicle", 0 ]},
                      section: {$arrayElemAt: [ "$section", 0 ]},
                      createAt: '$createAt',
                  }
              },
              { $sort:{createAt:-1}},
              { $limit : 15 }
          ])
          .allowDiskUse(true)
          .then(function (res) {
              //console.log(res);
              return res;
          });
  
          return res.status(200).json(NotificationQuery);
  
      }catch(err){
          console.error(err.message);
          res.status(500).send('server error');
      }
  
});



router.get('/menu',[auth],async (req,res)=>{
  
      try{
  
        const userData = await User.findById(req.user.id).select('access').populate('access.id'); 
     //   console.log(JSON.stringify(user));
        
       let menu = userData.access.map(i => {
            return {
                permission:i.value,
                name:i.id.name,
                nameField:i.id.nameField,
                position:i.id.position, 
                _id:i.id._id
            }
        });

        const menuSort = menu.sort((a, b) => a.position - b.position);

        return res.status(200).json(menuSort);
  
      }catch(err){
          console.error(err.message);
          res.status(500).send('server error');
      }
  
  
  });

module.exports = router;