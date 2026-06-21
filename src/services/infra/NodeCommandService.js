import crypto from 'crypto';
import BaseService from '../../shared/BaseService.js';
import { NotFoundError } from '../../shared/errors.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import BullMQManager from '../../queue/bullmq.js';

const COMMAND_WHITELIST = {
  addUser: { action: 'addUser', requireParams: ['uuid', 'email'], critical: false },
  removeUser: { action: 'removeUser', requireParams: ['email'], critical: true },
  restartXray: { action: 'restartXray', requireParams: [], critical: true },
  getStats: { action: 'getStats', requireParams: [], critical: false },
};

class NodeCommandService extends BaseService {
  async executeNodeCommand(serverId, commandName, params = {}) {
    const commandDef = COMMAND_WHITELIST[commandName];
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
    const ProvisionLog = (await import('../../models/ProvisionLog.js')).default;
    await ProvisionLog.create({
      serverId, action: `command_${commandId}`, status,
      metadata: { error }, completedAt: new Date(),
    });
    return { success: true };
  }
}

export default new NodeCommandService();
