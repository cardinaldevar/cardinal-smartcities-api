const mongoose = require('mongoose');

const mechanicalConfigSchema = new mongoose.Schema({
    status:{ 
        type:Number, 
        default: 0
    },
    company:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company',
        required: true
    },
    from:{
        type: Date,
        default: Date.now
    },
    to:{
        type: Date,
        default: Date.now
    },
    createAt:{
        type: Date,
        default: Date.now
    },
});

module.exports = MechanicalHistory = mongoose.model('mechanical.config', mechanicalConfigSchema);