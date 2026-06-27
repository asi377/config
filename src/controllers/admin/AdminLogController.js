export async function getAuditLogs(req, res, next) {
  try {
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const logs = await AuditLogRepository.find({}, null, {
      skip: (page - 1) * limit,
      limit,
      sort: { createdAt: -1 },
    });

    res.json({ success: true, data: logs });
  } catch (err) { next(err); }
}
