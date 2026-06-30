import BaseService from '../../shared/BaseService.js';
import { NotFoundError } from '../../shared/errors.js';
import ServerRepository from '../../repositories/ServerRepository.js';

class AdminServerService extends BaseService {
  getAllServers = this.wrapMethod(async () => ServerRepository.findActive());

  addServer = this.wrapMethod(async (data) => ServerRepository.create(data));

  toggleSales = this.wrapMethod(async (serverId, salesActive) => {
    const server = await ServerRepository.updateById(
      serverId,
      { $set: { status: salesActive ? 'active' : 'maintenance' } },
    );
    if (!server) throw new NotFoundError('Server');
    return server;
  });

  rebootServer = this.wrapMethod(async (serverId) => {
    const server = await ServerRepository.findById(serverId);
    if (!server) throw new NotFoundError('Server');
    this.logger.info({ server: server.name }, '[reboot] simulated reboot');
    return { message: `Reboot signal sent to ${server.name}` };
  });
}

export default new AdminServerService();
