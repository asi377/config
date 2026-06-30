import BaseService from '../shared/BaseService.js';
import { AuthError, ForbiddenError } from '../shared/errors.js';
import UserRepository from '../repositories/UserRepository.js';

class AuthService extends BaseService {
  verifyAdmin = this.wrapMethod(async (telegramId) => {
    const user = await UserRepository.findByTelegramId(telegramId);
    if (!user || !['support', 'superadmin'].includes(user.role)) {
      throw new ForbiddenError('Access denied. Admin role required.');
    }
    return user;
  });

  verifyApiKey = this.wrapMethod((key) => {
    if (!key || key !== process.env.ADMIN_API_KEY) {
      throw new AuthError('Unauthorized — invalid or missing API key');
    }
  });

  verifySmsSecret = this.wrapMethod((secret) => {
    if (!secret || secret !== process.env.SMS_SECRET) {
      throw new AuthError('Unauthorized');
    }
  });
}

export default new AuthService();
