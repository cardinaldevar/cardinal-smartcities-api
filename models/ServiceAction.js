const mongoose = require('mongoose');
const { customAlphabet } = require('nanoid');

const serviceActionSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId,auto:true },
    createAt:{type:Date,default:new Date()},
   // company:{ type: mongoose.SchemaTypes.ObjectId, ref: 'company', require:true },
    name:{ type: String,default: '' },
    name_es:{ type: String,default: null },
    icon: { type: String, default:null},
    library: { type: String, default:null},
    color: { type: String, default:null},
    visible: { type: Boolean, default:true},
    position: { type: Number, default:0},
});

module.exports = ServiceAction = mongoose.model('service.action', serviceActionSchema);