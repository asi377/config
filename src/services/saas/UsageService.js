import BaseService from '../../shared/BaseService.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import UserRepository from '../../repositories/UserRepository.js';
import TunnelConfigRepository from '../../repositories/TunnelConfigRepository.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import EventBus from '../../events/EventBus.js';
import logger from '../../config/logger.js';

class UsageService extends BaseService {
  /**
   * Record consumed bytes for a subscription, applying the server's
   * traffic coefficient before persisting.
   *
   * @param {string} subscriptionId
   * @param {number} bytesUsed  - Raw bytes reported by the node agent.
   * @param {string|null} serverId - The server that reported the traffic.
   *   When provided, the server's `coefficient` field is fetched and the
   *   reported bytes are multiplied by it before deduction.
   *   e.g. coefficient 1.5 → 100 MB reported = 150 MB charged.
   *
   * @returns {{ action: string, usagePercent: number, chargedBytes: number }}
   */
  async trackUsage(subscriptionId, bytesUsed, serverId = null) {
    const sub = await SubscriptionRepository.findById(subscriptionId);
    if (!sub || sub.status !== 'active') return { action: 'skipped' };

    // ── Apply server coefficient ────────────────────────────────────────────
    let coefficient = 1.0;
    if (serverId) {
      try {
        const server = await ServerRepository.findById(serverId);
        if (server?.coefficient != null && server.coefficient > 0) {
          coefficient = server.coefficient;
        }
      } catch (err) {
        // Non-fatal: fall back to 1.0 so traffic is still recorded
        logger.warn({ err, serverId }, '[usage] Failed to fetch server coefficient, defaulting to 1.0');
      }
    }

    // Use Math.round to avoid floating-point drift accumulating over time
    const chargedBytes = Math.round(bytesUsed * coefficient);

    if (coefficient !== 1.0) {
      logger.debug(
        { subscriptionId, serverId, bytesUsed, coefficient, chargedBytes },
        '[usage] Coefficient applied',
      );
    }

    sub.usedVolumeBytes = Math.min(sub.usedVolumeBytes + chargedBytes, sub.totalVolumeBytes);
    await sub.save();

    const usagePercent = sub.totalVolumeBytes > 0
      ? (sub.usedVolumeBytes / sub.totalVolumeBytes) * 100
      : 0;

    if (usagePercent >= 100) {
      sub.status = 'suspended';
      sub.reason = 'quota_exhausted';
      await sub.save();
      EventBus.emit('subscription:quota_exhausted', {
        subscriptionId: sub._id,
        userId: sub.ownerId,
      });
      return { action: 'suspended', usagePercent, chargedBytes };
    }

    if (usagePercent >= 80 && !sub.notified80Percent) {
      sub.notified80Percent = true;
      await sub.save();
      EventBus.emit('subscription:usage_warning', {
        subscriptionId: sub._id,
        userId: sub.ownerId,
        usagePercent,
      });
      return { action: 'warning', usagePercent, chargedBytes };
    }

    return { action: 'ok', usagePercent, chargedBytes };
  }

  /**
   * Batch variant of trackUsage.
   * Each entry may include an optional `serverId` so the coefficient is
   * applied per-server when the batch contains traffic from multiple nodes.
   *
   * @param {{ subscriptionId: string, bytesUsed: number, serverId?: string }[]} usages
   */
  async trackUsageBatch(usages) {
    const results = [];
    for (const { subscriptionId, bytesUsed, serverId = null } of usages) {
      try {
        const result = await this.trackUsage(subscriptionId, bytesUsed, serverId);
        results.push({ subscriptionId, ...result });
      } catch (err) {
        logger.error({ err, subscriptionId }, '[usage] Batch tracking error');
        results.push({ subscriptionId, action: 'error' });
      }
    }
    return results;
  }

  async getUsageReport(userId) {
    const user = await UserRepository.findById(userId);
    if (!user) return null;

    const subs = await SubscriptionRepository.findMany(
      { ownerId: userId },
      { populate: 'planId' },
    );

    const totalVolume = subs.reduce((s, sub) => s + (sub.totalVolumeBytes || 0), 0);
    const totalUsed = subs.reduce((s, sub) => s + (sub.usedVolumeBytes || 0), 0);

    return {
      userId,
      telegramId: user.telegramId,
      totalSubscriptions: subs.length,
      activeSubscriptions: subs.filter(s => s.status === 'active').length,
      totalVolumeGB: this._bytesToGB(totalVolume),
      totalUsedGB: this._bytesToGB(totalUsed),
      usagePercent: totalVolume > 0 ? (totalUsed / totalVolume) * 100 : 0,
      subscriptions: subs.map(s => ({
        id: s._id,
        plan: s.planId?.name || 'Unknown',
        status: s.status,
        totalGB: this._bytesToGB(s.totalVolumeBytes),
        usedGB: this._bytesToGB(s.usedVolumeBytes),
        usagePercent: s.totalVolumeBytes > 0
          ? (s.usedVolumeBytes / s.totalVolumeBytes) * 100
          : 0,
        expireDate: s.expireDate,
      })),
    };
  }

  async getSystemUsageOverview() {
    const allSubs = await SubscriptionRepository.findMany({ status: 'active' });
    const totalCapacity = allSubs.reduce((s, sub) => s + (sub.totalVolumeBytes || 0), 0);
    const totalUsed = allSubs.reduce((s, sub) => s + (sub.usedVolumeBytes || 0), 0);
    const nearLimit = allSubs.filter(sub => {
      const pct = sub.totalVolumeBytes > 0 ? (sub.usedVolumeBytes / sub.totalVolumeBytes) * 100 : 0;
      return pct >= 80 && pct < 100;
    }).length;
    const exhausted = allSubs.filter(sub => {
      return sub.totalVolumeBytes > 0 && sub.usedVolumeBytes >= sub.totalVolumeBytes;
    }).length;

    return {
      totalActiveSubscriptions: allSubs.length,
      totalCapacityGB: this._bytesToGB(totalCapacity),
      totalUsedGB: this._bytesToGB(totalUsed),
      globalUsagePercent: totalCapacity > 0 ? (totalUsed / totalCapacity) * 100 : 0,
      nearLimit,
      exhausted,
    };
  }

  async checkExpiringSubscriptions(daysAhead = 3) {
    const threshold = new Date(Date.now() + daysAhead * 86400000);
    const expiring = await SubscriptionRepository.findMany({
      status: 'active',
      expireDate: { $lte: threshold, $gte: new Date() },
    });

    for (const sub of expiring) {
      EventBus.emit('subscription:expiring_soon', {
        subscriptionId: sub._id,
        userId: sub.ownerId,
        expireDate: sub.expireDate,
        daysRemaining: Math.ceil((sub.expireDate - new Date()) / 86400000),
      });
    }

    return expiring.map(s => ({
      id: s._id,
      userId: s.ownerId,
      expireDate: s.expireDate,
      daysRemaining: Math.ceil((s.expireDate - new Date()) / 86400000),
    }));
  }

  async enforceQuota(subscriptionId) {
    const sub = await SubscriptionRepository.findById(subscriptionId);
    if (!sub || sub.status !== 'active') return { action: 'not_active' };

    if (sub.usedVolumeBytes >= sub.totalVolumeBytes) {
      sub.status = 'suspended';
      sub.reason = 'quota_exhausted';
      await sub.save();

      await TunnelConfigRepository.updateMany(
        { subscriptionId: sub._id, isActive: true },
        { $set: { isActive: false } },
      );

      EventBus.emit('subscription:quota_exhausted', {
        subscriptionId: sub._id,
        userId: sub.ownerId,
      });

      return { action: 'suspended' };
    }

    return { action: 'ok' };
  }

  _bytesToGB(bytes) {
    return Number((bytes / 1073741824).toFixed(2));
  }
}

export default new UsageService();
