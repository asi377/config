import AdminBandwidthService from '../../services/admin/AdminBandwidthService.js';

export async function getLoadScalingActions(req, res, next) {
  try {
    const actions = await AdminBandwidthService.getLoadAwareScalingActions();
    res.json({ success: true, data: actions });
  } catch (err) {
    next(err);
  }
}
