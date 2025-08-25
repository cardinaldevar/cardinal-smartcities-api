const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId,auto:true },
    DeviceID:{type:String,default:null},
    brand:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'vehicles.brand'
    },
    model:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'vehicles.model'
    },
    plate:{type:String,default:null},
    movilnum:{ type:String },
    color:{type:String, default:'ffffff'},
    category:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'vehicles.category'
    },
    type:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'vehicles.type'
    },
    company:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company'
    },
    status:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'vehicles.status'
    },
    createAt:{ type: Date, default: Date.now},
    name:{ type:String }
});

module.exports = Vehicle = mongoose.model('vehicles', vehicleSchema);