const mongoose = require('mongoose');

const coreSectionTypeSchema = new mongoose.Schema({
    name:{ type:String, required: true},
    nameField:{ type:String},
    position:{ 
        type:Number, 
        required: true,
        default: 99
    },
    status:{ 
        type:Number, 
        required: true,
        default: 1
    },
});

module.exports = coreSection = mongoose.model('core.section', coreSectionTypeSchema);