const mongoose = require('mongoose');
const moment = require('moment');
const UserTime = require('./models/UserTime');
moment.locale('es');
const cron = async () =>{

    let datenow = moment().utcOffset(-3);
    
    console.log('desde',moment(datenow).subtract(1,'day').startOf('D').toDate(),
    moment(datenow).endOf('D').toDate());

    try{

      //  console.log('DATE',datenow.set({'h':00, 'm':00, 's':00}).format('DD MM YYYY HH:mm:ss'),datenow.set({'h':23, 'm':59, 's':00}).format('DD MM YYYY HH:mm:ss'))
        // GET ALL DATA BIOMETRIC CONNECTED
        const biometricData = await UserTime.aggregate([
            { $match: {
               // user_id: {$in:response.map(i=>i.user_id)},
                access_in: {
                    $gte: moment().subtract(1,'day').startOf('D').utcOffset(-3).toDate(),
                    $lte: moment().endOf('D').utcOffset(-3).toDate()
                },
                access_out:{$eq:null}
            } },
           { $lookup: { from: 'users.access', localField: 'user_id', foreignField: 'user_id', as: 'userAccess'} },
        { $unwind:{path:"$userAccess",preserveNullAndEmptyArrays:true}},
        {
            $group:
              {
                _id: '$user_id',
                access_id: { $last: '$_id' },
                access_in: { $last: '$access_in' },
                access_out: { $last: '$access_out' },
                comment: { $last: '$comment' },
                userAccess: { $last: '$userAccess._id' },
              }
           },
           { $lookup: { from: 'employee', localField: 'userAccess', foreignField: 'userBiometric', as: 'employeeDetail' } },
           { $unwind:{path:"$employeeDetail",preserveNullAndEmptyArrays:true}},
           { $lookup: { from: 'employee.workshift', localField: 'employeeDetail.workShift', foreignField: '_id', as: 'employeeWorkShift' } },
           { $unwind:{path:"$employeeWorkShift",preserveNullAndEmptyArrays:true}},
           {
            $project: {
                user_id: '$_id',
                access_id: 1,
                access_in: 1,
                access_out: 1,
                comment: 1,
                employeeWorkShift: 1
            }},
            {
              $addFields: {
                "employeeWorkShift.timeAssign": {
                  $filter: {
                    input: "$employeeWorkShift.timeAssign",
                    as: "assign",
                    cond: {
                      $eq: ["$$assign.day", moment().day()],
                    },
                  },
                },
              },
            }
        
        ])
       // .sort({user_id:1})
        .allowDiskUse(true)
        .then(function (res) {
          console.log(JSON.stringify(res))
            return res;
        });
        
       
        var dataUpdate = [];
        

        if(biometricData.length >= 1){

          //  biometricData
          // CHECK IF ACCESS IN HASTA AHORA SUPERA LAS 12 hrs
          biometricData.map(item =>{

            let startTurn = null;
            let endTurn = null;
            var dateNow = moment().utcOffset(-3);
            let access_in = moment(item.access_in).utcOffset(-3);

            if(item.employeeWorkShift.timeAssign && item.employeeWorkShift.timeAssign.length >= 1){

              startTurn = moment(item.employeeWorkShift.timeAssign[0].from).utcOffset(-3);
              startTurn.set({
                year: moment().utcOffset(-3).year(),
                month: moment().utcOffset(-3).month(),
                date: moment().utcOffset(-3).date()
              });

              endTurn = moment(item.employeeWorkShift.timeAssign[0].to).utcOffset(-3);
              endTurn.set({
                year: moment().utcOffset(-3).year(),
                month: moment().utcOffset(-3).month(),
                date: moment().utcOffset(-3).date()
              });

              //EVAL IF DATE IS NEXTDAY
              if(item.employeeWorkShift.timeAssign[0].nextDay){
                endTurn.add(1,'day')
              }

             // dateNow.add(3,'h');
              endTurn.add(3,'h')
              const clonestartTurn = startTurn.clone();
              const cloneendTurn = endTurn.clone();
              const clonedateNow = dateNow.clone();

              console.log('* EVALUA ------------------------','next day',item.employeeWorkShift.timeAssign[0].nextDay,'ingreso',access_in.clone().format("DD/MM HH:mm"))
              console.log('* >','ingreso',access_in.clone().format("DD/MM HH:mm"),'next day',item.employeeWorkShift.timeAssign[0].nextDay)
              console.log('dateNow',clonedateNow.utcOffset(-3).format("DD/MM HH:mm"),'Turno:',item.employeeWorkShift.name,cloneendTurn.utcOffset(-3).format("DD/MM HH:mm"))
              console.log('NOW:',clonedateNow.utcOffset(-3).format("DD/MM HH:mm"),'startTurn',clonestartTurn.utcOffset(-3).format("DD/MM HH:mm"),'endturn',cloneendTurn.utcOffset(-3).format("DD/MM HH:mm"))
              console.log('IF dateNow:',dateNow.clone().format("DD/MM HH:mm"),'endTurn',endTurn.clone().format("DD/MM HH:mm"))
              if (dateNow.isSameOrAfter(endTurn)) {

                console.log('----> SUPERA access_id',item.access_id);

                dataUpdate.push( {
                  updateOne: {
                    filter: { _id: new mongoose.Types.ObjectId(item.access_id)},
                    update: { $set:{
                              forceClose: true,
                              access_out: moment().utcOffset(-3).toDate(),
                              comment:`Cierre automático`  
                          }
                      }
                  }
                });

              }else{
                console.log('----> ENTRE VALORES');
              }
              console.log('********************************************************');
              
            }else{
              console.log('NO item.employeeWorkShift.timeAssign',item.access_id)
            }

          /*  

            console.log(checkAccess)

            var dateofvisit = moment(item.access_in, 'DD-MM-YYYY');
            var today = moment().utcOffset(-3);
            
            console.log(dateofvisit.format('DD MM YYYY HH MM ss'))
            console.log(today.diff(dateofvisit, 'h'))

            if(today.diff(dateofvisit, 'h') >= 12){
                //Close work day
                console.log('/Close work day')
                
                

            }*/

          })

          console.log('dataUpdate',JSON.stringify(dataUpdate))

            UserTime.bulkWrite(dataUpdate).then(res => {
             // console.log(res.insertedCount, res.modifiedCount, res.deletedCount);
            });

    }

       // return res.status(200).json([]);
        

    }catch(err){
        console.error(err.message);
    }
    
 }

module.exports = cron;