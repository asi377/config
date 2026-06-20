import adminLogService from '../../services/admin/adminLogService.js';

export async function getAuditLogs(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const filter = {};

    if (req.query.adminId) filter.adminId = req.query.adminId;
    if (req.query.action) filter.action = req.query.action;
    if (req.query.targetType) filter.targetType = req.query.targetType;

    const data = await adminLogService.getLogs(filter, page, limit);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
