import crypto from 'crypto';
import BaseService from '../../shared/BaseService.js';
import { NotFoundError } from '../../shared/errors.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import TunnelConfigRepository from '../../repositories/TunnelConfigRepository.js';
import ProvisionLog from '../../models/ProvisionLog.js';
import ServerMetrics from '../../models/ServerMetrics.js';
import HealthCheckLog from '../../models/HealthCheckLog.js';
import config from '../../config/index.js';
import BullMQManager from '../../queue/bullmq.js';

class NodeManagerService extends BaseService {
  async registerNode({ name, ipAddress, region, port, xrayApiPort, maxCapacity, nodeToken, xrayStatus, isBootstrapRegistration }) {
    let server = null;

    if (nodeToken) {
      server = await ServerRepository.findOne({ nodeToken });
    }

    if (!server && isBootstrapRegistration && nodeToken) {
      // Bootstrap registration: find server by nodeToken matching a provisioned server
      server = await ServerRepository.findOne({ status: 'provisioning' }).sort({ createdAt: -1 });
      if (!server) {
        // Server not found in provisioning - it may have been created by addServer
        server = await ServerRepository.findOne({}).sort({ createdAt: -1 });
      }
    }

    if (server) {
      const permanentToken = server.nodeToken || crypto.randomBytes(32).toString('hex');

      server.ipAddress = ipAddress || server.ipAddress;
      server.region = region || server.region;
      server.port = port || server.port;
      server.xrayApiPort = xrayApiPort || server.xrayApiPort;
      server.maxCapacity = maxCapacity || server.maxCapacity;
      server.status = 'active';
      server.healthStatus = xrayStatus === 'active' ? 'healthy' : 'degraded';
      server.lastHeartbeat = new Date();
      server.consecutiveFailures = 0;
      if (!server.nodeToken) server.nodeToken = permanentToken;
      await server.save();

      await this._logProvision(server._id, 'server_registered', 'completed', {
        previousStatus: server.status,
        ipAddress,
      });

      return {
        success: true,
        data: {
          serverId: server._id,
          name: server.name,
          nodeToken: permanentToken,
        },
      };
    }

    const token = crypto.randomBytes(32).toString('hex');
    server = await ServerRepository.create({
      name: name || `node-${ipAddress || 'unknown'}`,
      ipAddress: ipAddress || 'unknown',
      region: region || 'unknown',
      port: port || 443,
      xrayApiPort: xrayApiPort || 10085,
      maxCapacity: maxCapacity || 100,
      status: 'active',
      healthStatus: xrayStatus === 'active' ? 'healthy' : 'degraded',
      nodeToken: token,
      lastHeartbeat: new Date(),
      salesEnabled: true,
    });

    await this._logProvision(server._id, 'server_provisioned', 'completed', { serverName: server.name });

    return {
      success: true,
      data: {
        serverId: server._id,
        name: server.name,
        nodeToken: token,
      },
    };
  }

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
      await ServerMetrics.create({
        serverId: server._id,
        ...metrics,
      });
    }

    const pendingCommands = await this._getPendingCommands(server._id);

    return {
      registered: true,
      serverId: server._id,
      commands: pendingCommands,
    };
  }

  async handleShutdown({ serverId, nodeToken }) {
    const filter = serverId ? { _id: serverId } : { nodeToken };
    const server = await ServerRepository.findOne(filter);
    if (!server) throw new NotFoundError('Server');

    server.status = 'offline';
    server.healthStatus = 'unhealthy';
    await server.save();

    await HealthCheckLog.create({
      serverId: server._id,
      status: 'offline',
      errorMessage: 'Agent initiated shutdown',
    });

    await this._logProvision(server._id, 'server_deregistered', 'completed', {});
    return { success: true };
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

  async reportCommandResult({ serverId, commandId, status, error }) {
    await this._logProvision(serverId, `command_${commandId}`, status, { error });
    return { success: true };
  }

  async addServer(serverData) {
    const token = crypto.randomBytes(32).toString('hex');
    const server = await ServerRepository.create({
      ...serverData,
      nodeToken: token,
      status: 'provisioning',
      salesEnabled: true,
    });

    await this._logProvision(server._id, 'server_provisioned', 'completed', {
      bootstrapCommand: this._generateBootstrapCommand(server),
    });

    return server;
  }

  async removeServer(serverId) {
    const server = await ServerRepository.findById(serverId);
    if (!server) throw new NotFoundError('Server');

    server.status = 'offline';
    server.salesEnabled = false;
    await server.save();

    await this._logProvision(serverId, 'server_deregistered', 'completed', {});
    return { success: true };
  }

  async getProvisionLogs(serverId, { limit = 50, offset = 0 } = {}) {
    const filter = serverId ? { serverId } : {};
    return ProvisionLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(Math.min(limit, 200))
      .lean();
  }

  async getServerStatus(serverId) {
    const server = await ServerRepository.findById(serverId);
    if (!server) throw new NotFoundError('Server');

    const latestMetric = await ServerMetrics.findOne(
      { serverId },
      {},
      { sort: { createdAt: -1 } }
    ).lean();

    const latestHealth = await HealthCheckLog.findOne(
      { serverId },
      {},
      { sort: { createdAt: -1 } }
    ).lean();

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
    const servers = await ServerRepository.findMany({});
    const activeServers = servers.filter(s => s.status === 'active');
    const overloaded = servers.filter(s => s.loadPercent > 80);
    const offline = servers.filter(s => s.status === 'offline');

    const totalCapacity = servers.reduce((sum, s) => sum + (s.maxCapacity || 0), 0);
    const totalUsers = servers.reduce((sum, s) => sum + (s.currentActiveUsers || 0), 0);

    return {
      totalServers: servers.length,
      activeServers: activeServers.length,
      overloadedServers: overloaded.length,
      offlineServers: offline.length,
      totalCapacity,
      totalUsers,
      globalLoadPercent: totalCapacity > 0 ? Math.round((totalUsers / totalCapacity) * 100) : 0,
      servers: servers.map(s => {
        const loadPercent = s.maxCapacity > 0
          ? Math.round(((s.currentActiveUsers || 0) / s.maxCapacity) * 1000) / 10
          : 0;
        return {
          _id: s._id,
          name: s.name,
          ipAddress: s.ipAddress,
          region: s.region,
          status: s.status,
          healthStatus: s.healthStatus,
          loadPercent,
          currentActiveUsers: s.currentActiveUsers,
          maxCapacity: s.maxCapacity,
          lastHeartbeat: s.lastHeartbeat,
        };
      }),
    };
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

  async _getPendingCommands(_serverId) {
    return [];
  }

  _generateBootstrapToken(server) {
    // Generate a time-limited bootstrap token: serverId + expiry + HMAC
    const expiry = Date.now() + 15 * 60 * 1000; // 15 minutes
    const payload = `${server._id}:${expiry}`;
    const hmac = crypto.createHmac('sha256', config.nodeSecret)
      .update(payload)
      .digest('hex');
    return `${payload}:${hmac}`;
  }

  _generateBootstrapCommand(server) {
    const backend = process.env.BACKEND_URL || 'http://localhost:3000';
    const bootstrapToken = this._generateBootstrapToken(server);
    return `curl -fsSL ${backend}/api/node-agent/bootstrap.sh | bash -s -- --backend ${backend} --token ${bootstrapToken} --region ${server.region || 'unknown'}`;
  }

  async _logProvision(serverId, action, status, metadata = {}) {
    try {
      await ProvisionLog.create({
        serverId,
        action,
        status,
        metadata,
        completedAt: status === 'completed' || status === 'failed' ? new Date() : null,
      });
    } catch (err) {
      this.logger.warn({ err }, 'Failed to write provision log');
    }
  }

  // ========== ZERO-TRUST NODE COMMANDS ==========

  COMMAND_WHITELIST = {
    addUser: { action: 'addUser', requireParams: ['uuid', 'email'], critical: false },
    removeUser: { action: 'removeUser', requireParams: ['email'], critical: true },
    restartXray: { action: 'restartXray', requireParams: [], critical: true },
    getStats: { action: 'getStats', requireParams: [], critical: false },
  };

  async executeNodeCommand(serverId, commandName, params = {}) {
    const commandDef = this.COMMAND_WHITELIST[commandName];
    if (!commandDef) return { error: `Prohibited command: ${commandName}` };

    for (const p of commandDef.requireParams) {
      if (!params[p]) return { error: `Missing param: ${p}` };
    }

    const job = await BullMQManager.enqueue('node-commands', commandName, {
      serverId, commandName, params, critical: commandDef.critical,
    });
    return { jobId: job.id, command: commandName, queued: true };
  }

  async rotateNodeCredentials(serverId) {
    const server = await ServerRepository.findById(serverId);
    if (!server) throw new NotFoundError('Server');

    const newToken = crypto.randomBytes(48).toString('hex');
    server.nodeToken = newToken;
    server.lastCredentialRotation = new Date();
    await server.save();

    await this._logProvision(serverId, 'credentials_rotated', 'completed', {
      rotatedAt: new Date().toISOString(),
    });

    await BullMQManager.enqueue('node-commands', 'updateCredentials', { serverId, newToken });
    return { newToken, rotatedAt: server.lastCredentialRotation, nextRotationAt: new Date(Date.now() + 86400000) };
  }

  async rotateAllNodeCredentials() {
    const servers = await ServerRepository.findMany({ status: 'active' });
    const results = [];
    for (const s of servers) {
      const last = s.lastCredentialRotation ? new Date(s.lastCredentialRotation).getTime() : 0;
      if (Date.now() - last > 43200000) {
        try {
          results.push({ serverId: s._id, ...await this.rotateNodeCredentials(s._id) });
        } catch (err) {
          this.logger.error({ err, serverId: s._id }, '[node] Rotation failed');
        }
      }
    }
    return results;
  }
}

export default new NodeManagerService();
