import adminDashboardService from '../../services/admin/adminDashboardService.js';

export async function getDashboard(req, res) {
  try {
    const data = await adminDashboardService.getDashboard();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
