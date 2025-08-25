const mongoose = require('mongoose');
const vehicleBrandSchema = new mongoose.Schema({
    name:{type:String},
    brand:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'vehicles.brand'
    },
    fuelConsumption: { type: Number, default: null },
});

module.exports = VehicleModel = mongoose.model('vehicles.model', vehicleBrandSchema);