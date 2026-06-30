class AuditLogRepository {
  async create(data) {
    const AuditLog = (await import('../models/AuditLog.js')).default;
    return AuditLog.create({
      adminId: data.adminId,
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      oldValue: data.oldValue || null,
      newValue: data.newValue || null,
      ip: data.ip,
      createdAt: new Date(),
    });
  }

  async find(filter = {}, projection = null, options = {}) {
    const AuditLog = (await import('../models/AuditLog.js')).default;
    return AuditLog.find(filter, projection, options).lean();
  }
}

export default new AuditLogRepository();
