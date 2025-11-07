const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto:true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true},
    password:{ type: String, required: true },
    avatar:{ type: String, default:null },
    createdAt:{ type: Date, default: Date.now },
    category:{
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'users.category',
        require:true
    },
    company:{ type: mongoose.SchemaTypes.ObjectId, ref: 'company', require:true },
    fleetAccess:{ type: Array },
    employee:{ type: mongoose.SchemaTypes.ObjectId, ref: 'employee'},
    status:{ type: Number, default: 1},
    last_connect:{ type: Date, default: Date.now},
    appMechanical:{ type: Boolean, default: false},
    appSystem:{ type: Boolean, default: false},
    access: {
        type: Map,
        of: String, // El valor asociado a cada clave será un String
        default: {}
    },
    panicAlert:{ type: Boolean, default: false },
    phone:[String]
});

module.exports = User = mongoose.model('users',UserSchema);