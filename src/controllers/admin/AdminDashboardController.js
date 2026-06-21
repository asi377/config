import AdminDashboardService from '../../services/admin/AdminDashboardService.js';

export async function getDashboard(req, res, next) {
  try {
    const data = await AdminDashboardService.getDashboard();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
