import BaseService from '../../shared/BaseService.js';
import { NotFoundError } from '../../shared/errors.js';
import ServerRepository from '../../repositories/ServerRepository.js';

class LoadBalancerService extends BaseService {
  async checkAllRegions() {
    const Server = (await import('../../models/Server.js')).default;
    const servers = await Server.find().lean();

    return servers.map(s => ({
      serverId: s._id,
      region: s.region,
      healthy: s.healthStatus === 'healthy',
      load: s.maxCapacity > 0 ? Math.round(((s.currentActiveUsers || 0) / s.maxCapacity) * 100) : 0,
    }));
  }

  /**
   * Move all active subscriptions off `fromServerId` onto the least-loaded
   * eligible server. If `toServerId` is omitted, one is picked automatically.
   * Used both for manual admin-triggered migration and automatic failover.
   */
  async migrateUsers(fromServerId, toServerId = null) {
    const Subscription = (await import('../../models/Subscription.js')).default;

    const fromServer = await ServerRepository.findById(fromServerId);
    if (!fromServer) throw new NotFoundError('Server');

    let target = null;
    if (toServerId) {
      target = await ServerRepository.findById(toServerId);
      if (!target) throw new NotFoundError('Target server');
    } else {
      target = await ServerRepository.model.findOne({
        _id: { $ne: fromServerId },
        status: 'active',
        salesEnabled: true,
        $expr: { $lt: ['$currentActiveUsers', '$maxCapacity'] },
      }).sort({ currentActiveUsers: 1, maxCapacity: -1 });
    }

    if (!target) {
      this.logger.warn({ fromServerId }, '[load-balancer] No eligible target server for migration');
      return { migrated: 0, fromServerId, toServerId: null };
    }

    const affected = await Subscription.find({ serverId: fromServerId, status: 'active' }).select('_id');
    const result = await Subscription.updateMany(
      { serverId: fromServerId, status: 'active' },
      { $set: { serverId: target._id } },
    );

    if (result.modifiedCount > 0) {
      await ServerRepository.model.updateOne({ _id: fromServerId }, { $inc: { currentActiveUsers: -result.modifiedCount } });
      await ServerRepository.model.updateOne({ _id: target._id }, { $inc: { currentActiveUsers: result.modifiedCount } });
    }

    this.logger.info({ fromServerId, toServerId: target._id, migrated: result.modifiedCount }, '[load-balancer] Users migrated');

    return {
      migrated: result.modifiedCount,
      subscriptionIds: affected.map(s => s._id),
      fromServerId,
      toServerId: target._id,
    };
  }

  async getServerDistribution() {
    const Server = (await import('../../models/Server.js')).default;
    const servers = await Server.find().lean();

    return servers.map(s => ({
      serverId: s._id,
      name: s.name,
      region: s.region,
      status: s.status,
      healthStatus: s.healthStatus,
      currentActiveUsers: s.currentActiveUsers || 0,
      maxCapacity: s.maxCapacity || 0,
      loadPercent: s.maxCapacity > 0 ? Math.round(((s.currentActiveUsers || 0) / s.maxCapacity) * 1000) / 10 : 0,
    }));
  }

  async getInfraScalingRecommendation() {
    const distribution = await this.getServerDistribution();
    const active = distribution.filter(s => s.status === 'active');

    const totalCapacity = active.reduce((sum, s) => sum + s.maxCapacity, 0);
    const totalUsers = active.reduce((sum, s) => sum + s.currentActiveUsers, 0);
    const globalLoadPercent = totalCapacity > 0 ? Math.round((totalUsers / totalCapacity) * 1000) / 10 : 0;
    const overloaded = active.filter(s => s.loadPercent > 80);

    let recommendation = 'stable';
    if (globalLoadPercent > 80 || overloaded.length > 0) recommendation = 'scale_up';
    else if (globalLoadPercent < 20 && active.length > 1) recommendation = 'scale_down';

    return {
      recommendation,
      globalLoadPercent,
      totalCapacity,
      totalUsers,
      overloadedServers: overloaded.map(s => s.serverId),
      byRegion: active.reduce((acc, s) => {
        acc[s.region] = acc[s.region] || { capacity: 0, users: 0 };
        acc[s.region].capacity += s.maxCapacity;
        acc[s.region].users += s.currentActiveUsers;
        return acc;
      }, {}),
    };
  }
}

export default new LoadBalancerService();
