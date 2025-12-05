const mongoose = require('mongoose');
const { Schema } = mongoose;
const { nanoid } = require('nanoid');

const SurveyQuestionSchema = new Schema({
    questionText: {
        type: String,
        required: true
    },
    answer: {
        type: Number,
        min: 1,
        max: 5
    }
}, { _id: false });

const IncidentDocketSurveySchema = new Schema({
    docket: { 
        type: Schema.Types.ObjectId, 
        ref: 'IncidentDocket',
        required: true,
        index: true
    },
    profile: {
        type: Schema.Types.ObjectId,
        ref: 'IncidentProfile',
        required: true
    },
    token: {
        type: String,
        default: () => nanoid(32),
        unique: true,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'expired'],
        default: 'pending'
    },
    expiresAt: {
        type: Date,
        required: true
    },
    questions: [SurveyQuestionSchema],
    generalComment: {
        type: String,
        trim: true
    }
}, { 
    timestamps: true,
    collection: 'incident.docket.survey'
});

IncidentDocketSurveySchema.index({ expiresAt: 1 });

const IncidentDocketSurvey = mongoose.model('IncidentDocketSurvey', IncidentDocketSurveySchema);

module.exports = IncidentDocketSurvey;
