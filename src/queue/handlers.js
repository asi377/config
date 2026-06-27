import BullMQManager from './bullmq.js';
import logger from '../config/logger.js';

export function registerJobHandlers() {
  // Register telegram-out handler
  BullMQManager.createWorker('telegram-out', async (job) => {
    logger.debug({ jobData: job.data }, '[queue] Processing telegram-out job');
  }, { concurrency: 5 });

  // Register provisioning handler
  BullMQManager.createWorker('provisioning', async (job) => {
    logger.debug({ jobData: job.data }, '[queue] Processing provisioning job');
  }, { concurrency: 2 });

  // Register billing handler
  BullMQManager.createWorker('billing', async (job) => {
    logger.debug({ jobData: job.data }, '[queue] Processing billing job');
  }, { concurrency: 1 });

  // Register node-commands handler
  BullMQManager.createWorker('node-commands', async (job) => {
    logger.debug({ jobData: job.data }, '[queue] Processing node-command job');
  }, { concurrency: 3 });

  logger.info('[queue] All job handlers registered');
}
