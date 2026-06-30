import BaseService from '../../shared/BaseService.js';
import mongoose from 'mongoose';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import UserRepository from '../../repositories/UserRepository.js';
import PlanRepository from '../../repositories/PlanRepository.js';
import TransactionRepository from '../../repositories/TransactionRepository.js';
import TunnelConfigRepository from '../../repositories/TunnelConfigRepository.js';
import EventBus from '../../events/EventBus.js';
import logger from '../../config/logger.js';

class BillingService extends BaseService {
  async autoRenewSubscription(subscriptionId) {
    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const sub = await SubscriptionRepository.findById(subscriptionId, { session });
        if (!sub || sub.status !== 'active') return { action: 'not_active' };

        const plan = await PlanRepository.findById(sub.planId, { session });
        if (!plan) return { action: 'plan_not_found' };

        const user = await UserRepository.findById(sub.ownerId, { session });
        if (!user) return { action: 'user_not_found' };

        if (user.walletBalance < plan.basePrice) {
          return { action: 'insufficient_balance', balance: user.walletBalance, required: plan.basePrice };
        }

        const rolloverBytes = sub.remainingVolumeBytes > 0 ? sub.remainingVolumeBytes : 0;

        user.walletBalance -= plan.basePrice;
        await user.save({ session });

        sub.totalVolumeBytes = plan.baseVolumeGB * 1073741824 + rolloverBytes;
        sub.rolloverVolumeBytes = rolloverBytes;
        sub.usedVolumeBytes = 0;
        sub.startDate = new Date();
        sub.expireDate = new Date(Date.now() + plan.durationDays * 86400000);
        sub.notified80Percent = false;
        await sub.save({ session });

        await TransactionRepository.create({
          userId: sub.ownerId,
          type: 'payment',
          status: 'completed',
          amount: plan.basePrice,
          description: `Auto-renewal: ${plan.title}`,
          balanceBefore: user.walletBalance + plan.basePrice,
          balanceAfter: user.walletBalance,
          referenceType: 'subscription',
          referenceId: sub._id,
          metadata: {
            category: 'subscription_renewal',
          },
        }, { session });

        EventBus.emit('subscription:renewed', {
          subscriptionId: sub._id,
          userId: sub.ownerId,
          planName: plan.title,
          amount: plan.basePrice,
          expireDate: sub.expireDate,
          rolloverBytes,
        });

        return {
          action: 'renewed',
          subscriptionId: sub._id,
          planName: plan.name,
          amount: plan.basePrice,
          rolloverGB: this._bytesToGB(rolloverBytes),
          newExpiry: sub.expireDate,
        };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async processAutoRenewals() {
    const now = new Date();
    const renewalWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const expiringSubs = await SubscriptionRepository.findMany({
      status: 'active',
      expireDate: { $lte: renewalWindow, $gte: now },
    });

    logger.info({ count: expiringSubs.length }, '[billing] Processing auto-renewals');

    const results = [];
    for (const sub of expiringSubs) {
      try {
        const result = await this.autoRenewSubscription(sub._id);
        results.push({ subscriptionId: sub._id, ...result });

        if (result.action === 'insufficient_balance') {
          EventBus.emit('subscription:renewal_failed', {
            subscriptionId: sub._id,
            userId: sub.ownerId,
            reason: 'insufficient_balance',
            balance: result.balance,
            required: result.required,
          });
        }
      } catch (err) {
        logger.error({ err, subscriptionId: sub._id }, '[billing] Auto-renewal error');
        results.push({ subscriptionId: sub._id, action: 'error', error: err.message });
      }
    }
    return results;
  }

  async processExpirations() {
    const expired = await SubscriptionRepository.findMany({
      status: 'active',
      expireDate: { $lt: new Date() },
    });

    for (const sub of expired) {
      sub.status = 'expired';
      await sub.save();

      await TunnelConfigRepository.updateMany(
        { subscriptionId: sub._id, isActive: true },
        { $set: { isActive: false } },
      );

      EventBus.emit('subscription:expired', {
        subscriptionId: sub._id,
        userId: sub.ownerId,
      });
    }

    logger.info({ count: expired.length }, '[billing] Expired subscriptions processed');
    return { expired: expired.length };
  }

  async getBillingReport(userId) {
    const transactions = await TransactionRepository.findMany(
      { userId },
      { sort: { createdAt: -1 }, limit: 50 },
    );
    const subs = await SubscriptionRepository.findMany(
      { ownerId: userId },
      { populate: 'planId' },
    );

    const totalSpent = transactions
      .filter(t => t.type === 'payment' && t.status === 'completed')
      .reduce((s, t) => s + t.amount, 0);

    return {
      userId,
      totalSpent,
      transactionCount: transactions.length,
      recentTransactions: transactions.slice(0, 10).map(t => ({
        id: t._id,
        type: t.type,
        category: t.category,
        amount: t.amount,
        description: t.description,
        status: t.status,
        createdAt: t.createdAt,
      })),
      subscriptions: subs.map(s => ({
        id: s._id,
        plan: s.planId?.name || 'Unknown',
        status: s.status,
        price: s.planId?.basePrice || 0,
        expireDate: s.expireDate,
      })),
    };
  }

  async getPlanRecommendation(userId) {
    const subs = await SubscriptionRepository.findMany(
      { ownerId: userId },
      { populate: 'planId' },
    );

    const avgUsage = subs
      .filter(s => s.status === 'active' && s.totalVolumeBytes > 0)
      .map(s => ({
        usedGB: this._bytesToGB(s.usedVolumeBytes),
        totalGB: this._bytesToGB(s.totalVolumeBytes),
        usagePercent: (s.usedVolumeBytes / s.totalVolumeBytes) * 100,
      }));

    // If user consistently uses >80%, recommend upgrade
    const consistentlyHigh = avgUsage.filter(u => u.usagePercent > 80).length > 0;
    const totalAvgGB = avgUsage.reduce((s, u) => s + u.usedGB, 0) / Math.max(avgUsage.length, 1);

    return {
      analyzeSubscriptionCount: avgUsage.length,
      averageUsageGB: Number(totalAvgGB.toFixed(2)),
      recommendUpgrade: consistentlyHigh,
      currentMaxPlan: subs.length > 0 ? subs[0].planId?.name : null,
    };
  }

  _bytesToGB(bytes) {
    return Number((bytes / 1073741824).toFixed(2));
  }
}

export default new BillingService();
