const mongoose = require('mongoose');

const NodesSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto: true },
    name: {
        type: String,
        required: true
    },
    host: {
        type: String,
        required: true,
        unique: true,
    },
    password:{
        type: String,
        required: true
    },
    date:{
        type: Date,
        default: Date.now
    },
    last_connect:{
        type: Date,
        default: Date.now
    },
});

module.exports = Nodes = mongoose.model('core.nodes',NodesSchema);