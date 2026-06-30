import EventBus from '../EventBus.js';
import logger from '../../config/logger.js';

export function registerTelegramNotificationHandlers(bot) {
  if (!bot) {
    logger.warn('[events] No bot instance, Telegram notifications disabled');
    return [];
  }

  const ids = [];

  ids.push(EventBus.on('fraud:detected', async (data) => {
    try {
      const msg = [
        '🚨 *هشدار تقلب*',
        '',
        `نوع: ${data.ruleName || 'نامشخص'}`,
        `کاربر: \`${data.userId}\``,
        `شدت: ${data.severity}`,
        `امتیاز: ${data.score}`,
        data.description ? `توضیحات: ${data.description}` : '',
      ].join('\n');
      await bot.telegram.sendMessage(data.adminChatId, msg, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.error({ err }, '[events] Failed to send fraud alert');
    }
  }, { name: 'fraud_notification' }));

  ids.push(EventBus.on('server:health_degraded', async (data) => {
    try {
      const msg = [
        '⚠️ *هشدار وضعیت سرور*',
        '',
        `سرور: ${data.serverName || data.serverId}`,
        `وضعیت: ${data.healthStatus}`,
        `بار: ${data.loadPercent}%`,
        data.errorMessage ? `خطا: ${data.errorMessage}` : '',
      ].join('\n');
      await bot.telegram.sendMessage(data.adminChatId, msg, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.error({ err }, '[events] Failed to send server alert');
    }
  }, { name: 'server_health_notification' }));

  ids.push(EventBus.on('payment:approved', async (data) => {
    try {
      const user = data.userTelegramId;
      if (!user) return;
      const msg = [
        '✅ *پرداخت شما تأیید شد*',
        '',
        `مبلغ: ${data.amount?.toLocaleString()} ریال`,
        data.planName ? `پلن: ${data.planName}` : '',
        '',
        'از سرویس ما لذت ببرید! 🐝',
      ].join('\n');
      await bot.telegram.sendMessage(user, msg, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.error({ err }, '[events] Failed to send payment notification');
    }
  }, { name: 'payment_notification' }));

  ids.push(EventBus.on('infra:bootstrap_complete', async (data) => {
    try {
      const msg = [
        '🖥️ *بوت‌استرپ سرور کامل شد*',
        '',
        `نام: ${data.serverName || 'نامشخص'}`,
        `آیپی: ${data.ipAddress || 'نامشخص'}`,
        `منطقه: ${data.region || 'نامشخص'}`,
      ].join('\n');
      await bot.telegram.sendMessage(data.adminChatId, msg, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.error({ err }, '[events] Failed to send bootstrap notification');
    }
  }, { name: 'bootstrap_notification' }));

  logger.info('[events] Telegram notification handlers registered');
  return ids;
}
