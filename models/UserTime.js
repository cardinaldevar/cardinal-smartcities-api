const mongoose = require('mongoose');

const UserTimeSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto:true },
    user_id: {
        type: String,
        required: true
    },
    io_mode: {
        type: Number
    },
    io_time: {
        type: String
    },
    log_image: {
        type: String,
        default:null
    },
    device_id: {
        type: String
    },
    verify_mode:{ type: Number },
    access_in:{
        type: Date,
        default:null
    },
    access_out:{
        type: Date,
        default:null
    },
    createAt:{
        type: Date,
        default: Date.now
    },
    edited:{
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'users',
        default:null
    },
    editedAt:{
        type: Date,
        default: Date.now
    },
    comment:{
        type: String,
        default:null
    },
    forceClose:{
        type: Boolean
    },
});

module.exports = UserTime = mongoose.model('users.access.time',UserTimeSchema);