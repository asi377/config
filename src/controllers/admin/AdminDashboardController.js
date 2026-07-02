/**
 * Admin dashboard stats.
 *
 * Revenue is computed from APPROVED receipts (card payments, wallet top-ups, and
 * manual admin approvals — all of which create an approved Receipt with the paid
 * `amount`). The previous version summed the `Transaction` collection, which
 * manual purchases never write to, so manual sales were missing from revenue.
 */
const APPROVED = ['approved', 'auto_approved', 'paid'];

export async function getDashboard(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const Subscription = (await import('../../models/Subscription.js')).default;
    const Receipt = (await import('../../models/Receipt.js')).default;
    const Plan = (await import('../../models/Plan.js')).default;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    const sumReceipts = async (extraMatch) => {
      const r = await Receipt.aggregate([
        { $match: { status: { $in: APPROVED }, ...extraMatch } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);
      return { total: r[0]?.total || 0, count: r[0]?.count || 0 };
    };

    const [
      totalUsers, newUsersToday, activeSubscriptions, onHoldSubs, expiredSubs,
      pendingReceipts, totalPlans, trialsClaimed, resellers,
      revToday, rev7, rev30, revAll, dailySeries,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: startOfToday } }),
      Subscription.countDocuments({ status: 'active' }),
      Subscription.countDocuments({ status: 'on_hold' }),
      Subscription.countDocuments({ status: 'expired' }),
      Receipt.countDocuments({ status: 'pending' }),
      Plan.countDocuments({ isActive: true }),
      User.countDocuments({ freeTrialClaimedAt: { $ne: null } }),
      User.countDocuments({ isReseller: true }),
      sumReceipts({ createdAt: { $gte: startOfToday } }),
      sumReceipts({ createdAt: { $gte: sevenDaysAgo } }),
      sumReceipts({ createdAt: { $gte: thirtyDaysAgo } }),
      sumReceipts({}),
      Receipt.aggregate([
        { $match: { status: { $in: APPROVED }, createdAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        newUsersToday,
        activeSubscriptions,
        onHoldSubs,
        expiredSubs,
        pendingReceipts,
        totalPlans,
        trialsClaimed,
        resellers,
        // Revenue (Toman) — now includes manual purchases.
        revenueToday: revToday.total,
        salesToday: revToday.count,
        revenue7d: rev7.total,
        revenue30d: rev30.total,
        revenueAllTime: revAll.total,
        dailyRevenue: revToday.total, // backward-compatible alias = today's revenue
        dailySeries,
        lastUpdated: new Date(),
      },
    });
  } catch (err) {
    next(err);
  }
}
