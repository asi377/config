import crypto from 'crypto';
import BaseService from '../../shared/BaseService.js';
import { NotFoundError } from '../../shared/errors.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import BullMQManager from '../../queue/bullmq.js';
import PendingNodeCommand from '../../models/PendingNodeCommand.js';

// Names/params must match the `case` values in infra/node-agent/agent.js's executeCommand().
const COMMAND_WHITELIST = {
  create_user: { requireParams: ['uuid', 'email'], critical: false },
  remove_user: { requireParams: ['email'], critical: true },
  disable_user: { requireParams: ['email'], critical: true },
  restart_xray: { requireParams: [], critical: true },
  update_config: { requireParams: ['config'], critical: true },
  sync_users: { requireParams: [], critical: false },
};

class NodeCommandService extends BaseService {
  /**
   * The node-agent (infra/node-agent/agent.js) only polls /api/nodes/heartbeat over HTTP —
   * it never opens a WebSocket connection. So commands are queued here and handed back
   * inside the next heartbeat response (see NodeHealthService.processHeartbeat), not
   * pushed in real time. Latency is bounded by the agent's heartbeat interval (~30s).
   */
  async executeNodeCommand(serverId, commandName, params = {}) {
    const commandDef = COMMAND_WHITELIST[commandName];
    if (!commandDef) return { error: `Prohibited command: ${commandName}` };

    for (const p of commandDef.requireParams) {
      if (params[p] === undefined || params[p] === null) {
        return { error: `Missing param: ${p}` };
      }
    }

    const doc = await PendingNodeCommand.create({
      serverId, type: commandName, params,
    });
    return { commandId: doc._id, command: commandName, queued: true };
  }

  async rotateNodeCredentials(serverId) {
    const server = await ServerRepository.findById(serverId);
    if (!server) throw new NotFoundError('Server');

    const newToken = crypto.randomBytes(48).toString('hex');
    server.nodeToken = newToken;
    server.lastCredentialRotation = new Date();
    await server.save();

    const ProvisionLog = (await import('../../models/ProvisionLog.js')).default;
    await ProvisionLog.create({
      serverId, action: 'credentials_rotated', status: 'completed',
      metadata: { rotatedAt: new Date().toISOString() },
      completedAt: new Date(),
    });

    await BullMQManager.enqueue('node-commands', 'updateCredentials', { serverId, newToken });
    return { newToken, rotatedAt: server.lastCredentialRotation, nextRotationAt: new Date(Date.now() + 86400000) };
  }

  async rotateAllNodeCredentials() {
    const servers = await ServerRepository.findMany({ status: 'active' });
    const eligible = servers.filter(s => {
      const last = s.lastCredentialRotation ? new Date(s.lastCredentialRotation).getTime() : 0;
      return Date.now() - last > 43200000;
    });

    const results = [];
    const CHUNK = 20;
    for (let i = 0; i < eligible.length; i += CHUNK) {
      const chunk = eligible.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(
        chunk.map(s => this.rotateNodeCredentials(s._id).then(r => ({ serverId: s._id, ...r })))
      );
      for (const r of settled) {
        if (r.status === 'fulfilled') results.push(r.value);
        else this.logger.error({ err: r.reason }, '[node] Rotation failed');
      }
    }
    return results;
  }

  async reportCommandResult({ serverId, commandId, status, error }) {
    const normalizedStatus = status === 'completed' ? 'completed' : 'failed';
    const cmd = await PendingNodeCommand.findOneAndUpdate(
      { _id: commandId, serverId },
      { status: normalizedStatus, completedAt: new Date(), error: error || null },
      { new: true }
    );

    const ACTION_BY_TYPE = {
      create_user: 'user_created',
      remove_user: 'user_removed',
      disable_user: 'user_disabled',
      update_config: 'config_updated',
      restart_xray: 'xray_restarted',
    };
    const action = ACTION_BY_TYPE[cmd?.type];
    if (action) {
      const ProvisionLog = (await import('../../models/ProvisionLog.js')).default;
      await ProvisionLog.create({
        serverId, action, status: normalizedStatus,
        targetEmail: cmd?.params?.email || null,
        targetUuid: cmd?.params?.uuid || null,
        metadata: { commandId, error: error || null }, completedAt: new Date(),
      });
    }
    return { success: true };
  }
}

export default new NodeCommandService();
