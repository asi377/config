import BaseService from '../../shared/BaseService.js';
import UserRepository from '../../repositories/UserRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';

class AdminAnalyticsService extends BaseService {
  getRetentionRate = this.wrapMethod(async () => {
    const totalUsers = await UserRepository.count();
    const activeInLast30 = await SubscriptionRepository.distinct('ownerId', {
      status: 'active',
      expireDate: { $gte: new Date() },
    });
    const retentionRate = totalUsers > 0
      ? Number(((activeInLast30.length / totalUsers) * 100).toFixed(1))
      : 0;
    return { retentionRate, activeUsers: activeInLast30.length, totalUsers };
  });

  getChurnRate = this.wrapMethod(async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);

    const [prevPeriod, currentPeriod] = await Promise.all([
      SubscriptionRepository.distinct('ownerId', {
        status: 'expired',
        expireDate: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo },
      }),
      SubscriptionRepository.distinct('ownerId', {
        status: 'expired',
        expireDate: { $gte: thirtyDaysAgo },
      }),
    ]);

    const churnRate = prevPeriod.length > 0
      ? Number(((currentPeriod.length / prevPeriod.length) * 100).toFixed(1))
      : 0;
    return { churnRate, churnedLast30: currentPeriod.length, churnedPrev30: prevPeriod.length };
  });

  getServerPopularity = this.wrapMethod(async () => {
    return SubscriptionRepository.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$serverId', subscriberCount: { $sum: 1 } } },
      { $lookup: { from: 'servers', localField: '_id', foreignField: '_id', as: 'server' } },
      { $unwind: '$server' },
      { $project: { _id: 0, serverName: '$server.name', ipAddress: '$server.ipAddress', subscriberCount: 1 } },
      { $sort: { subscriberCount: -1 } },
    ]);
  });
}

export default new AdminAnalyticsService();
