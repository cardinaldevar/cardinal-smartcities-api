const mongoose = require('mongoose');

const ReportJobSchema = new mongoose.Schema({
    _id: String, // Worker ID (e.g., 'docketTimeLapseWorker')
    description: String,
    lastRunStatus: String, // 'success', 'failed', 'running'
    lastRunStartedAt: Date,
    lastRunFinishedAt: Date,
    errorMessage: String, // For failed jobs
    metadata: Object // For worker-specific state like lastProcessedDocketUpdateDate
}, { collection: 'report.job', timestamps: true }); // Use 'report.job' collection

module.exports = mongoose.model('ReportJob', ReportJobSchema);