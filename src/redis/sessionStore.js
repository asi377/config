import redisClient from './client.js';
import config from '../config/index.js';

const PREFIX = `${config.redis.prefix}sess:`;

class SessionStore {
  async get(sessionId) {
    const data = await redisClient.getClient().get(`${PREFIX}${sessionId}`);
    return data ? JSON.parse(data) : null;
  }

  async set(sessionId, data, ttl = 3600) {
    await redisClient.getClient().set(`${PREFIX}${sessionId}`, JSON.stringify(data), 'EX', ttl);
  }

  async del(sessionId) {
    await redisClient.getClient().del(`${PREFIX}${sessionId}`);
  }

  async touch(sessionId, ttl = 3600) {
    await redisClient.getClient().expire(`${PREFIX}${sessionId}`, ttl);
  }

  async findByAdmin(adminId) {
    const keys = await redisClient.getClient().keys(`${PREFIX}*`);
    const sessions = [];
    for (const key of keys) {
      const data = await redisClient.getClient().get(key);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.adminId === adminId) sessions.push(parsed);
      }
    }
    return sessions;
  }
}

export default new SessionStore();
