const mongoose = require('mongoose');
const IncidentDocket = require('../models/IncidentDocket');
const IncidentProfile = require('../models/IncidentProfile');
const DocketType = require('../models/IncidentDocketType');
const IncidentDocketHistory = require('../models/IncidentDocketHistory');
const IncidentDocketArea = require('../models/IncidentDocketArea');
const { sendNewDocketEmail, sendInternalAssignedDocketEmail, sendNeighborAssignedDocketEmail, sendNewSubscriberEmail, sendInProgressDocketEmail, sendOnHoldDocketEmail, sendResolvedDocketEmail } = require('./ses');

const handleNewSubscriber = async (change) => {
    try {
        const docket = change.fullDocument;
        const updatedFields = change.updateDescription.updatedFields;
        
        // Find the key that indicates a subscriber was added, e.g., "subscribers.2"
        const subscriberKey = Object.keys(updatedFields).find(key => /^subscribers\.\d+$/.test(key));
        
        if (!subscriberKey) {
            console.log(`Could not identify a specific new subscriber from updatedFields for docket ${change.documentKey._id}.`);
            return;
        }

        // The value of this key is the new subscriber object
        const newSubscriber = updatedFields[subscriberKey];

        if (!newSubscriber) {
            console.error(`New subscriber data is missing for key ${subscriberKey} in docket ${docket._id}`);
            return;
        }

        let notificationEmail;
        let notificationName = 'Suscriptor';

        if (newSubscriber.profile) {
            const newSubscriberProfile = await IncidentProfile.findById(newSubscriber.profile);
            if (!newSubscriberProfile || !newSubscriberProfile.email) {
                console.error(`Could not find profile or email for new subscriber profile ${newSubscriber.profile}`);
                return;
            }
            notificationEmail = newSubscriberProfile.email;
            notificationName = newSubscriberProfile.name;
        } else if (newSubscriber.email) {
            notificationEmail = newSubscriber.email;
        }

        if (!notificationEmail) {
            console.error(`Could not determine email for new subscriber in docket ${docket._id}`);
            return;
        }

        console.log(`📧  New Subscriber [${notificationEmail}] to Docket [${docket.docketId}]. Triggering email notification.`);

        await sendNewSubscriberEmail({
            email: notificationEmail,
            nameProfile: notificationName,
            docketId: docket.docketId,
            address: docket.address,
            company: docket.company
        });

    } catch (error) {
        console.error(`Error handling new subscriber notification for docket ${change.documentKey._id}:`, error);
    }
};

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
        const docket = await IncidentDocket.findById(docketId)
        //.populate('docket_area')
        .populate('profile');
        if (!docket) {
            console.error(`Docket ${docketId} not found for 'assigned' notification.`);
            return;
        }

        // --- 1. Internal Notification Logic (to Areas) ---
       /* const internalEmailPromise = (async () => {
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
        })();*/

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
        //await Promise.all([internalEmailPromise, neighborEmailPromise]);
        await Promise.all([neighborEmailPromise]);

    } catch (error) {
        console.error(`Error handling 'assigned' docket notification for ${docketId}:`, error);
    }
};

const handleStatusChange = async (docketId, status, statusText, emailSender) => {
    try {
        const [docket, history] = await Promise.all([
            IncidentDocket.findById(docketId)
                .populate('profile', 'name email')
                .populate('subscribers.profile', 'name email'),
            IncidentDocketHistory.findOne({ docket: docketId, status: status }).sort({ createdAt: -1 })
        ]);

        if (!docket) {
            console.error(`Docket ${docketId} not found for '${status}' notification.`);
            return;
        }

        const observation = history ? history.content : null;
        const emailRecipients = new Map();

        // Add original profile
        if (docket.profile && docket.profile.email) {
            emailRecipients.set(docket.profile.email, { email: docket.profile.email, name: docket.profile.name });
        }

        // Add subscribers
        if (docket.subscribers && docket.subscribers.length > 0) {
            for (const sub of docket.subscribers) {
                if (sub.profile && sub.profile.email && !emailRecipients.has(sub.profile.email)) {
                    emailRecipients.set(sub.profile.email, { email: sub.profile.email, name: sub.profile.name });
                } else if (sub.email && !emailRecipients.has(sub.email)) {
                    emailRecipients.set(sub.email, { email: sub.email, name: 'Suscriptor' });
                }
            }
        }

        if (emailRecipients.size === 0) {
            console.log(`No recipients found for '${status}' notification for docket ${docket.docketId}.`);
            return;
        }

        console.log(`📧  Docket [${docket.docketId}] is ${statusText}. Triggering email to ${emailRecipients.size} recipient(s).`);

        const emailPromises = Array.from(emailRecipients.values()).map(recipient =>
            emailSender({
                email: recipient.email,
                nameProfile: recipient.name,
                docketId: docket.docketId,
                description: docket.description,
                company: docket.company,
                observation: observation
            })
        );

        await Promise.all(emailPromises);

    } catch (error) {
        console.error(`Error handling '${status}' docket notification for ${docketId}:`, error);
    }
};

const handleInProgressDocket = (docketId) => {
    handleStatusChange(docketId, 'in_progress', 'En Progreso', sendInProgressDocketEmail);
};

const handleOnHoldDocket = (docketId) => {
    handleStatusChange(docketId, 'on_hold', 'Observado', sendOnHoldDocketEmail);
};

const handleResolvedDocket = (docketId) => {
    handleStatusChange(docketId, 'resolved', 'Resuelto', sendResolvedDocketEmail);
};

const handleAreaNotify = async (change) => {
    try {
        const docket = change.fullDocument;
        const oldAreas = change.fullDocumentBeforeChange?.docket_area || [];
        const newAreas = docket.docket_area || [];

        if (newAreas.length === 0) return;

        const oldAreaIds = new Set(oldAreas.map(id => id.toString()));
        const newlyAddedAreaIds = newAreas.filter(id => !oldAreaIds.has(id.toString()));

        if (newlyAddedAreaIds.length === 0) return;

        const areasToNotify = await IncidentDocketArea.find({
            _id: { $in: newlyAddedAreaIds },
            notify: true,
            'emails.0': { $exists: true }
        }).select('emails');

        if (areasToNotify.length === 0) return;

        const allEmails = areasToNotify.flatMap(area => area.emails);
        const uniqueEmails = [...new Set(allEmails)];
        console.log('allEmails',allEmails)
        if (uniqueEmails.length > 0) {
            console.log(`📧  Docket [${docket.docketId}] assigned to new area. Triggering INTERNAL email to ${uniqueEmails.length} address(es).`);
            await sendInternalAssignedDocketEmail({
                emails: uniqueEmails,
                docketId: docket.docketId,
                description: docket.description,
                company: docket.company
            });
        }
    } catch (error) {
        console.error(`Error handling area assignment notification for docket ${change.documentKey._id}:`, error);
    }
};

const initializeDocketNotifier = () => {
    console.log('🔔 Docket Notifier Initialized. Watching for changes...');

    try {
        const pipeline = [
            // TEMPORAL: Filtro para pruebas locales
           /* {
                $match: { 'fullDocument.docket_area': new mongoose.Types.ObjectId('6903a842ab02ef919023c1d8') }
            },*/
            {
                $addFields: {
                    updatedFieldKeys: { $ifNull: [{ $objectToArray: "$updateDescription.updatedFields" }, []] }
                }
            },
            {
                $match: {
                    $or: [
                        { operationType: 'insert' },
                        { 'updateDescription.updatedFields.status': { $in: ['assigned', 'new', 'in_progress', 'on_hold', 'resolved'] } },
                        { "updatedFieldKeys.k": { $regex: /^subscribers/ } },
                        { 'updateDescription.updatedFields.docket_area': { $exists: true } }
                    ]
                }
            }
        ];

        const changeStream = IncidentDocket.watch(pipeline, {
            fullDocument: 'updateLookup',
            fullDocumentBeforeChange: 'whenAvailable'
        });

        changeStream.on('change', (change) => {

            console.log('**************',change.operationType,JSON.stringify(change.updateDescription))

            
            console.log('************** change.fullDocument',change.operationType,JSON.stringify(change.fullDocument))
            if (change.operationType === 'insert') {

                handleNewDocket(change.fullDocument);
                // evaluate if assigned
                const { status,docket_area} = change.fullDocument;
                if (docket_area && status === 'assigned') { handleAreaNotify(change); }

            }

            if (change.operationType === 'update') {
                const updatedFields = change.updateDescription.updatedFields;
                
                if (updatedFields.status) {
                    if (updatedFields.status === 'assigned') {
                        handleAssignedDocket(change.documentKey._id);

                        if (updatedFields.docket_area) {
                            const beforeDoc = change.fullDocumentBeforeChange;
                            if (!beforeDoc || !beforeDoc.docket_area || beforeDoc.docket_area.length === 0) {
                                handleAreaNotify(change);
                            }
                        }

                    } else if (updatedFields.status === 'new') {
                       /* IncidentDocket.findById(change.documentKey._id).then(docket => {
                            if (docket) handleNewDocket(docket);
                        });*/
                    } else if (updatedFields.status === 'in_progress') {
                        handleInProgressDocket(change.documentKey._id);
                    } else if (updatedFields.status === 'on_hold') {
                        handleOnHoldDocket(change.documentKey._id);
                    } else if (updatedFields.status === 'resolved') {
                        handleResolvedDocket(change.documentKey._id);
                    }
                }

                 
                
                const subscriberAdded = Object.keys(updatedFields).some(key => /^subscribers\.\d+$/.test(key));
                if (subscriberAdded) {
                    handleNewSubscriber(change);
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
