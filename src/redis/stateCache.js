import redisClient from './client.js';
import config from '../config/index.js';

const PREFIX = `${config.redis.prefix}cache:`;

class StateCache {
  async get(key) {
    const data = await redisClient.getClient().get(`${PREFIX}${key}`);
    return data ? JSON.parse(data) : null;
  }

  async set(key, value, ttl = 60) {
    await redisClient.getClient().set(`${PREFIX}${key}`, JSON.stringify(value), 'EX', ttl);
  }

  async del(key) {
    await redisClient.getClient().del(`${PREFIX}${key}`);
  }

  async getOrSet(key, fn, ttl = 60) {
    const existing = await this.get(key);
    if (existing !== null) return existing;
    const value = await fn();
    await this.set(key, value, ttl);
    return value;
  }

  // Node health state (no expiry, explicit set)
  async setNodeState(nodeId, state) {
    const key = `node:${nodeId}:state`;
    await redisClient.getClient().hset(`${PREFIX}${key}`, state);
  }

  async getNodeState(nodeId) {
    const key = `node:${nodeId}:state`;
    return redisClient.getClient().hgetall(`${PREFIX}${key}`);
  }

  async setNodeMetric(nodeId, metric, value) {
    const key = `node:${nodeId}:metrics`;
    const multi = redisClient.getClient().multi();
    multi.hset(`${PREFIX}${key}`, metric, value);
    multi.expire(`${PREFIX}${key}`, 300);
    await multi.exec();
  }

  async getNodeMetrics(nodeId) {
    const key = `node:${nodeId}:metrics`;
    return redisClient.getClient().hgetall(`${PREFIX}${key}`);
  }
}

export default new StateCache();
