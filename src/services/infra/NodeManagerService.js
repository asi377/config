import logger from '../../config/logger.js';

class NodeManagerService {
  async rotateNodeCredentials(serverId) {
    logger.info({ serverId }, '[infra] Rotating node credentials');
    return { serverId, rotated: true, timestamp: new Date() };
  }

  async rotateAllNodeCredentials() {
    const Server = (await import('../../models/Server.js')).default;
    const servers = await Server.find().select('_id name').lean();
    
    const results = [];
    for (const server of servers) {
      results.push(await this.rotateNodeCredentials(server._id));
    }
    return results;
  }
}

export default new NodeManagerService();
