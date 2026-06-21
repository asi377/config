import logger from '../config/logger.js';

export default function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method,
      url: originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
    }, 'request completed');
  });

  next();
}
