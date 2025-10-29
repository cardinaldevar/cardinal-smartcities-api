const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

// Configura las credenciales y la región de AWS
const sesClient = new SESClient({
    region: 'us-east-1', // Changed to N. Virginia
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

const sendDocketEmail = async (docketData) => {
    const { email, docketId, description, address, location, details, prediction } = docketData;

    const params = {
        Source: process.env.SES_FROM_EMAIL, // Reemplaza con tu email verificado en SES
        Destination: {
            ToAddresses: [email]
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: getHtmlTemplate(docketData)
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
    const { docketId, description, address, location, details, prediction } = docketData;
    // Puedes personalizar esta plantilla HTML como quieras
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; }
                .container { width: 80%; margin: 0 auto; border: 1px solid #ddd; padding: 20px; }
                .header { background-color: #f2f2f2; padding: 10px; text-align: center; }
                .content { padding: 20px; }
                .footer { font-size: 0.8em; text-align: center; padding: 10px; background-color: #f2f2f2; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>Confirmación de Legajo #${docketId}</h2>
                </div>
                <div class="content">
                    <p>Hola,</p>
                    <p>Hemos recibido tu legajo con la siguiente información:</p>
                    <ul>
                        <li><strong>Descripción:</strong> ${description}</li>
                        <li><strong>Categoría:</strong> ${prediction.name}</li>
                        <li><strong>Dirección:</strong> ${address || 'No especificada'}</li>
                        <li><strong>Localidad:</strong> ${location || 'No especificada'}</li>
                    </ul>
                    <p>Gracias por tu colaboración.</p>
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