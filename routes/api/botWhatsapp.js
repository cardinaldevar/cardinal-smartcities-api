const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');

// --- MODELOS (Ajusta las rutas según tu estructura) ---
const IncidentBotSession = require('../../models/IncidentBotSession'); 
const IncidentProfile = require('../../models/IncidentProfile');
const IncidentDocketType = require('../../models/IncidentDocketType');
const IncidentDocket = require('../../models/IncidentDocket');
const DocketSource = require('../../models/IncidentDocketSource');
const DocketHistory = require('../../models/IncidentDocketHistory');
const verifySignature = require('../../middleware/whatsappWebHook');
const {predictCategory} = require('../../utils/nlp');

// --- CONFIGURACIÓN ---
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const PHONE_ID = process.env.TIGRESIRVE_WHATSAPP_PHONE_ID;
const API_TOKEN = process.env.TIGRESIRVE_WHATSAPP_API_TOKEN;
const NLP_URL = process.env.TIGRESIRVE_NLP_URL;
const WHATSAPP_SOURCE_ID = '68e7df621c059a57c50d6a36'; // ID de la fuente 'WhatsApp'

// ==================================================================
// 2. SERVICIOS AUXILIARES (Envío de mensajes y NLP)
// ==================================================================
async function sendMessage(to, text) {
    try {
        await axios.post(`https://graph.facebook.com/v17.0/${PHONE_ID}/messages`, {
            messaging_product: 'whatsapp',
            to: to,
            type: 'text',
            text: { body: text }
        }, { headers: { Authorization: `Bearer ${API_TOKEN}` } });
    } catch (error) {
        console.error('Error enviando TXT:', error.response?.data || error.message);
    }
}

async function sendInteractiveButton(to, bodyText, buttons) {
    try {
        const buttonActions = buttons.map(btn => ({
            type: 'reply',
            reply: { id: btn.id, title: btn.title.substring(0, 20) } // WP limita titulos a 20 chars
        }));

        await axios.post(`https://graph.facebook.com/v17.0/${PHONE_ID}/messages`, {
            messaging_product: 'whatsapp',
            to: to,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: bodyText },
                action: { buttons: buttonActions }
            }
        }, { headers: { Authorization: `Bearer ${API_TOKEN}` } });
    } catch (error) {
        console.error('Error enviando BOTONES:', error.response?.data || error.message);
    }
}

async function sendInteractiveList(to, headerText, bodyText, buttonText, sections) {
    try {
        await axios.post(`https://graph.facebook.com/v17.0/${PHONE_ID}/messages`, {
            messaging_product: 'whatsapp',
            to: to,
            type: 'interactive',
            interactive: {
                type: 'list',
                header: { type: 'text', text: headerText },
                body: { text: bodyText },
                footer: { text: 'Selecciona una opción de la lista.'},
                action: {
                    button: buttonText,
                    sections: sections
                }
            }
        }, { headers: { Authorization: `Bearer ${API_TOKEN}` } });
    } catch (error) {
        console.error('Error enviando LISTA:', error.response?.data || error.message);
    }
}


// ==================================================================
// 3. LOGICA DE NEGOCIO / MÁQUINA DE ESTADOS (El Cerebro)
// ==================================================================
async function handleBotFlow(phone, messageData, userName) {
    // Extraer contenido del mensaje de forma unificada
    const currentText = (messageData && (messageData.type === 'text' || messageData.type === 'interactive')) ? messageData.body : null;
    const currentLocation = (messageData && messageData.type === 'location') ? messageData.location : null;
    
    // 1. Buscar o crear sesión
    let session = await IncidentBotSession.findOne({ whatsappId: phone });
    
    if (!session) {
        // Buscamos si ya es un vecino registrado
        const existingProfile = await IncidentProfile.findOne({ 'phone': phone }).select('company status'); // Seleccionamos la compañía y el estado

        // Si el perfil existe pero está inactivo, no continuamos.
        if (existingProfile && existingProfile.status !== 1) {
            await sendMessage(phone, 'Su usuario está inactivo.');
            return; 
        }
        
        session = await IncidentBotSession.create({
            whatsappId: phone,
            profile: existingProfile ? existingProfile._id : null,
            company: existingProfile ? existingProfile.company : null, // Se agrega el campo company aquí
            step: existingProfile ? 'MAIN_MENU' : 'REGISTER_START' 
        });

        // Mensaje de bienvenida inmediato si es sesión nueva
        if (session.step === 'REGISTER_START') {
            await sendMessage(phone, `¡Hola ${userName || ''}! 👋 Bienvenido a Tigre Sirve.\n\nPara poder tomar tus reclamos, necesito registrarte.\n¿Cuál es tu *Nombre*?`);
            session.step = 'REGISTER_NAME';
            await session.save();
            return;
        } else {
            // Si ya existía, saludo de retorno
            await sendMessage(phone, `¡Hola de nuevo ${userName || ''}! 👋 ¿En qué puedo ayudarte hoy? Escribe tu reclamo brevemente.`);
            session.step = 'WAITING_CLAIM';
            await session.save();
            return;
        }
    }

    // Si la sesión ya existe y tiene un perfil, validamos que el perfil siga activo.
    if (session.profile) {
        const userProfile = await IncidentProfile.findById(session.profile).select('status');
        if (!userProfile || userProfile.status !== 1) {
             await sendMessage(phone, 'Su usuario está inactivo.');
             await session.deleteOne(); // Limpiamos la sesión para este usuario inactivo.
             return;
        }
    }

    // 2. Máquina de Estados
    switch (session.step) {
        
        // --- FLUJO DE REGISTRO ---
        case 'REGISTER_NAME':
            session.buffer.tempName = currentText;
            session.step = 'REGISTER_LAST';
            session.markModified('buffer');
            await sendMessage(phone, "Gracias. ¿Cuál es tu *Apellido*?");
            break;

        case 'REGISTER_LAST':
            session.buffer.tempLast = currentText;
            session.step = 'REGISTER_DNI';
            session.markModified('buffer');
            await sendMessage(phone, "Perfecto. Ahora ingresá tu *DNI* (solo números):");
            break;
        
        case 'REGISTER_DNI':
            if (!/^\d+$/.test(currentText)) {
                await sendMessage(phone, "El DNI solo debe contener números. Intenta de nuevo:");
                return;
            }
            session.buffer.tempDni = currentText;
            session.step = 'REGISTER_EMAIL';
            session.markModified('buffer');
            await sendMessage(phone, "Por último, ingresá tu *Email*:");
            break;

        case 'REGISTER_EMAIL':
             const newProfile = await new IncidentProfile({
                 name: session.buffer.tempName,
                 last: session.buffer.tempLast,
                 dni: session.buffer.tempDni,
                 email: currentText,
                 phone: phone,
                 registerFrom: 'whatsapp'
             }).save();
             
             session.profile = newProfile._id;
             session.step = 'WAITING_CLAIM';
             session.buffer = {};
             session.markModified('buffer');
             
             await sendMessage(phone, "¡Registro Exitoso! 🎉\n\nAhora sí, contame ¿cuál es tu reclamo? (Ej: 'Luz quemada en la esquina de italia al 1200')");
            break;

        // --- FLUJO DE RECLAMOS ---
        case 'WAITING_CLAIM':
        case 'MAIN_MENU':
            await sendMessage(phone, "Analizando tu reclamo... ⏳");
            const prediction = await predictCategory(currentText);
            console.log(JSON.stringify(prediction))

            if (prediction && prediction.bestMatch) {
                session.buffer.draftClaim = currentText;
                session.buffer.bestMatch = prediction.bestMatch;
                session.buffer.otherOptions = prediction.allOptions;
                session.buffer.sentiment = prediction.sentiment; // Store sentiment
                session.markModified('buffer');
                session.step = 'CONFIRM_CATEGORY';
                
                await sendInteractiveButton(phone, 
                    `Identifiqué que tu reclamo se refiere a: *${prediction.bestMatch.name}*.\n\n¿Es esto correcto?`,
                    [{id: 'confirm_yes', title: 'Sí, confirmar'}, {id: 'confirm_no', title: 'No, es otro'}]
                );
            } else {
                await sendMessage(phone, "No pude entender la categoría de tu reclamo. ¿Podrías ser más específico?");
            }
            break;

        case 'CONFIRM_CATEGORY':
            if (currentText === 'confirm_yes') {
                const selectedCategory = session.buffer.bestMatch;

                if (selectedCategory && selectedCategory.fields && selectedCategory.fields.length > 0) {
                    session.buffer.form_fields = selectedCategory.fields;
                    session.buffer.current_field_index = 0;
                    session.details = {};
                    session.step = 'COLLECTING_FIELDS';
                    session.markModified('buffer');
                    session.markModified('details');
                    
                    const currentField = session.buffer.form_fields[0];
                    let message = `Confirmado: *"${selectedCategory.name}"*.\n\nAhora necesito algunos datos más.\n`;
                    if (currentField.key === 'address') {
                        message += 'Por favor, envíame la ubicación exacta. Para ello, usa el botón de adjuntar (📎) y selecciona "Ubicación".';
                    } else {
                        message += `Por favor, ingresa *${currentField.label}*`;
                        if (currentField.placeholder) {
                            message += ` (Ej: ${currentField.placeholder})`;
                        }
                    }
                    await sendMessage(phone, message);

                } else {

                    const docketTypePredicted = {
                        refId: selectedCategory._id,
                        name: selectedCategory.name,
                        score: selectedCategory.score
                    };
                    const docketData = {
                        profile: session.profile,
                        company: session.company,
                        docket_type: selectedCategory._id,
                        docket_area: selectedCategory.docket_area || [],
                        description: session.buffer.draftClaim,
                        source: WHATSAPP_SOURCE_ID,
                        docket_type_predicted:docketTypePredicted,
                        sentiments: session.buffer.sentiment ? [
                           {
                            analysisStage: 'initial',
                            sentiment: session.buffer.sentiment.tone, 
                            sentimentScore: {
                                positive: session.buffer.sentiment.scores.POSITIVE,
                                negative: session.buffer.sentiment.scores.NEGATIVE,
                                neutral: session.buffer.sentiment.scores.NEUTRAL,
                                mixed: session.buffer.sentiment.scores.MIXED
                            }
                        }] : []
                    };

                    // Añadir campos de ubicación de primer nivel si existen en el buffer
                    if (session.buffer.docketAddress) {
                        docketData.address = session.buffer.docketAddress;
                    }
                    if (session.buffer.docketLocation) {
                        docketData.location = session.buffer.docketLocation;
                    }

                    const newDocket = new IncidentDocket(docketData);
                    await newDocket.save();

                    const initialHistoryEntry = new DocketHistory({
                        docket: newDocket._id,      
                        user: session.profile, 
                        userModel: 'IncidentProfile',
                        status:'new',        
                        content: 'Legajo iniciado Whatsapp'
                    });
                    
                    await initialHistoryEntry.save();

                    await sendMessage(phone, `✅ Reclamo para "${selectedCategory.name}" generado con éxito. Tu número de seguimiento es #${newDocket.docketId}.`);
                    
                    await session.deleteOne();
                    return;
                }

            } else if (currentText === 'confirm_no') {

                if (session.buffer.otherOptions && session.buffer.otherOptions.length > 0) {
                    session.step = 'CHOOSE_OTHER_CATEGORY';
                    const rows = session.buffer.otherOptions.map(opt => ({
                        id: opt._id,
                        title: opt.name.substring(0, 24),
                        description: (opt.parent || '').substring(0, 72)
                    }));

                    await sendInteractiveList(phone,
                        'Recategorizar reclamo',
                        'Selecciona la categoría a la que corresponde',
                        'Ver Opciones',
                        [{ title: 'Selecciona una categoría', rows: rows }]
                    );

                } else {
                    await sendMessage(phone, "No encontré otras alternativas. Por favor, intenta describir tu problema con otras palabras.");
                    session.step = 'WAITING_CLAIM';
                }
            } else {
                 await sendMessage(phone, "Por favor, usa los botones para responder.");
            }
            break;
            
        case 'COLLECTING_FIELDS':
            const currentIndex = session.buffer.current_field_index;
            const fields = session.buffer.form_fields;
            const currentField = fields[currentIndex];
            
            // --- INICIO: Lógica para Dirección (Address) ---
            if (currentField.key === 'address') {
                if (currentLocation) { // Se recibió un objeto de ubicación
                    const lat = parseFloat(currentLocation.latitude);
                    const lng = parseFloat(currentLocation.longitude);
                    let addressText = currentLocation.address || currentLocation.name;

                    // TODO: Si no viene addressText de WhatsApp, hacer geocodificación inversa con Nominatim.
                    // if (!addressText) {
                    //    const reverseGeocoded = await nominatim.reverse(lat, lng);
                    //    addressText = reverseGeocoded.display_name;
                    // }

                    const locationObject = {
                        type: 'Point',
                        coordinates: [lng, lat]
                    };
                    
                    // Guardar para los campos de primer nivel del Docket
                    session.buffer.docketAddress = addressText;
                    session.buffer.docketLocation = locationObject;
                    session.markModified('buffer');

                    // Formatear para el campo `details` del Docket
                    fieldValue = {
                        value: addressText || 'Ubicación sin nombre',
                        label: currentField.label,
                        location: locationObject
                    };
                    
                } else {
                    // No se recibió un objeto de ubicación (el usuario envió texto o interactivo)
                    await sendMessage(phone, 'Respuesta no válida. Para la dirección, por favor, envíame la ubicación exacta usando el botón de adjuntar (📎) y seleccionando "Ubicación".');
                    return; // Detenemos el flujo para que el usuario pueda reintentar.
                }
            } else {
                // Si no es un campo de dirección, se usa el currentText como valor
                fieldValue = currentText;
            }
            // --- FIN: Lógica para Dirección (Address) ---

            session.details = {
                ...(session.details || {}),
                [currentField.key]: fieldValue
            };

            const nextIndex = currentIndex + 1;

            if (nextIndex < fields.length) {
                session.buffer.current_field_index = nextIndex;
                const nextField = fields[nextIndex];
                
                let message = '';
                if (nextField.key === 'address') {
                    message = 'Por favor, envíame la ubicación exacta. Para ello, usa el botón de adjuntar (📎) y selecciona "Ubicación".';
                } else {
                    message = `Por favor, ingresa *${nextField.label}*`;
                    if (nextField.placeholder) {
                        message += ` (Ej: ${nextField.placeholder})`;
                    }
                }
                await sendMessage(phone, message);

            } else {

                const selectedCategory = session.buffer.bestMatch;
                const docketTypePredicted = {
                        refId: selectedCategory._id,
                        name: selectedCategory.name,
                        score: selectedCategory.score
                    };
                
                const docketData = {
                    profile: session.profile,
                    company: session.company,
                    docket_type: selectedCategory._id,
                    docket_area: selectedCategory.docket_area || [],
                    description: session.buffer.draftClaim,
                    details: session.details || {},
                    source: WHATSAPP_SOURCE_ID,
                    docket_type_predicted:docketTypePredicted,
                    sentiments: session.buffer.sentiment ? [
                           {
                            analysisStage: 'initial',
                            sentiment: session.buffer.sentiment.tone, 
                            sentimentScore: {
                                positive: session.buffer.sentiment.scores.POSITIVE,
                                negative: session.buffer.sentiment.scores.NEGATIVE,
                                neutral: session.buffer.sentiment.scores.NEUTRAL,
                                mixed: session.buffer.sentiment.scores.MIXED
                            }
                        }] : []
                };

                // Añadir campos de ubicación de primer nivel si existen en el buffer
                if (session.buffer.docketAddress) {
                    docketData.address = session.buffer.docketAddress;
                }
                if (session.buffer.docketLocation) {
                    docketData.location = session.buffer.docketLocation;
                }
                
                const newDocket = new IncidentDocket(docketData);
                await newDocket.save();

                const initialHistoryEntry = new DocketHistory({
                        docket: newDocket._id,      
                        user: session.profile, 
                        userModel: 'IncidentProfile',
                        status:'new',        
                        content: 'Legajo iniciado Whatsapp'
                    });
                    
                await initialHistoryEntry.save();

                
                await sendMessage(phone, `✅ Reclamo para "${selectedCategory.name}" generado con éxito. Tu número de seguimiento es #${newDocket.docketId}.`);
                
                await session.deleteOne();
                return;
            }
            
            session.markModified('buffer');
            session.markModified('details');
            break;

        case 'CHOOSE_OTHER_CATEGORY':
            const selectedOptionId = currentText;
            const chosenOption = session.buffer.otherOptions.find(opt => opt._id === selectedOptionId);

            if (chosenOption) {
                //session.buffer.bestMatch = chosenOption; 

                if (chosenOption && chosenOption.fields && chosenOption.fields.length > 0) {
                    session.buffer.form_fields = chosenOption.fields;
                    session.buffer.current_field_index = 0;
                    session.details = {};
                    session.step = 'COLLECTING_FIELDS';
                    session.markModified('buffer');
                    session.markModified('details');

                    const firstField = session.buffer.form_fields[0];
                    let message = `Entendido: *"${chosenOption.name}"*.\n\nPara continuar, necesito unos datos más.\n`;

                    if (firstField.key === 'address') {
                        message += 'Por favor, envíame la ubicación exacta. Para ello, usa el botón de adjuntar (📎) y selecciona "Ubicación".';
                    } else {
                        message += `Por favor, ingresa *${firstField.label}*`;
                        if (firstField.placeholder) {
                            message += ` (Ej: ${firstField.placeholder})`;
                        }
                    }
                    await sendMessage(phone, message);
                } else {

                    const selectedCategory = session.buffer.bestMatch;
                    const docketTypePredicted = {
                        refId: selectedCategory._id,
                        name: selectedCategory.name,
                        score: selectedCategory.score
                    };
                    const docketData = {
                        profile: session.profile,
                        company: session.company,
                        docket_type: chosenOption._id,
                        docket_area: chosenOption.docket_area || [],
                        description: session.buffer.draftClaim,
                        source: WHATSAPP_SOURCE_ID,
                        docket_type_predicted:docketTypePredicted,
                        sentiments: session.buffer.sentiment ? [
                           {
                            analysisStage: 'initial',
                            sentiment: session.buffer.sentiment.tone, 
                            sentimentScore: {
                                positive: session.buffer.sentiment.scores.POSITIVE,
                                negative: session.buffer.sentiment.scores.NEGATIVE,
                                neutral: session.buffer.sentiment.scores.NEUTRAL,
                                mixed: session.buffer.sentiment.scores.MIXED
                            }
                        }] : []
                    };

                    // Añadir campos de ubicación de primer nivel si existen en el buffer
                    if (session.buffer.docketAddress) {
                        docketData.address = session.buffer.docketAddress;
                    }
                    if (session.buffer.docketLocation) {
                        docketData.location = session.buffer.docketLocation;
                    }

                    const newDocket = new IncidentDocket(docketData);
                    await newDocket.save();

                    const initialHistoryEntry = new DocketHistory({
                        docket: newDocket._id,      
                        user: session.profile, 
                        userModel: 'IncidentProfile',
                        status:'new',        
                        content: 'Legajo iniciado Whatsapp'
                    });
                    
                    await initialHistoryEntry.save();

                    await sendMessage(phone, `✅ Reclamo para "${chosenOption.name}" generado con éxito. Tu número de seguimiento es #${newDocket.docketId}.`);
                    
                    await session.deleteOne();
                    return;
                }
            } else {
                await sendMessage(phone, "La opción seleccionada no es válida. Por favor, intenta describir tu problema de nuevo.");
                session.step = 'WAITING_CLAIM';
            }
            break;

        default:
             await sendMessage(phone, "No entendí ese comando. Escribe 'Hola' para reiniciar.");
    }

    await session.save();
}

// ==================================================================
// 4. DEFINICIÓN DE RUTAS (Endpoints)
// ==================================================================

// GET: Verificación del Webhook (Meta lo llama al configurar)
router.get('/webhook', (req, res) => {

    console.log(req.query)
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verificado.');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// POST: Recepción de mensajes
router.post('/webhook', verifySignature, async (req, res) => {
    try {
        const body = req.body;
console.log(JSON.stringify(req.body))
        if (body.object === 'whatsapp_business_account') {
            // Procesamos cada entrada en background
            body.entry.forEach(entry => {
                entry.changes.forEach(change => {
                    const value = change.value;
                    
                    if (value.messages && value.messages.length > 0) {
                        const msg = value.messages[0];
                        const contact = value.contacts ? value.contacts[0] : {};
                        const from = msg.from;
                        console.log('-----',contact.profile.wa_id)
                        console.log('-----',msg.from)
                        let messageData = { type: msg.type };
                        if (msg.type === 'text') {
                            messageData.body = msg.text.body;
                        } else if (msg.type === 'interactive') {
                            messageData.body = msg.interactive.button_reply
                                ? msg.interactive.button_reply.id
                                : msg.interactive.list_reply.id;
                        } else if (msg.type === 'location') {
                            messageData.location = msg.location; // Pasa el objeto location completo
                        } else {
                            // Si es un tipo de mensaje no manejado (ej: imagen, video), no hacer nada
                            messageData = null; 
                        }

                        // No esperamos await aquí para devolver rápido el 200 OK a Meta
                        // Solo procesamos si tenemos un objeto messageData válido
                        if (messageData) {
                            handleBotFlow(from, messageData, contact.profile?.name).catch(e =>
                                console.error('Error en BotFlow:', e)
                            );
                        }
                    }
                });
            });
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error('Error general en webhook:', error);
        res.sendStatus(500);
    }
});

module.exports = router;