import AdminLogService from '../../services/admin/AdminLogService.js';

export async function getAuditLogs(req, res, next) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const filter = {};
    if (req.query.adminId) filter.adminId = req.query.adminId;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.targetType) filter.targetType = req.query.targetType;
    const data = await AdminLogService.getLogs(filter, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
