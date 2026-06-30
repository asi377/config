import { AppError } from '../shared/errors.js';
import logger from '../config/logger.js';

export default function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
  }

  logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
}
