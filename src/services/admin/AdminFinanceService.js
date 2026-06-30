import BaseService from '../../shared/BaseService.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import PromoCodeRepository from '../../repositories/PromoCodeRepository.js';

class AdminFinanceService extends BaseService {
  getDailySales = this.wrapMethod(async (days = 30) => {
    const since = new Date(Date.now() - days * 86400000);
    return SubscriptionRepository.getDailyRevenue(since);
  });

  getMonthlySales = this.wrapMethod(async (year, month) => {
    return SubscriptionRepository.getMonthlyRevenue(year, month);
  });

  getDiscountCodeStats = this.wrapMethod(async () => PromoCodeRepository.findMany({}));

  getRevenueProjection = this.wrapMethod(async (months = 3) => {
    const last30 = await this.getDailySales(30);
    const avgDaily = last30.reduce((sum, d) => sum + d.revenue, 0) / Math.max(last30.length, 1);
    return {
      monthlyAverage: Math.round(avgDaily * 30),
      projection3Months: Math.round(avgDaily * 30 * months),
    };
  });
}

export default new AdminFinanceService();
