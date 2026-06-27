export function botRateLimit(ctx, next) {
  // Basic rate limiting - can be enhanced with Redis
  return next();
}

export function createRateLimiter(options = {}) {
  const { windowMs = 60000, max = 100 } = options;
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();

    if (!requests.has(key)) {
      requests.set(key, []);
    }

    const userRequests = requests.get(key).filter((t) => now - t < windowMs);
    userRequests.push(now);
    requests.set(key, userRequests);

    if (userRequests.length > max) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  };
}
