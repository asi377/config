import cron from 'node-cron';
import logger from '../config/logger.js';
import { expireStaleResources } from './expireStaleResources.js';
import { notifyEightyPercent } from './notifyEightyPercent.js';
import { healthCheck } from './healthCheck.js';
import BillingService from '../services/saas/BillingService.js';
import UsageService from '../services/saas/UsageService.js';
import JobQueue from '../queue/JobQueue.js';
import { registerTelegramNotificationHandlers } from '../events/handlers/telegramNotifications.js';

class JobManager {
  constructor() {
    this.jobs = [];
  }

  start(bot) {
    this.jobs.push(
      this._register('*/10 * * * *', 'expireStaleResources', () => expireStaleResources()),
      this._register('0 * * * *', 'notifyEightyPercent', () => notifyEightyPercent(bot)),
      this._register('*/5 * * * *', 'healthCheck', () => healthCheck()),
      this._register('0 0 * * *', 'processExpirations', () => BillingService.processExpirations()),
      this._register('0 */6 * * *', 'autoRenewals', () => BillingService.processAutoRenewals()),
      this._register('0 */12 * * *', 'expiringSoonCheck', () => UsageService.checkExpiringSubscriptions(3)),
      this._register('0 2 * * *', 'cleanupUsageMetrics', () => JobQueue.enqueue('cleanup:metrics', {})),
    );

    if (bot) {
      registerTelegramNotificationHandlers(bot);
    }

    logger.info({ count: this.jobs.length }, '[jobs] Registered');
  }

  stop() {
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
    logger.info('[jobs] All stopped');
  }

  _register(schedule, name, fn) {
    const task = cron.schedule(schedule, async () => {
      logger.debug({ job: name }, '[jobs] Running');
      try {
        await fn();
      } catch (err) {
        logger.error({ err, job: name }, '[jobs] Failed');
      }
    });
    return task;
  }
}

export default new JobManager();
