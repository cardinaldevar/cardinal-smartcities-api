const mongoose = require('mongoose');

const UserAccessSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto:true },
    user_id: {
        type: String,
        required: true
    },
    user_name: {
        type: String
    },
    user_privilege: {
        type: String
    },
    profile_image: {
        type: String
    },
    device_id: {
        type: String
    },
    request_code:{ type: String },
    createAt:{
        type: Date,
        default: Date.now
    }
});

module.exports = UserAccess = mongoose.model('users.access',UserAccessSchema);