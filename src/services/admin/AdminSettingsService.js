import logger from '../../config/logger.js';

class AdminSettingsService {
  async listSettings(filters = {}) {
    const Setting = (await import('../../models/Setting.js')).default;
    const limit = Math.min(parseInt(filters.limit) || 50, 200);
    return Setting.find().limit(limit).lean();
  }

  async updateSetting(key, value, adminId, ip) {
    const Setting = (await import('../../models/Setting.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;

    const setting = await Setting.findOneAndUpdate(
      { key },
      { $set: { value, updatedAt: new Date() } },
      { new: true, upsert: true },
    );

    await AuditLogRepository.create({
      adminId,
      action: 'setting.update',
      targetType: 'Setting',
      targetId: setting._id,
      newValue: { key, value },
    });

    return setting;
  }
}

export default new AdminSettingsService();
