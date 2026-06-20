import adminFinanceService from '../../services/admin/adminFinanceService.js';

export async function getDailySales(req, res) {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const data = await adminFinanceService.getDailySales(days);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getMonthlySales(req, res) {
  try {
    const year = parseInt(req.params.year, 10) || new Date().getFullYear();
    const month = parseInt(req.params.month, 10) || (new Date().getMonth() + 1);
    const data = await adminFinanceService.getMonthlySales(year, month);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getDiscountCodes(req, res) {
  try {
    const data = await adminFinanceService.getDiscountCodeStats();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getRevenueProjection(req, res) {
  try {
    const months = parseInt(req.query.months, 10) || 3;
    const data = await adminFinanceService.getRevenueProjection(months);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
