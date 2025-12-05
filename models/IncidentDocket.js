const mongoose = require('mongoose');
const { Schema } = mongoose;
const IncidentCounter = require('./IncidentCounter'); 
const Zone = require('./Zone');

const PredictionSchema = new Schema({
    refId: {
        type: Schema.Types.ObjectId,
        ref: 'DocketType', 
        required: true
    },
    name: {
        type: String,
        required: true
    },
    score: {
        type: Number,
        required: true
    },
    predictionDate: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

const SentimentAnalysisSchema = new Schema({
    analysisStage: {
        type: String,
        required: true,
        enum: [ 'initial', 'resolution', 'user_comment', 'manual_trigger', 'survey' ]
    },
    sentiment: {
        type: String,
        required: true,
        enum: ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED']
    },
    sentimentScore: {
        positive: { type: Number },
        negative: { type: Number },
        neutral: { type: Number },
        mixed: { type: Number }
    }
}, { 
    timestamps: { createdAt: 'analysisDate', updatedAt: false }, 
    _id: false 
});


const IncidentDocketSchema = new Schema({
    company: { type: mongoose.Schema.Types.ObjectId,ref: 'company'},
    docketId: {
        type: String,
        unique: true,
        uppercase: true
    },
    profile: {
        type: Schema.Types.ObjectId,
        ref: 'IncidentProfile',
        required: true
    },
    docket_area: [{
        type: Schema.Types.ObjectId,
        ref: 'DocketArea'
    }],
    docket_area_predicted: {
        type: PredictionSchema,
        required: false
    },
    docket_type: {
        type: Schema.Types.ObjectId,
        ref: 'DocketType', 
        required: true
    },
    docket_type_predicted: {
        type: PredictionSchema,
        required: false
    },
    description: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: [
        'new',
        'assigned',
        'in_progress',
        'reassigned', //not used
        'returned',
        'on_hold',
        'partially_resolved',
        'resolved',
        'closed',   
        'cancelled',
        'archived',
        'deleted'
        ],
        default: 'new'
    },
    source: {
        type: Schema.Types.ObjectId,
        ref: 'DocketSource', 
        required: true
    },
    details: {
        type: Schema.Types.Mixed,
        default: {}
    },
    address: {
        type: String,
        trim: true
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // Formato [longitud, latitud]
            default: [0, 0]
        }
    },
    sentiments: [SentimentAnalysisSchema],
    surveys: [{
        type: Schema.Types.ObjectId,
        ref: 'IncidentDocketSurvey'
    }],
    subscribers: [{
        _id: false,
        profile: {
            type: Schema.Types.ObjectId,
            ref: 'IncidentProfile'
        },
        email: {
            type: String
        }
    }],
    zone: {
        type: Schema.Types.ObjectId,
        ref: 'Zone'
    },
}, { timestamps: true });

async function assignZoneToDocket(docket) {
    if (!docket.location || !docket.location.coordinates || docket.location.coordinates.length !== 2 || (docket.location.coordinates[0] === 0 && docket.location.coordinates[1] === 0)) {
        docket.zone = null;
        return;
    }
    try {
        const matchingZones = await Zone.find({
            company: docket.company,
            status: 1,
            location: {
                $geoIntersects: {
                    $geometry: docket.location
                }
            }
        });

        if (matchingZones.length === 0) {
            docket.zone = null;
            return;
        }

        if (matchingZones.length === 1) {
            docket.zone = matchingZones[0]._id;
            return;
        }

        // --- 👇 LÓGICA DE ORDENAMIENTO MEJORADA ---
        const typePriorityMap = {
            'town': 4,
            'locality': 3,
            'city': 2,
            'municipality': 1
        };

        const bestZone = matchingZones.sort((a, b) => {
            // 1. Primero, compara por el campo 'priority' personalizado (de mayor a menor)
            const customPriorityDiff = (b.priority || 0) - (a.priority || 0);
            if (customPriorityDiff !== 0) {
                return customPriorityDiff;
            }

            // 2. Si las prioridades son iguales, usa el 'type' como desempate
            const typePriorityA = typePriorityMap[a.type] || 0;
            const typePriorityB = typePriorityMap[b.type] || 0;
            return typePriorityB - typePriorityA;
        })[0]; // Elegimos el primer elemento después de este ordenamiento de dos niveles

        docket.zone = bestZone._id;

    } catch (error) {
        console.error(`Error al asignar zona al legajo ${docket._id}:`, error);
        docket.zone = null;
    }
}

IncidentDocketSchema.pre('save', async function(next) {
    const docket = this;

     if (docket.isNew || docket.isModified('location')) {
        await assignZoneToDocket(docket);
    }

    if (docket.isNew) {
        try {

            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            let prefix = '';
            for (let i = 0; i < 2; i++) {
                prefix += chars.charAt(Math.floor(Math.random() * chars.length));
            }

            // --- 2. Generación de la Fecha en formato DDMMYY ---
            const today = new Date();
            const year = today.getFullYear().toString().slice(-2);
            const month = (today.getMonth() + 1).toString().padStart(2, '0');
            const day = today.getDate().toString().padStart(2, '0');
            const dateString = `${day}${month}${year}`; // ej: '091025'

            // --- 3. Obtención del Contador Secuencial para el día actual ---
            // Se busca o crea un contador único para la fecha actual (ej: 'docket_091025')
            const counterId = `docket_${dateString}`;
            
            const counter = await IncidentCounter.findByIdAndUpdate(
                counterId,
                { $inc: { seq: 1 } },      // Incrementa el campo 'seq' en 1
                { new: true, upsert: true } // Opciones: devuelve el nuevo documento y lo crea si no existe
            );
            
            docket.docketId = `${prefix}${dateString}${counter.seq}`;
            next();

        } catch (error) {
            return next(error);
        }
    } else {
        next();
    }
});

IncidentDocketSchema.index({ location: '2dsphere' });
const IncidentDocket = mongoose.model('IncidentDocket', IncidentDocketSchema, 'incident.docket');

module.exports = IncidentDocket;