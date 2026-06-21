import pino from 'pino';
import config from './index.js';

const logger = pino({
  level: config.logLevel,
  transport: config.env === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
  redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
});

export default logger;
