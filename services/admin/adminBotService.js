import mongoose from 'mongoose';
import { User, Subscription } from '../../models/index.js';

class AdminBotService {
  async getBroadcastTargets(audienceType) {
    if (audienceType === 'all') {
      const users = await User.find({ telegramId: { $exists: true } })
        .select('telegramId')
        .lean();
      return users.map((u) => u.telegramId);
    }

    const statusMatch = audienceType === 'active' ? 'active' : 'expired';

    const results = await Subscription.aggregate([
      { $match: { status: statusMatch } },
      { $group: { _id: '$ownerId' } },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      { $group: { _id: null, ids: { $addToSet: '$user.telegramId' } } },
    ]);

    return results[0]?.ids ?? [];
  }

  async sendBroadcast(botInstance, telegramIds, message) {
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
  }
}

export default new AdminBotService();
