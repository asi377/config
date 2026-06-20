import mongoose from 'mongoose';
import { Plan, Subscription, Server } from '../../models/index.js';

class AdminBandwidthService {
  async getLoadAwareScalingActions() {
    const servers = await Server.find({ status: 'active' }).lean();
    const actions = [];

    for (const server of servers) {
      const loadPct = server.maxCapacity > 0
        ? (server.currentActiveUsers / server.maxCapacity) * 100
        : 100;

      if (loadPct > 80) {
        const affectedSubs = await Subscription.find({ serverId: server._id, status: 'active' })
          .populate('planId')
          .lean();

        const updatedPlans = new Set();

        for (const sub of affectedSubs) {
          if (!sub.planId) continue;
          const planType = sub.planId.type;
          if (planType === 'economy' || planType === 'normal') {
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
  }
}

export default new AdminBandwidthService();
