const mongoose = require('mongoose');
const { Schema } = mongoose;

const IncidentProfileSchema = new Schema({
    company: { type: mongoose.Schema.Types.ObjectId,ref: 'company'},
    registerFrom:{
        type: String,
        enum: ['dashboard', 'landing', 'whatsapp'] 
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    last: {
        type: String,
        required: true,
        trim: true
    },
    dni: {
        type: String,
        unique: true,
        sparse: true,
        trim: true
    },
    transactionNumber: {
        type: String,
        default:null,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    phone: {
        type: String,
        trim: true
    },
    birth: {
        type: Date
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other'] 
    },
    password: {
        type: String,
        required: true
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number],
            default: [0, 0]
        }
    },
    address: { type: String, trim: true},
    floor: { type: String },
    door: { type: String},
    isVerified: { type: Boolean, default: false},
    status: {
        type: Number,
        default: 1
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastConnect: {
        type: Date
    },
    pushToken: [
        {
            token: {
                type: String,
                required: true,
            },
            lastUsed: {
                type: Date,
                default: Date.now
            }
        }
    ],
    searchText: {
        type: String,
        trim: true
    },
    notify: {
        type: Boolean,
        default: true
    }
});

IncidentProfileSchema.index({ location: '2dsphere' });
IncidentProfileSchema.index({ searchText: 'text' });
IncidentProfileSchema.index({ name: 1 }, { collation: { locale: 'es', strength: 1 } });
IncidentProfileSchema.index({ last: 1 }, { collation: { locale: 'es', strength: 1 } });
IncidentProfileSchema.index({ dni: 1 });

IncidentProfileSchema.pre('save', function(next) {
  
  // Solo actualizamos el campo si 'name', 'last' o 'dni' han sido modificados
  if (this.isModified('name') || this.isModified('last') || this.isModified('dni')) {
    const textParts = [];
    
    if (this.name) textParts.push(this.name);
    if (this.last) textParts.push(this.last);
    if (this.dni) textParts.push(this.dni);
    
    // Unimos las partes en un solo string, lo pasamos a minúsculas para normalizarlo
    this.searchText = textParts.join(' ').toLowerCase();
  }
  
  next();
});

const IncidentProfile = mongoose.model('IncidentProfile', IncidentProfileSchema, 'incident.profile');
module.exports = IncidentProfile;