import BaseRepository from './BaseRepository.js';
import { User } from '../models/index.js';

class UserRepository extends BaseRepository {
  constructor() {
    super(User);
  }

  async findByTelegramId(telegramId) {
    return this.findOne({ telegramId });
  }

  async findByReferralCode(code) {
    return this.findOne({ referralCode: code });
  }

  async findAdmins() {
    return this.findMany({ role: { $in: ['support', 'superadmin'] } });
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async search(query) {
    const isObjectId = /^[a-f0-9]{24}$/i.test(String(query));
    const isNumeric = /^\d+$/.test(String(query));
    let filter = {};

    if (isObjectId) { filter = { _id: query }; }
    else if (isNumeric) { filter = { telegramId: Number(query) }; }
    else {
      const safe = this.escapeRegex(String(query)).slice(0, 100);
      filter = { telegramId: { $regex: safe, $options: 'i' } };
    }

    return this.findMany(filter, { limit: 50 });
  }

  async getWalletBalance(userId) {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    return user.walletBalance;
  }

  async incrementWalletBalance(userId, amount, session) {
    return this.model.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: amount, totalSpent: amount > 0 ? amount : 0 } },
      { new: true, session },
    );
  }

  async updateRank(userId, rank, session) {
    return this.model.findByIdAndUpdate(
      userId,
      { $set: { rank } },
      { new: true, session },
    );
  }
}

export default new UserRepository();
