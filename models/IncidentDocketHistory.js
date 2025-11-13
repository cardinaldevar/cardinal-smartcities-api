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
        'returned',
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
        url: { type: String },
        key: { type: String},
        originalName: {  type: String,  required: true  },
        fileType: {  type: String },
        fileSize: { type: Number }
    }]
}, {
    timestamps: { createdAt: true, updatedAt: false }
});


const DocketHistory = mongoose.model('IncidentHistory', DocketHistorySchema, 'incident.history');

module.exports = DocketHistory;