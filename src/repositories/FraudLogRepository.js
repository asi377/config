import BaseRepository from './BaseRepository.js';
import { FraudLog } from '../models/index.js';

class FraudLogRepository extends BaseRepository {
  constructor() {
    super(FraudLog);
  }

  async findByUserId(userId) {
    return this.findMany({ userId }, { sort: { createdAt: -1 } });
  }

  async findUnresolved(severity = null) {
    const filter = { resolved: false };
    if (severity) filter.severity = severity;
    return this.findMany(filter, { sort: { createdAt: -1 } });
  }

  async resolveFraudLog(logId, adminId, notes = '') {
    return this.updateById(logId, {
      $set: { resolved: true, resolvedBy: adminId, resolvedAt: new Date(), notes },
    });
  }

  async getFraudScore(userId) {
    const logs = await this.findMany({ userId, resolved: false });
    if (logs.length === 0) return 0;
    const totalScore = logs.reduce((sum, log) => sum + log.score, 0);
    return Math.min(100, totalScore);
  }

  async getAlertStats() {
    return this.aggregate([
      { $match: { resolved: false } },
      {
        $group: {
          _id: '$severity',
          count: { $sum: 1 },
        },
      },
    ]);
  }
}

export default new FraudLogRepository();
