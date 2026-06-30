import BaseService from '../../shared/BaseService.js';
import AuditLogRepository from '../../repositories/AuditLogRepository.js';

class AdminLogService extends BaseService {
  log = this.wrapMethod(async (adminId, action, targetType, targetId, oldValue, newValue, ip) => {
    return AuditLogRepository.createLog(adminId, action, targetType, targetId, oldValue, newValue, ip);
  });

  getLogs = this.wrapMethod(async (filter = {}, page = 1, limit = 50) => {
    return AuditLogRepository.findWithPagination(filter, page, limit);
  });
}

export default new AdminLogService();
