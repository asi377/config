import BaseService from '../../shared/BaseService.js';
import { NotFoundError } from '../../shared/errors.js';
import UserRepository from '../../repositories/UserRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';

const GB = 1073741824;

class AdminUserService extends BaseService {
  searchUsers = this.wrapMethod(async (query) => {
    const users = await UserRepository.search(query);
    return Promise.all(
      users.map(async (u) => {
        const subs = await SubscriptionRepository.findMany(
          { ownerId: u._id },
          { populate: 'planId', sort: { createdAt: -1 } },
        );
        const activeSub = subs.find((s) => s.status === 'active');
        const totalGB = subs.reduce((acc, s) => acc + (s.usedVolumeBytes || 0), 0) / GB;
        return {
          _id: u._id, telegramId: u.telegramId, walletBalance: u.walletBalance,
          role: u.role, joinedAt: u.joinedAt, referralCode: u.referralCode,
          referredBy: u.referredBy,
          subscriptions: subs.map((s) => ({
            _id: s._id, plan: s.planId?.title || '—', status: s.status,
            usedGB: Number((s.usedVolumeBytes / GB).toFixed(2)),
            totalGB: Number((s.totalVolumeBytes / GB).toFixed(2)), expireDate: s.expireDate,
          })),
          activePlan: activeSub?.planId?.title || null,
          totalUsedGB: Number(totalGB.toFixed(2)),
        };
      }),
    );
  });

  getUserById = this.wrapMethod(async (userId) => {
    const results = await this.searchUsers(userId);
    if (results.length === 0) throw new NotFoundError('User');
    return results[0];
  });

  updateUserRole = this.wrapMethod(async (userId, role) => {
    const user = await UserRepository.updateById(userId, { $set: { role } });
    if (!user) throw new NotFoundError('User');
    return user;
  });

  banUser = this.wrapMethod(async (userId) => {
    const user = await UserRepository.findById(userId);
    if (!user) throw new NotFoundError('User');
    user.role = 'banned';
    await SubscriptionRepository.updateMany({ ownerId: user._id, status: 'active' }, { $set: { status: 'suspended' } });
    return user.save();
  });

  resetUserBandwidth = this.wrapMethod(async (userId) => {
    const result = await SubscriptionRepository.updateMany(
      { ownerId: userId, status: 'active' },
      { $set: { usedVolumeBytes: 0 } },
    );
    return { resetCount: result.modifiedCount };
  });
}

export default new AdminUserService();
