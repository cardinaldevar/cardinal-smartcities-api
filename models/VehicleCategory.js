const mongoose = require('mongoose');

const vehicleCategorySchema = new mongoose.Schema({
    status:{ 
        type:Number, 
        required: true,
      //  default: 2
    },
    name:{ type:String, required: true},
    company:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company',
        required: true
    },
});

module.exports = VehicleCategory = mongoose.model('vehicles.category', vehicleCategorySchema);