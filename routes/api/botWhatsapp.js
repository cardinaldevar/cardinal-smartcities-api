const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');

// --- MODELOS (Ajusta las rutas según tu estructura) ---
const IncidentBotSession = require('../../models/IncidentBotSession'); 
const IncidentProfile = require('../../models/IncidentProfile');
const IncidentDocketType = require('../../models/IncidentDocketType');
const verifySignature = require('../../middleware/whatsappWebHook');
const {predictCategory} = require('../../utils/nlp');

// --- CONFIGURACIÓN ---
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const PHONE_ID = process.env.TIGRESIRVE_WHATSAPP_PHONE_ID;
const API_TOKEN = process.env.TIGRESIRVE_WHATSAPP_API_TOKEN;
const NLP_URL = process.env.TIGRESIRVE_NLP_URL;

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


// ==================================================================
// 3. LOGICA DE NEGOCIO / MÁQUINA DE ESTADOS (El Cerebro)
// ==================================================================
async function handleBotFlow(phone, text, userName) {
    
    // 1. Buscar o crear sesión
    let session = await IncidentBotSession.findOne({ whatsappId: phone });
    
    if (!session) {
        // Buscamos si ya es un vecino registrado
        const existingProfile = await IncidentProfile.findOne({ 'phone': phone });
        
        session = await IncidentBotSession.create({
            whatsappId: phone,
            profile: existingProfile ? existingProfile._id : null,
            step: existingProfile ? 'MAIN_MENU' : 'REGISTER_START' 
        });

        // Mensaje de bienvenida inmediato si es sesión nueva
        if (session.step === 'REGISTER_START') {
            await sendMessage(phone, `¡Hola ${userName || ''}! 👋 Bienvenido al Asistente Vecinal de Tigre.\n\nPara poder tomar tus reclamos, necesito registrarte.\n¿Cuál es tu *Nombre*?`);
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

    // 2. Máquina de Estados
    switch (session.step) {
        
        // --- FLUJO DE REGISTRO ---
        case 'REGISTER_NAME':
            session.buffer.tempName = text;
            session.step = 'REGISTER_LAST';
            session.markModified('buffer');
            await sendMessage(phone, "Gracias. ¿Cuál es tu *Apellido*?");
            break;

        case 'REGISTER_LAST':
            session.buffer.tempLast = text;
            session.step = 'REGISTER_DNI';
            session.markModified('buffer');
            await sendMessage(phone, "Perfecto. Ahora ingresá tu *DNI* (solo números):");
            break;
        
        case 'REGISTER_DNI':
            // Validación simple de DNI
            if (!/^\d+$/.test(text)) {
                await sendMessage(phone, "El DNI solo debe contener números. Intenta de nuevo:");
                return; // No avanzamos paso
            }
            session.buffer.tempDni = text;
            session.step = 'REGISTER_EMAIL';
            session.markModified('buffer');
            await sendMessage(phone, "Por último, ingresá tu *Email*:");
            break;

        case 'REGISTER_EMAIL':
             // Finalización de Registro
             // Aquí deberías crear/actualizar el Profile real en Mongo
             const newProfile = await new IncidentProfile({
                 name: session.buffer.tempName,
                 last: session.buffer.tempLast,
                 dni: session.buffer.tempDni,
                 email: text, // Asumimos válido
                 phone: phone,
                 registerFrom: 'whatsapp'
             }).save();
             
             session.profile = newProfile._id;
             session.step = 'WAITING_CLAIM';
             session.buffer = {}; // Limpiamos buffer
             session.markModified('buffer');
             
             await sendMessage(phone, "¡Registro Exitoso! 🎉\n\nAhora sí, contame ¿cuál es tu reclamo? (Ej: 'Luz quemada en la esquina')");
            break;

        // --- FLUJO DE RECLAMOS ---
        case 'WAITING_CLAIM':
        case 'MAIN_MENU':
            await sendMessage(phone, "Analizando tu reclamo... ⏳");
            const categoria = await predictCategory(text);

            if (categoria) {
                session.buffer.draftClaim = text;
                session.buffer.catId = categoria.id;
                session.markModified('buffer');
                session.step = 'CONFIRM_CATEGORY';
                
                await sendInteractiveButton(phone, 
                    `Detectamos: *${categoria.fullName}*.\n¿Es correcto?`,
                    [{id: 'yes', title: 'Sí, confirmar'}, {id: 'no', title: 'No, es otro'}]
                );
            } else {
                await sendMessage(phone, "No pude entender la categoría. ¿Podrías ser más específico?");
            }
            break;

        case 'CONFIRM_CATEGORY':
            if (text.toLowerCase() === 'sí, confirmar' || text === 'yes') {
                // AQUÍ CREARÍAS EL INCIDENT DOCKET REAL
                await sendMessage(phone, "✅ Reclamo generado con éxito. Tu número de seguimiento es #12345.");
                session.step = 'WAITING_CLAIM'; // Vuelta al inicio
                session.buffer = {};
                session.markModified('buffer');
            } else {
                await sendMessage(phone, "Entendido. Por favor describe tu problema con otras palabras:");
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
                        
                        let textBody = '';
                        if (msg.type === 'text') textBody = msg.text.body;
                        else if (msg.type === 'interactive') {
                            textBody = msg.interactive.button_reply 
                                ? msg.interactive.button_reply.id 
                                : msg.interactive.list_reply.id;
                        }

                        // No esperamos await aquí para devolver rápido el 200 OK a Meta
                        handleBotFlow(from, textBody, contact.profile?.name).catch(e => 
                            console.error('Error en BotFlow:', e)
                        );
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