import BullMQManager from './bullmq.js';
import logger from '../config/logger.js';
import config from '../config/index.js';

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

  // node-commands queue is owned by NodeCommandBridge.startNodeCommandWorker()
  // (registered separately in app.js) — do not register a second worker here,
  // BullMQ would split jobs between two competing processors non-deterministically.

  // check_payment: fired 30s after user taps "I paid". Checks if the receipt
  // has been auto-approved (SMS arrived and matched). If still pending, reschedules
  // once more at 30s (total 60s). After that, sends a "will notify when SMS arrives" message.
  BullMQManager.createWorker('default', async (job) => {
    if (job.name !== 'check_payment') return;
    const { receiptId, chatId, lang, attempt } = job.data;
    try {
      const { default: mongoose } = await import('mongoose');
      if (mongoose.connection.readyState !== 1) return;

      const { default: Receipt } = await import('../models/Receipt.js');
      const { t } = await import('../utils/i18n.js');
      const { getBotInstance } = await import('../bot/botInstance.js');
      const bot = getBotInstance();
      if (!bot) return;

      const receipt = await Receipt.findById(receiptId).lean();
      if (!receipt) return;

      if (['approved', 'auto_approved', 'paid'].includes(receipt.status)) {
        // Confirmed — deliver the DIRECT configs (idempotent; gated on I-paid,
        // which is already true because this poll is scheduled from handleIPaid).
        await bot.telegram.sendMessage(chatId, t('payment_confirmed', lang));
        const { default: ConfigDeliveryService } = await import('../services/ConfigDeliveryService.js');
        await ConfigDeliveryService.deliverForReceipt(bot.telegram, receiptId);
        return;
      }

      if (attempt < 2) {
        // Schedule one more check in 30s (attempt 2 = 60s total from first tap).
        await BullMQManager.addJob('default', 'check_payment',
          { receiptId, chatId, lang, attempt: attempt + 1 },
          { delay: 30_000 },
        );
        return;
      }

      // Two checks done (60s elapsed), still pending — tell user we'll notify.
      await bot.telegram.sendMessage(chatId, t('payment_sms_pending', lang));
    } catch (err) {
      logger.error({ err, receiptId }, '[queue] check_payment job failed');
    }
  }, { concurrency: 5 });

  logger.info('[queue] All job handlers registered');
}
