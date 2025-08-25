const mongoose = require('mongoose');
const activitySchema = new mongoose.Schema({
  createdAt:{type:Date,default: Date.now,expires: '360d'},
  description:{type:String},
  title:{type:String},
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'company'},
  refPoint: { type: mongoose.Schema.Types.ObjectId, ref: 'position.gps', default:null},
  refID: { type: mongoose.Schema.Types.ObjectId, refPath: 'modelType' },
  modelType: { type: String, enum: ['vehicles', 'employee'], required: true },
  value:{type:Number,default:0},
  internalCode:{type:Number,default:0,ref: 'activity.code'},
  picture:{type:String,default:null},
  alarm:{type:Number,default:0},
  alarmData:{type:String},
  observation:{type:String},
  modelEmployee: { type: String, enum: ['users', 'bot'], required: true },
  employee:{ type: mongoose.Schema.Types.ObjectId,refPath: 'modelEmployee' },
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

activitySchema.index({ location: "2dsphere" });
activitySchema.index({ createdAt: 1 });
module.exports = Activity = mongoose.model('activity', activitySchema);