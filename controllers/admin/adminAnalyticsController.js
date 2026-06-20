import adminAnalyticsService from '../../services/admin/adminAnalyticsService.js';

export async function getRetentionRate(req, res) {
  try {
    const data = await adminAnalyticsService.getRetentionRate();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getChurnRate(req, res) {
  try {
    const data = await adminAnalyticsService.getChurnRate();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getServerPopularity(req, res) {
  try {
    const data = await adminAnalyticsService.getServerPopularity();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
