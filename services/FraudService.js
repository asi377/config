import { TunnelConfig, Subscription } from '../models/index.js';
import adminService from './AdminService.js';
import webhookService from './WebhookService.js';

class FraudService {

  /**
   * Simulates parsing an Xray log entry for a given UUID.
   * If the UUID's active connections exceed 5 distinct IPs, increment
   * the strike counter.  After 3 strikes, auto-suspend the parent
   * subscription.
   *
   * @param {string} uuid         - The tunnel config UUID.
   * @param {string[]} activeIps  - Array of active client IPs.
   * @returns {Promise<{action: string, config: import('mongoose').Document|null}>}
   */
  async checkConcurrentConnections(uuid, activeIps) {
    const config = await TunnelConfig.findOne({ uuid });
    if (!config) return { action: 'not_found', config: null };

    if (activeIps.length <= 5) return { action: 'ok', config };

    config.strikeCount = (config.strikeCount || 0) + 1;
    await config.save();

    if (config.strikeCount >= 3) {
      const sub = await Subscription.findById(config.subscriptionId);
      if (sub && sub.status === 'active') {
        await adminService.toggleSuspend(sub._id.toString(), true);

        webhookService.sendEvent('FRAUD_DETECTED', {
          uuid: config.uuid,
          subscriptionId: config.subscriptionId,
          activeIpsCount: activeIps.length,
          strikeCount: config.strikeCount,
          action: 'suspended',
        });
      }

      return { action: 'suspended', config };
    }

    return { action: 'strike_incremented', config };
  }
}

export default new FraudService();
