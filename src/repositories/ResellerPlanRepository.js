import BaseRepository from './BaseRepository.js';
import { ResellerPlan } from '../models/index.js';

class ResellerPlanRepository extends BaseRepository {
  constructor() {
    super(ResellerPlan);
  }

  async findActive() {
    return this.findMany({ isActive: true }, { sort: { sortOrder: 1 } });
  }
}

export default new ResellerPlanRepository();
