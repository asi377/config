import BaseRepository from './BaseRepository.js';
import { Subscription } from '../models/index.js';

class SubscriptionRepository extends BaseRepository {
  constructor() {
    super(Subscription);
  }

  async findByOwner(ownerId) {
    return this.findMany({ ownerId }, { sort: { createdAt: -1 } });
  }

  async findActiveByOwner(ownerId) {
    return this.findOne({ ownerId, status: 'active' });
  }

  async findExpiredSubscription(ownerId, planId) {
    return this.findOne({ ownerId, planId, status: 'expired' });
  }

  async findExpiredToExpire() {
    return this.findMany({ status: 'active', expireDate: { $lte: new Date() } });
  }

  async expireMany(filter, session) {
    return this.updateMany(filter, { $set: { status: 'expired' } }, { session });
  }

  async countByOwnerAndStatus(ownerId, status) {
    return this.count({ ownerId, status });
  }

  async getTotalUsedByOwner(ownerId) {
    const result = await this.aggregate([
      { $match: { ownerId, status: 'active' } },
      { $group: { _id: null, totalUsed: { $sum: '$usedVolumeBytes' } } },
    ]);
    return result[0]?.totalUsed ?? 0;
  }

  async getDailyRevenue(since) {
    return this.aggregate([
      { $match: { createdAt: { $gte: since }, status: { $ne: 'pending_shared_payment' } } },
      { $lookup: { from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan' } },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 }, revenue: { $sum: '$plan.basePrice' } } },
      { $sort: { _id: 1 } },
    ]);
  }

  async getMonthlyRevenue(year, month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    const result = await this.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end }, status: { $ne: 'pending_shared_payment' } } },
      { $lookup: { from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan' } },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      { $group: { _id: null, totalRevenue: { $sum: '$plan.basePrice' }, totalSales: { $sum: 1 } } },
    ]);
    return result[0] || { totalRevenue: 0, totalSales: 0 };
  }

  async getOwnerIdsByStatus(status) {
    const result = await this.aggregate([
      { $match: { status } },
      { $group: { _id: '$ownerId' } },
    ]);
    return result.map((r) => r._id);
  }
}

export default new SubscriptionRepository();
