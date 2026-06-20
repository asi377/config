import mongoose from 'mongoose';
import { Subscription, Plan, PromoCode } from '../../models/index.js';

class AdminFinanceService {
  async getDailySales(days = 30) {
    const since = new Date(Date.now() - days * 86400000);

    const pipeline = [
      { $match: { createdAt: { $gte: since }, status: { $ne: 'pending_shared_payment' } } },
      {
        $lookup: { from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan' },
      },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          revenue: { $sum: '$plan.basePrice' },
        },
      },
      { $sort: { _id: 1 } },
    ];

    return Subscription.aggregate(pipeline);
  }

  async getMonthlySales(year, month) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);

    const pipeline = [
      { $match: { createdAt: { $gte: start, $lte: end }, status: { $ne: 'pending_shared_payment' } } },
      {
        $lookup: { from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan' },
      },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$plan.basePrice' },
          totalSales: { $sum: 1 },
        },
      },
    ];

    const result = await Subscription.aggregate(pipeline);
    return result[0] || { totalRevenue: 0, totalSales: 0 };
  }

  async getDiscountCodeStats() {
    return PromoCode.find().lean();
  }

  async getRevenueProjection(months = 3) {
    const last30 = await this.getDailySales(30);
    const avgDaily = last30.reduce((sum, d) => sum + d.revenue, 0) / Math.max(last30.length, 1);
    return {
      monthlyAverage: Math.round(avgDaily * 30),
      projection3Months: Math.round(avgDaily * 30 * months),
    };
  }
}

export default new AdminFinanceService();
