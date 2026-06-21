import BaseService from '../../shared/BaseService.js';
import UserRepository from '../../repositories/UserRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';

class AdminBotService extends BaseService {
  getBroadcastTargets = this.wrapMethod(async (audienceType) => {
    if (audienceType === 'all') {
      const users = await UserRepository.findMany({ telegramId: { $exists: true } });
      return users.map((u) => u.telegramId);
    }
    const status = audienceType === 'active' ? 'active' : 'expired';
    const ids = await SubscriptionRepository.getOwnerIdsByStatus(status);
    const users = await UserRepository.findMany({ _id: { $in: ids }, telegramId: { $exists: true } });
    return users.map((u) => u.telegramId);
  });

  sendBroadcast = this.wrapMethod(async (botInstance, telegramIds, message) => {
    let sent = 0;
    let failed = 0;
    for (const id of telegramIds) {
      try {
        await botInstance.telegram.sendMessage(id, message, { parse_mode: 'Markdown' });
        sent++;
      } catch {
        failed++;
      }
    }
    return { sent, failed, total: telegramIds.length };
  });
}

export default new AdminBotService();
