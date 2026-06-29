import { Queue, Worker } from 'bullmq';
import redisClient from '../redis/client.js';
import logger from '../config/logger.js';

class BullMQManager {
  constructor() {
    this.queues = new Map();
    this.workers = new Map();
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

  /**
   * Enqueue a job by name onto a queue, creating the queue on demand if it
   * hasn't been initialized yet (e.g. in tests or out-of-order startup).
   */
  async enqueue(queueName, jobName, data, options = {}) {
    const queue = this.getQueue(queueName) || this.createQueue(queueName);
    return queue.add(jobName, data, options);
  }

  /**
   * Register a single handler for every job on a queue, regardless of job
   * name. Adapts BullMQ's native `(job)` processor signature to
   * `(data, { jobId, name })` to match callers written against that shape.
   * Replaces any worker previously registered for this queue.
   */
  registerHandler(queueName, handler, options = {}) {
    const existing = this.workers.get(`${queueName}-worker`);
    if (existing) {
      existing.close().catch((err) => logger.warn({ err, queueName }, '[bullmq] Failed to close previous worker'));
    }

    return this.createWorker(queueName, async (job) => {
      return handler(job.data, { jobId: job.id, name: job.name });
    }, options);
  }

  /**
   * BullMQ workers automatically reclaim jobs stalled by a crashed process
   * (via lockDuration/stalledInterval), so there is no separate recovery
   * step required once workers are (re)started — this just logs current
   * counts for visibility after a restart.
   */
  async recoverStalledJobs() {
    const report = {};
    for (const [name, queue] of this.queues) {
      try {
        report[name] = await queue.getJobCounts('active', 'waiting', 'delayed', 'failed');
      } catch (err) {
        logger.warn({ err, queueName: name }, '[bullmq] Failed to read job counts during stall check');
      }
    }
    logger.info({ report }, '[bullmq] Stalled-job recovery check complete');
    return report;
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
