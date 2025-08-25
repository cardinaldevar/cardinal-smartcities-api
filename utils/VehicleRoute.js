const mongoose = require('mongoose');
const moment = require('moment');
const GpsData = require('../models/GpsData');
const Vehicle = require('../models/Vehicle');
const VehicleStat = require('../models/VehicleStat');

const VehicleRoute = async () =>{ 

   /* let dateStart = moment('2022-10-15 10:00').utcOffset(-3).toDate();
    let dateEnd = moment('2022-10-15 10:10').utcOffset(-3).toDate();
*/
    let dateStartBefore = moment().subtract(1,'h').startOf('h').toDate();
    let dateEndBefore = moment().subtract(1,'h').endOf('h').toDate();

    let dateStart = moment().startOf('h').toDate();
    let dateEnd = moment().endOf('h').toDate();
    
    console.log('-BEFORE',dateStartBefore)
    console.log('-AFTER',dateStart)
    // GET VEHICLE ACTIVES
    const VehiclesList = await Vehicle.aggregate([
      { $match: { 
          status: {$ne:new mongoose.Types.ObjectId("61106beedce13f38b602bf51")},
          DeviceID: {$ne:0},
        // DeviceID : {$eq:"121181261519"}
      }, },
      {
          $project: {
              _id: '$_id',
              deviceID: '$DeviceID',
              company: "$company",
              movilnum:'$movilnum',
          }
      },
      { $sort:{deviceID:1}},
  ])
  .allowDiskUse(true)
  .then(function (res) {
     // console.log(JSON.stringify(res));
      return res;
    });
  //  console.log('>>>>>>>> AFTER',dateStartBefore,dateEndBefore)
   // console.log('>>>>>>>>',dateStart,dateEnd)

    //let vehicleQ = VehiclesList.map(i=>i.deviceID)
   // console.log('-',JSON.stringify(vehicleQ))
    
    const promisesData = VehiclesList.map(v => {

            return new Promise(async (resolve, reject) => {

              let lastStat = await VehicleStat.findOne({ deviceID:{$eq:v.deviceID},dateAt: { $lte: dateEndBefore } }).sort({dateAt:-1}).limit(1).exec();
              let after = await GpsData.findOne({  deviceID:{$eq:v.deviceID},statusGps:"A",dateConv: { $gte: dateStart, $lte: dateEnd } }).sort({dateConv:-1}).limit(1).exec();
                  resolve({lastStat,after,company:v.company});

            });

          }) 
          
         let resData = await Promise.all(promisesData).then((values) => {
          //  console.log(values);
           
            return values
          });

      //  console.log('values',JSON.stringify(resData))

          
          const ImportData = [];
          
          resData.map(item => {
            
            let mileageDiff = 0;

            if(item.lastStat && item.after){
            //  console.log('IN BEFORE AFTER')
              mileageDiff = item.after.mileage ? ((item.after.mileage / 1000) - (item.lastStat.mileage)).toFixed(2) : 0;
            }
            /*else if(!item.before && item.after){
              mileageDiff = item.after.mileage ? (item.after.mileage / 1000).toFixed(2) : 0;
            }*/

           // console.log(item.after ? item.after.deviceID : '-',mileageDiff)
            //search deviceID for company

            if(item.after){

              ImportData.push({
                deviceID:item.after.deviceID,
                company: new mongoose.Types.ObjectId(item.company),
                fuel:item.after.fuel,
                mileage:item.after ? item.after.mileage / 1000 : 0,
                panic:item.after.panic,
                alert:item.after.alert,
                mileageDiff:parseFloat(mileageDiff), // in kms
                dateAt:item.after.dateConv,
                history: new mongoose.Types.ObjectId(item.after._id),
              });

            }
            
          })
      //  console.log('ImportData',JSON.stringify(ImportData))

          VehicleStat.insertMany(ImportData);

}

module.exports = VehicleRoute;