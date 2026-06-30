import BaseService from '../../shared/BaseService.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';

class AdminBandwidthService extends BaseService {
  getLoadAwareScalingActions = this.wrapMethod(async () => {
    const servers = await ServerRepository.findActive();
    const actions = [];

    for (const server of servers) {
      const loadPct = server.maxCapacity > 0
        ? (server.currentActiveUsers / server.maxCapacity) * 100
        : 100;

      if (loadPct > 80) {
        const affectedSubs = await SubscriptionRepository.findMany(
          { serverId: server._id, status: 'active' },
          { populate: 'planId' },
        );
        const updatedPlans = new Set();
        for (const sub of affectedSubs) {
          if (!sub.planId) continue;
          if (['economy', 'normal'].includes(sub.planId.type)) {
            updatedPlans.add(sub.planId.title);
          }
        }
        actions.push({
          serverName: server.name,
          loadPercent: Number(loadPct.toFixed(1)),
          status: 'SCALE_DOWN',
          affectedPlans: [...updatedPlans],
          suggestedAction: 'Reduce speed limit for economy/normal tiers on this server',
        });
      }
    }
    return actions;
  });
}

export default new AdminBandwidthService();
