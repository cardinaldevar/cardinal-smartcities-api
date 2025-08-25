const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const User = require('../../models/User');
const CompanyNotification = require('../../models/CompanyNotification');
const Vehicle = require('../../models/Vehicle');
const mongoose = require('mongoose');
require('dotenv').config();


//@route POST api/panic
//@Desc Create or update
//@access Private
router.post('/',auth,[
    check('deviceID', 'Device required').not().isEmpty(),
],async (req,res)=>{

    console.log('PANIC:',req.body)

    const errors = validationResult(req);
    if(!errors.isEmpty()){
        return res.status(400).json({error:errors.array() });

    }

    const {deviceID,idPanic,Lat,Lng} = req.body;
    
    //search vehicle company
    const VehicleDoc = await Vehicle.findOne({DeviceID: {$eq:deviceID}})
      .populate("brand model")
      .select("DeviceID plate movilnum color category company _id")
      .then((result) => {
          return result;
      });
    
      const companyID = new mongoose.Types.ObjectId(VehicleDoc.company);
     // console.log(VehicleDoc);

      // GET USERS OF COMPANY
      const UserDoc = await User.find({company: {$eq:companyID},panicAlert:true,status:1})
      .select("phone email name fleetAccess category _id")
      .then((result) => {
          return result;
      });

     // console.log(UserDoc)

    // AWS SNS sms 
    var AlertSMS = [];
    if(UserDoc.length >= 1){

        UserDoc.map(userItem =>{

            if(userItem.phone){
                userItem.phone.map(cellphone => {
                    console.log(cellphone);
                    AlertSMS.push( new AWS_SMS.SNS({ apiVersion: '2010-03-31' }).publish({
                        Message: `El Interno ${VehicleDoc.movilnum}. Accionó el botón de pánico.`,
                        PhoneNumber: `+${cellphone}`,
                        MessageAttributes: {
                            'AWS.SNS.SMS.SenderID': {
                                'DataType': 'String',
                                'StringValue': 'Alerta',
                            }
                        }
                    }).promise());

                })
            }

        })

    }
    
    
    try {

        let NewNotify = new CompanyNotification({
            status:1,
            company:companyID,
            topic:`El Interno ${VehicleDoc.movilnum}. Accionó el botón de pánico.`,
            vehicleAssign:new mongoose.Types.ObjectId(VehicleDoc._id),
            codeError:9,
            section:new mongoose.Types.ObjectId('5efbd860a848dc5790c2797f'),
        });

        console.log('sending SMS');
        // SEND SMS
        Promise.all(AlertSMS).then(values => { 
            values.map(i=> console.log('sms sent:',i.MessageId))
        });

        await NewNotify.save();

        return res.status(200).json({status:'ok'});

    } catch (error) {
        console.error(error);
        res.status(500).send('server error');
    }

})

module.exports = router;