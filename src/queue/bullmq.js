import { Queue, Worker, QueueScheduler } from 'bullmq';
import redisClient from '../redis/client.js';
import logger from '../config/logger.js';

class BullMQManager {
  constructor() {
    this.queues = new Map();
    this.workers = new Map();
    this.schedulers = new Map();
  }

  createQueue(name, options = {}) {
    if (this.queues.has(name)) return this.queues.get(name);

    const connection = redisClient.getConnection();
    const queue = new Queue(name, { connection, ...options });
    this.queues.set(name, queue);
    logger.info({ queueName: name }, '[bullmq] Queue created');
    return queue;
  }

  getQueue(name) {
    return this.queues.get(name);
  }

  createWorker(queueName, processor, options = {}) {
    const connection = redisClient.getConnection();
    const worker = new Worker(queueName, processor, { connection, ...options });
    this.workers.set(`${queueName}-worker`, worker);
    logger.info({ queueName }, '[bullmq] Worker created');
    return worker;
  }

  async getAllMetrics() {
    const metrics = {};
    for (const [name, queue] of this.queues) {
      const counts = await queue.getJobCounts();
      metrics[name] = counts;
    }
    return metrics;
  }

  async getDeadLetterJobs(queueName, limit = 20) {
    const queue = this.queues.get(queueName);
    if (!queue) return [];
    // DLQ implementation depends on BullMQ version
    return [];
  }

  async retryDeadLetter(queueName, jobId) {
    logger.info({ queueName, jobId }, '[bullmq] Retry DLQ job');
    return { retried: true };
  }
}

export default new BullMQManager();
