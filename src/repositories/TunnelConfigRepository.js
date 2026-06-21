import BaseRepository from './BaseRepository.js';
import { TunnelConfig } from '../models/index.js';

class TunnelConfigRepository extends BaseRepository {
  constructor() {
    super(TunnelConfig);
  }

  async findBySubscription(subscriptionId) {
    return this.findMany({ subscriptionId, isActive: true });
  }

  async findByUuid(uuid) {
    return this.findOne({ uuid });
  }

  async countActiveBySubscription(subscriptionId) {
    return this.count({ subscriptionId, isActive: true });
  }

  async getTotalReservedQuota(subscriptionId, session) {
    const result = await this.aggregate([
      { $match: { subscriptionId, isActive: true, allocatedQuotaBytes: { $ne: null } } },
      { $group: { _id: null, totalReserved: { $sum: '$allocatedQuotaBytes' } } },
    ], { session });
    return result[0]?.totalReserved ?? 0;
  }

  async expireGuestLinks() {
    const now = new Date();
    return this.updateMany({
      isActive: true,
      $or: [
        { isGuestLink: true, guestExpireDate: { $lte: now } },
        { allocatedQuotaBytes: { $ne: null }, $expr: { $gte: ['$usedQuotaBytes', '$allocatedQuotaBytes'] } },
      ],
    }, { $set: { isActive: false } });
  }
}

export default new TunnelConfigRepository();
