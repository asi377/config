import BaseRepository from './BaseRepository.js';
import { Server } from '../models/index.js';

class ServerRepository extends BaseRepository {
  constructor() {
    super(Server);
  }

  async findActive() {
    return this.findMany({ status: 'active' }, { sort: { currentActiveUsers: -1 } });
  }

  async allocateLeastLoaded() {
    return this.model.findOneAndUpdate(
      { status: 'active', $expr: { $lt: ['$currentActiveUsers', '$maxCapacity'] } },
      { $inc: { currentActiveUsers: 1 } },
      { sort: { currentActiveUsers: 1, maxCapacity: -1 }, new: true },
    );
  }

  async releaseSlot(serverId) {
    return this.model.findOneAndUpdate(
      { _id: serverId, currentActiveUsers: { $gt: 0 } },
      { $inc: { currentActiveUsers: -1 } },
    );
  }

  async getHealthReport() {
    return this.findMany({ status: 'active' }, { sort: { currentActiveUsers: -1 } });
  }
}

export default new ServerRepository();
