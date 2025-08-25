const mongoose = require('mongoose');

const AccessNodeSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto:true },
    company:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company'
    },
    device_id: {
        type: String
    },
    name: {
        type: String
    },
    request_code:{ type: String },
    lastUpdate:{
        type: Date,
        default: Date.now
    }
});

module.exports = AccessNode = mongoose.model('users.access.node',AccessNodeSchema);