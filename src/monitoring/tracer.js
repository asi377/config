export function correlationMiddleware(req, res, next) {
  req.correlationId = req.headers['x-correlation-id'] || require('crypto').randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}

export function tracingMiddleware(req, res, next) {
  req.startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    console.log(`[tracing] ${req.method} ${req.path} took ${duration}ms`);
  });
  next();
}
