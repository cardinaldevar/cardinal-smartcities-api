const IncidentDocket = require('../models/IncidentDocket');
const IncidentProfile = require('../models/IncidentProfile');
const DocketType = require('../models/IncidentDocketType');
const { sendNewDocketEmail, sendInternalAssignedDocketEmail, sendNeighborAssignedDocketEmail } = require('./ses');

const handleNewDocket = async (docket) => {
    try {
        const userProfile = await IncidentProfile.findById(docket.profile);
        if (!userProfile || !userProfile.email) {
            console.error(`Could not find profile or email for user ${docket.profile} on new docket ${docket._id}`);
            return;
        }

        let predictionData = null;
        if (docket.docket_type) {
            const docketTypeInfo = await DocketType.findById(docket.docket_type).select('name parent').populate('parent', 'name');
            if (docketTypeInfo) {
                let categoryName = docketTypeInfo.name;
                if (docketTypeInfo.parent && docketTypeInfo.parent.name) {
                    categoryName = `${docketTypeInfo.parent.name} > ${categoryName}`;
                }
                predictionData = { name: categoryName };
            }
        }

        console.log(`📧  New Docket [${docket.docketId}]. Triggering email confirmation to ${userProfile.email}.`);
        await sendNewDocketEmail({
            company: docket.company,
            email: userProfile.email,
            docketId: docket.docketId,
            description: docket.description,
            address: docket.address,
            prediction: predictionData,
            nameProfile: userProfile.name
        });
    } catch (error) {
        console.error(`Error handling new docket notification for ${docket._id}:`, error);
    }
};

const handleAssignedDocket = async (docketId) => {
    try {
        const docket = await IncidentDocket.findById(docketId).populate('docket_area').populate('profile');
        if (!docket) {
            console.error(`Docket ${docketId} not found for 'assigned' notification.`);
            return;
        }

        // --- 1. Internal Notification Logic (to Areas) ---
        const internalEmailPromise = (async () => {
            const areasToNotify = docket.docket_area.filter(area => area.notify && area.emails && area.emails.length > 0);
            if (areasToNotify.length > 0) {
                const emailSet = new Set(areasToNotify.flatMap(area => area.emails));
                const emails = Array.from(emailSet);
                if (emails.length > 0) {
                    console.log(`📧  Docket [${docket.docketId}] assigned. Triggering INTERNAL email to ${emails.length} address(es).`);
                    await sendInternalAssignedDocketEmail({
                        emails: emails,
                        docketId: docket.docketId,
                        description: docket.description,
                        company: docket.company
                    });
                }
            }
        })();

        // --- 2. Neighbor Notification Logic (to Profile) ---
        const neighborEmailPromise = (async () => {
            if (docket.profile && docket.profile.email) {
                console.log(`📧  Docket [${docket.docketId}] assigned. Triggering NEIGHBOR email to ${docket.profile.email}.`);
                await sendNeighborAssignedDocketEmail({
                    email: docket.profile.email,
                    nameProfile: docket.profile.name,
                    docketId: docket.docketId,
                    description: docket.description,
                    company: docket.company
                });
            }
        })();

        // --- 3. Run both in parallel ---
        await Promise.all([internalEmailPromise, neighborEmailPromise]);

    } catch (error) {
        console.error(`Error handling 'assigned' docket notification for ${docketId}:`, error);
    }
};

const initializeDocketNotifier = () => {
    console.log('🔔 Docket Notifier Initialized. Watching for status changes...');

    try {
        const pipeline = [
            {
                $match: {
                    $or: [
                        { operationType: 'insert' },
                        { 
                            'operationType': 'update',
                            'updateDescription.updatedFields.status': { $in: ['assigned', 'new'] }
                        }
                    ]
                }
            }
        ];

        const changeStream = IncidentDocket.watch(pipeline, { fullDocument: 'updateLookup' });

        changeStream.on('change', (change) => {
            if (change.operationType === 'insert') {
                handleNewDocket(change.fullDocument);
            } else if (change.operationType === 'update') {
                const status = change.updateDescription.updatedFields.status;
                if (status === 'assigned') {
                    handleAssignedDocket(change.documentKey._id);
                } else if (status === 'new') {
                    IncidentDocket.findById(change.documentKey._id).then(docket => {
                       
                        if (docket) handleNewDocket(docket);
                    });
                }
            }
        });

        changeStream.on('error', (error) => {
            console.error('Error in Docket-Notify Change Stream:', error);
        });

    } catch (error) {
        console.error('Failed to initialize Docket-Notify Change Stream:', error);
    }
};

module.exports = initializeDocketNotifier;
