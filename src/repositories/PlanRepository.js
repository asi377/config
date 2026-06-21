import BaseRepository from './BaseRepository.js';
import { Plan } from '../models/index.js';

class PlanRepository extends BaseRepository {
  constructor() {
    super(Plan);
  }

  async findActive() {
    return this.findMany({ isActive: true, isTrial: { $ne: true } });
  }

  async findTrialPlan() {
    return this.findOne({ isTrial: true, isActive: true });
  }

  async findCategories() {
    return this.distinct('category', { isActive: true, isTrial: { $ne: true } });
  }

  async findByCategory(category) {
    return this.findMany({ category, isActive: true, isTrial: { $ne: true } });
  }
}

export default new PlanRepository();
