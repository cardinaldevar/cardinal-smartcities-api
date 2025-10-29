const mongoose = require('mongoose');
const { Schema } = mongoose;

const IncidentCounterSchema = new Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
});

const IncidentCounter = mongoose.model('IncidentCounter', IncidentCounterSchema, 'incident.counter');

module.exports = IncidentCounter;