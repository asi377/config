import BaseRepository from './BaseRepository.js';
import { Transaction } from '../models/index.js';

class TransactionRepository extends BaseRepository {
  constructor() {
    super(Transaction);
  }

  async findByUserId(userId, options = {}) {
    return this.findMany({ userId }, { sort: { createdAt: -1 }, ...options });
  }

  async findByReference(referenceType, referenceId) {
    return this.findOne({ referenceType, referenceId });
  }

  async getRevenueByDateRange(startDate, endDate) {
    return this.aggregate([
      {
        $match: {
          type: { $in: ['deposit', 'payment'] },
          createdAt: { $gte: startDate, $lt: endDate },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);
  }

  async getDailyRevenueForPeriod(since) {
    return this.aggregate([
      {
        $match: {
          type: { $in: ['deposit', 'payment'] },
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }
}

export default new TransactionRepository();
