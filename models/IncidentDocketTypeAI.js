const mongoose = require('mongoose');

const IncidentDocketTypeAISchema = new mongoose.Schema({
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    text: {
        type: String,
        required: true
    },
    docket_type: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'IncidentDocketType',
        required: true
    },
    slug: {
        type: String,
        required: true
    },
    stage: {
        type: String,
        enum: ['initial', 'training', 'retraining'],
        default: 'initial',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    collection: 'incident.docket_types.AImodel',
    timestamps: true
});

module.exports = mongoose.model('IncidentDocketTypeAI', IncidentDocketTypeAISchema);