import mongoose from 'mongoose';
import { User, Subscription } from '../../models/index.js';
import { NotFoundError } from '../../utils/errors.js';

const GB = 1073741824;

class AdminUserService {
  async searchUsers(query) {
    const isObjectId = /^[a-f0-9]{24}$/i.test(String(query));
    const isNumeric = /^\d+$/.test(String(query));

    let filter = {};
    if (isObjectId) {
      filter = { _id: new mongoose.Types.ObjectId(query) };
    } else if (isNumeric) {
      filter = { telegramId: Number(query) };
    } else {
      filter = { telegramId: { $regex: query, $options: 'i' } };
    }

    const users = await User.find(filter).lean();

    const enriched = await Promise.all(
      users.map(async (u) => {
        const subs = await Subscription.find({ ownerId: u._id })
          .populate('planId')
          .sort({ createdAt: -1 })
          .lean();

        const activeSub = subs.find((s) => s.status === 'active');
        const totalGB = subs.reduce((acc, s) => acc + (s.usedVolumeBytes || 0), 0) / GB;

        return {
          _id: u._id,
          telegramId: u.telegramId,
          walletBalance: u.walletBalance,
          role: u.role,
          joinedAt: u.joinedAt,
          referralCode: u.referralCode,
          referredBy: u.referredBy,
          subscriptions: subs.map((s) => ({
            _id: s._id,
            plan: s.planId?.title || '—',
            status: s.status,
            usedGB: Number((s.usedVolumeBytes / GB).toFixed(2)),
            totalGB: Number((s.totalVolumeBytes / GB).toFixed(2)),
            expireDate: s.expireDate,
          })),
          activePlan: activeSub?.planId?.title || null,
          totalUsedGB: Number(totalGB.toFixed(2)),
        };
      })
    );

    return enriched;
  }

  async getUserById(userId) {
    const results = await this.searchUsers(userId);
    if (results.length === 0) throw new NotFoundError('User');
    return results[0];
  }

  async updateUserRole(userId, role) {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { role } },
      { new: true },
    );
    if (!user) throw new NotFoundError('User');
    return user;
  }

  async banUser(userId) {
    const user = await User.findById(userId);
    if (!user) throw new NotFoundError('User');
    user.role = 'banned';
    await Subscription.updateMany({ ownerId: user._id, status: 'active' }, { $set: { status: 'suspended' } });
    await user.save();
    return user;
  }

  async resetUserBandwidth(userId) {
    const subs = await Subscription.find({ ownerId: userId, status: 'active' });
    for (const sub of subs) {
      sub.usedVolumeBytes = 0;
      await sub.save();
    }
    return { resetCount: subs.length };
  }
}

export default new AdminUserService();
