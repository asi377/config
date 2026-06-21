import AdminFinanceService from '../../services/admin/AdminFinanceService.js';

export async function getDailySales(req, res, next) {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const data = await AdminFinanceService.getDailySales(days);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getMonthlySales(req, res, next) {
  try {
    const year = parseInt(req.params.year, 10) || new Date().getFullYear();
    const month = parseInt(req.params.month, 10) || (new Date().getMonth() + 1);
    const data = await AdminFinanceService.getMonthlySales(year, month);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getDiscountCodes(req, res, next) {
  try {
    const data = await AdminFinanceService.getDiscountCodeStats();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getRevenueProjection(req, res, next) {
  try {
    const months = parseInt(req.query.months, 10) || 3;
    const data = await AdminFinanceService.getRevenueProjection(months);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
