const mongoose = require('mongoose');

const EmployeeWorkshiftSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto:true },
    name: {
        type: String,
        required: true
    },
    status: {
       type: Number,
       default:1
    },
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company'
    },
    timeAssign: [
       { 
           _id:{ type:mongoose.SchemaTypes.ObjectId, auto:true },
           day: {type: Number},
           from: {type: Date},
           to: {type: Date},
           percent:{type: Number},
           nextDay:{type: Boolean}
        }
    ]
});

module.exports = EmployeeWorkshift = mongoose.model('employee.workshift',EmployeeWorkshiftSchema);