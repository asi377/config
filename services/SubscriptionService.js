import mongoose from 'mongoose';
import { Subscription, Plan, Server } from '../models/index.js';
import {
  NotFoundError,
  InsufficientBalanceError,
  SubscriptionExpiredError,
  SubscriptionSuspendedError,
  SharedPaymentNotPendingError,
  UserNotInSharedPaymentError,
  UserAlreadyPaidError,
} from '../utils/errors.js';
import User from '../models/User.js';
import tunnelService from './TunnelService.js';
import { calculateRank } from '../utils/formatters.js';

const GB_TO_BYTES = 1073741824;

/**
 * Internal helper — provisions a subscription document + server allocation
 * inside an ongoing transaction. Called by createSubscription and by
 * PaymentService after receipt approval.
 *
 * @param {import('mongoose').Document} user
 * @param {import('mongoose').Document} plan
 * @param {import('mongoose').ClientSession} session
 * @returns {Promise<import('mongoose').Document>}
 */
async function _provisionPool(user, plan, session) {
  const server = await tunnelService.allocateServer();

  const now = new Date();
  const expireDate = new Date(now.getTime() + plan.durationDays * 86400000);

  const [sub] = await Subscription.create(
    [{
      ownerId: user._id,
      planId: plan._id,
      serverId: server._id,
      status: 'active',
      totalVolumeBytes: plan.baseVolumeGB * GB_TO_BYTES,
      rolloverVolumeBytes: 0,
      usedVolumeBytes: 0,
      startDate: now,
      expireDate,
    }],
    { session },
  );

  return sub;
}

class SubscriptionService {

  /**
   * Purchase a plan and provision the data pool.
   * Deducts the price from the user's wallet and creates an active subscription
   * atomically within a single transaction.
   *
   * @param {string} userId - The purchasing user's _id.
   * @param {string} planId - The plan _id to subscribe to.
   * @returns {Promise<import('mongoose').Document>} The created Subscription document.
   * @throws {NotFoundError} User or Plan not found.
   * @throws {InsufficientBalanceError} Wallet balance is below plan price.
   */
  async createSubscription(userId, planId) {
    const session = await mongoose.startSession();

    try {
      const subscription = await session.withTransaction(async () => {
        const plan = await Plan.findById(planId).session(session);
        if (!plan) throw new NotFoundError('Plan');
        if (!plan.isActive) throw new Error('Selected plan is no longer available');

        const user = await User.findById(userId).session(session);
        if (!user) throw new NotFoundError('User');

        const cost = plan.basePrice;
        if (user.walletBalance < cost) {
          throw new InsufficientBalanceError(user.walletBalance, cost);
        }

        user.walletBalance -= cost;

        if (user.referredBy) {
          const referrer = await User.findById(user.referredBy).session(session);
          if (referrer) {
            const reward = Math.round(plan.basePrice * 0.1);
            referrer.walletBalance += reward;
            await referrer.save({ session });
          }
        }

        user.totalSpent = (user.totalSpent || 0) + cost;
        user.rank = calculateRank(user.totalSpent);
        await user.save({ session });

        return _provisionPool(user, plan, session);
      });

      return subscription;

    } finally {
      await session.endSession();
    }
  }

  /**
   * Bypass wallet check & create subscription (admin/manual payment use).
   * Creates the user by telegramId if they don't exist.
   *
   * @param {string} telegramId
   * @param {string} planId
   * @returns {Promise<import('mongoose').Document>}
   */
  async forceCreateSubscription(telegramId, planId) {
    const session = await mongoose.startSession();

    try {
      const subscription = await session.withTransaction(async () => {
        const plan = await Plan.findById(planId).session(session);
        if (!plan) throw new NotFoundError('Plan');
        if (!plan.isActive) throw new Error('Plan is no longer available');

        let user = await User.findOne({ telegramId }).session(session);
        if (!user) {
          user = await User.create([{ telegramId }], { session });
          user = user[0];
        }

        return _provisionPool(user, plan, session);
      });

      return subscription;

    } finally {
      await session.endSession();
    }
  }

  /**
   * Expose allocateServer so PaymentService can use it inside its own
   * transaction without importing TunnelService directly.
   *
   * @param {import('mongoose').ClientSession} session
   * @returns {Promise<import('mongoose').Document>}
   */
  async _allocateServerForTransaction(session) {
    return tunnelService.allocateServer();
  }

  /**
   * Renew a subscription with automatic data rollover.
   * Unused bytes from the current period are carried forward as rolloverVolumeBytes,
   * atomically merged with the new plan's base volume.
   *
   * @param {string} subscriptionId - The existing subscription's _id.
   * @param {string} newPlanId - The plan _id to renew into (may be same or different plan).
   * @returns {Promise<import('mongoose').Document>} The updated subscription document.
   * @throws {NotFoundError} Subscription or Plan not found.
   * @throws {SubscriptionExpiredError} Subscription is expired.
   * @throws {SubscriptionSuspendedError} Subscription is suspended.
   */
  async renewWithRollover(subscriptionId, newPlanId) {
    const session = await mongoose.startSession();

    try {
      const updatedSubscription = await session.withTransaction(async () => {
        const sub = await Subscription.findById(subscriptionId).session(session);
        if (!sub) throw new NotFoundError('Subscription');

        if (sub.status === 'suspended') throw new SubscriptionSuspendedError();
        if (sub.status === 'pending_shared_payment') {
          throw new Error('Cannot renew a shared-payment subscription before full payment');
        }

        const plan = await Plan.findById(newPlanId).session(session);
        if (!plan) throw new NotFoundError('Plan');
        if (!plan.isActive) throw new Error('Selected plan is no longer available');

        const remainingBytes = Math.max(0, sub.totalVolumeBytes - sub.usedVolumeBytes);
        const planBytes = plan.baseVolumeGB * GB_TO_BYTES;

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

      return updatedSubscription;

    } finally {
      await session.endSession();
    }
  }

  /**
   * Mark a user's share as paid within a co-purchased subscription.
   * When every participant has paid, the subscription is atomically activated.
   *
   * @param {string} subscriptionId - The subscription _id in pending_shared_payment status.
   * @param {string} userId - The user _id who has completed their payment.
   * @returns {Promise<import('mongoose').Document>} The updated subscription document.
   * @throws {NotFoundError} Subscription not found.
   * @throws {SharedPaymentNotPendingError} Subscription is not awaiting shared payments.
   * @throws {UserNotInSharedPaymentError} User is not listed in the shared payment details.
   * @throws {UserAlreadyPaidError} User has already paid.
   */
  async processSharedPaymentApproval(subscriptionId, userId) {
    const session = await mongoose.startSession();

    try {
      const updatedSubscription = await session.withTransaction(async () => {
        const sub = await Subscription.findById(subscriptionId).session(session);
        if (!sub) throw new NotFoundError('Subscription');
        if (sub.status !== 'pending_shared_payment') throw new SharedPaymentNotPendingError();

        const paymentEntry = sub.sharedPaymentDetails.find(
          (entry) => entry.userId.toString() === userId
        );
        if (!paymentEntry) throw new UserNotInSharedPaymentError();
        if (paymentEntry.paid) throw new UserAlreadyPaidError();

        paymentEntry.paid = true;
        paymentEntry.paidAt = new Date();

        if (sub.isSharedPaymentComplete()) {
          sub.status = 'active';
        }

        return sub.save({ session });
      });

      return updatedSubscription;

    } finally {
      await session.endSession();
    }
  }
}

export default new SubscriptionService();
