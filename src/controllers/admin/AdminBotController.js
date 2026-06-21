import AdminBotService from '../../services/admin/AdminBotService.js';

export async function getBroadcastTargets(req, res, next) {
  try {
    const audience = req.query.audience || 'all';
    const ids = await AdminBotService.getBroadcastTargets(audience);
    res.json({ success: true, data: { audience, count: ids.length } });
  } catch (err) {
    next(err);
  }
}

export async function sendBroadcast(req, res, next) {
  try {
    const { audience, message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'message is required' });

    const bot = req.app.get('bot');
    if (!bot) return res.status(500).json({ success: false, error: 'Bot instance not available' });

    const targets = ['active', 'expired'].includes(audience)
      ? await AdminBotService.getBroadcastTargets(audience)
      : await AdminBotService.getBroadcastTargets('all');

    const result = await AdminBotService.sendBroadcast(bot, targets, message);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
