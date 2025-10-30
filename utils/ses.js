const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const Company = require('../models/Company');
const { getURLS3 } = require("./s3.js");

// Configura las credenciales y la región de AWS
const sesClient = new SESClient({
    region: 'us-east-1', // Changed to N. Virginia
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

const sendDocketEmail = async (docketData) => {
    const { company, email, docketId, description, address, details, prediction, nameProfile } = docketData;

    let logoUrl = '';
    let companyName = 'Company';
    let companyWeb = '#';

    try {
        const companyData = await Company.findById(company);
        if (companyData) {
            companyName = companyData.name || companyName;
            companyWeb = companyData.web || companyWeb;
            if (companyData.logo) {
                // 48 hours in minutes = 48 * 60 = 2880
                logoUrl = await getURLS3(companyData.logo, 2880, '');
            }
        }
    } catch (error) {
        console.error("Error fetching company data for email:", error);
        // Continue with defaults if it fails
    }

    const params = {
        Source: process.env.SES_FROM_EMAIL,
        Destination: {
            ToAddresses: [email]
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: getHtmlTemplate({ ...docketData, logoUrl, companyName, companyWeb, nameProfile })
                }
            },
            Subject: {
                Charset: "UTF-8",
                Data: `Confirmación de Legajo #${docketId}`
            }
        }
    };

    try {
        const command = new SendEmailCommand(params);
        const sendPromise = await sesClient.send(command);
        console.log("Email sent successfully:", sendPromise.MessageId);
        return sendPromise;
    } catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
};

const getHtmlTemplate = (docketData) => {
    const { docketId, description, address, details, prediction, logoUrl, companyName, companyWeb, nameProfile } = docketData;
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
                .container { width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
                .header { background-color: #ffffff; padding: 20px; text-align: left; }
                .header img { max-width: 150px; max-height: 70px; display: block; margin: 0; }
                .content { padding: 20px; }
                .content p { margin: 0 0 10px; }
                .content ul { list-style-type: none; padding: 0; }
                .content li { background-color: #f9f9f9; margin-bottom: 10px; padding: 10px; border-left: 4px solid #007bff; }
                .footer { font-size: 0.8em; text-align: center; padding: 20px; background-color: #f8f8f8; color: #777; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    ${logoUrl ? `<a href="${companyWeb}" target="_blank"><img src="${logoUrl}" alt="${companyName}"></a>` : ''}
                </div>
                <div class="content">
                    <h2 style="text-align: center; color: #333;">Confirmación de Legajo #${docketId}</h2>
                    <p>Hola${nameProfile ? ` ${nameProfile}` : ''},</p>
                    <p>Hemos recibido tu legajo con la siguiente información:</p>
                    <ul>
                        <li><strong>Descripción:</strong> ${description}</li>
                        <li><strong>Categoría:</strong> ${prediction.name}</li>
                        <li><strong>Dirección:</strong> ${address || 'No especificada'}</li>
                    </ul>
                    <p>Gracias por tu colaboración.</p>
                    <p>Se le informará mediante esta vía sobre el avance de su legajo.</p>
                </div>
                <div class="footer">
                    <p>Este es un email automático, por favor no respondas a este mensaje.</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

module.exports = { sendDocketEmail };