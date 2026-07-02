import BaseService from '../shared/BaseService.js';
import UserRepository from '../repositories/UserRepository.js';

class UserService extends BaseService {
  resolveUser = this.wrapMethod(async (telegramId, referralCode, profile = null) => {
    let isNew = false;
    let user = await UserRepository.findByTelegramId(telegramId);

    if (!user) {
      isNew = true;
      user = await UserRepository.create({ telegramId });
    }

    // Keep the human name/username fresh from Telegram (for the admin panel).
    if (profile) {
      const first = profile.first_name || '';
      const last = profile.last_name || '';
      const uname = profile.username || '';
      if (user.firstName !== first || user.lastName !== last || user.username !== uname) {
        user.firstName = first;
        user.lastName = last;
        user.username = uname;
        await user.save();
      }
    }

    if (isNew && referralCode && !user.referredBy) {
      const referrer = await UserRepository.findByReferralCode(referralCode);
      if (referrer && !referrer._id.equals(user._id)) {
        user.referredBy = referrer._id;
        await user.save();
      }
    }

    return user;
  });

  getProfile = this.wrapMethod(async (telegramId) => {
    const user = await UserRepository.findByTelegramId(telegramId);
    if (!user) throw new Error('User not found');
    return user;
  });
}

export default new UserService();
