import BaseService from '../../shared/BaseService.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import HealthCheckLog from '../../models/HealthCheckLog.js';
import ServerMetrics from '../../models/ServerMetrics.js';
import ProvisionLog from '../../models/ProvisionLog.js';
import LoadBalancerService from './LoadBalancerService.js';

class HealthMonitorService extends BaseService {
  FAILURE_THRESHOLD = 3;
  HEARTBEAT_TIMEOUT_SECONDS = 90;

  async checkServer(server) {
    const now = new Date();
    const lastBeat = server.lastHeartbeat ? new Date(server.lastHeartbeat) : null;
    const sinceLastBeat = lastBeat ? (now - lastBeat) / 1000 : Infinity;
    const isOffline = sinceLastBeat > this.HEARTBEAT_TIMEOUT_SECONDS;

    let status = 'healthy';
    let errorMessage = null;

    if (isOffline) {
      status = 'offline';
      errorMessage = `No heartbeat for ${Math.round(sinceLastBeat)}s (threshold: ${this.HEARTBEAT_TIMEOUT_SECONDS}s)`;
    } else if (server.healthStatus === 'unhealthy') {
      status = 'unhealthy';
      errorMessage = 'Server reported unhealthy status';
    } else if (server.loadPercent > 90) {
      status = 'degraded';
      errorMessage = `Server load at ${server.loadPercent}%`;
    }

    const failures = isOffline ? (server.consecutiveFailures || 0) + 1 : 0;

    await HealthCheckLog.create({
      serverId: server._id,
      status,
      responseTime: isOffline ? 0 : Math.round(sinceLastBeat * 1000),
      cpuPercent: 0,
      memoryPercent: 0,
      diskPercent: 0,
      errorMessage,
      consecutiveFailures: failures,
    });

    if (failures >= this.FAILURE_THRESHOLD) {
      server.status = 'offline';
      server.healthStatus = 'unhealthy';
      server.salesEnabled = false;

      await this._logProvision(server._id, 'xray_restarted', 'completed',
        { reason: `${failures} consecutive health check failures` }
      );

      try {
        await LoadBalancerService.migrateUsers(server._id);
        this.logger.info('Users auto-migrated from failed server', {
          serverId: server._id, serverName: server.name,
        });
      } catch (err) {
        this.logger.warn({ err, serverId: server._id }, 'Auto-migration failed');
      }
    }

    server.consecutiveFailures = failures;
    await server.save();

    return { status, failures, isOffline };
  }

  async checkAllServers() {
    const servers = await ServerRepository.findMany({});
    const results = [];

    for (const server of servers) {
      try {
        const result = await this.checkServer(server);
        results.push({ serverId: server._id, name: server.name, ...result });
      } catch (err) {
        this.logger.error({ err, serverId: server._id }, 'Health check failed');
        results.push({ serverId: server._id, name: server.name, status: 'error', error: err.message });
      }
    }

    const summary = {
      total: results.length,
      healthy: results.filter(r => r.status === 'healthy').length,
      degraded: results.filter(r => r.status === 'degraded').length,
      unhealthy: results.filter(r => r.status === 'unhealthy').length,
      offline: results.filter(r => r.status === 'offline').length,
    };

    this.logger.info('Health check cycle complete', summary);
    return { results, summary };
  }

  async getServerHealthHistory(serverId, hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const checks = await HealthCheckLog.find({
      serverId,
      createdAt: { $gte: since },
    }).sort({ createdAt: -1 }).limit(100).lean();

    const uptime = checks.length > 0
      ? Math.round((checks.filter(c => c.status === 'healthy').length / checks.length) * 100)
      : 0;

    return {
      checks,
      uptimePercent: uptime,
      totalChecks: checks.length,
      healthyChecks: checks.filter(c => c.status === 'healthy').length,
      failedChecks: checks.filter(c => ['offline', 'unhealthy'].includes(c.status)).length,
    };
  }

  async getMetrics(serverId, hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    const metrics = await ServerMetrics.find({
      serverId,
      createdAt: { $gte: since },
    }).sort({ createdAt: 1 }).lean();

    const averaged = this._averageMetrics(metrics);
    return { metrics, averaged };
  }

  async getDashboard() {
    const servers = await ServerRepository.findMany({});

    const metrics = await ServerMetrics.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 3600 * 1000) } } },
      { $group: {
        _id: '$serverId',
        avgCpu: { $avg: '$cpuPercent' },
        avgMem: { $avg: '$memoryPercent' },
        avgDisk: { $avg: '$diskPercent' },
        maxCpu: { $max: '$cpuPercent' },
        maxConnections: { $max: '$activeConnections' },
      }},
    ]);

    const healthSummary = await HealthCheckLog.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 3600 * 1000) } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    return {
      servers: servers.map(s => {
        const load = s.maxCapacity > 0
          ? Math.round(((s.currentActiveUsers || 0) / s.maxCapacity) * 1000) / 10
          : 0;
        return {
          _id: s._id, name: s.name, region: s.region,
          status: s.status, health: s.healthStatus,
          load, users: s.currentActiveUsers,
          capacity: s.maxCapacity,
          lastHeartbeat: s.lastHeartbeat,
        };
      }),
      metricsSummary: metrics,
      healthSummary,
    };
  }

  _averageMetrics(metrics) {
    if (metrics.length === 0) return null;
    const sum = { cpuPercent: 0, memoryPercent: 0, diskPercent: 0, activeConnections: 0 };
    for (const m of metrics) {
      sum.cpuPercent += m.cpuPercent || 0;
      sum.memoryPercent += m.memoryPercent || 0;
      sum.diskPercent += m.diskPercent || 0;
      sum.activeConnections += m.activeConnections || 0;
    }
    const n = metrics.length;
    return {
      avgCpu: Math.round(sum.cpuPercent / n * 10) / 10,
      avgMem: Math.round(sum.memoryPercent / n * 10) / 10,
      avgDisk: Math.round(sum.diskPercent / n * 10) / 10,
      avgConnections: Math.round(sum.activeConnections / n),
    };
  }

  async _logProvision(serverId, action, status, metadata = {}) {
    try {
      await ProvisionLog.create({ serverId, action, status, metadata, completedAt: new Date() });
    } catch (err) {
      this.logger.warn({ err }, 'Failed to write provision log');
    }
  }
}

export default new HealthMonitorService();
