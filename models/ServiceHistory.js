const mongoose = require('mongoose');

const serviceHistorySchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId,auto:true },
    createAt:{type:Date,default: Date.now},
    service: { type: mongoose.SchemaTypes.ObjectId, ref: 'service', require:true },
    employee: { type: mongoose.SchemaTypes.ObjectId, ref: 'users', require:true },
    company:{ type: mongoose.SchemaTypes.ObjectId, ref: 'company', require:true },
    action:{ type: mongoose.SchemaTypes.ObjectId, ref: 'service.action', require:true,default:null  },
    typePoint: { type: String, enum: ['iot.sensor', 'mark'], default:null},
    _idPoint: { type: mongoose.Schema.Types.ObjectId,refPath: 'typePoint',default:null },
    observation:{ type: String,default: null },
    image: { type: String, default:null},
    location:{
        type: { type: String, 
        enum: ['Point','Polygon','LineString'],
        required: true},
        coordinates: { type: Array,required: true},
    }
});

module.exports = ServiceHistory = mongoose.model('service.history', serviceHistorySchema);