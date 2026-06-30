import logger from '../../config/logger.js';
import EventBus from '../../events/EventBus.js';

// ==================== RESELLER PLANS (tiers) ====================

export async function getAllResellerPlans(req, res, next) {
  try {
    const ResellerPlan = (await import('../../models/ResellerPlan.js')).default;
    const plans = await ResellerPlan.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
    res.json({ success: true, data: plans });
  } catch (err) { next(err); }
}

export async function createResellerPlan(req, res, next) {
  try {
    const ResellerPlan = (await import('../../models/ResellerPlan.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;
    const {
      name, displayName, maxActiveAccounts, discountPercent,
      requiresApproval, applicationFee, isActive, sortOrder,
    } = req.body;

    if (!name || !displayName || discountPercent === undefined || discountPercent === null) {
      return res.status(400).json({ success: false, error: 'name, displayName and discountPercent are required' });
    }

    const plan = await ResellerPlan.create({
      name,
      displayName,
      maxActiveAccounts: maxActiveAccounts === undefined || maxActiveAccounts === '' ? null : maxActiveAccounts,
      discountPercent,
      requiresApproval: requiresApproval !== undefined ? !!requiresApproval : true,
      applicationFee: applicationFee || 0,
      isActive: isActive !== undefined ? !!isActive : true,
      sortOrder: sortOrder || 0,
    });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'reseller_plan.create',
      targetType: 'ResellerPlan',
      targetId: plan._id,
      newValue: { name, displayName, discountPercent },
    });

    res.status(201).json({ success: true, data: plan });
  } catch (err) { next(err); }
}

export async function updateResellerPlan(req, res, next) {
  try {
    const ResellerPlan = (await import('../../models/ResellerPlan.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;
    const allowed = [
      'name', 'displayName', 'maxActiveAccounts', 'discountPercent',
      'requiresApproval', 'applicationFee', 'isActive', 'sortOrder',
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.maxActiveAccounts === '') updates.maxActiveAccounts = null;

    const plan = await ResellerPlan.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!plan) return res.status(404).json({ success: false, error: 'Reseller plan not found' });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'reseller_plan.update',
      targetType: 'ResellerPlan',
      targetId: plan._id,
      newValue: updates,
    });

    res.json({ success: true, data: plan });
  } catch (err) { next(err); }
}

export async function deleteResellerPlan(req, res, next) {
  try {
    const ResellerPlan = (await import('../../models/ResellerPlan.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;
    const plan = await ResellerPlan.findByIdAndUpdate(req.params.id, { $set: { isActive: false } });
    if (!plan) return res.status(404).json({ success: false, error: 'Reseller plan not found' });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'reseller_plan.deactivate',
      targetType: 'ResellerPlan',
      targetId: plan._id,
    });

    res.json({ success: true, data: { deactivated: true } });
  } catch (err) { next(err); }
}

// ==================== RESELLER APPLICATIONS ====================

export async function getResellerApplications(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const filter = {};
    if (req.query.status) filter.resellerApplicationStatus = req.query.status;
    else filter.resellerApplicationStatus = 'pending';

    const users = await User.find(filter)
      .populate('currentResellerPlanId')
      .sort({ updatedAt: -1 })
      .limit(Math.min(parseInt(req.query.limit) || 100, 500))
      .lean();

    res.json({ success: true, data: users });
  } catch (err) { next(err); }
}

export async function approveResellerApplication(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;

    const user = await User.findById(req.params.userId).populate('currentResellerPlanId');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    user.isReseller = true;
    user.resellerApplicationStatus = 'approved';
    await user.save();

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'reseller_application.approve',
      targetType: 'User',
      targetId: user._id,
      newValue: { isReseller: true, resellerApplicationStatus: 'approved' },
    });

    EventBus.emit('reseller:application_reviewed', {
      userTelegramId: user.telegramId,
      lang: user.language,
      approved: true,
      tierName: user.currentResellerPlanId?.displayName,
    });

    logger.info({ userId: user._id }, '[admin] Reseller application approved');
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function rejectResellerApplication(req, res, next) {
  try {
    const User = (await import('../../models/User.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const telegramId = user.telegramId;
    const lang = user.language;

    user.resellerApplicationStatus = 'rejected';
    user.currentResellerPlanId = null;
    await user.save();

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'reseller_application.reject',
      targetType: 'User',
      targetId: user._id,
      newValue: { resellerApplicationStatus: 'rejected' },
    });

    EventBus.emit('reseller:application_reviewed', {
      userTelegramId: telegramId,
      lang,
      approved: false,
    });

    logger.info({ userId: user._id }, '[admin] Reseller application rejected');
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}
