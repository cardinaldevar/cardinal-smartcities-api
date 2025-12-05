const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');
const https = require('https');

// --- MODELOS (Ajusta las rutas según tu estructura) ---
const IncidentBotSession = require('../../models/IncidentBotSession'); 
const IncidentProfile = require('../../models/IncidentProfile');
const IncidentDocketType = require('../../models/IncidentDocketType');
const IncidentDocket = require('../../models/IncidentDocket');
const DocketSource = require('../../models/IncidentDocketSource');
const DocketHistory = require('../../models/IncidentDocketHistory');
const Company = require('../../models/Company');
const CONS = require('../../utils/CONS');
const verifySignature = require('../../middleware/whatsappWebHook');
const {predictCategory} = require('../../utils/nlp');
const { sendNewProfileEmail, sendNewPasswordEmail } = require('../../utils/ses');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');

// --- CONFIGURACIÓN ---
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const PHONE_ID = process.env.TIGRESIRVE_WHATSAPP_PHONE_ID;
const API_TOKEN = process.env.TIGRESIRVE_WHATSAPP_API_TOKEN;
const NLP_URL = process.env.TIGRESIRVE_NLP_URL;
const WHATSAPP_SOURCE_ID = '68e7df621c059a57c50d6a36'; // ID de la fuente 'WhatsApp'

// Mapa para asociar el número de teléfono del bot a una compañía
const companyPhoneMapping = {
    '5491176011378': '68e9c3977c6f1f402e7b91e0' //phone tigre sirve
};

// ==================================================================
// 2. SERVICIOS AUXILIARES (Envío de mensajes y NLP)
// ==================================================================

// Helper para enmascarar email
function maskEmail(email) {
    if (!email) return '';
    const [localPart, domain] = email.split('@');
    if (!domain) return email; 
    const maskedLocal = localPart.length > 3 ? localPart.substring(0, 3) + '****' : localPart.substring(0, 1) + '****';
    return `${maskedLocal}@${domain}`;
}

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
async function handleBotFlow(phone, messageData, userName, botPhoneNumber) {
    // Extraer contenido del mensaje de forma unificada
    const currentText = (messageData && (messageData.type === 'text' || messageData.type === 'interactive')) ? messageData.body : null;
    const currentLocation = (messageData && messageData.type === 'location') ? messageData.location : null;

    // --- NUEVA LÓGICA: Comando de Reinicio ---
    if (currentText && typeof currentText === 'string' && currentText.toLowerCase() === 'salir') {
        let session = await IncidentBotSession.findOne({ whatsappId: phone });
        if (session) {
            await session.deleteOne();
            await sendMessage(phone, "¡Intentemos nuevamente! Cuando quieras, escríbeme 'Hola' para empezar de nuevo.");
            return; // Detener el procesamiento
        } else {
            // Si no hay sesión, pero escriben *salir, simplemente les decimos que empiecen.
            await sendMessage(phone, "Parece que no tienes una conversación activa conmigo en este momento. Si quieres empezar, ¡solo escribe 'Hola'!");
            return;
        }
    }
    // --- FIN Comando de Reinicio ---
    
    // 1. Buscar o crear sesión
    let session = await IncidentBotSession.findOne({ whatsappId: phone });
    
    if (!session) {
        // Buscamos si ya es un vecino registrado por su teléfono
        const existingProfile = await IncidentProfile.findOne({ 'phone': phone }).select('company status');

        if (existingProfile && existingProfile.status !== 1) {
            await sendMessage(phone, 'Su usuario está inactivo.');
            return; 
        }

        // Determinar el paso inicial: si no se encuentra por teléfono, se le da a elegir.
        const initialStep = existingProfile ? 'MAIN_MENU' : 'CHOOSE_LOGIN_OR_REGISTER';
        const companyForSession = existingProfile ? existingProfile.company : (companyPhoneMapping[botPhoneNumber] || null);
        
        session = await IncidentBotSession.create({
            whatsappId: phone,
            profile: existingProfile ? existingProfile._id : null,
            company: companyForSession,
            step: initialStep 
        });

        // Enviar el primer mensaje según el paso inicial
        if (session.step === 'CHOOSE_LOGIN_OR_REGISTER') {
            let companyName = 'Cardinal'; // Fallback
            if (session.company) {
                const company = await Company.findById(session.company).select('name').lean();
                if (company) { companyName = company.name; }
            }
            await sendInteractiveButton(
                phone, 
                `¡Hola ${userName || ''}! 👋 Bienvenido a ${companyName}.\n\nPara continuar, ¿ya tienes una cuenta o necesitas registrarte?\n\nSi en algún momento quieres reiniciar nuestra conversación, escribe 'salir'.`,
                [
                    {id: 'login_existing', title: '👤 Ya tengo cuenta'}, 
                    {id: 'register_new', title: '🔑 Registrarme'},
                    {id: 'forgot_password', title: 'Olvidé mi contraseña'}
                ]
            );
        } else { // 'MAIN_MENU'
            await sendMessage(phone, `¡Hola de nuevo ${userName || ''}! 👋 ¿En qué puedo ayudarte hoy?\n\nSi en algún momento quieres reiniciar nuestra conversación, escribe 'salir'.\n\nEscribe tu reclamo brevemente.`);
            session.step = 'WAITING_CLAIM';
            await session.save();
        }
        return; // Detenemos la ejecución aquí para esperar la respuesta del usuario
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

        // --- FLUJO DE LOGIN / REGISTRO INICIAL ---
        case 'CHOOSE_LOGIN_OR_REGISTER':
            if (currentText === 'login_existing') {
                session.step = 'LOGIN_DNI';
                session.buffer.loginAttempts = 0; // Initialize login attempts
                session.markModified('buffer');
                await sendMessage(phone, "Entendido. Para iniciar sesión, por favor ingresa tu *DNI*:");
            } else if (currentText === 'register_new') {
                session.step = 'REGISTER_NAME';
                await sendMessage(phone, "Perfecto. Para crear tu cuenta, ¿Cuál es tu *Nombre*?");
            } else if (currentText === 'forgot_password') {
                session.step = 'FORGOT_PASSWORD_DNI';
                await sendMessage(phone, "Entendido. Para recuperar tu contraseña, por favor ingresa tu *DNI*:");
            } else {
                await sendMessage(phone, "Por favor, usa los botones para elegir una opción.");
            }
            break;

        // --- FLUJO DE OLVIDÉ CONTRASEÑA ---
        case 'FORGOT_PASSWORD_DNI':
            const userToReset = await IncidentProfile.findOne({ 
                dni: currentText, 
                company: session.company 
            });

            if (!userToReset || userToReset.status !== 1) {
                await sendMessage(phone, "No encontramos un usuario activo con ese DNI. Por favor, contacta a soporte si crees que es un error.");
                await session.deleteOne(); // Terminar sesión por seguridad
                return;
            }

            try {
                // Generar y guardar nueva contraseña
                const newPassword = nanoid(10);
                const salt = await bcrypt.genSalt(10);
                userToReset.password = await bcrypt.hash(newPassword, salt);
                await userToReset.save();

                // Enviar email con la nueva contraseña
                await sendNewPasswordEmail({
                    email: userToReset.email,
                    newPassword: newPassword,
                    company: userToReset.company
                });

                const maskedEmail = maskEmail(userToReset.email);
                await sendMessage(phone, `✅ Se ha enviado una nueva contraseña a tu email: *${maskedEmail}*.\n\nPor favor, revisa tu correo y vuelve a iniciar la conversación para ingresar con tu nueva clave.`);
            
            } catch (error) {
                console.error("Error en el flujo de olvidé contraseña:", error.message);
                await sendMessage(phone, "Hubo un problema al procesar tu solicitud. Por favor, intenta de nuevo más tarde.");
            }
            
            await session.deleteOne(); // Terminar sesión por seguridad
            break;

        // --- FLUJO DE LOGIN ---
        case 'LOGIN_DNI':
            session.buffer.loginDni = currentText;
            session.step = 'LOGIN_PASSWORD';
            session.markModified('buffer');
            await sendMessage(phone, "Gracias. Ahora, por favor, ingresa tu *contraseña*:");
            break;

        case 'LOGIN_PASSWORD':

            const userToLogin = await IncidentProfile.findOne({ 
                dni: session.buffer.loginDni, 
                company: session.company 
            });

            if (!userToLogin) {
                session.step = 'LOGIN_DNI'; // Reiniciar
                session.buffer = {};
                session.markModified('buffer');
                await sendMessage(phone, "No encontramos un usuario con ese DNI. Por favor, intenta de nuevo o regístrate. Ingresa tu *DNI*:");
                return;
            }

            const isMatch = await bcrypt.compare(currentText, userToLogin.password);

            if (!isMatch) {
                session.buffer.loginAttempts = (session.buffer.loginAttempts || 0) + 1;
                session.markModified('buffer');

                if (session.buffer.loginAttempts >= 3) {
                    await sendMessage(phone, "Has excedido el número de intentos. Por favor, intenta de nuevo más tarde o recupera tu contraseña.");
                    await session.deleteOne(); // Terminar sesión por seguridad
                    return;
                } else {
                    const remainingAttempts = 3 - session.buffer.loginAttempts;
                    await sendMessage(phone, `Contraseña incorrecta. Te quedan ${remainingAttempts} intento(s) más.`);
                    await session.save(); // Persist the session after updating the counter
                    return; // Se queda en el mismo paso 'LOGIN_PASSWORD'
                }
            }

            // --- ¡Login Exitoso! ---
            userToLogin.phone = phone; // Actualizar el teléfono
            await userToLogin.save();

            session.profile = userToLogin._id;
            session.step = 'WAITING_CLAIM';
            session.buffer = {}; // Limpiar buffer
            session.buffer.loginAttempts = 0; // Reset login attempts on success
            session.markModified('buffer');

            await sendMessage(phone, `¡Hola de nuevo, ${userToLogin.name}! 👋 Sesión iniciada correctamente.\n\n¿En qué puedo ayudarte hoy? Escribe tu reclamo brevemente.`);
            break;
        
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

            // --- Inicio de la Validación ---
            const existingProfileByDni = await IncidentProfile.findOne({ dni: currentText, company: session.company });

            if (existingProfileByDni) {
                await sendMessage(phone, "Ya existe un usuario registrado con ese DNI. Si crees que es un error, por favor contacta a soporte.");
                return; 
            }
            // --- Fin de la Validación ---

            session.buffer.tempDni = currentText;
            session.step = 'REGISTER_TRAMITE'; // <--- NUEVO PASO
            session.markModified('buffer');
            await sendMessage(phone, "Gracias. Ahora, por favor, ingresá tu *Número de Trámite* del DNI.\n\nEl número de trámite del DNI argentino es un código de 11 dígitos que sirve para validar la identidad en gestiones en línea. Es importante para priorizar tus reclamos.");
            break;

        case 'REGISTER_TRAMITE':
            if (!/^\d{11}$/.test(currentText)) {
                await sendMessage(phone, "El Número de Trámite debe contener exactamente 11 dígitos. Por favor, intenta de nuevo:");
                return;
            }

            session.buffer.tempTramite = currentText; // Guardar número de trámite
            session.step = 'REGISTER_GENDER';
            session.markModified('buffer');

            await sendInteractiveButton(phone, 
                "Para validar tu identidad, por favor selecciona tu género:",
                [{id: 'male', title: 'Masculino'}, {id: 'female', title: 'Femenino'}]
            );
            break;

        case 'REGISTER_GENDER':
            const gender = currentText; // 'male' o 'female'
            if (gender !== 'male' && gender !== 'female') {
                await sendMessage(phone, "Por favor, selecciona una de las opciones usando los botones.");
                return;
            }
            session.buffer.tempGender = gender;
            session.markModified('buffer');

            await sendMessage(phone, "Validando identidad... ⏳");

            try {
                const httpsAgent = new https.Agent({ rejectUnauthorized: false });
                const genderForApi = gender === 'male' ? 'M' : 'F';
                
                const dniValidationPayload = {
                    token: process.env.token_service_tigre, 
                    dni: session.buffer.tempDni,
                    sexo: genderForApi,
                    id_tramite: session.buffer.tempTramite
                };
        
                const headers = { 'Content-Type': 'application/json' };
                const dniApiUrl = 'https://www.tigre.gob.ar/Restserver/vigencia_dni';
                const dniValidationResponse = await axios.post(dniApiUrl, dniValidationPayload, { headers, httpsAgent });
                
                if (dniValidationResponse.data.error || dniValidationResponse.data.data.mensaje !== 'DNI VIGENTE') {
                    // --- CASO FALLIDO ---
                    await sendMessage(phone, 'No pudimos validar tu identidad. Continuaremos con el registro, pero tu perfil no estará verificado.');
                    session.buffer.isVerified = false;
                } else {
                    // --- CASO EXITOSO ---
                    session.buffer.isVerified = true;
                    await sendMessage(phone, "¡Identidad validada! 👍");
                }

                // --- SIGUIENTE PASO (COMÚN A AMBOS CASOS) ---
                session.step = 'REGISTER_EMAIL';
                session.markModified('buffer');
                await sendMessage(phone, "\n\nAhora ingresá tu *Email*:\nEs importante que sea un email válido para que te lleguen las notificaciones de resolución.");

            } catch (error) {
                console.error("Error en validación de DNI:", error.message);
                await sendMessage(phone, "Hubo un problema con el servicio de validación. Continuaremos con el registro, pero tu perfil no estará verificado.");
                
                session.buffer.isVerified = false;
                session.step = 'REGISTER_EMAIL';
                session.markModified('buffer');
                await sendMessage(phone, "\n\nAhora ingresá tu *Email*:\nEs importante que sea un email válido para que te lleguen las notificaciones de resolución.");
            }
            break;
			
        case 'REGISTER_EMAIL':
            // --- Inicio de la Validación de Formato de Email ---
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(currentText)) {
                await sendMessage(phone, "El formato del email no parece válido. Por favor, asegúrate de que sea como 'nombre@ejemplo.com' e intenta de nuevo.");
                return;
            }
            // --- Fin de la Validación de Formato de Email ---

            // --- Inicio de la Validación de Email Existente ---
            const existingProfileByEmail = await IncidentProfile.findOne({ email: currentText, company: session.company });

            if (existingProfileByEmail) {
                await sendMessage(phone, "Este email ya está registrado con otro usuario. Por favor, ingresa un email diferente o contacta a soporte.");
                return;
            }
            // --- Fin de la Validación de Email Existente ---

            session.buffer.tempEmail = currentText; // Guardar email en el buffer
            session.step = 'REGISTER_PASSWORD'; // Siguiente paso: contraseña
            session.markModified('buffer');
             
            await sendMessage(phone, "Ahora, por favor crea una contraseña. Debe tener *al menos 6 caracteres*.");
            break;

        case 'REGISTER_PASSWORD':
            // --- Validación de Longitud de Contraseña ---
            if (!currentText || currentText.length < 6) {
                await sendMessage(phone, "La contraseña es muy corta. Debe tener *al menos 6 caracteres*. Por favor, intenta de nuevo.");
                return;
            }
            // --- Fin de la Validación ---

            const plainTextPassword = currentText; // Guardar contraseña para el email

            // Encriptar contraseña
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(plainTextPassword, salt);

            const newProfile = await new IncidentProfile({
                 company: session.company,
                 name: session.buffer.tempName,
                 last: session.buffer.tempLast,
                 dni: session.buffer.tempDni,
                 transactionNumber: session.buffer.tempTramite,
                 gender: session.buffer.tempGender,
                 isVerified: session.buffer.isVerified || false,
                 email: session.buffer.tempEmail,
                 password: hashedPassword, 
                 phone: phone,
                 registerFrom: 'whatsapp'
             }).save();
             
             session.profile = newProfile._id;
             
             // --- Enviar Email de Bienvenida ---
             try {
                await sendNewProfileEmail({
                    email: newProfile.email,
                    name: newProfile.name,
                    lastname: newProfile.last,
                    dni: newProfile.dni,
                    password: plainTextPassword,
                    company: session.company
                });
                await sendMessage(phone, "¡Registro Exitoso! 🎉\n\nRevisa tu casilla de email para obtener tus datos de acceso a la plataforma.\n\nAhora sí, contame ¿cuál es tu reclamo? (Ej: 'Luz quemada en la esquina de italia al 1200')");
             } catch (emailError) {
                console.error("Error enviando el email de bienvenida desde el bot:", emailError.message);
                // Si el email falla, al menos le avisamos que el registro fue exitoso.
                await sendMessage(phone, "¡Registro Exitoso! 🎉\n\nNo pudimos enviar el email con tus datos de acceso, pero ya podés usar el bot.\n\nAhora sí, contame ¿cuál es tu reclamo? (Ej: 'Luz quemada en la esquina de italia al 1200')");
             }
             // --- Fin Envío de Email ---

             session.step = 'WAITING_CLAIM';
             session.buffer = {}; // Limpiar buffer
             session.markModified('buffer');
             
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
                    `Identifiqué que tu reclamo se refiere a: ${prediction.bestMatch.parent} > *${prediction.bestMatch.name}*.\n\n¿Es esto correcto?`,
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

                    // Si WhatsApp no nos da el texto de la dirección, la buscamos nosotros.
                    if (!addressText) {
                        try {
                            let countryCode = 'AR'; // Opción A: Default a Argentina

                            // Si la sesión tiene una compañía, usamos su país
                            if (session.company) {
                                const company = await Company.findById(session.company).select('country_code'); // El schema usa 'country_code'
                                if (company && company.country_code) {
                                    countryCode = company.country_code;
                                }
                            }
                            
                            // Obtenemos la URL del servicio de Nominatim para ese país
                            const nominatimUrl = CONS.nominatimService[countryCode];

                            if (nominatimUrl) {
                                // Hacemos la llamada al servicio de georeverse
                                const url = `${nominatimUrl}/reverse?format=json&lat=${lat}&lon=${lng}`;
                                console.log(`Geocodificando en: ${url}`);
                                const response = await axios.get(url);
                                
                                if (response.data && response.data.display_name) {
                                    addressText = response.data.display_name; // ej: "Calle Falsa 123, Springfield, Argentina"
                                } else {
                                    addressText = `Ubicación en lat: ${lat}, lng: ${lng}`;
                                }
                            }
                        } catch (geoError) {
                            console.error("Error en geocodificación inversa:", geoError.message);
                            addressText = `Ubicación cercana a lat: ${lat}, lng: ${lng}`; // Fallback si el servicio falla
                        }
                    }

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
                session.buffer.bestMatch = chosenOption; 
                session.markModified('buffer');

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
                // El usuario no seleccionó una opción válida de la lista.
                await sendMessage(phone, "La opción seleccionada no es válida. Por favor, elige una de las siguientes categorías.");

                // Re-enviar la lista de opciones
                const rows = session.buffer.otherOptions.map(opt => ({
                    id: opt._id,
                    title: opt.name.substring(0, 24),
                    description: (opt.parent || '').substring(0, 72)
                }));

                await sendInteractiveList(phone,
                    'Recategorizar reclamo',
                    'Si ninguna de estas opciones se ajusta a tu necesidad, puedes intentar escribir tu reclamo con otras palabras.',
                    'Ver Opciones',
                    [{ title: 'Selecciona una categoría', rows: rows }]
                );
                // La sesión se queda en el paso 'CHOOSE_OTHER_CATEGORY' para el siguiente intento.
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
                        const botPhoneNumber = value.metadata?.display_phone_number; // <-- EXTRAER NÚMERO DEL BOT

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
                            messageData = null; 
                        }

                        // No esperamos await aquí para devolver rápido el 200 OK a Meta
                        if (messageData && botPhoneNumber) { // <-- VALIDAR QUE TENEMOS EL NÚMERO DEL BOT
                            handleBotFlow(from, messageData, contact.profile?.name, botPhoneNumber).catch(e =>
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