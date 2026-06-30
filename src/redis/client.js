import Redis from 'ioredis';
import config from '../config/index.js';
import logger from '../config/logger.js';

class RedisClient {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  async connect() {
    try {
      this.client = new Redis(config.redis.url);
      await this.client.ping();
      this.connected = true;
      logger.info('[redis] Connected');
    } catch (err) {
      this.connected = false;
      logger.warn({ err: err.message }, '[redis] Connection failed');
    }
  }

  getConnection() {
    return this.client || new Redis(config.redis.url);
  }

  /** Raw ioredis client, for callers (e.g. socket.io-redis-adapter) that need direct pub/sub access. */
  getClient() {
    return this.getConnection();
  }

  /** Dedicated subscriber connection — pub/sub requires a separate connection from the main client. */
  getSubscriber() {
    return this.getConnection().duplicate();
  }

  async set(key, value, ex = null) {
    if (!this.connected) return;
    if (ex) {
      await this.client.setex(key, ex, JSON.stringify(value));
    } else {
      await this.client.set(key, JSON.stringify(value));
    }
  }

  async get(key) {
    if (!this.connected) return null;
    const val = await this.client.get(key);
    return val ? JSON.parse(val) : null;
  }

  async disconnect() {
    if (this.client) await this.client.quit();
    this.connected = false;
  }
}

export default new RedisClient();
