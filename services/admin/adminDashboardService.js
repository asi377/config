import { User, Subscription, Plan, Server } from '../../models/index.js';

const GB = 1073741824;

class AdminDashboardService {
  async getDashboard() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalUsers,
      activeSubscriptions,
      todayRevenueResult,
      todayBandwidthResult,
      serverHealth,
    ] = await Promise.all([
      User.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Subscription.aggregate([
        { $match: { createdAt: { $gte: todayStart }, status: { $ne: 'pending_shared_payment' } } },
        {
          $lookup: { from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan' },
        },
        { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, total: { $sum: '$plan.basePrice' } } },
      ]),
      Subscription.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, total: { $sum: '$usedVolumeBytes' } } },
      ]),
      Server.aggregate([
        {
          $group: {
            _id: null,
            healthy: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            total: { $sum: 1 },
          },
        },
      ]),
    ]);

    return {
      totalUsers,
      activeSubscriptions,
      todayRevenue: todayRevenueResult[0]?.total ?? 0,
      todayBandwidthGB: Number(((todayBandwidthResult[0]?.total ?? 0) / GB).toFixed(2)),
      serverHealthy: serverHealth[0]?.healthy ?? 0,
      serverTotal: serverHealth[0]?.total ?? 0,
    };
  }
}

export default new AdminDashboardService();
