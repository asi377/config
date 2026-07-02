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
import { getPlanPrice } from '../utils/pricing.js';

const GB = 1073741824;

async function provisionPool(user, plan, session) {
  const server = await ServerRepository.allocateLeastLoaded();
  const now = new Date();
  // expireDate is a placeholder — the real value is set on first connect
  // (activation logic in UsageService.trackUsage).
  // We store plan duration on the document so activation can recalculate it.
  const placeholderExpireDate = new Date(now.getTime() + plan.durationDays * 86400000);

  return SubscriptionRepository.create({
    ownerId: user._id,
    planId: plan._id,
    serverId: server._id,
    status: 'on_hold',
    totalVolumeBytes: plan.baseVolumeGB * GB,
    rolloverVolumeBytes: 0,
    usedVolumeBytes: 0,
    startDate: now,
    expireDate: placeholderExpireDate,
    activatedAt: null,
  }, { session });
}

class SubscriptionService extends BaseService {
  createSubscription = this.wrapMethod(async (userId, planId) => {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const plan = await PlanRepository.findById(planId, { session });
        if (!plan) throw new NotFoundError('Plan');
        if (!plan.isActive) throw new Error('Selected plan is no longer available');

        const user = await UserRepository.findById(userId, { session });
        if (!user) throw new NotFoundError('User');

        // Wallet payment is Persian-only (Toman). Use the fa price (falls back
        // to basePrice) as the wallet-charge base.
        const basePriceToman = getPlanPrice(plan, 'fa').amount;
        let effectivePrice = basePriceToman;
        if (user.isReseller && user.currentResellerPlanId) {
          const ResellerPlanRepository = (await import('../repositories/ResellerPlanRepository.js')).default;
          const resellerPlan = await ResellerPlanRepository.findById(user.currentResellerPlanId, { session });
          if (resellerPlan) {
            effectivePrice = Math.round(basePriceToman * (1 - resellerPlan.discountPercent / 100));
          }
        }

        if (user.walletBalance < effectivePrice) {
          throw new InsufficientBalanceError(user.walletBalance, effectivePrice);
        }

        user.walletBalance -= effectivePrice;
        user.totalSpent = (user.totalSpent || 0) + effectivePrice;
        user.rank = calculateRank(user.totalSpent);

        // NOTE: automatic promotion to reseller on wallet/spend threshold was
        // intentionally removed — reseller status is now an explicit
        // application + admin-approval flow (see AdminResellerController),
        // except for the no-approval-required "open" tier.

        await user.save({ session });

        if (user.referredBy) {
          const referrer = await UserRepository.findById(user.referredBy, { session });
          if (referrer) {
            // Plain referral commission (separate mechanism from reseller
            // per-tier commission/discount, which is computed elsewhere).
            const reward = Math.round(effectivePrice * 0.15);
            referrer.walletBalance += reward;
            referrer.referralCommission = (referrer.referralCommission || 0) + reward;
            await referrer.save({ session });
          }
        }

        return provisionPool(user, plan, session);
      });
    } finally {
      await session.endSession();
    }
  });

  /**
   * Flips a freshly-provisioned `on_hold` subscription to `active` and
   * recalculates a real `expireDate` from now (rather than the placeholder
   * set at provisioning time). Called right after payment approval — this
   * phase activates at approval time, not on first client connect.
   */
  activateSubscription = this.wrapMethod(async (subscriptionId) => {
    const sub = await SubscriptionRepository.findById(subscriptionId, { populate: 'planId' });
    if (!sub) throw new NotFoundError('Subscription');
    if (sub.status !== 'on_hold') return sub; // idempotent guard

    const now = new Date();
    sub.status = 'active';
    sub.activatedAt = now;
    sub.startDate = now;
    sub.expireDate = new Date(now.getTime() + sub.planId.durationDays * 86400000);
    return sub.save();
  });

  forceCreateSubscription = this.wrapMethod(async (telegramId, planId) => {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
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
      return await session.withTransaction(async () => {
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
      return await session.withTransaction(async () => {
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
