import EventBus from '../events/EventBus.js';
import UserRepository from '../repositories/UserRepository.js';
import SubscriptionRepository from '../repositories/SubscriptionRepository.js';
import TunnelConfigRepository from '../repositories/TunnelConfigRepository.js';
import FraudLogRepository from '../repositories/FraudLogRepository.js';
import stateCache from '../redis/stateCache.js';
import { fraudEventsTotal, fraudScore } from '../monitoring/metrics.js';
import logger from '../config/logger.js';

const THRESHOLD_WARN = 70;
const THRESHOLD_SUSPEND = 85;
const THRESHOLD_BAN = 95;

const RULES = [
  {
    name: 'bandwidth_spike',
    weight: 30,
    description: 'Abnormal bandwidth usage spike detected',
    async evaluate(userId) {
      const subs = await SubscriptionRepository.findMany({ ownerId: userId, status: 'active' });
      let totalSpike = 0;
      for (const sub of subs) {
        const usagePercent = sub.totalVolumeBytes > 0
          ? (sub.usedVolumeBytes / sub.totalVolumeBytes) * 100
          : 0;
        if (usagePercent > 90 && sub.startDate && (Date.now() - sub.startDate) < 86400000) {
          totalSpike += 20;
        }
        if (usagePercent > 50 && (Date.now() - sub.startDate) < 3600000) {
          totalSpike += 15;
        }
      }
      return totalSpike;
    },
  },
  {
    name: 'rapid_node_switching',
    weight: 25,
    description: 'User rapidly switching between nodes',
    async evaluate(userId) {
      const configs = await TunnelConfigRepository.findMany({ userId, isActive: true });
      const recentChanges = configs.filter(c => c.updatedAt && (Date.now() - c.updatedAt) < 3600000);
      if (recentChanges.length >= 3) return 20;
      if (recentChanges.length >= 5) return 25;
      return 0;
    },
  },
  {
    name: 'multiple_device_logins',
    weight: 20,
    description: 'Multiple concurrent IPs across configs',
    async evaluate(userId) {
      const configs = await TunnelConfigRepository.findMany({ userId, isActive: true });
      const ipSet = new Set(configs.filter(c => c.lastKnownIp).map(c => c.lastKnownIp));
      const count = ipSet.size;
      if (count >= 10) return 20;
      if (count >= 5) return 10;
      return 0;
    },
  },
  {
    name: 'suspicious_geo_change',
    weight: 15,
    description: 'Suspicious geographic location change',
    async evaluate(userId) {
      const configs = await TunnelConfigRepository.findMany({ userId, isActive: true });
      const ips = configs.filter(c => c.lastKnownIp).map(c => c.lastKnownIp);
      if (ips.length < 2) return 0;

      const key = `user:${userId}:geo_history`;
      const geoHistory = await stateCache.get(key) || [];
      const now = Date.now();

      const recentEntries = geoHistory.filter(e => now - e.timestamp < 3600000);
      if (recentEntries.length >= 3) {
        const countries = new Set(recentEntries.map(e => e.country));
        if (countries.size >= 2) return 10;
        if (countries.size >= 3) return 15;
      }

      const geoEntry = { ips, timestamp: now, country: 'unknown' };
      geoHistory.push(geoEntry);
      if (geoHistory.length > 10) geoHistory.shift();
      await stateCache.set(key, geoHistory, 86400);

      return 0;
    },
  },
  {
    name: 'account_age_anomaly',
    weight: 10,
    description: 'Suspicious new account behavior',
    async evaluate(userId) {
      const user = await UserRepository.findById(userId);
      if (!user || !user.joinedAt) return 0;
      const accountAge = Date.now() - user.joinedAt;
      if (accountAge < 3600000) return 10;

      const subs = await SubscriptionRepository.findMany({ ownerId: userId });
      if (accountAge < 86400000 && subs.length >= 3) return 8;

      return 0;
    },
  },
];

class FraudScoreService {
  async evaluateUser(userId) {
    let totalScore = 0;
    const triggeredRules = [];

    for (const rule of RULES) {
      try {
        const score = await rule.evaluate(userId);
        if (score > 0) {
          totalScore += score;
          triggeredRules.push({ rule: rule.name, score, description: rule.description });
        }
      } catch (err) {
        logger.error({ err, userId, rule: rule.name }, '[fraud] Rule evaluation failed');
      }
    }

    totalScore = Math.min(100, totalScore);
    fraudScore.set({ user_id: userId }, totalScore);

    await this._logAndAct(userId, totalScore, triggeredRules);

    return { userId, score: totalScore, triggeredRules, decision: this._getDecision(totalScore) };
  }

  async evaluateBatch(userIds) {
    return Promise.all(userIds.map(uid => this.evaluateUser(uid).catch(err => {
      logger.error({ err, uid }, '[fraud] Batch evaluation failed');
      return { userId: uid, score: 0, error: err.message };
    })));
  }

  async getFraudProfile(userId) {
    const key = `fraud:profile:${userId}`;
    const cached = await stateCache.get(key);
    if (cached) return cached;

    const logs = await FraudLogRepository.findMany({ userId }, { sort: { createdAt: -1 }, limit: 20 });
    const profile = {
      userId,
      totalEvents: logs.length,
      averageScore: logs.length > 0 ? logs.reduce((s, l) => s + l.score, 0) / logs.length : 0,
      lastEvent: logs[0] || null,
      recentEvents: logs.slice(0, 5),
    };

    await stateCache.set(key, profile, 300);
    return profile;
  }

  async _logAndAct(userId, score, triggeredRules) {
    const severity = score >= THRESHOLD_BAN ? 'critical' : score >= THRESHOLD_SUSPEND ? 'high' : score >= THRESHOLD_WARN ? 'medium' : 'low';
    const ruleNames = triggeredRules.map(r => r.rule);

    fraudEventsTotal.inc({ severity, rule: ruleNames.join('|') || 'none' });

    if (score > 0) {
      await FraudLogRepository.create({
        userId,
        ruleName: ruleNames.join(', '),
        severity,
        score,
        description: `Fraud score ${score}: ${ruleNames.join(', ')}`,
        evidence: { triggeredRules, totalScore: score },
        actionTaken: this._getDecision(score),
        resolved: false,
      });
    }

    if (score >= THRESHOLD_BAN) {
      const user = await UserRepository.findById(userId);
      if (user) {
        user.role = 'banned';
        await user.save();
        logger.warn({ userId, score }, '[fraud] User banned');
      }
      EventBus.emit('fraud:user_banned', { userId, score, triggeredRules });
    } else if (score >= THRESHOLD_SUSPEND) {
      const subs = await SubscriptionRepository.findMany({ ownerId: userId, status: 'active' });
      for (const sub of subs) {
        sub.status = 'suspended';
        sub.suspendReason = 'fraud_detected';
        await sub.save();
      }
      EventBus.emit('fraud:user_suspended', { userId, score, triggeredRules });
    } else if (score >= THRESHOLD_WARN) {
      EventBus.emit('fraud:user_warned', { userId, score, triggeredRules });
    }
  }

  _getDecision(score) {
    if (score >= THRESHOLD_BAN) return 'ban';
    if (score >= THRESHOLD_SUSPEND) return 'suspend';
    if (score >= THRESHOLD_WARN) return 'warn';
    return 'monitor';
  }
}

export default new FraudScoreService();
