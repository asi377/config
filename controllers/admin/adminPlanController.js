import adminPlanService from '../../services/admin/adminPlanService.js';
import { NotFoundError } from '../../utils/errors.js';

export async function getAllPlans(req, res) {
  try {
    const plans = await adminPlanService.getAllPlans();
    res.json({ success: true, data: plans });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function createPlan(req, res) {
  try {
    const { title, type, basePrice, baseVolumeGB, durationDays, maxSubLinks, category } = req.body;
    if (!title || !type || !basePrice || !baseVolumeGB || !durationDays) {
      return res.status(400).json({ success: false, error: 'Missing required plan fields' });
    }
    const plan = await adminPlanService.createPlan(req.body, req.adminId, req.ip);
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function updatePlan(req, res) {
  try {
    const plan = await adminPlanService.updatePlan(req.params.id, req.body, req.adminId, req.ip);
    res.json({ success: true, data: plan });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function deletePlan(req, res) {
  try {
    const result = await adminPlanService.deletePlan(req.params.id, req.adminId, req.ip);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}
