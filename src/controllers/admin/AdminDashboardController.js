import logger from '../../config/logger.js';

export async function getDashboard(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const Subscription = (await import('../../models/Subscription.js')).default;
    const Transaction = (await import('../../models/Transaction.js')).default;
    const Receipt = (await import('../../models/Receipt.js')).default;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalUsers, activeSubscriptions, pendingReceipts, dailyRevenue] = await Promise.all([
      User.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Receipt.countDocuments({ status: 'pending' }),
      Transaction.aggregate([
        { $match: { type: 'payment', status: 'completed', createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        activeSubscriptions,
        pendingReceipts,
        dailyRevenue: dailyRevenue[0]?.total || 0,
        lastUpdated: new Date(),
      },
    });
  } catch (err) {
    next(err);
  }
}
