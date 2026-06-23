import mongoose from 'mongoose';
import logger from '../../config/logger.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import UserRepository from '../../repositories/UserRepository.js';
import PlanRepository from '../../repositories/PlanRepository.js';
import TransactionRepository from '../../repositories/TransactionRepository.js';
import EventBus from '../../events/EventBus.js';
import paymentGateway from '../gateway/index.js';

export const SUBSCRIPTION_STATES = {
  TRIAL: 'trial',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  PENDING_PAYMENT: 'pending_payment',
};

export class SubscriptionLifecycleError extends Error {
  constructor(message, code = 'SUBSCRIPTION_ERROR') {
    super(message);
    this.name = 'SubscriptionLifecycleError';
    this.code = code;
  }
}

class SubscriptionEngine {
  async create(userId, planId, gateway = 'wallet') {
    const session = await mongoose.startSession();
    try {
      return session.withTransaction(async () => {
        const user = await UserRepository.findById(userId, { session });
        if (!user) throw new SubscriptionLifecycleError('User not found');

        const plan = await PlanRepository.findById(planId, { session });
        if (!plan) throw new SubscriptionLifecycleError('Plan not found');

        const now = new Date();
        const expireDate = new Date(now.getTime() + plan.durationDays * 86400000);

        if (plan.basePrice > 0) {
          const payment = await paymentGateway.createPayment(
            plan.basePrice,
            'irr',
            { userId, planId, description: `Purchase ${plan.title}` },
            gateway,
          );

          const sub = await SubscriptionRepository.create({
            ownerId: userId,
            planId: plan._id,
            status: payment.status === 'completed' ? 'on_hold' : 'pending_payment',
            totalVolumeBytes: plan.baseVolumeGB * 1073741824,
            usedVolumeBytes: 0,
            startDate: now,
            expireDate,
            gatewayPaymentId: payment.paymentId,
            gatewayName: payment.gateway,
            activatedAt: null,
          }, { session });

          await TransactionRepository.create({
            userId,
            type: 'payment',
            amount: plan.basePrice,
            description: `Purchase: ${plan.title}`,
            balanceBefore: user.walletBalance,
            balanceAfter: user.walletBalance,
            referenceType: 'subscription',
            referenceId: sub._id,
            metadata: {
              category: 'subscription_purchase',
              gateway: payment.gateway,
              gatewayPaymentId: payment.paymentId,
              paymentStatus: payment.status,
            },
          }, { session });

          if (payment.status === 'completed') {
            EventBus.emit('subscription:created', { userId, subscriptionId: sub._id, planName: plan.title });
          }

          return { subscription: sub, payment };
        }

        const sub = await SubscriptionRepository.create({
          ownerId: userId,
          planId: plan._id,
          status: 'on_hold',
          totalVolumeBytes: plan.baseVolumeGB * 1073741824,
          usedVolumeBytes: 0,
          startDate: now,
          expireDate,
          activatedAt: null,
        }, { session });

        EventBus.emit('subscription:created', { userId, subscriptionId: sub._id, planName: plan.title });
        return { subscription: sub, payment: null };
      });
    } finally {
      await session.endSession();
    }
  }

  async renew(subscriptionId, gateway = null) {
    const session = await mongoose.startSession();
    try {
      return session.withTransaction(async () => {
        const sub = await SubscriptionRepository.findById(subscriptionId, { session });
        if (!sub) throw new SubscriptionLifecycleError('Subscription not found');
        if (sub.status === 'cancelled') throw new SubscriptionLifecycleError('Subscription cancelled');

        const plan = await PlanRepository.findById(sub.planId, { session });
        if (!plan) throw new SubscriptionLifecycleError('Plan not found');

        const user = await UserRepository.findById(sub.ownerId, { session });
        if (!user) throw new SubscriptionLifecycleError('User not found');

        const rolloverBytes = sub.remainingVolumeBytes > 0 ? sub.remainingVolumeBytes : 0;
        const now = new Date();
        const expireDate = new Date(now.getTime() + plan.durationDays * 86400000);

        if (plan.basePrice > 0) {
          const payment = await paymentGateway.createPayment(
            plan.basePrice,
            'irr',
            { userId: sub.ownerId, planId: plan._id, description: `Renewal: ${plan.title}` },
            gateway,
          );

          sub.totalVolumeBytes = plan.baseVolumeGB * 1073741824 + rolloverBytes;
          sub.rolloverVolumeBytes = rolloverBytes;
          sub.usedVolumeBytes = 0;
          sub.startDate = now;
          sub.expireDate = expireDate;
          sub.status = 'active';
          sub.gatewayPaymentId = payment.paymentId;
          await sub.save({ session });

          await TransactionRepository.create({
            userId: sub.ownerId,
            type: 'payment',
            amount: plan.basePrice,
            description: `Renewal: ${plan.title}`,
            balanceBefore: user.walletBalance,
            balanceAfter: user.walletBalance,
            referenceType: 'subscription',
            referenceId: sub._id,
            metadata: {
              category: 'subscription_renewal',
              gateway: payment.gateway,
              gatewayPaymentId: payment.paymentId,
              paymentStatus: payment.status,
            },
          }, { session });

          EventBus.emit('subscription:renewed', { subscriptionId: sub._id, userId: sub.ownerId, planName: plan.title });
          return { subscription: sub, payment };
        }

        sub.totalVolumeBytes = plan.baseVolumeGB * 1073741824 + rolloverBytes;
        sub.rolloverVolumeBytes = rolloverBytes;
        sub.usedVolumeBytes = 0;
        sub.startDate = now;
        sub.expireDate = expireDate;
        sub.status = 'active';
        await sub.save({ session });

        return { subscription: sub, payment: null };
      });
    } finally {
      await session.endSession();
    }
  }

  async cancel(subscriptionId) {
    const sub = await SubscriptionRepository.findById(subscriptionId);
    if (!sub) throw new SubscriptionLifecycleError('Subscription not found');

    sub.status = 'cancelled';
    await sub.save();

    EventBus.emit('subscription:cancelled', { subscriptionId: sub._id, userId: sub.ownerId });
    logger.info({ subscriptionId }, '[billing] Subscription cancelled');
    return sub;
  }

  async suspend(subscriptionId, reason = 'admin_suspend') {
    const sub = await SubscriptionRepository.findById(subscriptionId);
    if (!sub) throw new SubscriptionLifecycleError('Subscription not found');

    sub.status = 'suspended';
    sub.suspendReason = reason;
    await sub.save();

    const { default: TunnelConfigRepository } = await import('../../repositories/TunnelConfigRepository.js');
    await TunnelConfigRepository.updateMany(
      { subscriptionId: sub._id, isActive: true },
      { $set: { isActive: false } },
    );

    EventBus.emit('subscription:suspended', { subscriptionId: sub._id, userId: sub.ownerId, reason });
    return sub;
  }

  async resume(subscriptionId) {
    const sub = await SubscriptionRepository.findById(subscriptionId);
    if (!sub) throw new SubscriptionLifecycleError('Subscription not found');

    const plan = await PlanRepository.findById(sub.planId);
    if (!plan) throw new SubscriptionLifecycleError('Plan not found');

    if (new Date() > sub.expireDate) {
      throw new SubscriptionLifecycleError('Subscription expired, renew instead');
    }

    sub.status = 'active';
    sub.suspendReason = null;
    await sub.save();

    EventBus.emit('subscription:resumed', { subscriptionId: sub._id, userId: sub.ownerId });
    return sub;
  }

  async processExpirations() {
    const expired = await SubscriptionRepository.findMany({
      status: { $in: ['active', 'trial'] },
      expireDate: { $lt: new Date() },
    });

    let count = 0;
    for (const sub of expired) {
      sub.status = 'expired';
      await sub.save();
      count++;

      const { default: TunnelConfigRepository } = await import('../../repositories/TunnelConfigRepository.js');
      await TunnelConfigRepository.updateMany(
        { subscriptionId: sub._id, isActive: true },
        { $set: { isActive: false } },
      );

      EventBus.emit('subscription:expired', { subscriptionId: sub._id, userId: sub.ownerId });
    }

    logger.info({ count }, '[billing] Expirations processed');
    return { expired: count };
  }

  async getLifecycleState(subscriptionId) {
    const sub = await SubscriptionRepository.findById(subscriptionId, { populate: 'planId' });
    if (!sub) return null;

    const now = new Date();
    const daysUntilExpiry = Math.ceil((sub.expireDate - now) / 86400000);
    const usagePercent = sub.totalVolumeBytes > 0
      ? (sub.usedVolumeBytes / sub.totalVolumeBytes) * 100
      : 0;

    const allowedTransitions = {
      trial: ['active', 'expired'],
      active: ['expired', 'suspended', 'cancelled'],
      suspended: ['active', 'expired', 'cancelled'],
      expired: ['active'],
      cancelled: [],
      pending_payment: ['active', 'expired', 'cancelled'],
    };

    return {
      id: sub._id,
      status: sub.status,
      plan: sub.planId?.title,
      daysUntilExpiry,
      usagePercent: Number(usagePercent.toFixed(1)),
      allowedActions: allowedTransitions[sub.status] || [],
      isExpired: now > sub.expireDate,
      isQuotaExhausted: sub.usedVolumeBytes >= sub.totalVolumeBytes,
    };
  }
}

export default new SubscriptionEngine();
