const mongoose = require('mongoose');

const EmployeeSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto:true },
    name: {
        type: String,
        required: true
    },
    last: {
       type: String,
       required: true
    },
    status: {
       type: Number,
       required: true
    },
    bloodtype: {
       type: Number
    },
    art: {
        type: String, default:null
    },
    dni: {
        type: Number,
        required: true
    },
    gender: {
        type: Number,
        default:0
    },
    createAt:{
        type: Date,
        default: Date.now
    },
    leavingDate:{
        type: Date,
        default: null
    },
    birth:{
        type: Date,
        default: Date.now
    },
    email: {
        type: String, default:null
    },
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company'
    },
    typeEmployee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'employee.type'
    },
    avatar: {
        type: String, default:null
    },
    fileNumber: {
        type: String,
        required: true
    },
    phone: {
        type: Number, default:null
    },
    nameEmergency: {
        type: String
    },
    phoneEmergency: {
        type: Number, default:null
    },
    cuil: {
        type: Number, default:null
    },
    userBiometric: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users.access'
    },
    workShift: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'employee.workshift'
    },
    searchText: { type: String }
});

module.exports = Employee = mongoose.model('employee',EmployeeSchema);