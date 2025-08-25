const mongoose = require('mongoose');
const { customAlphabet } = require('nanoid');
const moment  = require('moment');
const nanoidGen = customAlphabet('1234567890ABCDFGHIJKLMNOPQRSTUVWXYZ', 3);

const statusInit = new mongoose.Types.ObjectId('664ff9324ae1d1ad025d8a16');

const serviceSchema = new mongoose.Schema({
    _id:{ type:mongoose.SchemaTypes.ObjectId,auto:true },
    createAt:{type:Date,default:new Date()},
    routeID: { type: String, default: ()=>{return moment().format('DDMM')+nanoidGen()} },
    company:{
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'company',
        require:true
    },
    deliveryDate:{
        type: Date,
        default: null
    },
    observation:{ type: String,default: null },
    typeOrder: {
        type: String,
        required: true,
        enum : ['route','repair','incident'],
        default: 'route'
     },
    assign:{
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'users',
    },
    lastUpdate:{
        type: Date,
        default: null
    },
    estimatedTime:{
        type: Number,
        default: null
    },
    estimatedKm:{
        type: Number,
        default: null
    },
    estimatedVolume:{
        type: Number,
        default: null
    },
    from: { type: Array, default:null},
    to: [{
            //_id: { type: mongoose.Schema.Types.ObjectId, ref: 'mark' },
            type: {
                type: String,
                enum: ['iot.sensor', 'mark'],
                required: true,
              },
            item: {
                type: mongoose.Schema.Types.ObjectId,
                refPath: 'to.type',
            },
            position: { type: Number },
            time: { type: Number },
            kilometer: { type: Number },
            lastUpdate:{type: Date, default: null},
            status:{ type: mongoose.SchemaTypes.ObjectId, ref: 'service.action', default:statusInit  }
    }],
    status:{
        type: String,
        enum : ['new','init','pending','complete','incomplete','deleted'],
        default: 'new'
    },
    routeHash:{
        type: String, default:null
    },
});

module.exports = Service = mongoose.model('service', serviceSchema);