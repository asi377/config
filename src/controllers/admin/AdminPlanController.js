import AdminPlanService from '../../services/admin/AdminPlanService.js';

export async function getAllPlans(req, res, next) {
  try {
    const plans = await AdminPlanService.getAllPlans(req.query);
    res.json({ success: true, data: plans });
  } catch (err) {
    next(err);
  }
}

export async function createPlan(req, res, next) {
  try {
    const plan = await AdminPlanService.createPlan(req.body, req.adminId, req.ip);
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
}

export async function clonePlan(req, res, next) {
  try {
    const plan = await AdminPlanService.clonePlan(req.params.id, req.adminId, req.ip);
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
}

export async function reorderPlans(req, res, next) {
  try {
    const result = await AdminPlanService.reorderPlans(req.body.items, req.adminId, req.ip);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function updatePlan(req, res, next) {
  try {
    const plan = await AdminPlanService.updatePlan(req.params.id, req.body, req.adminId, req.ip);
    res.json({ success: true, data: plan });
  } catch (err) {
    next(err);
  }
}

export async function deletePlan(req, res, next) {
  try {
    const result = await AdminPlanService.deletePlan(req.params.id, req.adminId, req.ip);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
