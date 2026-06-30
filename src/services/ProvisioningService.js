import BaseService from '../shared/BaseService.js';
import TunnelService from './TunnelService.js';
import NodeCommandService from './infra/NodeCommandService.js';
import logger from '../config/logger.js';

const GB = 1073741824;

class ProvisioningService extends BaseService {
  /**
   * Creates the first TunnelConfig (UUID) for an active subscription and
   * queues a `create_user` command to the allocated server's node-agent.
   * Shared by PaymentService (auto/manual approval) and createSubLinkScene
   * so the Xray-provisioning step isn't duplicated in two places.
   */
  async provisionTunnelOnNode(subscription, plan, user, configName = 'default') {
    const tunnelConfig = await TunnelService.createSubLink(subscription._id, configName);

    const email = `user-${tunnelConfig.uuid}@hornet.node`;
    const trafficLimitGB = plan?.baseVolumeGB
      || (subscription.totalVolumeBytes ? Math.round(subscription.totalVolumeBytes / GB) : null);

    const result = await NodeCommandService.executeNodeCommand(subscription.serverId, 'create_user', {
      uuid: tunnelConfig.uuid,
      email,
      trafficLimitGB,
      expiryDays: plan?.durationDays || null,
    });

    if (result?.error) {
      logger.error({ result, subscriptionId: subscription._id }, '[provisioning] create_user command rejected');
    } else {
      logger.info(
        { subscriptionId: subscription._id, serverId: subscription.serverId, uuid: tunnelConfig.uuid },
        '[provisioning] create_user command queued for node-agent'
      );
    }

    return { tunnelConfig, commandResult: result };
  }
}

export default new ProvisioningService();
