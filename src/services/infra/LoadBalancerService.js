import BaseService from '../../shared/BaseService.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import stateCache from '../../redis/stateCache.js';
import EventBus from '../../events/EventBus.js';
import { nodeHealthScore, nodeActiveUsers, nodeLoadPercent } from '../../monitoring/metrics.js';
import { getCircuitBreaker } from '../../shared/CircuitBreaker.js';
import logger from '../../config/logger.js';

class LoadBalancerService extends BaseService {
  HEALTHY_THRESHOLD = 80;
  CRITICAL_THRESHOLD = 90;
  FAILOVER_THRESHOLD = 5;

  REGION_GROUPS = {
    EU: ['de-fra', 'nl-ams', 'uk-lon', 'fr-par'],
    US: ['us-east', 'us-west', 'us-central'],
    ASIA: ['sg-sin', 'jp-tyo', 'kr-seoul', 'hk-hkg'],
    MIDDLE_EAST: ['ir-thr', 'tr-ist', 'ae-dxb'],
  };

  async allocateServer(userId = null, preferredRegion = null, preferredLatency = null) {
    const healthCheck = getCircuitBreaker('loadbalancer.allocate', { failureThreshold: 3, resetTimeout: 10000 });
    return healthCheck.call(async () => {
      const servers = await this._getActiveServers();
      if (servers.length === 0) throw new Error('No available servers');

      const scored = await this._scoreServers(servers, userId, preferredRegion, preferredLatency);
      const candidates = scored.filter(s => s.healthScore >= 60 && !s.isOverloaded);

      let selected;
      if (candidates.length === 0) {
        const fallback = scored.filter(s => s.healthScore >= 30);
        if (fallback.length === 0) throw new Error('No available server capacity');
        selected = fallback.sort((a, b) => b.healthScore - a.healthScore)[0];
        logger.warn({ serverId: selected._id, score: selected.healthScore }, '[lb] Using degraded server');
      } else {
        selected = candidates.sort((a, b) => b.compositeScore - a.compositeScore)[0];
      }

      await ServerRepository.updateById(selected._id, { $inc: { currentActiveUsers: 1 } });
      await this._updateMetrics(selected);

      logger.info({ serverId: selected._id, name: selected.name, region: selected.region, score: selected.compositeScore }, '[lb] Allocated');
      return selected;
    });
  }

  async releaseServer(serverId) {
    const server = await ServerRepository.findById(serverId);
    if (server && server.currentActiveUsers > 0) {
      await ServerRepository.updateById(serverId, { $inc: { currentActiveUsers: -1 } });
    }
  }

  async getOptimalServerForUser(userTelegramId = null, preferredRegion = null) {
    return this.allocateServer(userTelegramId, preferredRegion);
  }

  async getServerDistribution() {
    const servers = await this._getActiveServers();
    const byRegion = {};
    let total = 0;

    for (const s of servers) {
      const region = this._resolveRegion(s.region) || 'other';
      if (!byRegion[region]) byRegion[region] = { servers: [], totalUsers: 0, totalCapacity: 0 };
      byRegion[region].servers.push(s);
      byRegion[region].totalUsers += s.currentActiveUsers || 0;
      byRegion[region].totalCapacity += s.maxCapacity || 0;
      total += s.currentActiveUsers || 0;
    }

    return {
      totalUsers: total,
      totalServers: servers.length,
      regions: Object.entries(byRegion).map(([name, data]) => ({
        region: name,
        serverCount: data.servers.length,
        users: data.totalUsers,
        loadPercent: data.totalCapacity > 0 ? Math.round((data.totalUsers / data.totalCapacity) * 100) : 0,
        servers: data.servers.map(s => ({
          id: s._id, name: s.name, users: s.currentActiveUsers,
          loadPercent: s.loadPercent, healthStatus: s.healthStatus,
          percent: total > 0 ? Math.round(((s.currentActiveUsers || 0) / total) * 100) : 0,
        })),
      })),
    };
  }

  async migrateUsers(fromServerId, toServerId = null) {
    const fromServer = await ServerRepository.findById(fromServerId);
    if (!fromServer) throw new Error('Source server not found');

    let targetServer;
    if (toServerId) {
      targetServer = await ServerRepository.findById(toServerId);
      if (!targetServer || targetServer.status !== 'active') {
        throw new Error('Target server not found or inactive');
      }
    } else {
      // Find best server in same region first, then globally
      const servers = await this._getActiveServers();
      const sameRegion = servers.filter(s =>
        s._id.toString() !== fromServerId &&
        s.region === fromServer.region &&
        s.healthStatus === 'healthy'
      );
      if (sameRegion.length > 0) {
        targetServer = sameRegion.reduce((min, s) => s.loadPercent < min.loadPercent ? s : min);
      } else {
        targetServer = await this.allocateServer();
      }
    }

    await SubscriptionRepository.updateMany(
      { serverId: fromServerId, status: 'active' },
      { $set: { serverId: targetServer._id } },
    );

    const migrated = fromServer.currentActiveUsers || 0;
    fromServer.currentActiveUsers = 0;
    fromServer.status = 'maintenance';
    await fromServer.save();

    targetServer.currentActiveUsers = (targetServer.currentActiveUsers || 0) + migrated;
    await targetServer.save();

    logger.info({ from: fromServer.name, to: targetServer.name, count: migrated, region: fromServer.region }, '[lb] Migration completed');
    EventBus.emit('lb:migration_completed', { fromServerId, toServerId: targetServer._id, count: migrated });

    return { fromServer: fromServer.name, toServer: targetServer.name, count: migrated };
  }

  async autoMigrateFromUnhealthy() {
    const unhealthy = await ServerRepository.findMany({
      healthStatus: { $in: ['unhealthy', 'offline'] },
      currentActiveUsers: { $gt: 0 },
    });

    const results = [];
    for (const server of unhealthy) {
      try {
        const result = await this.migrateUsers(server._id);
        server.status = 'maintenance';
        await server.save();
        results.push(result);
      } catch (err) {
        logger.error({ err, serverId: server._id }, '[lb] Auto-migration failed');
      }
    }
    return results;
  }

  async detectRegionBlackout(region) {
    const servers = await ServerRepository.findMany({ region, status: 'active' });
    if (servers.length === 0) return { blackout: false };

    const unhealthy = servers.filter(s => s.healthStatus === 'unhealthy' || s.healthStatus === 'offline');
    if (unhealthy.length === servers.length) {
      logger.error({ region, serverCount: servers.length }, '[lb] Region blackout detected');
      EventBus.emit('lb:region_blackout', { region, serverCount: servers.length });

      // Auto-migrate users from blacked-out region
      for (const server of unhealthy) {
        if (server.currentActiveUsers > 0) {
          await this.migrateUsers(server._id);
        }
      }
      return { blackout: true, affectedServers: servers.length, migrated: true };
    }

    return { blackout: false, healthyServers: servers.length - unhealthy.length, unhealthyServers: unhealthy.length };
  }

  async checkAllRegions() {
    const regions = Object.keys(this.REGION_GROUPS);
    const results = [];
    for (const region of regions) {
      const status = await this.detectRegionBlackout(region);
      results.push({ region, ...status });
    }
    return results;
  }

  async getInfraScalingRecommendation() {
    const servers = await ServerRepository.findMany({ status: 'active' });
    const byRegion = {};
    let overloadedCount = 0;
    let criticalCount = 0;

    for (const s of servers) {
      const region = this._resolveRegion(s.region) || 'unknown';
      if (!byRegion[region]) byRegion[region] = { total: 0, used: 0, count: 0, servers: [] };
      byRegion[region].total += s.maxCapacity || 0;
      byRegion[region].used += s.currentActiveUsers || 0;
      byRegion[region].count += 1;
      byRegion[region].servers.push(s);
      if (s.loadPercent >= this.CRITICAL_THRESHOLD) criticalCount++;
      else if (s.loadPercent >= this.HEALTHY_THRESHOLD) overloadedCount++;
    }

    for (const [, data] of Object.entries(byRegion)) {
      data.loadPercent = Math.round((data.used / data.total) * 100);
      data.needsMoreCapacity = data.loadPercent >= this.HEALTHY_THRESHOLD;
    }

    return {
      totalServers: servers.length,
      overloadedCount,
      criticalCount,
      needsMigration: criticalCount > 0,
      recommendedNewServers: Math.ceil(overloadedCount / 2),
      regions: byRegion,
      details: servers.map(s => ({
        id: s._id, name: s.name, region: s.region,
        load: Number(s.loadPercent?.toFixed?.(1)) || 0,
        users: s.currentActiveUsers, capacity: s.maxCapacity,
        health: s.healthStatus,
        status: s.loadPercent >= this.CRITICAL_THRESHOLD ? 'critical'
          : s.loadPercent >= this.HEALTHY_THRESHOLD ? 'overloaded' : 'healthy',
      })),
    };
  }

  async _getActiveServers() {
    // Try Redis cache first
    const cached = await stateCache.get('lb:active_servers');
    if (cached) return cached;

    const servers = await ServerRepository.findMany({
      status: 'active',
      salesEnabled: true,
    });

    // Cache for 10s
    await stateCache.set('lb:active_servers', servers, 10);
    return servers;
  }

  async _scoreServers(servers, userId, preferredRegion, _preferredLatency) {
    const scores = [];

    for (const s of servers) {
      const load = s.loadPercent || 0;
      const health = s.healthStatus === 'healthy' ? 100 : s.healthStatus === 'degraded' ? 50 : 0;
      const region = s.region || 'unknown';
      const resolvedRegion = this._resolveRegion(region);

      // Base score: higher is better
      let regionScore = 50;
      if (preferredRegion && resolvedRegion === this._resolveRegion(preferredRegion)) {
        regionScore = 100;
      } else if (preferredRegion) {
        // Nearby region gets partial score
        const regionDistance = this._regionDistance(resolvedRegion, this._resolveRegion(preferredRegion));
        regionScore = Math.max(0, 50 - regionDistance * 10);
      }

      const loadScore = Math.max(0, 100 - (load / this.CRITICAL_THRESHOLD) * 100);
      const healthScore = health;

      // Recent failure penalty
      const cb = getCircuitBreaker(`node.${s._id}`, { failureThreshold: 3, resetTimeout: 30000 });
      const cbState = cb.getState();
      const failurePenalty = cbState.failureCount > 0 ? cbState.failureCount * 10 : 0;

      const compositeScore = Math.max(0, (regionScore * 0.3) + (loadScore * 0.35) + (healthScore * 0.35) - failurePenalty);

      scores.push({
        ...s.toJSON(),
        region,
        resolvedRegion,
        loadScore,
        regionScore,
        healthScore,
        compositeScore: Math.round(compositeScore * 10) / 10,
        isOverloaded: load >= this.HEALTHY_THRESHOLD,
        failurePenalty,
      });
    }

    return scores;
  }

  async _updateMetrics(server) {
    nodeActiveUsers.set({ node_id: server._id.toString(), region: server.region }, server.currentActiveUsers || 0);
    nodeLoadPercent.set({ node_id: server._id.toString() }, server.loadPercent || 0);
    nodeHealthScore.set({ node_id: server._id.toString(), region: server.region },
      server.healthStatus === 'healthy' ? 100 : server.healthStatus === 'degraded' ? 50 : 0);
  }

  _resolveRegion(serverRegion) {
    if (!serverRegion) return null;
    for (const [group, members] of Object.entries(this.REGION_GROUPS)) {
      if (members.includes(serverRegion) || serverRegion.startsWith(group.toLowerCase())) return group;
    }
    return null;
  }

  _regionDistance(a, b) {
    if (!a || !b || a === b) return 0;
    const order = Object.keys(this.REGION_GROUPS);
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 || bi === -1) return 3;
    return Math.abs(ai - bi);
  }

  _pickBestFit(servers, preferredRegion) {
    if (preferredRegion) {
      const regionMatch = servers.filter(s =>
        s.region?.toLowerCase() === preferredRegion.toLowerCase()
      );
      if (regionMatch.length > 0) {
        return regionMatch.reduce((min, s) => s.loadPercent < min.loadPercent ? s : min);
      }
    }
    return servers.reduce((min, s) => s.loadPercent < min.loadPercent ? s : min);
  }
}

export default new LoadBalancerService();
