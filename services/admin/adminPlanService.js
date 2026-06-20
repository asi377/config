import mongoose from 'mongoose';
import { Plan } from '../../models/index.js';
import { NotFoundError } from '../../utils/errors.js';
import adminLogService from './adminLogService.js';

class AdminPlanService {
  async getAllPlans() {
    return Plan.find().sort({ basePrice: 1 }).lean();
  }

  async createPlan(data, adminId, ip) {
    const plan = await Plan.create(data);
    await adminLogService.log(adminId, 'create_plan', 'plan', plan._id, null, data, ip);
    return plan;
  }

  async updatePlan(planId, updates, adminId, ip) {
    const old = await Plan.findById(planId).lean();
    if (!old) throw new NotFoundError('Plan');

    const plan = await Plan.findByIdAndUpdate(planId, { $set: updates }, { new: true });
    await adminLogService.log(adminId, 'update_plan', 'plan', planId, old, updates, ip);
    return plan;
  }

  async deletePlan(planId, adminId, ip) {
    const plan = await Plan.findByIdAndDelete(planId);
    if (!plan) throw new NotFoundError('Plan');
    await adminLogService.log(adminId, 'delete_plan', 'plan', planId, plan, null, ip);
    return { deleted: true };
  }
}

export default new AdminPlanService();
