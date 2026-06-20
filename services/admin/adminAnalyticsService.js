import mongoose from 'mongoose';
import { User, Subscription, Plan } from '../../models/index.js';

class AdminAnalyticsService {
  async getRetentionRate() {
    const totalUsers = await User.countDocuments();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const activeInLast30 = await Subscription.distinct('ownerId', {
      status: 'active',
      expireDate: { $gte: new Date() },
    });

    const retentionRate = totalUsers > 0
      ? Number(((activeInLast30.length / totalUsers) * 100).toFixed(1))
      : 0;

    return { retentionRate, activeUsers: activeInLast30.length, totalUsers };
  }

  async getChurnRate() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);

    const [prevPeriod, currentPeriod] = await Promise.all([
      Subscription.distinct('ownerId', {
        status: 'expired',
        expireDate: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo },
      }),
      Subscription.distinct('ownerId', {
        status: 'expired',
        expireDate: { $gte: thirtyDaysAgo },
      }),
    ]);

    const churnRate = prevPeriod.length > 0
      ? Number(((currentPeriod.length / prevPeriod.length) * 100).toFixed(1))
      : 0;

    return { churnRate, churnedLast30: currentPeriod.length, churnedPrev30: prevPeriod.length };
  }

  async getServerPopularity() {
    const pipeline = [
      { $match: { status: 'active' } },
      {
        $group: {
          _id: '$serverId',
          subscriberCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'servers',
          localField: '_id',
          foreignField: '_id',
          as: 'server',
        },
      },
      { $unwind: '$server' },
      {
        $project: {
          _id: 0,
          serverName: '$server.name',
          ipAddress: '$server.ipAddress',
          subscriberCount: 1,
        },
      },
      { $sort: { subscriberCount: -1 } },
    ];

    return Subscription.aggregate(pipeline);
  }
}

export default new AdminAnalyticsService();
