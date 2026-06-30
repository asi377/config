import logger from '../../config/logger.js';

export async function searchUsers(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const query = req.params.query || req.query.query || '';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const users = await User.find({
      $or: [
        { telegramId: { $regex: query, $options: 'i' } },
        { referralCode: { $regex: query, $options: 'i' } },
      ],
    }).limit(limit).lean();

    res.json({ success: true, data: users });
  } catch (err) { next(err); }
}

export async function getUser(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const user = await User.findById(req.params.id)
      .populate('referredBy', 'telegramId referralCode')
      .lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function updateUserRole(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;
    const { role } = req.body;

    if (!['user', 'support', 'superadmin', 'reseller'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }

    if (role === 'superadmin' && req.admin?.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Only a superadmin can grant the superadmin role' });
    }

    const user = await User.findByIdAndUpdate(req.params.id, { $set: { role } }, { new: true });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'user.role_change',
      targetType: 'User',
      targetId: user._id,
      oldValue: { role: user.role },
      newValue: { role },
    });

    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function banUser(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;

    const user = await User.findByIdAndUpdate(req.params.id, { $set: { role: 'banned' } }, { new: true });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'user.ban',
      targetType: 'User',
      targetId: user._id,
    });

    res.json({ success: true, data: { telegramId: user.telegramId, role: user.role } });
  } catch (err) { next(err); }
}

export async function resetBandwidth(req, res, next) {
  try {
    const Subscription = (await import('../../models/Subscription.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;

    const result = await Subscription.updateMany(
      { ownerId: req.params.id, status: 'active' },
      { $set: { usedVolumeBytes: 0, notified80Percent: false } },
    );

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'user.bandwidth_reset',
      targetType: 'User',
      targetId: req.params.id,
      newValue: { subscriptionsAffected: result.modifiedCount },
    });

    res.json({ success: true, data: { subscriptionsReset: result.modifiedCount } });
  } catch (err) { next(err); }
}

export async function resetFreeTrialAll(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;

    const result = await User.updateMany({}, { $set: { freeTrialClaimedAt: null } });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'user.free_trial_reset_all',
      targetType: 'User',
      targetId: null,
      newValue: { usersAffected: result.modifiedCount },
    });

    res.json({ success: true, data: { usersReset: result.modifiedCount } });
  } catch (err) { next(err); }
}
