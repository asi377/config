export async function getLoadScalingActions(req, res, next) {
  try {
    const ServerMetrics = (await import('../../models/ServerMetrics.js')).default;
    const actions = await ServerMetrics.find({ load: { $gt: 80 } }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, data: actions });
  } catch (err) { next(err); }
}
