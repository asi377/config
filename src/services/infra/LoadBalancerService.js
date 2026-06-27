import logger from '../../config/logger.js';

class LoadBalancerService {
  async checkAllRegions() {
    const Server = (await import('../../models/Server.js')).default;
    const servers = await Server.find().lean();
    
    return servers.map(s => ({
      serverId: s._id,
      region: s.region,
      healthy: true,
      load: Math.random() * 100,
    }));
  }
}

export default new LoadBalancerService();
