import BaseRepository from './BaseRepository.js';
import { Ticket } from '../models/index.js';

class TicketRepository extends BaseRepository {
  constructor() {
    super(Ticket);
  }

  async findByUser(userId) {
    return this.findMany({ userId }, { sort: { updatedAt: -1 } });
  }

  async findWithUser(filter = {}) {
    return this.model.find(filter)
      .populate('userId', 'telegramId')
      .sort({ updatedAt: -1 })
      .lean();
  }
}

export default new TicketRepository();
