const mongoose = require('mongoose');

const CompanyNotificationSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto: true },
    topic:{ type:String },
    section:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'core.section'
    },
    company:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company'
    },
    vehicleAssign:{ 
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'vehicles'
    },
    status:{type:Number,default:0},
    codeError:{type:Number,default:0},
    createAt:{
        type: Date,
        default: Date.now
    }
});

module.exports = CompanyNotification = mongoose.model('company.notification', CompanyNotificationSchema);