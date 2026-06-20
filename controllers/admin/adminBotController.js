import adminBotService from '../../services/admin/adminBotService.js';

export async function getBroadcastTargets(req, res) {
  try {
    const audience = req.query.audience || 'all';
    const ids = await adminBotService.getBroadcastTargets(audience);
    res.json({ success: true, data: { audience, count: ids.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function sendBroadcast(req, res) {
  try {
    const { audience, message } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'message is required' });

    const bot = req.app.get('bot');
    if (!bot) return res.status(500).json({ success: false, error: 'Bot instance not available' });

    const targets = audience === 'active' || audience === 'expired'
      ? await adminBotService.getBroadcastTargets(audience)
      : await adminBotService.getBroadcastTargets('all');

    const result = await adminBotService.sendBroadcast(bot, targets, message);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
