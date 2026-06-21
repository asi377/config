import AdminAnalyticsService from '../../services/admin/AdminAnalyticsService.js';

export async function getRetentionRate(req, res, next) {
  try {
    const data = await AdminAnalyticsService.getRetentionRate();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getChurnRate(req, res, next) {
  try {
    const data = await AdminAnalyticsService.getChurnRate();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getServerPopularity(req, res, next) {
  try {
    const data = await AdminAnalyticsService.getServerPopularity();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
