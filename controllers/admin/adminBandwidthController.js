import adminBandwidthService from '../../services/admin/adminBandwidthService.js';

export async function getLoadScalingActions(req, res) {
  try {
    const actions = await adminBandwidthService.getLoadAwareScalingActions();
    res.json({ success: true, data: actions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
