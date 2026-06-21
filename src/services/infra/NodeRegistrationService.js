import crypto from 'crypto';
import BaseService from '../../shared/BaseService.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import ProvisionLog from '../../models/ProvisionLog.js';
import config from '../../config/index.js';

class NodeRegistrationService extends BaseService {
  async registerNode({ name, ipAddress, region, port, xrayApiPort, maxCapacity, nodeToken, xrayStatus, isBootstrapRegistration }) {
    let server = null;

    if (nodeToken) {
      server = await ServerRepository.findOne({ nodeToken });
    }

    if (!server && isBootstrapRegistration && nodeToken) {
      server = await ServerRepository.findOneAndUpdate(
        { status: 'provisioning' },
        { $set: { status: 'claiming' } },
        { sort: { createdAt: -1 }, new: true }
      );
      if (!server) {
        server = await ServerRepository.findOneAndUpdate(
          {},
          { $set: { status: 'claiming' } },
          { sort: { createdAt: -1 }, new: true }
        );
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
        data: { serverId: server._id, name: server.name, nodeToken: permanentToken },
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
      data: { serverId: server._id, name: server.name, nodeToken: token },
    };
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
    if (!server) throw new (await import('../../shared/errors.js')).NotFoundError('Server');

    server.status = 'offline';
    server.salesEnabled = false;
    await server.save();

    await this._logProvision(serverId, 'server_deregistered', 'completed', {});
    return { success: true };
  }

  _generateBootstrapToken(server) {
    const expiry = Date.now() + 15 * 60 * 1000;
    const payload = `${server._id}:${expiry}`;
    const hmac = crypto.createHmac('sha256', config.nodeSecret)
      .update(payload)
      .digest('hex');
    return `${payload}:${hmac}`;
  }

  _generateBootstrapCommand(server) {
    const backend = process.env.BACKEND_URL || 'http://localhost:3000';
    const bootstrapToken = this._generateBootstrapToken(server);
    const region = (server.region || 'unknown').replace(/[^a-zA-Z0-9-]/g, '');
    return `curl -fsSL ${backend}/api/node-agent/bootstrap.sh | bash -s -- --backend ${backend} --token ${bootstrapToken} --region '${region}'`;
  }

  async _logProvision(serverId, action, status, metadata = {}) {
    try {
      await ProvisionLog.create({
        serverId, action, status, metadata,
        completedAt: status === 'completed' || status === 'failed' ? new Date() : null,
      });
    } catch (err) {
      this.logger.warn({ err }, 'Failed to write provision log');
    }
  }
}

export default new NodeRegistrationService();
