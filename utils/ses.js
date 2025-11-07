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
    const destination = {};
    if (options.useBcc) {
        destination.BccAddresses = addresses;
        destination.ToAddresses = [process.env.SES_FROM_EMAIL]; // BCC requires at least one TO address.
    } else {
        destination.ToAddresses = addresses;
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
        console.log(`📧 Email sent successfully via ${recipientType} to ${addresses.length} recipient(s) with subject "${subject}"`, response.MessageId);
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
    const subject = `Confirmación de Legajo #${docketData.docketId}`;
    return sendEmail([email], subject, html);
};

const sendInternalAssignedDocketEmail = async (docketData) => {
    const { company, emails } = docketData;
    if (!emails || emails.length === 0) return;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getInternalAssignedDocketHtmlTemplate({ ...docketData, ...companyInfo });
    const subject = `Legajo Asignado #${docketData.docketId}`;
    return sendEmail(emails, subject, html, { useBcc: true });
};

const sendNeighborAssignedDocketEmail = async (docketData) => {
    const { company, email } = docketData;
    const companyInfo = await getCompanyDataForEmail(company);
    const html = getNeighborAssignedDocketHtmlTemplate({ ...docketData, ...companyInfo });
    const subject = `Actualización de tu Legajo #${docketData.docketId}`;
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

module.exports = { sendNewDocketEmail, sendInternalAssignedDocketEmail, sendNeighborAssignedDocketEmail, sendNewProfileEmail };