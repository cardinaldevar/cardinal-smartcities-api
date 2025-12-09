const Queue = require('bull');

// bull crea sus propios clientes ioredis. Le proporcionamos las opciones de conexión.
const redisConnectionOptions = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    // password: process.env.REDIS_PASSWORD, // Descomentar si tienes una contraseña
};

const docketReportQueue = new Queue('docket-report-generation', {
    redis: redisConnectionOptions
});

async function scheduleDocketReportJob() {
    // El resto de la lógica para programar el job sigue siendo válida
    const jobName = 'generate-docket-time-lapses';
    const jobKey = 'docketTimeLapseWorker'; // ID para el job repetible

    const repeatableJobs = await docketReportQueue.getRepeatableJobs();
    const jobExists = repeatableJobs.some(job => job.key.includes(jobKey));

    if (!jobExists) {
        await docketReportQueue.add(
            jobName,
            {},
            {
                jobId: jobKey,
                repeat: {
                    cron: '0 * * * *' // Cada hora
                }
            }
        );
        console.log(`✅ Scheduled Bull job: ${jobName} (cada hora, ID: ${jobKey})`);
    } else {
        console.log(`ℹ️ Bull job: ${jobName} (ID: ${jobKey}) ya estaba programado.`);
    }
}

async function triggerImmediateReportJob() {
    const jobName = 'generate-docket-time-lapses';
    const uniqueJobId = `manual-trigger-${Date.now()}`;

    await docketReportQueue.add(
        jobName,
        { type: 'manual_trigger' },
        {
            jobId: uniqueJobId,
            removeOnComplete: true,
            removeOnFail: false
        }
    );
    console.log(`🚀 Manually triggered Bull job: ${jobName} (ID: ${uniqueJobId})`);
}

module.exports = {
    scheduleDocketReportJob,
    triggerImmediateReportJob,
    docketReportQueue // Exportamos la instancia de la cola
};

