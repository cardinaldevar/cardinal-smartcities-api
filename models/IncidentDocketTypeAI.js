const mongoose = require('mongoose');

const IncidentDocketTypeAISchema = new mongoose.Schema({
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company',
        required: true
    },
    text: {
        type: String,
        required: true
    },
    category: {
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
    collection: 'incident.docket_types.AImodel', // Specify the collection name
    timestamps: true // Adds createdAt and updatedAt fields automatically
});

module.exports = mongoose.model('IncidentDocketTypeAI', IncidentDocketTypeAISchema);