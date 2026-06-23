import mongoose from 'mongoose';
import crypto from 'crypto';
import { Subscription, TunnelConfig, Server } from '../src/models/index.js';
import {
  NotFoundError,
  SubscriptionNotActiveError,
  MaxSubLinksReachedError,
  InsufficientQuotaError,
} from '../src/shared/errors.js';

class TunnelService {
  /**
   * Create a sub-link (tunnel config) scoped to a subscription's data pool.
   * Validates plan-level sub-link limits and pool-level unallocated quota before
   * persisting.
   *
   * @param {string} subscriptionId - The parent Subscription _id.
   * @param {string} configName - Human-readable label (e.g. "Wife's Phone").
   * @param {number|null} allocatedQuotaBytes - Hard cap for this link in bytes,
   * or null for unlimited draw from the pool.
   * @param {boolean} isGuest - Whether this is a temporary self-destruct link.
   * @returns {Promise<import('mongoose').Document>} The created TunnelConfig document.
   * @throws {NotFoundError} Subscription or Plan not found.
   * @throws {SubscriptionNotActiveError} Subscription is not active.
   * @throws {MaxSubLinksReachedError} Plan's sub-link cap exceeded.
   * @throws {InsufficientQuotaError} Requested quota exceeds remaining unallocated pool.
   */
  async createSubLink(subscriptionId, configName, allocatedQuotaBytes = null, isGuest = false) {
    const session = await mongoose.startSession();

    try {
      const tunnelConfig = await session.withTransaction(async () => {
        const sub = await Subscription.findById(subscriptionId).populate('planId').session(session);

        if (!sub) throw new NotFoundError('Subscription');
        if (sub.status !== 'active') throw new SubscriptionNotActiveError();

        const plan = sub.planId;
        if (!plan) throw new NotFoundError('Plan');

        const activeLinkCount = await TunnelConfig.countDocuments({
          subscriptionId: sub._id,
          isActive: true,
        }).session(session);

        if (activeLinkCount >= plan.maxSubLinks) {
          throw new MaxSubLinksReachedError(plan.maxSubLinks);
        }

        if (allocatedQuotaBytes !== null) {
          const unallocatedBytes = await this._getUnallocatedPoolBytes(sub._id, session);
          if (allocatedQuotaBytes > unallocatedBytes) {
            throw new InsufficientQuotaError();
          }
        }

        const guestExpireDate = isGuest && allocatedQuotaBytes === null ? new Date(Date.now() + 86400000) : undefined;

        const config = await TunnelConfig.create(
          [
            {
              subscriptionId: sub._id,
              uuid: crypto.randomUUID(),
              name: configName,
              allocatedQuotaBytes,
              usedQuotaBytes: 0,
              isGuestLink: isGuest,
              guestExpireDate,
              isActive: true,
            },
          ],
          { session },
        );

        return config[0];
      });

      return tunnelConfig;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Calculate the remaining unallocated bytes in a subscription pool.
   * This is the total pool volume minus the sum of all hard-quota allocations
   * on active sub-links (links with null allocatedQuotaBytes are excluded
   * since they don't reserve a fixed portion).
   *
   * @param {string} subscriptionId
   * @param {import('mongoose').ClientSession} session
   * @returns {Promise<number>}
   * @private
   */
  async _getUnallocatedPoolBytes(subscriptionId, session) {
    const sub = await Subscription.findById(subscriptionId).select('totalVolumeBytes').session(session);

    const result = await TunnelConfig.aggregate([
      {
        $match: {
          subscriptionId: sub._id,
          isActive: true,
          allocatedQuotaBytes: { $ne: null },
        },
      },
      {
        $group: {
          _id: null,
          totalReserved: { $sum: '$allocatedQuotaBytes' },
        },
      },
    ]).session(session);

    const reservedBytes = result.length > 0 ? result[0].totalReserved : 0;
    return sub.totalVolumeBytes - reservedBytes;
  }

  /**
   * Atomically assign a user to the least-loaded active server.
   * Uses findOneAndUpdate with $expr to ensure the server has remaining
   * capacity, then $inc currentActiveUsers so no two allocations race.
   *
   * @returns {Promise<import('mongoose').Document>} The allocated Server document.
   * @throws {Error} No available server found.
   */
  async allocateServer() {
    const server = await Server.findOneAndUpdate(
      {
        status: 'active',
        $expr: { $lt: ['$currentActiveUsers', '$maxCapacity'] },
      },
      { $inc: { currentActiveUsers: 1 } },
      { sort: { currentActiveUsers: 1, maxCapacity: -1 }, new: true },
    );

    if (!server) {
      throw new Error('No available server — all servers are at full capacity');
    }

    return server;
  }

  /**
   * Release a user slot from a server (call on subscription expiry / cancel).
   * Ensures currentActiveUsers never drops below 0.
   *
   * @param {string} serverId
   */
  async releaseServer(serverId) {
    await Server.findOneAndUpdate(
      { _id: serverId, currentActiveUsers: { $gt: 0 } },
      { $inc: { currentActiveUsers: -1 } },
    );
  }
}

export default new TunnelService();
