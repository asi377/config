import cron from 'node-cron';
import { Subscription, TunnelConfig } from '../models/index.js';
import tunnelService from './TunnelService.js';

class CronService {
  constructor() {
    this.bot = null;
    this.jobs = [];
  }

  /**
   * Register all recurring jobs. Must be called after the bot is created.
   * @param {import('telegraf').Telegraf} bot
   */
  start(bot) {
    this.bot = bot;

    this.jobs.push(
      cron.schedule('*/10 * * * *', () => this._expireStaleResources()),
      cron.schedule('0 * * * *', () => this._notifyEightyPercent()),
    );

    console.log(`✓ ${this.jobs.length} cron jobs registered`);
  }

  stop() {
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
  }

  // -----------------------------------------------------------------------
  // Job 1 — every 10 minutes
  // -----------------------------------------------------------------------

  async _expireStaleResources() {
    const now = new Date();

    try {
      // -- expire subscriptions --
      const expiredSubs = await Subscription.find({
        status: 'active',
        expireDate: { $lte: now },
      });

      for (const sub of expiredSubs) {
        if (sub.serverId) {
          await tunnelService.releaseServer(sub.serverId.toString());
        }
        sub.status = 'expired';
        await sub.save();
      }

      // -- expire tunnel configs --
      await TunnelConfig.updateMany(
        {
          isActive: true,
          $or: [
            { isGuestLink: true, guestExpireDate: { $lte: now } },
            { allocatedQuotaBytes: { $ne: null }, $expr: { $gte: ['$usedQuotaBytes', '$allocatedQuotaBytes'] } },
          ],
        },
        { $set: { isActive: false } },
      );

      // -- expire subs with zero remaining volume --
      await Subscription.updateMany(
        {
          status: 'active',
          $expr: { $gte: ['$usedVolumeBytes', '$totalVolumeBytes'] },
        },
        { $set: { status: 'expired' } },
      );

      if (expiredSubs.length > 0) {
        console.log(`[cron] Expired ${expiredSubs.length} subscription(s)`);
      }
    } catch (err) {
      console.error('[cron] _expireStaleResources error:', err.message);
    }
  }

  // -----------------------------------------------------------------------
  // Job 2 — hourly
  // -----------------------------------------------------------------------

  async _notifyEightyPercent() {
    try {
      const subs = await Subscription.find({
        status: 'active',
        notified80Percent: false,
        $expr: {
          $gte: [
            { $divide: ['$usedVolumeBytes', '$totalVolumeBytes'] },
            0.8,
          ],
        },
      }).populate('ownerId');

      for (const sub of subs) {
        const telegramId = sub.ownerId?.telegramId;
        if (!telegramId) continue;

        try {
          await this.bot.telegram.sendMessage(
            telegramId,
            '⚠️ *هشدار مصرف حجم*\n\n' +
            'حجم سرویس شما به `80%` مصرف رسیده است.\n' +
            'لطفاً در صورت نیاز نسبت به تمدید یا افزایش حجم اقدام کنید.\n\n' +
            '🙏 با تشکر از همراهی شما',
            { parse_mode: 'Markdown' },
          );

          sub.notified80Percent = true;
          await sub.save();
        } catch (msgErr) {
          console.error(`[cron] Failed to notify user ${telegramId}:`, msgErr.message);
        }
      }

      if (subs.length > 0) {
        console.log(`[cron] Notified ${subs.length} user(s) about 80% usage`);
      }
    } catch (err) {
      console.error('[cron] _notifyEightyPercent error:', err.message);
    }
  }
}

export default new CronService();
