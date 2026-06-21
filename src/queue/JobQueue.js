import logger from '../config/logger.js';
import JobModel from './JobModel.js';
import EventBus from '../events/EventBus.js';

const WORKER_CHECK_INTERVAL = 2000;
const MAX_CONCURRENT = 5;

class JobQueue {
  constructor() {
    this.handlers = new Map();
    this.running = false;
    this.activeJobs = new Set();
    this.workerTimer = null;
  }

  register(type, handler, { concurrency = 1 } = {}) {
    this.handlers.set(type, { handler, concurrency });
    logger.info({ type, concurrency }, '[queue] Handler registered');
  }

  async enqueue(type, payload, { priority = 0, maxRetries = 3, scheduledAt } = {}) {
    const job = await JobModel.create({
      type,
      payload,
      priority,
      maxRetries,
      scheduledAt: scheduledAt || new Date(),
      status: 'queued',
    });
    logger.debug({ jobId: job._id, type }, '[queue] Enqueued');
    EventBus.emit('job:enqueued', { jobId: job._id, type });
    return job;
  }

  async enqueueBulk(jobs) {
    const docs = jobs.map(j => ({
      type: j.type,
      payload: j.payload,
      priority: j.priority || 0,
      maxRetries: j.maxRetries || 3,
      status: 'queued',
      scheduledAt: j.scheduledAt || new Date(),
    }));
    const created = await JobModel.insertMany(docs);
    logger.info({ count: created.length }, '[queue] Bulk enqueued');
    return created;
  }

  start(concurrency = MAX_CONCURRENT) {
    if (this.running) return;
    this.running = true;
    logger.info({ concurrency }, '[queue] Worker started');
    this._processLoop(concurrency);
  }

  stop() {
    this.running = false;
    if (this.workerTimer) {
      clearTimeout(this.workerTimer);
      this.workerTimer = null;
    }
    logger.info('[queue] Worker stopped');
  }

  async _processLoop(concurrency) {
    while (this.running) {
      if (this.activeJobs.size < concurrency) {
        const available = concurrency - this.activeJobs.size;
        const jobs = await this._dequeueBatch(available);
        for (const job of jobs) {
          this.activeJobs.add(job._id.toString());
          this._processJob(job).finally(() => {
            this.activeJobs.delete(job._id.toString());
          });
        }
      }
      await this._sleep(WORKER_CHECK_INTERVAL);
    }
  }

  async _dequeueBatch(limit) {
    const now = new Date();
    const jobs = await JobModel.find({
      status: 'queued',
      scheduledAt: { $lte: now },
    })
      .sort({ priority: -1, scheduledAt: 1 })
      .limit(limit)
      .session(null);

    if (jobs.length === 0) return [];

    const ids = jobs.map(j => j._id);
    await JobModel.updateMany(
      { _id: { $in: ids }, status: 'queued' },
      { $set: { status: 'processing', startedAt: now } },
    );

    return jobs;
  }

  async _processJob(job) {
    const handlerDef = this.handlers.get(job.type);
    if (!handlerDef) {
      await this._failJob(job, new Error(`No handler registered for job type: ${job.type}`));
      return;
    }

    const startTime = Date.now();
    try {
      const result = await handlerDef.handler(job.payload, { jobId: job._id });
      await JobModel.updateOne(
        { _id: job._id },
        { $set: { status: 'completed', result, completedAt: new Date() } },
      );
      const duration = Date.now() - startTime;
      logger.debug({ jobId: job._id, type: job.type, duration }, '[queue] Completed');
      EventBus.emit('job:completed', { jobId: job._id, type: job.type, result });
    } catch (err) {
      logger.error({ err, jobId: job._id, type: job.type }, '[queue] Failed');
      const retryCount = (job.retryCount || 0) + 1;
      if (retryCount <= (job.maxRetries || 3)) {
        const backoff = Math.min(1000 * Math.pow(2, retryCount), 30000);
        await JobModel.updateOne(
          { _id: job._id },
          {
            $set: {
              status: 'queued',
              retryCount,
              scheduledAt: new Date(Date.now() + backoff),
              startedAt: null,
            },
            $push: { errors: { message: err.message, at: new Date() } },
          },
        );
        logger.info({ jobId: job._id, retryCount, backoff }, '[queue] Scheduled retry');
      } else {
        await this._failJob(job, err);
      }
    }
  }

  async _failJob(job, err) {
    await JobModel.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'failed',
          error: { message: err.message, stack: err.stack },
          completedAt: new Date(),
        },
      },
    );
    EventBus.emit('job:failed', { jobId: job._id, type: job.type, error: err.message });
  }

  async getJobStats() {
    const stats = await JobModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const result = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const s of stats) {
      result[s._id] = s.count;
    }
    return result;
  }

  async retryFailed(type) {
    const filter = { status: 'failed' };
    if (type) filter.type = type;
    const res = await JobModel.updateMany(filter, {
      $set: { status: 'queued', retryCount: 0, scheduledAt: new Date(), error: null },
    });
    logger.info({ modified: res.modifiedCount }, '[queue] Retrying failed jobs');
    return res.modifiedCount;
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

export default new JobQueue();
