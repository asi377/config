import logger from '../../config/logger.js';

export async function getAllPlans(req, res, next) {
  try {
    const Plan = (await import('../../models/Plan.js')).default;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const [plans, total] = await Promise.all([
      Plan.find({ isArchived: false }).sort({ sortOrder: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Plan.countDocuments({ isArchived: false }),
    ]);

    res.json({ success: true, data: { plans, total, page, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
}

export async function createPlan(req, res, next) {
  try {
    const Plan = (await import('../../models/Plan.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;
    const { title, basePrice, baseVolumeGB, durationDays, maxSubLinks, type, pricing } = req.body;

    if (!title || !basePrice || !baseVolumeGB || !durationDays || !type) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const plan = await Plan.create({
      title,
      basePrice,
      baseVolumeGB,
      durationDays,
      maxSubLinks: maxSubLinks || 1,
      type,
      pricing: pricing || [{ currency: 'IRR', amount: basePrice, enabled: true }],
    });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'plan.create',
      targetType: 'Plan',
      targetId: plan._id,
      newValue: { title, basePrice },
    });

    res.status(201).json({ success: true, data: plan });
  } catch (err) { next(err); }
}

export async function updatePlan(req, res, next) {
  try {
    const Plan = (await import('../../models/Plan.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;
    const allowed = ['title', 'basePrice', 'baseVolumeGB', 'durationDays', 'maxSubLinks', 'type', 'pricing', 'salesEnabled', 'visibility'];
    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const plan = await Plan.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'plan.update',
      targetType: 'Plan',
      targetId: plan._id,
      newValue: updates,
    });

    res.json({ success: true, data: plan });
  } catch (err) { next(err); }
}

export async function reorderPlans(req, res, next) {
  try {
    const Plan = (await import('../../models/Plan.js')).default;
    const { planOrder } = req.body;
    if (!Array.isArray(planOrder)) return res.status(400).json({ success: false, error: 'planOrder array required' });

    const updates = planOrder.map((id, index) => ({ id, sortOrder: index }));
    for (const { id, sortOrder } of updates) {
      await Plan.findByIdAndUpdate(id, { $set: { sortOrder } });
    }

    res.json({ success: true, data: { reordered: planOrder.length } });
  } catch (err) { next(err); }
}

export async function clonePlan(req, res, next) {
  try {
    const Plan = (await import('../../models/Plan.js')).default;
    const original = await Plan.findById(req.params.id);
    if (!original) return res.status(404).json({ success: false, error: 'Plan not found' });

    const cloned = await Plan.create({
      ...original.toObject(),
      _id: undefined,
      title: `${original.title} (Copy)`,
      sortOrder: (original.sortOrder || 100) + 1,
    });

    res.status(201).json({ success: true, data: cloned });
  } catch (err) { next(err); }
}

export async function deletePlan(req, res, next) {
  try {
    const Plan = (await import('../../models/Plan.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;
    const plan = await Plan.findByIdAndUpdate(req.params.id, { $set: { isArchived: true } });
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'plan.archive',
      targetType: 'Plan',
      targetId: plan._id,
    });

    res.json({ success: true, data: { archived: true } });
  } catch (err) { next(err); }
}
