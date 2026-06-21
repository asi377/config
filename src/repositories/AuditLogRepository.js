import BaseRepository from './BaseRepository.js';
import { AuditLog } from '../models/index.js';

class AuditLogRepository extends BaseRepository {
  constructor() {
    super(AuditLog);
  }

  async createLog(adminId, action, targetType, targetId, oldValue, newValue, ip) {
    return this.create({ adminId, action, targetType, targetId, oldValue, newValue, ip });
  }

  async findWithPagination(filter = {}, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.model.find(filter)
        .populate('adminId', 'telegramId role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.count(filter),
    ]);
    return { logs, total, page, limit, pages: Math.ceil(total / limit) };
  }
}

export default new AuditLogRepository();
