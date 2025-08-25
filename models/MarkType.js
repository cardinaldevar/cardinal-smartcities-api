const mongoose = require('mongoose');

const MarkTypeSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto: true  },
    createAt:{ type: Date, default: Date.now},
    typeModel:{ type: String, enum : ['iot','point'],default: 'point'},
    subTypeModel:{ type: mongoose.Schema.Types.ObjectId,ref: 'mark.type',default:null},
    name:{type:String},
    name_es:{type:String},
    icon:{type:String},
    color:{type:String}
});


module.exports = MarkType = mongoose.model('mark.type',MarkTypeSchema);