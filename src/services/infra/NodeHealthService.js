import mongoose from 'mongoose';
import BaseService from '../../shared/BaseService.js';
import { NotFoundError } from '../../shared/errors.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import TunnelConfigRepository from '../../repositories/TunnelConfigRepository.js';
import ServerMetrics from '../../models/ServerMetrics.js';
import HealthCheckLog from '../../models/HealthCheckLog.js';

class NodeHealthService extends BaseService {
  async processHeartbeat({ nodeToken, serverId, metrics }) {
    const filter = serverId ? { _id: serverId } : { nodeToken };
    const server = await ServerRepository.findOne(filter);
    if (!server) {
      return { registered: false, serverId: null, commands: [] };
    }

    server.lastHeartbeat = new Date();
    server.consecutiveFailures = 0;

    if (metrics) {
      server.healthStatus = this._determineHealth(metrics);
      if (metrics.xrayStatus) {
        server.status = metrics.xrayStatus === 'active' ? 'active' : 'maintenance';
      }
    }

    await server.save();

    if (metrics) {
      await ServerMetrics.create({ serverId: server._id, ...metrics });
    }

    return {
      registered: true,
      serverId: server._id,
      commands: [],
    };
  }

  async handleShutdown({ serverId, nodeToken }) {
    const filter = serverId ? { _id: serverId } : { nodeToken };
    const server = await ServerRepository.findOne(filter);
    if (!server) throw new NotFoundError('Server');

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        server.status = 'offline';
        server.healthStatus = 'unhealthy';
        await server.save({ session });

        await HealthCheckLog.create([{
          serverId: server._id,
          status: 'offline',
          errorMessage: 'Agent initiated shutdown',
        }], { session });

        const ProvisionLog = (await import('../../models/ProvisionLog.js')).default;
        await ProvisionLog.create([{
          serverId: server._id, action: 'server_deregistered',
          status: 'completed', metadata: {},
          completedAt: new Date(),
        }], { session });
      });
      return { success: true };
    } finally {
      await session.endSession();
    }
  }

  async syncUsers({ serverId, users }) {
    const server = await ServerRepository.findById(serverId);
    if (!server) throw new NotFoundError('Server');

    const activeUsers = users.filter(u => u.enable !== false);
    server.currentActiveUsers = activeUsers.length;
    await server.save();

    const tunnelConfigs = await TunnelConfigRepository.findMany(
      { subscriptionId: { $exists: true }, isActive: true },
      { populate: 'subscriptionId' }
    );

    const expectedEmails = tunnelConfigs
      .filter(tc => tc.subscriptionId?.serverId?.toString() === serverId)
      .map(tc => `user-${tc.uuid}@hornet.node`);

    const actualEmails = users.map(u => u.email);
    const toCreate = tunnelConfigs
      .filter(tc => !actualEmails.includes(`user-${tc.uuid}@hornet.node`))
      .map(tc => ({
        uuid: tc.uuid,
        email: `user-${tc.uuid}@hornet.node`,
        trafficLimitGB: tc.allocatedQuotaBytes ? Math.round(tc.allocatedQuotaBytes / 1073741824) : null,
        expiryDays: null,
      }));

    const toRemove = actualEmails.filter(e => !expectedEmails.includes(e) && e?.startsWith('user-'));

    return { toCreate, toRemove };
  }

  async getServerStatus(serverId) {
    const server = await ServerRepository.findById(serverId);
    if (!server) throw new NotFoundError('Server');

    const [latestMetric, latestHealth] = await Promise.all([
      ServerMetrics.findOne({ serverId }, {}, { sort: { createdAt: -1 } }).lean(),
      HealthCheckLog.findOne({ serverId }, {}, { sort: { createdAt: -1 } }).lean(),
    ]);

    return {
      server: server.toJSON(),
      currentMetrics: latestMetric,
      lastHealthCheck: latestHealth,
      isOverloaded: server.loadPercent > 80,
      isHealthy: server.healthStatus === 'healthy',
      secondsSinceHeartbeat: server.lastHeartbeat
        ? Math.floor((Date.now() - new Date(server.lastHeartbeat)) / 1000)
        : null,
    };
  }

  async getInfraSummary() {
    const Server = (await import('../../models/Server.js')).default;
    const [stats] = await Server.aggregate([
      {
        $group: {
          _id: null,
          totalServers: { $sum: 1 },
          activeServers: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          overloadedServers: { $sum: { $cond: [{ $gt: ['$loadPercent', 80] }, 1, 0] } },
          offlineServers: { $sum: { $cond: [{ $eq: ['$status', 'offline'] }, 1, 0] } },
          totalCapacity: { $sum: { $ifNull: ['$maxCapacity', 0] } },
          totalUsers: { $sum: { $ifNull: ['$currentActiveUsers', 0] } },
        },
      },
      {
        $project: {
          _id: 0, totalServers: 1, activeServers: 1, overloadedServers: 1, offlineServers: 1,
          totalCapacity: 1, totalUsers: 1,
          globalLoadPercent: {
            $cond: [
              { $gt: ['$totalCapacity', 0] },
              { $round: [{ $multiply: [{ $divide: ['$totalUsers', '$totalCapacity'] }, 100] }, 0] },
              0,
            ],
          },
        },
      },
    ]);

    const servers = await Server.aggregate([
      {
        $project: {
          _id: 1, name: 1, ipAddress: 1, region: 1, status: 1, healthStatus: 1, lastHeartbeat: 1,
          currentActiveUsers: { $ifNull: ['$currentActiveUsers', 0] },
          maxCapacity: { $ifNull: ['$maxCapacity', 0] },
          loadPercent: {
            $round: [{
              $cond: [
                { $gt: ['$maxCapacity', 0] },
                { $multiply: [{ $divide: [{ $ifNull: ['$currentActiveUsers', 0] }, '$maxCapacity'] }, 100] },
                0,
              ],
            }, 1],
          },
        },
      },
    ]);

    return {
      ...stats,
      totalServers: stats?.totalServers || 0,
      activeServers: stats?.activeServers || 0,
      overloadedServers: stats?.overloadedServers || 0,
      offlineServers: stats?.offlineServers || 0,
      totalCapacity: stats?.totalCapacity || 0,
      totalUsers: stats?.totalUsers || 0,
      globalLoadPercent: stats?.globalLoadPercent || 0,
      servers,
    };
  }

  async getProvisionLogs(serverId, { limit = 50, offset = 0 } = {}) {
    const ProvisionLog = (await import('../../models/ProvisionLog.js')).default;
    const filter = serverId ? { serverId } : {};
    return ProvisionLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(Math.min(limit, 200))
      .lean();
  }

  _determineHealth(metrics) {
    if (!metrics) return 'unknown';
    const cpuHigh = metrics.cpuPercent > 85;
    const memHigh = metrics.memoryPercent > 85;
    const xrayDown = metrics.xrayStatus && metrics.xrayStatus !== 'active';
    if (xrayDown || cpuHigh || memHigh) return 'unhealthy';
    if (metrics.cpuPercent > 70 || metrics.memoryPercent > 75) return 'degraded';
    return 'healthy';
  }
}

export default new NodeHealthService();
