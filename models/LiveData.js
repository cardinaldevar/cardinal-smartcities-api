const mongoose = require('mongoose');
const LiveDataSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId },
    altitude:{type:Number},
    CSQ:{type:Number},
    time:{type:String},
    statusGps:{type:String},
    Lat:{type:Number},
    NS:{type:String},
    Lng:{type:Number},
    speed:{type:Number},
    deviceID:{type:String},
    EW:{type:String},
    heading:{type:Number},
    dateConv:{type:Date},
    date:{type:String},
    analogInput:{type:Number},
    IOstatus:{type:String},
    externalPower:{type:Number},
    internalPower:{type:Number},
    mileage:{type:Number},
    panic:{type:Number,default:0},
    location:{
        type: {
        type: String, // Don't do `{ location: { type: String } }`
        enum: ['Point'], // 'location.type' must be 'Point'
        required: true
        },
        coordinates: {
        type: [Number],
        required: true
        }
    }
});

module.exports = LiveData = mongoose.model('position.live',LiveDataSchema);