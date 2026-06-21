import { randomUUID } from 'crypto';

const CORRELATION_HEADER = 'x-correlation-id';

export function correlationMiddleware(req, res, next) {
  const correlationId = req.headers[CORRELATION_HEADER] || randomUUID();
  req.correlationId = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);
  next();
}

export function tracingMiddleware(req, res, next) {
  req.startTime = Date.now();
  req.traceId = randomUUID().replace(/-/g, '').slice(0, 16);

  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    if (duration > 1000) {
      req.logger?.warn?.({ traceId: req.traceId, duration, url: req.originalUrl }, '[trace] Slow request');
    }
  });

  next();
}

export function getTraceContext(req) {
  return {
    traceId: req.traceId,
    correlationId: req.correlationId,
    spanId: randomUUID().replace(/-/g, '').slice(0, 16),
  };
}
