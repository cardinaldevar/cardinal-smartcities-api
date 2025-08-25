const mongoose = require('mongoose');

const mechanicalHistorySchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto: true },
    status:{ 
        type:Number, 
        default: 0
    },
    vehicleStatus:{ 
        type: mongoose.Schema.Types.ObjectId,
        ref: 'vehicles.status',
        required: true
    },
    company:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company',
        required: true
    },
    user:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users',
        required: true
    },
    vehicleAssign:{ 
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'vehicles'
    },
    question:[
        { 
            id:{
                type: mongoose.SchemaTypes.ObjectId, 
                ref: 'mechanical.question'
            },
            position:{ type: Number }
        }
    ],
    result: [ 
        { 
            id:{
                type: mongoose.SchemaTypes.ObjectId, 
                ref: 'mechanical.question'
            },
            option:{ type: Number },
            editAt:{ type: Date },
            image:{ type: String, default:null},
            observation:{ type: String, default:null },
        }
    ],
    createAt:{
        type: Date,
        default: Date.now
    },
    endAt:{
        type: Date,
        default: Date.now
    },
    audio:{ 
        type:String
    }
});

module.exports = MechanicalHistory = mongoose.model('mechanical.history', mechanicalHistorySchema);