const crypto = require('crypto');

const verifySignature = (req, res, next) => {
  try {
    
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
      console.warn('Webhook recibido sin firma.');
      // En dev puedes ser laxo, en prod rechaza: return res.sendStatus(401);
      return next(); 
    }
   
    const elements = signature.split('=');
    const signatureHash = elements[1];
    const expectedHash = crypto
      .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
      .update(req.rawBody)
      .digest('hex');

    if (signatureHash !== expectedHash) {
      console.error('Firma del Webhook inválida. Posible ataque.');
      return res.sendStatus(403);
    }

    next();
  } catch (e) {
    console.error('Error validando firma:', e);
    res.sendStatus(500);
  }
};

module.exports = verifySignature;