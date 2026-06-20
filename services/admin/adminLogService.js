import mongoose from 'mongoose';
import AuditLog from '../../models/AuditLog.js';

class AdminLogService {
  async log(adminId, action, targetType, targetId, oldValue, newValue, ip) {
    return AuditLog.create({
      adminId,
      action,
      targetType,
      targetId,
      oldValue,
      newValue,
      ip,
    });
  }

  async getLogs(filter = {}, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('adminId', 'telegramId role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    return { logs, total, page, limit, pages: Math.ceil(total / limit) };
  }
}

export default new AdminLogService();
