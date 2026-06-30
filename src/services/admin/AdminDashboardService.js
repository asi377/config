import BaseService from '../../shared/BaseService.js';
import UserRepository from '../../repositories/UserRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import ServerRepository from '../../repositories/ServerRepository.js';

const GB = 1073741824;

class AdminDashboardService extends BaseService {
  getDashboard = this.wrapMethod(async () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalUsers, activeSubscriptions, todayRevenueResult, todayBandwidthResult, serverHealth] = await Promise.all([
      UserRepository.count(),
      SubscriptionRepository.count({ status: 'active' }),
      SubscriptionRepository.aggregate([
        { $match: { createdAt: { $gte: todayStart }, status: { $ne: 'pending_shared_payment' } } },
        { $lookup: { from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan' } },
        { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, total: { $sum: '$plan.basePrice' } } },
      ]),
      SubscriptionRepository.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, total: { $sum: '$usedVolumeBytes' } } },
      ]),
      ServerRepository.aggregate([
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
  });
}

export default new AdminDashboardService();
