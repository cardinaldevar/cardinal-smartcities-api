const mongoose = require('mongoose');

const MarkSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto: true  },
    createAt:{ type: Date, default: Date.now},
    name:{type:String},
    description:{type:String},
    imei:{ type: String, default: null},
    typePoint:{ type: mongoose.Schema.Types.ObjectId,ref: 'mark.type'},
    subTypePoint:{ type: mongoose.Schema.Types.ObjectId,ref: 'mark.type',default:null},
    company: { type: mongoose.Schema.Types.ObjectId,ref: 'company'},
    status:{ type: String, enum : ['new','active','inactive','out of service','deleted'],default: 'new'},
    model:{type:String},
    height:{type:Number},
    width:{type:Number},
    length:{type:Number}, //cm
    capacity:{type:Number},
    address: { type: String },
    addressNumber: { type: Number },
    location:{
        type: { type: String, // Don't do `{ location: { type: String } }`
        enum: ['Point','Polygon','LineString'], // 'location.type' must be 'Point'
        required: true},
        coordinates: { type: Array,required: true},
    },
    last_action: { type: Date,default:null},
});

MarkSchema.index({ address: 1,createAt:-1 });

module.exports = Mark = mongoose.model('mark',MarkSchema);