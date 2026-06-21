import redisClient from './client.js';
import config from '../config/index.js';

const PREFIX = `${config.redis.prefix}ratelimit:`;

class RateLimitStore {
  async increment(key, windowMs) {
    const redisKey = `${PREFIX}${key}`;
    const now = Date.now();
    const windowKey = `${redisKey}:${Math.floor(now / windowMs)}`;

    const multi = redisClient.getClient().multi();
    multi.incr(windowKey);
    multi.pexpire(windowKey, windowMs);
    const results = await multi.exec();
    return results[0][1];
  }

  async get(key, windowMs) {
    const now = Date.now();
    const windowKey = `${PREFIX}${key}:${Math.floor(now / windowMs)}`;
    const count = await redisClient.getClient().get(windowKey);
    return count ? parseInt(count, 10) : 0;
  }

  async reset(key) {
    const keys = await redisClient.getClient().keys(`${PREFIX}${key}:*`);
    if (keys.length > 0) await redisClient.getClient().del(...keys);
  }
}

export default new RateLimitStore();
