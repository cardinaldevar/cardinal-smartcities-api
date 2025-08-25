const mongoose = require('mongoose');

const VehicleStatSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId, auto: true  },
    createAt:{ type: Date, default: Date.now},
    dateAt:{ type: Date, default: Date.now},
    deviceID:{ type: String, default: null},
    fuel:{type: Number,default:0},
    mileage:{type: Number,default:0},
    mileageDiff:{type: Number,default:0},
    panic:{type: Number,default:0},
    alert:{type: Number,default:0},
    history:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'position.gps'
    },
    company:{
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'company',
        require:true
    },
});

VehicleStatSchema.index({ createAt:-1 });

module.exports = VehicleStat = mongoose.model('vehicle.stat',VehicleStatSchema);