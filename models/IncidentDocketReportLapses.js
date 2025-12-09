const mongoose = require('mongoose');

const IncidentDocketReportLapsesSchema = new mongoose.Schema({
    _id: { // Composite ID for unique aggregation buckets
        year: { type: Number, required: true },
        month: { type: Number, required: true },
        area: { type: mongoose.Schema.Types.ObjectId, ref: 'DocketArea', required: true },
        docketType: { type: mongoose.Schema.Types.ObjectId, ref: 'DocketType', required: true },
    },
    areaName: { type: String, required: true },
    docketTypeName: { type: String, required: true },

    // Metrics for Lapso 1: Total Resolution Time (new -> resolved)
    avgTotalResolutionTimeHours: { type: Number, default: 0 },
    medianTotalResolutionTimeHours: { type: Number, default: 0 },
    p90TotalResolutionTimeHours: { type: Number, default: 0 },
    
    // Metrics for Lapso 2: Time to First Assignment (new -> first assigned)
    avgTimeToFirstAssignmentMinutes: { type: Number, default: 0 },
    medianTimeToFirstAssignmentMinutes: { type: Number, default: 0 },
    p90TimeToFirstAssignmentMinutes: { type: Number, default: 0 },

    // Metrics for Lapso 3: Time from Last Assignment to Resolution (last assigned -> resolved)
    avgLastAssignmentToResolutionHours: { type: Number, default: 0 },
    medianLastAssignmentToResolutionHours: { type: Number, default: 0 },
    p90LastAssignmentToResolutionHours: { type: Number, default: 0 },

    docketsCount: { type: Number, default: 0 } // Number of dockets in this bucket
}, { collection: 'incident.report.lapses', timestamps: true }); // Custom collection name and timestamps

module.exports = mongoose.model('IncidentDocketReportLapses', IncidentDocketReportLapsesSchema);
