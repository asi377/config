import crypto from 'crypto';
import mongoose from 'mongoose';
import BaseService from '../shared/BaseService.js';
import {
  NotFoundError,
  SubscriptionNotActiveError,
  MaxSubLinksReachedError,
  InsufficientQuotaError,
} from '../shared/errors.js';
import SubscriptionRepository from '../repositories/SubscriptionRepository.js';
import TunnelConfigRepository from '../repositories/TunnelConfigRepository.js';
import ServerRepository from '../repositories/ServerRepository.js';

class TunnelService extends BaseService {
  async createSubLink(subscriptionId, configName, allocatedQuotaBytes = null, isGuest = false) {
    const session = await this._startSession();
    try {
      const tunnelConfig = await session.withTransaction(async () => {
        const sub = await SubscriptionRepository.findById(subscriptionId, { session, populate: 'planId' });
        if (!sub) throw new NotFoundError('Subscription');
        if (sub.status !== 'active') throw new SubscriptionNotActiveError();

        const plan = sub.planId;
        if (!plan) throw new NotFoundError('Plan');

        const activeLinkCount = await TunnelConfigRepository.countActiveBySubscription(sub._id);
        if (activeLinkCount >= plan.maxSubLinks) {
          throw new MaxSubLinksReachedError(plan.maxSubLinks);
        }

        if (allocatedQuotaBytes !== null) {
          const total = sub.totalVolumeBytes;
          const reserved = await TunnelConfigRepository.getTotalReservedQuota(sub._id, session);
          const unallocatedBytes = total - reserved;
          if (allocatedQuotaBytes > unallocatedBytes) {
            throw new InsufficientQuotaError();
          }
        }

        const guestExpireDate = isGuest && allocatedQuotaBytes === null
          ? new Date(Date.now() + 86400000)
          : undefined;

        const allowed = plan.allowedProtocols && plan.allowedProtocols.length
          ? plan.allowedProtocols
          : ['vless'];
        const protocol = allowed.includes('vless') ? 'vless' : allowed[0];

        return TunnelConfigRepository.create({
          subscriptionId: sub._id,
          uuid: crypto.randomUUID(),
          name: configName,
          protocol,
          allocatedQuotaBytes,
          usedQuotaBytes: 0,
          isGuestLink: isGuest,
          guestExpireDate,
          isActive: true,
        }, { session });
      });
      return tunnelConfig;
    } finally {
      await session.endSession();
    }
  }

  async allocateServer() {
    const server = await ServerRepository.allocateLeastLoaded();
    if (!server) {
      throw new Error('No available server — all servers are at full capacity');
    }
    return server;
  }

  async releaseServer(serverId) {
    await ServerRepository.releaseSlot(serverId);
  }

  _startSession() {
    return mongoose.startSession();
  }
}

export default new TunnelService();
