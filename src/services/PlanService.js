import BaseService from '../shared/BaseService.js';
import PlanRepository from '../repositories/PlanRepository.js';

class PlanService extends BaseService {
  getActivePlans = this.wrapMethod(async () => PlanRepository.findActive());

  getCategories = this.wrapMethod(async () => PlanRepository.findCategories());

  getPlansByCategory = this.wrapMethod(async (category) => PlanRepository.findByCategory(category));

  getTrialPlan = this.wrapMethod(async () => PlanRepository.findTrialPlan());

  getPlanById = this.wrapMethod(async (id) => PlanRepository.findById(id));
}

export default new PlanService();
