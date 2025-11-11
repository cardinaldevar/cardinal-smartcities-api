const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
    _id:{ type:Schema.Types.ObjectId, auto:true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true},
    password:{ type: String, required: true },
    avatar:{ type: String, default:null },
    createdAt:{ type: Date, default: Date.now },
    category:{
        type: Schema.Types.ObjectId,
        ref: 'users.category',
        require:true
    },
    company:{ type: Schema.Types.ObjectId, ref: 'company', require:true },
    fleetAccess:{ type: Array },
    employee:{ type: Schema.Types.ObjectId, ref: 'employee'},
    status:{ type: Number, default: 1},
    last_connect:{ type: Date, default: Date.now},
    appMechanical:{ type: Boolean, default: false},
    appSystem:{ type: Boolean, default: false},
    access: {
        type: Map,
        of: String, // El valor asociado a cada clave será un String
        default: {}
    },
    docket_area: [{
        type: Schema.Types.ObjectId,
        ref: 'DocketArea'
    }],
    panicAlert:{ type: Boolean, default: false },
    phone:[String]
});

module.exports = User = mongoose.model('users',UserSchema);