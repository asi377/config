import BaseService from '../shared/BaseService.js';
import UserRepository from '../repositories/UserRepository.js';

class UserService extends BaseService {
  resolveUser = this.wrapMethod(async (telegramId, referralCode) => {
    let isNew = false;
    let user = await UserRepository.findByTelegramId(telegramId);

    if (!user) {
      isNew = true;
      user = await UserRepository.create({ telegramId });
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
