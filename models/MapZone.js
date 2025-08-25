const mongoose = require('mongoose');

const MapZoneSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto:true },
    name: { type: String,required: true},
    createAt:{ type: Date,default: Date.now },
    status: { type: Number, required: true },
    company:[ { _id:{ type: mongoose.SchemaTypes.ObjectId, ref: 'company' } } ],
    type: {
        type: String, enum : ['city','municipality','locality','town'],
        default:null
    },
    location : {
        type: { type: String, enum: ['Polygon','MultiPolygon'],required: true},
        coordinates:{
            type: [[[Number]]],
            required: true
        },
    },
    keyword:{ type: String },
    country_code: { type: String, enum: ['AR','ES','UY','MX','CO','PY'] }
});

module.exports = MapZone = mongoose.model('map.zone',MapZoneSchema);