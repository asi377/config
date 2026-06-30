export async function getDailySales(req, res, next) {
  try {
    const Transaction = (await import('../../models/Transaction.js')).default;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sales = await Transaction.aggregate([
      {
        $match: {
          type: 'payment',
          status: 'completed',
          createdAt: { $gte: today, $lt: tomorrow },
        },
      },
      {
        $group: {
          _id: '$currency',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);

    res.json({ success: true, data: sales });
  } catch (err) { next(err); }
}

export async function getMonthlySales(req, res, next) {
  try {
    const Transaction = (await import('../../models/Transaction.js')).default;
    const { year, month } = req.params;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);

    const sales = await Transaction.aggregate([
      {
        $match: {
          type: 'payment',
          status: 'completed',
          createdAt: { $gte: startDate, $lt: endDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({ success: true, data: sales });
  } catch (err) { next(err); }
}

export async function getDiscountCodes(req, res, next) {
  try {
    const PromoCode = (await import('../../models/PromoCode.js')).default;
    const codes = await PromoCode.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: codes });
  } catch (err) { next(err); }
}

export async function getRevenueProjection(req, res, next) {
  try {
    const Transaction = (await import('../../models/Transaction.js')).default;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const avgDaily = await Transaction.aggregate([
      {
        $match: {
          type: 'payment',
          status: 'completed',
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: null,
          avgDaily: { $avg: '$amount' },
          total: { $sum: '$amount' },
        },
      },
    ]);

    const projection = avgDaily[0] ? avgDaily[0].avgDaily * 30 : 0;
    res.json({ success: true, data: { projectedMonthlyRevenue: projection, lastMonth: avgDaily[0]?.total || 0 } });
  } catch (err) { next(err); }
}
