const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId },
    name: {
        type: String,
        required: true
    },
    status: {
        type: String,
        required: true
    },
    license: {
        type: Array
    },
    web: {
        type: String
    },
    address: {
        type: String
    },
    logo: {
        type: String
    },
    email: {
        type: String
    },
    location:{
        type: { type: String, enum: ['Point','Polygon','LineString'] },
        coordinates: { type: Array,required: true},
    },
    country_code: { type: String, enum: ['AR','ES','UY','MX','CO','PY'],default:'AR' },
    timezone: { type: String, default:'America/Argentina/Buenos_Aires' },
});

module.exports = Company = mongoose.model('company',CompanySchema);