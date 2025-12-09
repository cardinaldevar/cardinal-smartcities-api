// redisClient.js
const Redis = require('ioredis');

// Opciones de configuración para ioredis
const redisOptions = {};

// Solo agregar la contraseña si estamos en entorno de producción
if (process.env.NODE_ENV === 'production') {
  redisOptions.password = process.env.REDIS_DB_PROD;
}

const redisClient = new Redis(redisOptions);

redisClient.on('connect', () => {
  console.log('> Redis (ioredis) Online!');
});

redisClient.on('error', (err) => {
  console.error('Error de conexión a Redis (ioredis):', err);
});

module.exports = redisClient;
