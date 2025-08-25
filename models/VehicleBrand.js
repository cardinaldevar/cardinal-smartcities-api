const mongoose = require('mongoose');
const vehicleBrandSchema = new mongoose.Schema({
    name:{Type:String}
});

module.exports = VehicleBrand = mongoose.model('vehicles.brand', vehicleBrandSchema);