export async function getRetentionRate(req, res, next) {
  try {
    const Subscription = (await import('../../models/Subscription.js')).default;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const retained = await Subscription.countDocuments({
      status: 'active',
      createdAt: { $lt: thirtyDaysAgo },
    });

    const total = await Subscription.countDocuments({
      createdAt: { $lt: thirtyDaysAgo },
    });

    const rate = total > 0 ? (retained / total) * 100 : 0;
    res.json({ success: true, data: { retentionRate: rate, retained, total } });
  } catch (err) { next(err); }
}

export async function getChurnRate(req, res, next) {
  try {
    const Subscription = (await import('../../models/Subscription.js')).default;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const churned = await Subscription.countDocuments({
      status: { $in: ['expired', 'cancelled'] },
      updatedAt: { $gte: thirtyDaysAgo },
    });

    res.json({ success: true, data: { churnedCount: churned } });
  } catch (err) { next(err); }
}

export async function getServerPopularity(req, res, next) {
  try {
    const Subscription = (await import('../../models/Subscription.js')).default;
    const popularity = await Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$serverId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    res.json({ success: true, data: popularity });
  } catch (err) { next(err); }
}
