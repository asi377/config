export async function getBroadcastTargets(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const users = await User.find({ role: { $ne: 'banned' } }, { telegramId: 1, role: 1 }).lean();
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
}

export async function sendBroadcast(req, res, next) {
  try {
    const BullMQManager = (await import('../../queue/bullmq.js')).default;
    const { text, targetRole } = req.body;

    if (!text) return res.status(400).json({ success: false, error: 'text is required' });

    const queue = BullMQManager.getQueue('telegram-out');
    if (!queue) return res.status(500).json({ success: false, error: 'Queue not available' });

    await queue.add('broadcast', { text, targetRole: targetRole || 'user' }, { removeOnComplete: true });
    res.json({ success: true, data: { scheduled: true } });
  } catch (err) { next(err); }
}
