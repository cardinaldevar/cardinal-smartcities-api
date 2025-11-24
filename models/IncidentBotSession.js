const mongoose = require('mongoose');

const IncidentBotSessionSchema = new mongoose.Schema({
    // ID único de WhatsApp (Ej: 5491122334455)
    whatsappId: { 
        type: String, 
        required: true, 
        unique: true,
        index: true 
    },

    // Relación opcional con el Perfil (se llena cuando logramos identificarlo/registrarlo)
    profile: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'IncidentProfile',
        default: null
    },

    // Control de flujo (La "memoria" de en qué paso está)
    step: { 
        type: String, 
        default: 'INIT' // Ej: 'ASKING_DNI', 'CONFIRMING_CATEGORY', 'WAITING_CLAIM_TEXT'
    },

    // Buffer temporal: Aquí guardas todo lo que el usuario escribe antes de confirmar
    // Ej: { draftClaim: "hay un pozo...", predictedCategory: "Bacheo", tempName: "Juan" }
    buffer: { 
        type: mongoose.Schema.Types.Mixed, 
        default: {} 
    }

}, { 
    timestamps: true, // Genera createdAt y updatedAt automáticos
    collection: 'incident.bot' // Forzamos el nombre exacto que pediste
});

// IMPORTANTE: Índice TTL (Time To Live)
// Si el vecino deja de hablar por 1 hora, esta sesión se autodestruye.
// Esto evita que si vuelve mañana, el bot le diga "¿Es correcto?" de la nada.
IncidentBotSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 }); 

module.exports = mongoose.model('IncidentBotSession', IncidentBotSessionSchema);