const mongoose = require('mongoose');

const ZoneSchema = new mongoose.Schema({
    name: { 
        type: String,
        required: true
    },
    createAt:{ 
        type: Date,
        default: Date.now 
    },
    status: { 
        type: Number, 
        required: true 
    },
    company:[{
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'company'
    }],
    type: {
        type: String, 
        enum : ['city','municipality','locality','town','custom'],
        default: null
    },
    location : {
        type: { 
            type: String, 
            enum: ['Polygon','MultiPolygon'],
            required: true
        },
        coordinates:{
            type: Array, 
            required: true
        },
    },
    keyword:{ 
        type: String 
    },
    priority: {
        type: Number,
        default: 0
    },
    country_code: { 
        type: String, 
        enum: ['AR','ES','UY','MX','CO','PY'] 
    },
    locked:{ 
        type:Boolean, 
        default: false 
    }
});

ZoneSchema.index({ "location": "2dsphere" });

module.exports = mongoose.model('Zone', ZoneSchema, 'zone');