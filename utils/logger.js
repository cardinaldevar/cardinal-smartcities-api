const winston = require('winston');
const path = require('path');

// Crea y configura la instancia del logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
  ),
  transports: [
    // Definí a dónde querés que se guarden los logs
    new winston.transports.File({ filename: path.join(__dirname, '..', 'app.log') }), // Lo guardará en la raíz del proyecto
    new winston.transports.Console()
  ],
});

// Exporta la instancia para que otros archivos puedan usarla
module.exports = logger;