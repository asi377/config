import BaseRepository from './BaseRepository.js';
import { Admin } from '../models/index.js';

class AdminRepository extends BaseRepository {
  constructor() {
    super(Admin);
  }

  async findByEmail(email) {
    return this.findOne({ email: email.toLowerCase() });
  }

  async findByEmailWithPassword(email) {
    return this.model.findOne({ email: email.toLowerCase() });
  }

  async findActiveById(id) {
    return this.findOne({ _id: id, isActive: true });
  }

  async findActiveAdmins() {
    return this.findMany({ isActive: true });
  }

  async incrementFailedAttempts(adminId) {
    return this.model.findByIdAndUpdate(adminId, {
      $inc: { failedLoginAttempts: 1 },
    });
  }

  async lockAccount(adminId, lockDurationMs = 15 * 60 * 1000) {
    return this.model.findByIdAndUpdate(adminId, {
      $set: { lockedUntil: new Date(Date.now() + lockDurationMs) },
      $inc: { failedLoginAttempts: 1 },
    });
  }

  async unlockAccount(adminId) {
    return this.model.findByIdAndUpdate(adminId, {
      $set: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  async resetFailedAttempts(adminId) {
    return this.model.findByIdAndUpdate(adminId, {
      $set: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  async updateLastLogin(adminId, ip) {
    return this.model.findByIdAndUpdate(adminId, {
      $set: { lastLoginAt: new Date(), lastLoginIp: ip },
    });
  }

  async countByRole(role) {
    return this.count({ role, isActive: true });
  }
}

export default new AdminRepository();
