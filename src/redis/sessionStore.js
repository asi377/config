import redisClient from './client.js';
import config from '../config/index.js';

const PREFIX = `${config.redis.prefix}sess:`;

class SessionStore {
  async get(sessionId) {
    const data = await redisClient.getClient().get(`${PREFIX}${sessionId}`);
    return data ? JSON.parse(data) : null;
  }

  async set(sessionId, data, ttl = 3600) {
    const multi = redisClient.getClient().multi();
    // Store session data
    multi.set(`${PREFIX}${sessionId}`, JSON.stringify(data), 'EX', ttl);
    // Maintain admin index (a Set per admin)
    if (data.adminId) {
      multi.sadd(`${PREFIX}admin:${data.adminId}`, sessionId);
    }
    await multi.exec();
  }

  async del(sessionId) {
    const data = await this.get(sessionId);
    const multi = redisClient.getClient().multi();
    multi.del(`${PREFIX}${sessionId}`);
    if (data?.adminId) {
      multi.srem(`${PREFIX}admin:${data.adminId}`, sessionId);
    }
    await multi.exec();
  }

  async touch(sessionId, ttl = 3600) {
    await redisClient.getClient().expire(`${PREFIX}${sessionId}`, ttl);
  }

  async findByAdmin(adminId) {
    // Use Redis Set index instead of KEYS * scan
    const sessionIds = await redisClient.getClient().smembers(`${PREFIX}admin:${adminId}`);
    if (!sessionIds.length) return [];

    const pipeline = redisClient.getClient().pipeline();
    for (const sid of sessionIds) {
      pipeline.get(`${PREFIX}${sid}`);
    }
    const results = await pipeline.exec();

    const sessions = [];
    for (let i = 0; i < results.length; i++) {
      const err = results[i][0];
      const data = results[i][1];
      if (!err && data) {
        try {
          sessions.push(JSON.parse(data));
        } catch { /* skip corrupt entry */ }
      }
    }
    return sessions;
  }
}

export default new SessionStore();
