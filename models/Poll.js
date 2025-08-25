const mongoose = require('mongoose');

const pollSchema = new mongoose.Schema({
    status:{ 
        type:Number, 
        default: 0
    },
    title:{ 
        type:String, 
        required: true
    },
    company:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company',
        required: true
    },
   /* vehicleAssign:[
        { 
         id:{
            type: mongoose.SchemaTypes.ObjectId, 
            ref: 'vehicles'
            }
        }
    ],*/
    vehicleAssign:{ type:Array },
    question:[
        { 
            id:{
                type: mongoose.SchemaTypes.ObjectId, 
                ref: 'mechanical.question'
            },
            position:{ type: Number }
        }
    ],
    createAt:{
        type: Date,
        default: Date.now
    },
});

module.exports = Poll = mongoose.model('mechanical.poll', pollSchema);