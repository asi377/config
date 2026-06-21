import IORedis from 'ioredis';
import config from '../config/index.js';
import logger from '../config/logger.js';

const MAX_RETRIES = 2;

class RedisClient {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected) return this.client;
    if (!config.redis?.url) return null;

    const opts = {
      retryStrategy: (times) => {
        if (times > MAX_RETRIES) return null;
        return Math.min(times * 100, 300);
      },
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableReadyCheck: true,
      keepAlive: 10000,
      reconnectOnError: () => false,
    };

    this.client = new IORedis(config.redis.url, opts);
    this.subscriber = new IORedis(config.redis.url, opts);

    this.client.on('ready', () => {
      this.connected = true;
      logger.info('[redis] Ready');
    });
    this.client.on('error', () => {});
    this.client.on('close', () => { this.connected = false; });

    this.subscriber.on('error', () => {});

    try {
      await this.client.connect();
      await this.subscriber.connect();
      logger.info('[redis] Connected');
      return this.client;
    } catch {
      logger.warn('[redis] Unavailable — using in-memory fallback');
      this.connected = false;
      return null;
    }
  }

  getClient() {
    if (!this.connected || !this.client) return null;
    return this.client;
  }

  getSubscriber() {
    if (!this.connected || !this.subscriber) return null;
    return this.subscriber;
  }

  async healthCheck() {
    if (!this.connected || !this.client) return { status: 'disconnected' };
    try {
      await this.client.ping();
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  async disconnect() {
    if (this.subscriber) { await this.subscriber.quit(); this.subscriber = null; }
    if (this.client) { await this.client.quit(); this.client = null; }
    this.connected = false;
    logger.info('[redis] Disconnected');
  }
}

export default new RedisClient();
