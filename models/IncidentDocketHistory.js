const mongoose = require('mongoose');
const { Schema } = mongoose;

const DocketHistorySchema = new Schema({
    docket: {
        type: Schema.Types.ObjectId,
        ref: 'IncidentDocket',
        required: true,
        index: true 
    },
    user: {
        type: Schema.Types.ObjectId,
        required: true,
        // 'refPath' le dice a Mongoose que el modelo a usar se encuentra en el campo 'userModel'
        refPath: 'userModel'
    },
    userModel: {
        type: String,
        required: true,
        enum: ['IncidentProfile', 'employee','users'] 
    },
    status: {
        type: String,
        required: true,
        enum: [
            'new',
        'assigned',
        'in_progress',
        'reassigned',
        'on_hold',
        'resolved', 
        'closed',   
        'cancelled',
        'archived',
        'deleted'
        ]
    },
    content: {
        type: String,
        trim: true
    },
    observation: {
        type: String,
        trim: true
    },
    files: [{
        filename: { type: String, required: true },
        mimeType: { type: String }
    }]
}, {
    timestamps: { createdAt: true, updatedAt: false }
});


const DocketHistory = mongoose.model('IncidentHistory', DocketHistorySchema, 'incident.history');

module.exports = DocketHistory;