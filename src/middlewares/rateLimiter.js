import redisClient from '../redis/client.js';
import logger from '../config/logger.js';

const WINDOW_MS = 60000;
const MAX_REQUESTS = 200;

// Bot-specific rate limiter (Telegraf middleware)
const botRateLimitStore = new Map();
export function botRateLimit(ctx, next) {
  const store = botRateLimitStore;
  const key = `bot:${ctx.from?.id || 'unknown'}`;
  const now = Date.now();
  const windowKey = Math.floor(now / 1000);

  const entry = store.get(key) || { count: 0, window: windowKey };
  if (entry.window !== windowKey) {
    entry.count = 1;
    entry.window = windowKey;
  } else {
    entry.count++;
  }

  if (entry.count > 30) {
    // Rate limited silently
    return;
  }

  store.set(key, entry);
  return next();
}

export function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs || WINDOW_MS;
  const max = opts.max || MAX_REQUESTS;

  return async function rateLimiter(req, res, next) {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const redis = redisClient.connected ? redisClient.getClient() : null;

    if (!redis) {
      // In-memory fallback
      if (!req.app.locals._rlStore) req.app.locals._rlStore = new Map();
      const store = req.app.locals._rlStore;
      const now = Date.now();
      const windowKey = `${key}:${Math.floor(now / windowMs)}`;
      const entry = store.get(windowKey) || { count: 0 };
      entry.count++;
      store.set(windowKey, entry);
      if (entry.count > max) {
        return res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil(windowMs / 1000) });
      }
      // Clean old entries
      if (store.size > 10000) {
        const cutoff = Math.floor(now / windowMs);
        for (const [k] of store) {
          if (parseInt(k.split(':').pop()) < cutoff) store.delete(k);
        }
      }
      return next();
    }

    try {
      const windowKey = Math.floor(Date.now() / windowMs);
      const redisKey = `rl:${key}:${windowKey}`;
      const count = await redis.incr(redisKey);
      if (count === 1) await redis.pexpire(redisKey, windowMs);
      if (count > max) {
        return res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil(windowMs / 1000) });
      }
    } catch (err) {
      logger.warn({ err }, '[rate-limit] Redis error, allowing request');
    }
    next();
  };
}
