const mongoose = require('mongoose');
const { docketReportQueue } = require('../producers/docketReportProducer'); // Importamos la cola
const ReportJob = require('../../models/ReportJob');
 // --- AGGREGATION LOGIC STARTS HERE ---
const IncidentDocket = require('../../models/IncidentDocket');
const IncidentHistory = require('../../models/IncidentDocketHistory');
require('../../models/IncidentDocketArea');
require('../../models/IncidentDocketType');

// En 'bull', el consumidor es una función de procesamiento que se adjunta a la cola.
// El '1' indica que procesará 1 job a la vez (concurrencia).
docketReportQueue.process('generate-docket-time-lapses', 1, async (job) => {
    const { name, id, data } = job;
    console.log(`⚙️ Processing Bull job: ${name} (ID: ${id})`);
    
    // Para los jobs repetibles, el ID que nos importa para guardar el estado es el que definimos
    const workerId = job.opts.jobId; 

    await ReportJob.findOneAndUpdate(
        { _id: workerId },
        { $set: { lastRunStatus: "running", lastRunStartedAt: new Date(), errorMessage: null } },
        { upsert: true }
    );

    let lastProcessedHistoryDate = new Date(0);
    let maxHistoryDateThisRun = new Date(0);

    try {
        // 1. Get worker's state from report.job collection
        const jobMetadataDoc = await ReportJob.findById(workerId);
        if (jobMetadataDoc && jobMetadataDoc.metadata && jobMetadataDoc.metadata.lastProcessedHistoryDate) {
            lastProcessedHistoryDate = new Date(jobMetadataDoc.metadata.lastProcessedHistoryDate);
            console.log(`   - Last processed history date from state: ${lastProcessedHistoryDate}`);
        } else {
            console.log(`   - No previous state found for worker ${workerId}. Starting from beginning.`);
        }

       

        console.log(`   - Querying for relevant history created since: ${lastProcessedHistoryDate}`);

        const relevantHistory = await IncidentHistory.find(
            {
                createdAt: { $gt: lastProcessedHistoryDate },
                status: { $in: ['assigned', 'resolved'] }
            },
            { createdAt: 1, docket: 1 }
        ).sort({ createdAt: 1 });

        if (relevantHistory.length === 0) {
            console.log('   - No new relevant history to process.');
            maxHistoryDateThisRun = lastProcessedHistoryDate;
        } else {
            maxHistoryDateThisRun = relevantHistory[relevantHistory.length - 1].createdAt;
            const docketIdsToProcess = [...new Set(relevantHistory.map(h => h.docket))];
            
            console.log(`   - Found ${relevantHistory.length} relevant history entries for ${docketIdsToProcess.length} dockets. Max history date is ${maxHistoryDateThisRun}`);

            const pipeline = [
                { $match: { _id: { $in: docketIdsToProcess } } },
                { $lookup: { from: 'incident.history', localField: '_id', foreignField: 'docket', as: 'history' } },
                { $unwind: { path: "$docket_area", preserveNullAndEmptyArrays: false } },
                { $addFields: {
                    resolvedEvents: { $filter: { input: '$history', as: 'h', cond: { $eq: ['$$h.status', 'resolved'] } } },
                    assignedEvents: { $filter: { input: '$history', as: 'h', cond: { $eq: ['$$h.status', 'assigned'] } } }
                }},
                { $addFields: {
                    dateNew: '$createdAt',
                    dateFirstAssigned: { $min: '$assignedEvents.createdAt' },
                    dateLastAssigned: { $max: '$assignedEvents.createdAt' },
                    dateResolved: { $min: '$resolvedEvents.createdAt' }
                }},
                { $addFields: {
                    'lapse1_TotalResolutionHours': { $cond: { if: { $and: ['$dateNew', '$dateResolved'] }, then: { $divide: [{ $subtract: ['$dateResolved', '$dateNew'] }, 3600000] }, else: null } },
                    'lapse2_TimeToFirstAssignmentMinutes': { $cond: { if: { $and: ['$dateNew', '$dateFirstAssigned'] }, then: { $divide: [{ $subtract: ['$dateFirstAssigned', '$dateNew'] }, 60000] }, else: null } },
                    'lapse3_LastAssignmentToResolutionHours': { $cond: { if: { $and: ['$dateLastAssigned', '$dateResolved'] }, then: { $divide: [{ $subtract: ['$dateResolved', '$dateLastAssigned'] }, 3600000] }, else: null } }
                }},
                { $group: {
                                                _id: {
                                                    year: { $year: { date: '$dateNew', timezone: 'America/Argentina/Buenos_Aires' } },
                                                    month: { $month: { date: '$dateNew', timezone: 'America/Argentina/Buenos_Aires' } },
                                                    area: '$docket_area',
                                                    docketType: '$docket_type'
                                                },                    lapses1: { $push: '$lapse1_TotalResolutionHours' },
                    lapses2: { $push: '$lapse2_TimeToFirstAssignmentMinutes' },
                    lapses3: { $push: '$lapse3_LastAssignmentToResolutionHours' },
                }},
                                    {
                                        $project: {
                                            _id: 1,
                                            docketsCount: { $size: '$lapses1' }, // Contar todos los dockets procesados para el grupo
                                            lapses1_filtered: { $filter: { input: '$lapses1', as: 'l', cond: { $ne: ['$l', null] } } },
                                            lapses2_filtered: { $filter: { input: '$lapses2', as: 'l', cond: { $ne: ['$l', null] } } },
                                            lapses3_filtered: { $filter: { input: '$lapses3', as: 'l', cond: { $ne: ['$l', null] } } },
                                        }
                                    },
                                    {
                                        $project: {
                                            _id: 1,
                                            docketsCount: 1, // Pasar el conteo correcto
                                            avgTotalResolutionTimeHours: { $avg: '$lapses1_filtered' },
                                            avgTimeToFirstAssignmentMinutes: { $avg: '$lapses2_filtered' },
                                            avgLastAssignmentToResolutionHours: { $avg: '$lapses3_filtered' },
                                            lapses1_sorted: { $sortArray: { input: '$lapses1_filtered', sortBy: 1 } },
                                            lapses2_sorted: { $sortArray: { input: '$lapses2_filtered', sortBy: 1 } },
                                            lapses3_sorted: { $sortArray: { input: '$lapses3_filtered', sortBy: 1 } },
                                        }
                                    },
                { $project: {
                    _id: 1, docketsCount: 1, avgTotalResolutionTimeHours: 1, avgTimeToFirstAssignmentMinutes: 1, avgLastAssignmentToResolutionHours: 1,
                    medianTotalResolutionTimeHours: { $arrayElemAt: [ '$lapses1_sorted', { $floor: { $multiply: [0.50, { $size: '$lapses1_sorted' }] } } ] },
                    medianTimeToFirstAssignmentMinutes: { $arrayElemAt: [ '$lapses2_sorted', { $floor: { $multiply: [0.50, { $size: '$lapses2_sorted' }] } } ] },
                    medianLastAssignmentToResolutionHours: { $arrayElemAt: [ '$lapses3_sorted', { $floor: { $multiply: [0.50, { $size: '$lapses3_sorted' }] } } ] },
                    p90TotalResolutionTimeHours: { $arrayElemAt: [ '$lapses1_sorted', { $floor: { $multiply: [0.90, { $size: '$lapses1_sorted' }] } } ] },
                    p90TimeToFirstAssignmentMinutes: { $arrayElemAt: [ '$lapses2_sorted', { $floor: { $multiply: [0.90, { $size: '$lapses2_sorted' }] } } ] },
                    p90LastAssignmentToResolutionHours: { $arrayElemAt: [ '$lapses3_sorted', { $floor: { $multiply: [0.90, { $size: '$lapses3_sorted' }] } } ] }
                }},
                    // Etapa 8: Obtener los nombres de area y docketType
                    { $lookup: { from: 'incident.docket_areas', localField: '_id.area', foreignField: '_id', as: 'areaInfo' } },
                    { $lookup: { from: 'incident.docket_types', localField: '_id.docketType', foreignField: '_id', as: 'docketTypeInfo' } },
                { $addFields: {
                    'areaName': { $ifNull: [ { $arrayElemAt: ['$areaInfo.name', 0] }, 'N/A' ] },
                    'docketTypeName': { $ifNull: [ { $arrayElemAt: ['$docketTypeInfo.name', 0] }, 'N/A' ] }
                }},
                { $merge: { into: 'incident.report.lapses', on: '_id', whenMatched: 'replace', whenNotMatched: 'insert' }}
            ];

            await IncidentDocket.aggregate(pipeline);
            console.log('   - Aggregation pipeline executed and merged results.');
        }
        // --- AGGREGATION LOGIC ENDS HERE ---

        await ReportJob.findOneAndUpdate(
            { _id: workerId },
            {
                $set: {
                    description: "Calcula tiempos de resolución y asignación para dockets.",
                    lastRunStatus: "success",
                    lastRunFinishedAt: new Date(),
                    "metadata.lastProcessedHistoryDate": maxHistoryDateThisRun
                }
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.error(`❌ Bull job: ${name} (ID: ${id}) failed:`, error);
        await ReportJob.findOneAndUpdate(
            { _id: workerId },
            {
                $set: {
                    lastRunStatus: "failed",
                    lastRunFinishedAt: new Date(),
                    errorMessage: error.message
                }
            },
            { upsert: true, new: true }
        );
        throw error;
    }
});

// Los listeners de eventos se adjuntan a la instancia de la cola
docketReportQueue.on('completed', (job, result) => {
    console.log(`Job ${job.id} has completed!`);
});

docketReportQueue.on('failed', (job, err) => {
    console.log(`Job ${job.id} has failed with error ${err.message}`);
});

console.log('✅ Docket report consumer (processor) is attached and waiting for jobs.');

// Este archivo no necesita exportar nada, solo ser importado en server.js para que el procesador se adjunte.