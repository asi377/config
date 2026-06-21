import { Queue, Worker } from 'bullmq';
import logger from '../config/logger.js';
import redisClient from '../redis/client.js';
import { queueJobCount, queueJobDuration } from '../monitoring/metrics.js';

class BullMQManager {
  constructor() {
    this.queues = new Map();
    this.workers = new Map();
    this.handlers = new Map();
  }

  _getConnection() {
    return redisClient.connected ? redisClient.getClient() : undefined;
  }

  createQueue(name, opts = {}) {
    if (this.queues.has(name)) return this.queues.get(name);

    const conn = this._getConnection();
    if (!conn) {
      logger.warn({ queue: name }, '[bullmq] Redis unavailable — queue not created');
      return null;
    }

    const queue = new Queue(name, {
      connection: conn,
      defaultJobOptions: {
        attempts: opts.attempts || 3,
        backoff: { type: 'exponential', delay: opts.backoffDelay || 2000 },
        removeOnComplete: { age: 3600 * 24, count: 100 },
        removeOnFail: { age: 3600 * 24 * 7, count: 500 },
        priority: opts.priority || 0,
        ...opts,
      },
    });

    this.queues.set(name, queue);
    logger.info({ queue: name }, '[bullmq] Queue created');
    return queue;
  }

  registerHandler(queueName, handler, opts = {}) {
    this.handlers.set(queueName, handler);

    const conn = this._getConnection();
    if (!conn) {
      logger.warn({ queue: queueName }, '[bullmq] Redis unavailable — worker not registered');
      return;
    }

    const worker = new Worker(queueName, async (job) => {
      const start = Date.now();
      logger.debug({ queue: queueName, jobId: job.id, type: job.name }, '[bullmq] Processing job');

      const handlerFn = this.handlers.get(queueName);
      if (!handlerFn) throw new Error(`No handler for queue: ${queueName}`);

      try {
        const result = await handlerFn(job.data, { jobId: job.id, name: job.name, queue: queueName });
        const duration = (Date.now() - start) / 1000;
        queueJobDuration.observe({ queue: queueName, job_type: job.name || 'default' }, duration);
        return result;
      } catch (err) {
        logger.error({ err, queue: queueName, jobId: job.id }, '[bullmq] Job failed');
        throw err;
      }
    }, {
      connection: conn,
      concurrency: opts.concurrency || 5,
      limiter: opts.limiter || null,
      ...opts,
    });

    worker.on('completed', (job) => {
      logger.debug({ queue: queueName, jobId: job.id }, '[bullmq] Job completed');
    });

    worker.on('failed', (job, err) => {
      logger.error({ err: err.message, queue: queueName, jobId: job.id }, '[bullmq] Job failed permanently');
    });

    worker.on('error', (err) => {
      logger.error({ err, queue: queueName }, '[bullmq] Worker error');
    });

    this.workers.set(queueName, worker);
    logger.info({ queue: queueName, concurrency: opts.concurrency }, '[bullmq] Worker registered');
    return worker;
  }

  async enqueue(queueName, jobName, data, opts = {}) {
    const queue = this.queues.get(queueName) || this.createQueue(queueName);
    if (!queue) throw new Error('Queue unavailable: Redis not connected');
    const job = await queue.add(jobName, data, {
      priority: opts.priority || 0,
      delay: opts.delay || 0,
      attempts: opts.attempts || 3,
      ...opts,
    });
    return job;
  }

  async enqueueBulk(queueName, jobs) {
    const queue = this.queues.get(queueName) || this.createQueue(queueName);
    const added = await queue.addBulk(jobs.map(j => ({
      name: j.name,
      data: j.data,
      opts: { priority: j.priority || 0, delay: j.delay || 0, attempts: j.attempts || 3 },
    })));
    return added;
  }

  async getQueueMetrics(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return null;
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    queueJobCount.set({ queue: queueName, status: 'waiting' }, waiting);
    queueJobCount.set({ queue: queueName, status: 'active' }, active);
    queueJobCount.set({ queue: queueName, status: 'completed' }, completed);
    queueJobCount.set({ queue: queueName, status: 'failed' }, failed);
    queueJobCount.set({ queue: queueName, status: 'delayed' }, delayed);

    return { waiting, active, completed, failed, delayed, name: queueName };
  }

  async getAllMetrics() {
    const results = {};
    for (const [name] of this.queues) {
      results[name] = await this.getQueueMetrics(name);
    }
    return results;
  }

  async getDeadLetterJobs(queueName, limit = 20) {
    const queue = this.queues.get(queueName);
    if (!queue) return [];
    const failed = await queue.getFailed(0, limit);
    return failed.map(j => ({
      id: j.id,
      name: j.name,
      data: j.data,
      failedReason: j.failedReason,
      attempts: j.attemptsMade,
      timestamp: j.timestamp,
      processedOn: j.processedOn,
    }));
  }

  async retryDeadLetter(queueName, jobId) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    await job.retry();
    return { retried: true };
  }

  async pauseQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);
    await queue.pause();
    logger.info({ queue: queueName }, '[bullmq] Queue paused');
  }

  async resumeQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);
    await queue.resume();
    logger.info({ queue: queueName }, '[bullmq] Queue resumed');
  }

  async drainQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) throw new Error(`Queue ${queueName} not found`);
    await queue.drain();
    logger.info({ queue: queueName }, '[bullmq] Queue drained');
  }

  async close() {
    for (const [, worker] of this.workers) await worker.close();
    for (const [, queue] of this.queues) await queue.close();
    this.queues.clear();
    this.workers.clear();
    logger.info('[bullmq] All queues closed');
  }
}

export default new BullMQManager();
