const mongoose = require('mongoose');
const gpsDataSchema = new mongoose.Schema({
  _id:{ type:mongoose.SchemaTypes.ObjectId, auto:true },
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
  odometer:{type:Number},
  fuel:{type:Number,default:0},
  panic:{type:Number,default:0},
  alarm:{type:Number},
  alarmData:{type:String},
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
},{timestamps: true}
);
gpsDataSchema.index({ location: "2dsphere" },{ expireAfterSeconds: 15552000 });
module.exports = GpsData = mongoose.model('position.gps', gpsDataSchema);