const mongoose = require('mongoose');

const ZoneSchema = new mongoose.Schema({
    zone: {
        type: String,
        required: true
    },
    status:{
        type: Number,
        default:1
    },
    public:{
        type: Boolean,
        default:false
    },
    user:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users'
    }
});

module.exports = Zone = mongoose.model('zone',ZoneSchema);