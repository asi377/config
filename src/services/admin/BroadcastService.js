/**
 * BroadcastService
 *
 * Enqueues individual per-user Telegram messages via BullMQ so that:
 *  - Telegram 429 (rate-limit) errors are handled with exponential backoff
 *  - The broadcast doesn't block the bot process
 *  - Failed sends are retried automatically (up to 5 times)
 *  - Progress is logged and queryable
 *
 * Queue: "broadcast"
 * Job name: "send_message"
 * Job data: { telegramId, text, parseMode }
 */

import BullMQManager from '../../queue/bullmq.js';
import UserRepository from '../../repositories/UserRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import logger from '../../config/logger.js';

const QUEUE_NAME = 'broadcast';
// Telegram allows ~30 messages/sec to different users; we stay well under that.
const RATE_LIMIT_DELAY_MS = 50; // 50 ms between jobs = ~20 msgs/sec

class BroadcastService {
  /**
   * Enqueue a broadcast to a target audience.
   *
   * @param {'all'|'active'|'on_hold'|'expired'} audience
   * @param {string} text          - Message text (Markdown supported)
   * @param {string} parseMode     - 'Markdown' | 'HTML' | null
   * @returns {{ enqueued: number, audience: string }}
   */
  async enqueueBroadcast(audience, text, parseMode = 'Markdown') {
    const telegramIds = await this._resolveAudience(audience);
    if (telegramIds.length === 0) {
      logger.info({ audience }, '[broadcast] No targets found');
      return { enqueued: 0, audience };
    }

    // Ensure the BullMQ queue exists
    BullMQManager.createQueue(QUEUE_NAME, {
      attempts: 5,
      backoffDelay: 2000, // exponential from 2 s
    });

    // Build bulk job list — stagger with a small delay to respect rate limits
    const jobs = telegramIds.map((telegramId, i) => ({
      name: 'send_message',
      data: { telegramId, text, parseMode },
      delay: i * RATE_LIMIT_DELAY_MS,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
    }));

    await BullMQManager.enqueueBulk(QUEUE_NAME, jobs);

    logger.info({ audience, count: jobs.length }, '[broadcast] Enqueued');
    return { enqueued: jobs.length, audience };
  }

  /**
   * Register the BullMQ worker that actually calls ctx.telegram.sendMessage.
   * Must be called once at app startup with the Telegraf bot instance.
   *
   * @param {import('telegraf').Telegraf} bot
   */
  registerWorker(bot) {
    BullMQManager.registerHandler(
      QUEUE_NAME,
      async (data) => {
        const { telegramId, text, parseMode } = data;
        await bot.telegram.sendMessage(telegramId, text, {
          parse_mode: parseMode || undefined,
          disable_web_page_preview: true,
        });
        logger.debug({ telegramId }, '[broadcast] Message sent');
        return { sent: true };
      },
      {
        concurrency: 5,
        // BullMQ rate-limiter: max 20 jobs per second across all workers
        limiter: { max: 20, duration: 1000 },
      },
    );

    logger.info('[broadcast] Worker registered');
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async _resolveAudience(audience) {
    let ownerIds;

    switch (audience) {
      case 'active':
        ownerIds = await SubscriptionRepository.getOwnerIdsByStatus('active');
        break;
      case 'on_hold':
        ownerIds = await SubscriptionRepository.getOwnerIdsByStatus('on_hold');
        break;
      case 'expired':
        ownerIds = await SubscriptionRepository.getOwnerIdsByStatus('expired');
        break;
      case 'all':
      default: {
        const users = await UserRepository.findMany(
          { role: { $nin: ['banned'] } },
          { limit: 50000 },
        );
        return users.map(u => u.telegramId).filter(Boolean);
      }
    }

    if (!ownerIds || ownerIds.length === 0) return [];
    const users = await UserRepository.findMany({ _id: { $in: ownerIds } });
    return users.map(u => u.telegramId).filter(Boolean);
  }
}

export default new BroadcastService();
