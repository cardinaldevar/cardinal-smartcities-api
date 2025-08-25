const mongoose = require('mongoose');
const moment = require('moment');
//moment.locale('es');
const cron = async () =>{

    let datenow = moment().utcOffset(-3);
    
    //console.log(datenow.subtract(1,'d').set({'h':00, 'm':00, 's':00}).toDate(),
    //datenow.set({'h':23, 'm':59, 's':00}).toDate());

    try{

      //  console.log('DATE',datenow.set({'h':00, 'm':00, 's':00}).format('DD MM YYYY HH:mm:ss'),datenow.set({'h':23, 'm':59, 's':00}).format('DD MM YYYY HH:mm:ss'))
        // GET ALL DATA BIOMETRIC CONNECTED
        const biometricData = await UserTime.aggregate([
            { $match: {
               // user_id: {$in:response.map(i=>i.user_id)},
                access_in: {
                    $gte: datenow.subtract(1,'d').set({'h':00, 'm':00, 's':00}).toDate(),
                    $lte: datenow.set({'h':23, 'm':59, 's':00}).toDate()
                },
                access_out:{$eq:null}
            } },
        // { $lookup: { from: 'users', localField: 'userAccess', foreignField: '_id', as: 'userAccess'} },
        // { $lookup: { from: 'users', localField: 'technicalAssigned', foreignField: '_id', as: 'technicalAssigned'} },
        {
            $group:
              {
                _id: '$user_id',
                access_id: { $last: '$_id' },
                access_in: { $last: '$access_in' },
                access_out: { $last: '$access_out' },
                comment: { $last: '$comment' },
              }
           }
        ])
       // .sort({user_id:1})
        .allowDiskUse(true)
        .then(function (res) {
            return res;
        });
        
        var dataUpdate = [];
        if(biometricData.length >= 1){

          //  biometricData
          // CHECK IF ACCESS IN HASTA AHORA SUPERA LAS 12 hrs
          let updateData = biometricData.map(item =>{

            let checkAccess = moment(item.access_in).utcOffset(-3).to(moment().utcOffset(-3));

            console.log(checkAccess)

            var dateofvisit = moment(item.access_in, 'DD-MM-YYYY');
            var today = moment().utcOffset(-3);
            
            console.log(dateofvisit.format('DD MM YYYY HH MM ss'))
            console.log(today.diff(dateofvisit, 'h'))

            if(today.diff(dateofvisit, 'h') >= 12){
                //Close work day
                console.log('/Close work day')
                
                dataUpdate.push( {
                        updateOne: {
                          filter: { _id: new mongoose.Types.ObjectId(item.access_id)},
                          update: { $set:{
                                    forceClose: true,
                                    access_out: moment().utcOffset(-3).toDate(),
                                    comment:`${item.comment} - Cierre automático`  
                                }
                            }
                        }
                      });

            }

          })

        }
       
        UserTime.bulkWrite(dataUpdate).then(res => {
             // console.log(res.insertedCount, res.modifiedCount, res.deletedCount);
        });

       // return res.status(200).json([]);
        

    }catch(err){
        console.error(err.message);
    }
    
 }

module.exports = cron;