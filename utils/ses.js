const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const Company = require('../models/Company');
const { getURLS3 } = require("./s3.js");

const sesClient = new SESClient({
    region: 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

// --- Template Helpers ---

const getBaseEmailStyles = () => `
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
    .header { background-color: #ffffff; padding: 20px; text-align: left; }
    .header img { max-width: 150px; max-height: 70px; display: block; margin: 0; }
    .content { padding: 20px; }
    .content p { margin: 0 0 10px; }
    .content ul { list-style-type: none; padding: 0; }
    .content li { background-color: #f9f9f9; margin-bottom: 10px; padding: 10px; border-left: 4px solid #007bff; }
    .footer { font-size: 0.8em; text-align: center; padding: 20px; background-color: #f8f8f8; color: #777; }
`;

const getNewDocketHtmlTemplate = (docketData) => {
    const { docketId, description, address, prediction, logoUrl, companyName, companyWeb, nameProfile } = docketData;
    return `
        <!DOCTYPE html><html><head><style>${getBaseEmailStyles()}</style></head><body>
            <div class="container">
                <div class="header">${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}</div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">Confirmación de Legajo #${docketId}</h2>
                    <p>Hola${nameProfile ? ` ${nameProfile}` : ''},</p>
                    <p>Hemos recibido tu legajo con la siguiente información:</p>
                    <ul>
                        <li><strong>Descripción:</strong> ${description}</li>
                        <li><strong>Tipo:</strong> ${prediction?.name || 'No especificada'}</li>
                        <li><strong>Dirección:</strong> ${address || 'No especificada'}</li>
                    </ul>
                    <p>Gracias por tu colaboración. Se te informará mediante esta vía sobre el avance de tu legajo.</p>
                </div>
                <div class="footer"><p>Este es un email automático, por favor no respondas a este mensaje.</p></div>
            </div>
        </body></html>
    `;
};

const getInternalAssignedDocketHtmlTemplate = (docketData) => {
    const { docketId, description, address, logoUrl, companyName, companyWeb } = docketData;
    return `
        <!DOCTYPE html><html><head><style>${getBaseEmailStyles()}</style></head><body>
            <div class="container">
                <div class="header">${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}</div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">Nuevo Legajo Asignado #${docketId}</h2>
                    <p>Se ha asignado un nuevo legajo al área.</p>
                    <p><strong>Resumen del legajo:</strong></p>
                    <p><i>"${description}"</i></p>
                    <p>Por favor, proceder con la gestión correspondiente.</p>
                </div>
                <div class="footer"><p>Este es un email automático, por favor no respondas a este mensaje.</p></div>
            </div>
        </body></html>
    `;
};

const getNeighborAssignedDocketHtmlTemplate = (docketData) => {
    const { docketId, description, address, logoUrl, companyName, companyWeb, nameProfile } = docketData;
    return `
        <!DOCTYPE html><html><head><style>${getBaseEmailStyles()}</style></head><body>
            <div class="container">
                <div class="header">${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}</div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">Tu Legajo #${docketId} ha sido Asignado</h2>
                    <p>Hola ${nameProfile || ''},</p>
                    <p>Te informamos que tu legajo ya fue asignado a un área interna para su tratamiento. A continuación, te recordamos los datos:</p>
                    <ul>
                        <li><strong>Descripción:</strong> ${description}</li>
                    </ul>
                    <p>Recibirás una nueva notificación cuando el estado de tu legajo vuelva a cambiar. Gracias por tu paciencia.</p>
                </div>
                <div class="footer"><p>Este es un email automático, por favor no respondas a este mensaje.</p></div>
            </div>
        </body></html>
    `;
};

// --- Generic Email Logic ---

const sendEmail = async (addresses, subject, htmlData, options = { useBcc: false }) => {
    // Filtrar direcciones de correo inválidas.
    const validAddresses = addresses.filter(email => email && !email.endsWith('@fakemail.com'));

    // Si no hay direcciones válidas, no hacer nada y loggear.
    if (validAddresses.length === 0) {
        console.log(`📧 Email sending skipped for subject "${subject}". No valid recipients found or all were invalid.`);
        return;
    }

    const destination = {};
    if (options.useBcc) {
        destination.BccAddresses = validAddresses;
        destination.ToAddresses = [process.env.SES_FROM_EMAIL]; // BCC requires at least one TO address.
    } else {
        destination.ToAddresses = validAddresses;
    }

    const params = {
        Source: process.env.SES_FROM_EMAIL,
        Destination: destination,
        Message: {
            Body: { Html: { Charset: "UTF-8", Data: htmlData } },
            Subject: { Charset: "UTF-8", Data: subject }
        }
    };
    try {
        const command = new SendEmailCommand(params);
        const response = await sesClient.send(command);
        const recipientType = options.useBcc ? 'Bcc' : 'To';
        console.log(`📧 Email sent successfully via ${recipientType} to ${validAddresses.length} recipient(s) with subject "${subject}"`, response.MessageId);
        return response;
    } catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
};

const getCompanyDataForEmail = async (companyId) => {
    try {
        const companyData = await Company.findById(companyId);
        if (companyData) {
            const logoUrl = companyData.logo ? await getURLS3(companyData.logo, 2880, '') : '';
            return { logoUrl, companyName: companyData.name || 'Company', companyWeb: companyData.web || '#' };
        }
    } catch (error) {
        console.error("Error fetching company data for email:", error);
    }
    return { logoUrl: '', companyName: 'Company', companyWeb: '#' };
};

// --- Exposed Email Functions ---

const sendNewDocketEmail = async (docketData) => {
    const { company, email } = docketData;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getNewDocketHtmlTemplate({ ...docketData, ...companyInfo });
    const subject = `Confirmación de Legajo #${docketData.docketId} - ${companyInfo.companyName}`;
    return sendEmail([email], subject, html);
};

const sendInternalAssignedDocketEmail = async (docketData) => {
    const { company, emails } = docketData;
    if (!emails || emails.length === 0) return;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getInternalAssignedDocketHtmlTemplate({ ...docketData, ...companyInfo });
    const subject = `Legajo Asignado #${docketData.docketId} - ${companyInfo.companyName}`;
    return sendEmail(emails, subject, html, { useBcc: true });
};

const sendNeighborAssignedDocketEmail = async (docketData) => {
    const { company, email } = docketData;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getNeighborAssignedDocketHtmlTemplate({ ...docketData, ...companyInfo });
    const subject = `Actualización de tu Legajo #${docketData.docketId} - ${companyInfo.companyName}`;
    return sendEmail([email], subject, html);
};

const getInProgressDocketHtmlTemplate = (docketData) => {
    const { docketId, description, address, logoUrl, companyName, companyWeb, nameProfile, observation } = docketData;
    return `
        <!DOCTYPE html><html><head><style>${getBaseEmailStyles()}</style></head><body>
            <div class="container">
                <div class="header">${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}</div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">Tu Legajo #${docketId} está En Progreso</h2>
                    <p>Hola ${nameProfile || ''},</p>
                    <p>Te informamos que tu legajo ha sido actualizado al estado "En Progreso". Nuestro equipo está trabajando en tu solicitud.</p>
                    <ul>
                        <li><strong>Descripción:</strong> ${description}</li>
                        ${observation ? `<li><strong>Observación:</strong> ${observation}</li>` : ''}
                    </ul>
                    <p>Recibirás una nueva notificación cuando el estado de tu legajo vuelva a cambiar. Gracias por tu paciencia.</p>
                </div>
                <div class="footer"><p>Este es un email automático, por favor no respondas a este mensaje.</p></div>
            </div>
        </body></html>
    `;
};

const sendInProgressDocketEmail = async (docketData) => {
    const { company, email } = docketData;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getInProgressDocketHtmlTemplate({ ...docketData, ...companyInfo });
    const subject = `Legajo #${docketData.docketId} está En Progreso - ${companyInfo.companyName}`;
    return sendEmail([email], subject, html);
};

const getNewProfileHtmlTemplate = (profileData) => {
    const { name, lastname, dni, password, logoUrl, companyName, companyWeb } = profileData;
    return `
        <!DOCTYPE html><html><head><style>${getBaseEmailStyles()}</style></head><body>
            <div class="container">
                <div class="header">${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}</div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">¡Bienvenido/a a la plataforma!</h2>
                    <p>Hola ${name} ${lastname},</p>
                    <p>Se ha creado un perfil para ti en nuestra plataforma. A continuación encontrarás tus datos de acceso:</p>
                    <ul>
                        <li><strong>DNI:</strong> ${dni}</li>
                        <li><strong>Contraseña:</strong> ${password}</li>
                    </ul>
                    <p>Te recomendamos cambiar tu contraseña después de iniciar sesión por primera vez.</p>
                </div>
                <div class="footer"><p>Este es un email automático, por favor no respondas a este mensaje.</p></div>
            </div>
        </body></html>
    `;
};

const sendNewProfileEmail = async (profileData) => {
    const { company, email } = profileData;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getNewProfileHtmlTemplate({ ...profileData, ...companyInfo });
    const subject = `¡Bienvenido/a a ${companyInfo.companyName}!`;
    return sendEmail([email], subject, html);
};

const getNewSubscriberHtmlTemplate = (docketData) => {
    const { docketId, address, logoUrl, companyName, companyWeb, nameProfile } = docketData;
    return `
        <!DOCTYPE html><html><head><style>${getBaseEmailStyles()}</style></head><body>
            <div class="container">
                <div class="header">${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}</div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">Suscripción al Reclamo #${docketId}</h2>
                    <p>Hola ${nameProfile || ''},</p>
                    <p>Te has suscripto al reclamo <strong>#${docketId}</strong>, con referencia en la dirección: <strong>${address || 'No especificada'}</strong>.</p>
                    <p>A partir de ahora, recibirás notificaciones por email cada vez que haya un cambio de estado en el mismo.</p>
                    <p>Gracias por tu colaboración.</p>
                </div>
                <div class="footer"><p>Este es un email automático, por favor no respondas a este mensaje.</p></div>
            </div>
        </body></html>
    `;
};

const sendNewSubscriberEmail = async (docketData) => {
    const { company, email } = docketData;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getNewSubscriberHtmlTemplate({ ...docketData, ...companyInfo });
    const subject = `Suscripción al Reclamo #${docketData.docketId} - ${companyInfo.companyName}`;
    return sendEmail([email], subject, html);
};

const getOnHoldDocketHtmlTemplate = (docketData) => {
    const { docketId, description, logoUrl, companyName, companyWeb, nameProfile, observation } = docketData;
    return `
        <!DOCTYPE html><html><head><style>${getBaseEmailStyles()}</style></head><body>
            <div class="container">
                <div class="header">${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}</div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">El Legajo #${docketId} ha sido Observado</h2>
                    <p>Hola ${nameProfile || ''},</p>
                    <p>Esta observación podría requerir una acción de tu parte (como completar documentación, revisar información faltante, etc.)</p>
                    <ul>
                        ${observation ? `<li><strong>Observación:</strong> ${observation}</li>` : ''}
                    </ul>
                    <p>Recibirás una nueva notificación cuando el estado de tu legajo vuelva a cambiar. Gracias por tu paciencia.</p>
                </div>
                <div class="footer"><p>Este es un email automático, por favor no respondas a este mensaje.</p></div>
            </div>
        </body></html>
    `;
};

const sendOnHoldDocketEmail = async (docketData) => {
    const { company, email } = docketData;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getOnHoldDocketHtmlTemplate({ ...docketData, ...companyInfo });
    const subject = `Legajo #${docketData.docketId} se encuentra observado - ${companyInfo.companyName}`;
    return sendEmail([email], subject, html);
};

const getResolvedDocketHtmlTemplate = (docketData) => {
    const { docketId, description, logoUrl, companyName, companyWeb, nameProfile, observation } = docketData;
    return `
        <!DOCTYPE html><html><head><style>${getBaseEmailStyles()}</style></head><body>
            <div class="container">
                <div class="header">${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}</div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">Tu Legajo #${docketId} ha sido Resuelto</h2>
                    <p>Hola ${nameProfile || ''},</p>
                    <p>Te informamos que tu legajo ha sido resuelto.</p>
                    <ul>
                        <li><strong>Descripción:</strong> ${description}</li>
                        ${observation ? `<li><strong>Observación:</strong> ${observation}</li>` : ''}
                    </ul>
                    <p>Gracias por tu colaboración.</p>
                </div>
                <div class="footer"><p>Este es un email automático, por favor no respondas a este mensaje.</p></div>
            </div>
        </body></html>
    `;
};

const sendResolvedDocketEmail = async (docketData) => {
    const { company, email } = docketData;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getResolvedDocketHtmlTemplate({ ...docketData, ...companyInfo });
    const subject = `Tu Legajo #${docketData.docketId} ha sido Resuelto - ${companyInfo.companyName}`;
    return sendEmail([email], subject, html);
};

const getNewPasswordHtmlTemplate = (resetData) => {
    const { newPassword, logoUrl, companyName, companyWeb } = resetData;
    return `
        <!DOCTYPE html><html><head><style>${getBaseEmailStyles()}</style></head><body>
            <div class="container">
                <div class="header">${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}</div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">Restablecimiento de Contraseña</h2>
                    <p>Has solicitado restablecer tu contraseña. Se ha generado una nueva contraseña temporal para ti:</p>
                    <p style="text-align: center; font-size: 1.2em; font-weight: bold; margin: 20px 0;">${newPassword}</p>
                    <p>Te recomendamos iniciar sesión y cambiar esta contraseña por una de tu elección lo antes posible.</p>
                </div>
                <div class="footer"><p>Este es un email automático, por favor no respondas a este mensaje.</p></div>
            </div>
        </body></html>
    `;
};

const sendNewPasswordEmail = async (resetData) => {
    const { company, email, newPassword } = resetData;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getNewPasswordHtmlTemplate({ ...resetData, ...companyInfo });
    const subject = `Tu nueva contraseña para ${companyInfo.companyName}`;
    return sendEmail([email], subject, html);
};

module.exports = { sendNewDocketEmail, sendInternalAssignedDocketEmail, sendNeighborAssignedDocketEmail, sendNewProfileEmail, sendNewSubscriberEmail, sendInProgressDocketEmail, sendOnHoldDocketEmail, sendResolvedDocketEmail, sendNewPasswordEmail };