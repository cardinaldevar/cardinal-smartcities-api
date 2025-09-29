const mongoose = require('mongoose');

const IotHistorySchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto: true  },
    createAt:{ type: Date, default: Date.now},
    reportedAt: { type: Date, required: true }, 
    imei:{ type: String, default: null},
    temperature:{type: Number,default:0},
    value:{type: Number,default:0},
    full_alarm:{type: Number,default:0},
    fire_alarm:{type: Number,default:0},
    tilt_alarm:{type: Number,default:0},
    battery_alarm:{type: Number,default:0},
    volt:{type: Number,default:0},
    angle:{type: Number,default:0},
    rsrp:{type: String,default:0},
    frame_counter:{type: Number,default:0},
    location:{
        type: { type: String, enum: ['Point'], required: true},
        coordinates: { type: Array, required: true},
    },
    uid:{type: String}, //value for cardinal device
    s1:{type: Number,default:null}, //value for cardinal device
    s2:{type: Number,default:null}, //value for cardinal device
    heartbeat: { type: Date,default:null }
});

IotHistorySchema.index({ imei: 1,createAt:-1 });

module.exports = IotHistory = mongoose.model('iot.history',IotHistorySchema);