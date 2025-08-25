const mongoose = require('mongoose');
const vehicleStatusSchema = new mongoose.Schema({
    name:{type:String},
    color:{type:String},
    position:{type:Number}
});

module.exports = vehicleStatus = mongoose.model('vehicles.status', vehicleStatusSchema);