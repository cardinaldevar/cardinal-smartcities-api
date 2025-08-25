const mongoose = require('mongoose');

const InvoiceSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto: true  },
    createAt:{ type: Date, default: Date.now},
    lastUpdate:{ type: Date, default: null},
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
});

InvoiceSchema.index({ createAt:-1,imei:1 });

module.exports = Invoice = mongoose.model('iot.live',InvoiceSchema);