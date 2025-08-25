const mongoose = require('mongoose');

const employeeTypeSchema = new mongoose.Schema({
    name:{ type:String, required: true},
    company:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company',
        required: true
    },
    status:{ 
        type:Number, 
        required: true,
        default: 1
    },
});

module.exports = employeeType = mongoose.model('employee.type', employeeTypeSchema);