import BaseService from '../../shared/BaseService.js';
import UserRepository from '../../repositories/UserRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import TunnelConfigRepository from '../../repositories/TunnelConfigRepository.js';
import FraudLogRepository from '../../repositories/FraudLogRepository.js';
import TransactionRepository from '../../repositories/TransactionRepository.js';

const RULES = {
  MULTIPLE_ACCOUNTS: { name: 'multiple_accounts', weight: 30, threshold: 60 },
  RAPID_SIGNUP: { name: 'rapid_signup', weight: 25, threshold: 50 },
  SUSPICIOUS_PAYMENT: { name: 'suspicious_payment', weight: 35, threshold: 50 },
  VPN_ABUSE: { name: 'vpn_abuse', weight: 40, threshold: 70 },
  WALLET_MANIPULATION: { name: 'wallet_manipulation', weight: 45, threshold: 60 },
};

class FraudDetectionService extends BaseService {
  async scanUser(userId) {
    const results = await Promise.allSettled([
      this._checkMultipleAccounts(userId),
      this._checkRapidSignup(userId),
      this._checkSuspiciousPayment(userId),
      this._checkVpnAbuse(userId),
      this._checkWalletManipulation(userId),
    ]);

    const alerts = results
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => r.value);

    for (const alert of alerts) {
      await FraudLogRepository.create(alert);
    }

    const score = await FraudLogRepository.getFraudScore(userId);

    if (score >= 70) {
      const user = await UserRepository.findById(userId);
      if (user && user.role === 'user') {
        user.role = 'banned';
        await user.save();
        await SubscriptionRepository.updateMany(
          { ownerId: userId, status: 'active' },
          { $set: { status: 'suspended' } }
        );
      }
    }

    return { score, alerts };
  }

  async scanAllUsers() {
    const allUsers = await UserRepository.findMany({ role: 'user' });
    const results = [];
    for (const user of allUsers) {
      try {
        const result = await this.scanUser(user._id);
        if (result.alerts.length > 0) {
          results.push({ userId: user._id, ...result });
        }
      } catch (err) {
        this.logger.warn({ userId: user._id, err }, 'Fraud scan failed for user');
      }
    }
    return results;
  }

  async _checkMultipleAccounts(userId) {
    const user = await UserRepository.findById(userId);
    if (!user) return null;

    const configs = await TunnelConfigRepository.findMany({ userId, isActive: true });
    if (configs.length === 0) return null;

    const ipCounts = {};
    for (const cfg of configs) {
      if (cfg.lastKnownIp) {
        ipCounts[cfg.lastKnownIp] = (ipCounts[cfg.lastKnownIp] || 0) + 1;
      }
    }

    const uniqueIps = Object.keys(ipCounts);
    if (uniqueIps.length >= 3) {
      return {
        userId,
        ruleName: RULES.MULTIPLE_ACCOUNTS.name,
        severity: 'high',
        score: RULES.MULTIPLE_ACCOUNTS.weight,
        description: `User associated with ${uniqueIps.length} different IPs`,
        evidence: { ips: uniqueIps, configCount: configs.length },
        actionTaken: 'review',
      };
    }
    return null;
  }

  async _checkRapidSignup(userId) {
    const user = await UserRepository.findById(userId);
    if (!user || !user.createdAt) return null;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (user.createdAt > oneHourAgo) {
      const recentUsers = await UserRepository.count({
        createdAt: { $gte: oneHourAgo },
      });

      if (recentUsers > 50) {
        return {
          userId,
          ruleName: RULES.RAPID_SIGNUP.name,
          severity: 'medium',
          score: RULES.RAPID_SIGNUP.weight,
          description: 'Rapid signup detected during high-volume registration period',
          evidence: { recentSignups: recentUsers, userCreatedAt: user.createdAt },
          actionTaken: 'warning',
        };
      }
    }
    return null;
  }

  async _checkSuspiciousPayment(userId) {
    const txs = await TransactionRepository.findByUserId(userId);
    if (txs.length < 2) return null;

    const paymentTxs = txs.filter((t) => t.type === 'payment' || t.type === 'deposit');
    if (paymentTxs.length < 2) return null;

    const amounts = paymentTxs.map((t) => t.amount);
    const uniqueAmounts = new Set(amounts);

    if (uniqueAmounts.size === 1 && amounts.length >= 3) {
      return {
        userId,
        ruleName: RULES.SUSPICIOUS_PAYMENT.name,
        severity: 'high',
        score: RULES.SUSPICIOUS_PAYMENT.weight,
        description: `${amounts.length} identical payment amounts detected`,
        evidence: { amounts, count: amounts.length },
        actionTaken: 'review',
      };
    }

    const rapidPayments = paymentTxs.filter((t) => {
      const createdAt = new Date(t.createdAt);
      return Date.now() - createdAt.getTime() < 5 * 60 * 1000;
    });

    if (rapidPayments.length >= 3) {
      return {
        userId,
        ruleName: RULES.SUSPICIOUS_PAYMENT.name,
        severity: 'medium',
        score: Math.floor(RULES.SUSPICIOUS_PAYMENT.weight * 0.7),
        description: `${rapidPayments.length} payments within 5 minutes`,
        evidence: { rapidPaymentCount: rapidPayments.length },
        actionTaken: 'warning',
      };
    }

    return null;
  }

  async _checkVpnAbuse(userId) {
    const configs = await TunnelConfigRepository.findMany({ userId, isActive: true });
    if (configs.length === 0) return null;

    const highUsageConfigs = configs.filter(
      (c) => c.allocatedQuotaBytes > 0 && c.usedQuotaBytes / c.allocatedQuotaBytes > 0.95
    );

    if (highUsageConfigs.length >= 3) {
      return {
        userId,
        ruleName: RULES.VPN_ABUSE.name,
        severity: 'high',
        score: RULES.VPN_ABUSE.weight,
        description: `${highUsageConfigs.length} configs at >95% usage`,
        evidence: { configIds: highUsageConfigs.map((c) => c._id) },
        actionTaken: 'review',
      };
    }

    return null;
  }

  async _checkWalletManipulation(userId) {
    const txs = await TransactionRepository.findByUserId(userId);
    if (txs.length < 3) return null;

    const adminAdjustments = txs.filter((t) => t.type === 'admin_adjustment');
    const refunds = txs.filter((t) => t.type === 'refund');

    if (adminAdjustments.length >= 3) {
      return {
        userId,
        ruleName: RULES.WALLET_MANIPULATION.name,
        severity: 'high',
        score: Math.floor(RULES.WALLET_MANIPULATION.weight * 0.8),
        description: `${adminAdjustments.length} admin adjustments on this account`,
        evidence: { adminAdjustmentCount: adminAdjustments.length },
        actionTaken: 'review',
      };
    }

    if (refunds.length >= 3) {
      return {
        userId,
        ruleName: RULES.WALLET_MANIPULATION.name,
        severity: 'critical',
        score: RULES.WALLET_MANIPULATION.weight,
        description: `${refunds.length} refund requests on this account`,
        evidence: { refundCount: refunds.length },
        actionTaken: 'suspension',
      };
    }

    return null;
  }
}

export default new FraudDetectionService();
