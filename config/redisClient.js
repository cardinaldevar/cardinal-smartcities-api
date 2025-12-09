// redisClient.js
const Redis = require('ioredis');

const redisClient = new Redis();

redisClient.on('connect', () => {
  console.log('> Redis Online!');
});

redisClient.on('error', (err) => {
  console.error('Error de conexión a Redis:', err);
});

module.exports = redisClient;
