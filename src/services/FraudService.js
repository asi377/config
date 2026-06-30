import BaseService from '../shared/BaseService.js';
import TunnelConfigRepository from '../repositories/TunnelConfigRepository.js';
import SubscriptionRepository from '../repositories/SubscriptionRepository.js';
import FraudLogRepository from '../repositories/FraudLogRepository.js';
import webhookService from './WebhookService.js';
import logger from '../config/logger.js';

class FraudService extends BaseService {
  checkConcurrentConnections = this.wrapMethod(async (uuid, activeIps) => {
    const config = await TunnelConfigRepository.findByUuid(uuid);
    if (!config) return { action: 'not_found', config: null };

    if (activeIps.length <= 5) return { action: 'ok', config };

    config.strikeCount = (config.strikeCount || 0) + 1;
    await config.save();

    await this._logFraudEvent({
      userId: config.userId,
      ruleName: 'concurrent_connections',
      severity: activeIps.length > 20 ? 'critical' : 'high',
      score: Math.min(100, activeIps.length * 5),
      description: `${activeIps.length} concurrent IPs on config ${uuid}`,
      evidence: { uuid, activeIps, strikeCount: config.strikeCount },
      actionTaken: config.strikeCount >= 3 ? 'suspension' : 'warning',
    });

    if (config.strikeCount >= 3) {
      const sub = await SubscriptionRepository.findById(config.subscriptionId);
      if (sub && sub.status === 'active') {
        sub.status = 'suspended';
        await sub.save();

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
  });

  async _logFraudEvent({ userId, ruleName, severity, score, description, evidence, actionTaken }) {
    try {
      await FraudLogRepository.create({
        userId,
        ruleName,
        severity,
        score,
        description,
        evidence,
        actionTaken,
        resolved: false,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to log fraud event');
    }
  }
}

export default new FraudService();
