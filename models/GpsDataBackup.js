// models/GpsDataBackup.js
const mongoose = require('mongoose');
const gpsDataSchema = require('./GpsData').schema;   // reutiliza el existente

gpsDataSchema.index({ location: '2dsphere' });       // sin expireAfterSeconds

module.exports = mongoose.model(
  'position.gps.backup',         // nombre explícito
  gpsDataSchema,                 // mismo esquema
  'position.gps.backup'          // nombre de la colección en MongoDB
);