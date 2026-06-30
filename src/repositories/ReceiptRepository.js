import BaseRepository from './BaseRepository.js';
import { Receipt } from '../models/index.js';

class ReceiptRepository extends BaseRepository {
  constructor() {
    super(Receipt);
  }

  async findPending() {
    return this.findMany({ status: 'pending' }, { sort: { createdAt: -1 } });
  }

  async findByUser(userId) {
    return this.findMany({ userId }, { sort: { createdAt: -1 } });
  }

  async findMatchingSms(amount, since) {
    return this.findOne({ amount, status: 'pending', createdAt: { $gte: since } });
  }

  async findUniqueAmount(baseAmount, maxAttempts = 20) {
    for (let i = 0; i < maxAttempts; i++) {
      const offset = Math.floor(Math.random() * 999) + 1;
      const exactAmount = baseAmount + offset;
      const existing = await this.findOne({ amount: exactAmount, status: 'pending' });
      if (!existing) return exactAmount;
    }
    return null;
  }
}

export default new ReceiptRepository();
