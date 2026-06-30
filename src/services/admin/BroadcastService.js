import logger from '../../config/logger.js';
import AdminBotService from './AdminBotService.js';

class BroadcastService {
  static async processBroadcastJob(bot, data) {
    const { text, targetRole } = data;
    const telegramIds = await AdminBotService.getBroadcastTargets(targetRole || 'all');
    const result = await AdminBotService.sendBroadcast(bot, telegramIds, text);
    logger.info({ targetRole, ...result }, '[broadcast] Broadcast complete');
    return result;
  }
}

export default BroadcastService;
