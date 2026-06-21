import mongoose from 'mongoose';
import BaseService from '../shared/BaseService.js';
import {
  NotFoundError,
  InsufficientBalanceError,
  SubscriptionSuspendedError,
  SharedPaymentNotPendingError,
  UserNotInSharedPaymentError,
  UserAlreadyPaidError,
} from '../shared/errors.js';
import UserRepository from '../repositories/UserRepository.js';
import PlanRepository from '../repositories/PlanRepository.js';
import SubscriptionRepository from '../repositories/SubscriptionRepository.js';
import ServerRepository from '../repositories/ServerRepository.js';
import { calculateRank } from '../utils/formatters.js';

const GB = 1073741824;

async function provisionPool(user, plan, session) {
  const server = await ServerRepository.allocateLeastLoaded();
  const now = new Date();
  const expireDate = new Date(now.getTime() + plan.durationDays * 86400000);

  return SubscriptionRepository.create({
    ownerId: user._id,
    planId: plan._id,
    serverId: server._id,
    status: 'active',
    totalVolumeBytes: plan.baseVolumeGB * GB,
    rolloverVolumeBytes: 0,
    usedVolumeBytes: 0,
    startDate: now,
    expireDate,
  }, { session });
}

class SubscriptionService extends BaseService {
  createSubscription = this.wrapMethod(async (userId, planId) => {
    const session = await mongoose.startSession();
    try {
      return session.withTransaction(async () => {
        const plan = await PlanRepository.findById(planId, { session });
        if (!plan) throw new NotFoundError('Plan');
        if (!plan.isActive) throw new Error('Selected plan is no longer available');

        const user = await UserRepository.findById(userId, { session });
        if (!user) throw new NotFoundError('User');

        if (user.walletBalance < plan.basePrice) {
          throw new InsufficientBalanceError(user.walletBalance, plan.basePrice);
        }

        user.walletBalance -= plan.basePrice;
        user.totalSpent = (user.totalSpent || 0) + plan.basePrice;
        user.rank = calculateRank(user.totalSpent);
        await user.save({ session });

        if (user.referredBy) {
          const referrer = await UserRepository.findById(user.referredBy, { session });
          if (referrer) {
            const reward = Math.round(plan.basePrice * 0.1);
            referrer.walletBalance += reward;
            await referrer.save({ session });
          }
        }

        return provisionPool(user, plan, session);
      });
    } finally {
      await session.endSession();
    }
  });

  forceCreateSubscription = this.wrapMethod(async (telegramId, planId) => {
    const session = await mongoose.startSession();
    try {
      return session.withTransaction(async () => {
        const plan = await PlanRepository.findById(planId, { session });
        if (!plan) throw new NotFoundError('Plan');
        if (!plan.isActive) throw new Error('Plan is no longer available');

        let user = await UserRepository.findByTelegramId(telegramId);
        if (!user) {
          user = await UserRepository.create({ telegramId }, { session });
        }

        return provisionPool(user, plan, session);
      });
    } finally {
      await session.endSession();
    }
  });

  renewWithRollover = this.wrapMethod(async (subscriptionId, newPlanId) => {
    const session = await mongoose.startSession();
    try {
      return session.withTransaction(async () => {
        const sub = await SubscriptionRepository.findById(subscriptionId, { session });
        if (!sub) throw new NotFoundError('Subscription');
        if (sub.status === 'suspended') throw new SubscriptionSuspendedError();
        if (sub.status === 'pending_shared_payment') {
          throw new Error('Cannot renew a shared-payment subscription before full payment');
        }

        const plan = await PlanRepository.findById(newPlanId, { session });
        if (!plan) throw new NotFoundError('Plan');
        if (!plan.isActive) throw new Error('Selected plan is no longer available');

        const remainingBytes = Math.max(0, sub.totalVolumeBytes - sub.usedVolumeBytes);
        const planBytes = plan.baseVolumeGB * GB;

        sub.planId = plan._id;
        sub.rolloverVolumeBytes = remainingBytes;
        sub.totalVolumeBytes = planBytes + remainingBytes;
        sub.usedVolumeBytes = 0;

        const now = new Date();
        if (sub.status === 'expired' || sub.expireDate <= now) {
          sub.startDate = now;
          sub.expireDate = new Date(now.getTime() + plan.durationDays * 86400000);
        } else {
          sub.expireDate = new Date(sub.expireDate.getTime() + plan.durationDays * 86400000);
        }

        sub.status = 'active';
        return sub.save({ session });
      });
    } finally {
      await session.endSession();
    }
  });

  processSharedPaymentApproval = this.wrapMethod(async (subscriptionId, userId) => {
    const session = await mongoose.startSession();
    try {
      return session.withTransaction(async () => {
        const sub = await SubscriptionRepository.findById(subscriptionId, { session });
        if (!sub) throw new NotFoundError('Subscription');
        if (sub.status !== 'pending_shared_payment') throw new SharedPaymentNotPendingError();

        const paymentEntry = sub.sharedPaymentDetails.find(
          (entry) => entry.userId.toString() === userId,
        );
        if (!paymentEntry) throw new UserNotInSharedPaymentError();
        if (paymentEntry.paid) throw new UserAlreadyPaidError();

        paymentEntry.paid = true;
        paymentEntry.paidAt = new Date();
        sub.markModified('sharedPaymentDetails');

        if (sub.isSharedPaymentComplete()) {
          sub.status = 'active';
        }

        return sub.save({ session });
      });
    } finally {
      await session.endSession();
    }
  });
}

export default new SubscriptionService();
