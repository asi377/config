import Subscription from '../models/Subscription.js';
import logger from '../config/logger.js';

export async function notifyEightyPercent(bot) {
  if (!bot) return;

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
        await bot.telegram.sendMessage(
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
        logger.error({ telegramId, err: msgErr }, '[job] Failed to notify user');
      }
    }

    if (subs.length > 0) {
      logger.info({ count: subs.length }, '[job] Notified 80% usage');
    }
  } catch (err) {
    logger.error({ err }, '[job] notifyEightyPercent failed');
  }
}
