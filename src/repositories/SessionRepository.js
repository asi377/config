import crypto from 'crypto';
import BaseRepository from './BaseRepository.js';
import { Session } from '../models/index.js';

class SessionRepository extends BaseRepository {
  constructor() {
    super(Session);
  }

  async createSession(adminId, tokenId, refreshToken, deviceInfo, accessTokenExpiresMs, refreshTokenExpiresMs) {
    const now = new Date();
    return this.create({
      adminId,
      tokenId,
      refreshTokenHash: this._hashToken(refreshToken),
      deviceInfo,
      expiresAt: new Date(now.getTime() + accessTokenExpiresMs),
      refreshExpiresAt: new Date(now.getTime() + refreshTokenExpiresMs),
    });
  }

  async findByTokenId(tokenId) {
    return this.findOne({ tokenId, isRevoked: false });
  }

  async findByRefreshToken(refreshToken) {
    const hash = this._hashToken(refreshToken);
    return this.findOne({ refreshTokenHash: hash, isRevoked: false });
  }

  async revokeSession(tokenId, revokedBy = null) {
    return this.updateOne(
      { tokenId, isRevoked: false },
      { $set: { isRevoked: true, revokedAt: new Date(), revokedBy } }
    );
  }

  async revokeAllAdminSessions(adminId, exceptTokenId = null) {
    const filter = { adminId, isRevoked: false };
    if (exceptTokenId) filter.tokenId = { $ne: exceptTokenId };
    return this.updateMany(filter, {
      $set: { isRevoked: true, revokedAt: new Date() },
    });
  }

  async countActiveSessions(adminId) {
    return this.count({ adminId, isRevoked: false, expiresAt: { $gt: new Date() } });
  }

  async cleanupExpired() {
    return this.deleteMany({
      $or: [
        { expiresAt: { $lt: new Date() } },
        { refreshExpiresAt: { $lt: new Date() } },
      ],
    });
  }

  _hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

export default new SessionRepository();
