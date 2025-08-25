const mongoose = require('mongoose');

const AlertSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto: true  },
    createAt:{ type: Date, default: Date.now},
    name:{type:String},
    company: { type: mongoose.Schema.Types.ObjectId,ref: 'company'},
    status:{ type: String, enum : ['active','inactive','deleted'],default: 'active'},
    evaluationType:{ type: String, enum : ['in','out','near','greater','less'],default: null},
    value:{type:Number,default:0},
    originID: [{ type: mongoose.Schema.Types.ObjectId, refPath: 'modelType' }],
    modelType: {  type: String, enum: ['vehicles', 'iot.sensor'], required: true },
    location:{
        type: { type: String, // Don't do `{ location: { type: String } }`
        enum: ['Point','Polygon','LineString'], // 'location.type' must be 'Point'
        required: true},
        coordinates: { type: Array,required: true},
    }
});

AlertSchema.index({ name: 1,createAt:-1, location: "2dsphere" });
module.exports = Alert = mongoose.model('alert',AlertSchema);