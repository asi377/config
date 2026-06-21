import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import BaseService from '../../shared/BaseService.js';
import { AuthError, ValidationError, ForbiddenError } from '../../shared/errors.js';
import AdminRepository from '../../repositories/AdminRepository.js';
import SessionRepository from '../../repositories/SessionRepository.js';
import AuditLogRepository from '../../repositories/AuditLogRepository.js';
import config from '../../config/index.js';

class AdminAuthService extends BaseService {
  constructor() {
    super();
    this.accessTokenExpiry = config.jwt.accessExpiry || '15m';
    this.refreshTokenExpiry = config.jwt.refreshExpiry || '7d';
    this.accessTokenExpiryMs = 15 * 60 * 1000;
    this.refreshTokenExpiryMs = 7 * 24 * 60 * 60 * 1000;
    this.maxFailedAttempts = 5;
    this.lockoutDurationMs = 15 * 60 * 1000;
  }

  login = this.wrapMethod(async ({ email, password, ip, userAgent }) => {
    const admin = await AdminRepository.findByEmailWithPassword(email);
    if (!admin) {
      throw new AuthError('Invalid email or password');
    }

    if (!admin.isActive) {
      throw new ForbiddenError('Account is deactivated. Contact super admin.');
    }

    if (admin.isLocked()) {
      const remaining = Math.ceil((admin.lockedUntil - new Date()) / 1000 / 60);
      throw new ForbiddenError(`Account locked. Try again in ${remaining} minutes.`);
    }

    const valid = await admin.comparePassword(password);
    if (!valid) {
      await this._handleFailedAttempt(admin);
      throw new AuthError('Invalid email or password');
    }

    await AdminRepository.resetFailedAttempts(admin._id);

    if (admin.totpEnabled) {
      const tempToken = this._generateTempToken(admin._id);
      await AdminRepository.updateLastLogin(admin._id, ip);
      await this._logAudit(admin._id, 'login_2fa_required', { ip, userAgent });
      return {
        requires2fa: true,
        tempToken,
        admin: { _id: admin._id, email: admin.email, displayName: admin.displayName, role: admin.role },
      };
    }

    return this._issueTokens(admin, ip, userAgent);
  });

  verify2fa = this.wrapMethod(async ({ tempToken, totpCode, ip, userAgent }) => {
    const payload = this._verifyTempToken(tempToken);
    const admin = await AdminRepository.findById(payload.adminId);
    if (!admin || !admin.isActive) throw new AuthError('Invalid session');

    const verified = speakeasy.totp.verify({
      secret: admin.totpSecret,
      encoding: 'base32',
      token: totpCode,
      window: 2,
    });

    if (!verified) throw new ValidationError('Invalid 2FA code');

    return this._issueTokens(admin, ip, userAgent);
  });

  refreshToken = this.wrapMethod(async ({ refreshToken, ip, userAgent }) => {
    if (!refreshToken) throw new AuthError('Refresh token required');

    const session = await SessionRepository.findByRefreshToken(refreshToken);
    if (!session) {
      throw new AuthError('Invalid or expired refresh token');
    }

    if (session.refreshExpiresAt < new Date()) {
      await SessionRepository.revokeSession(session.tokenId);
      throw new AuthError('Refresh token expired. Please login again.');
    }

    const admin = await AdminRepository.findActiveById(session.adminId);
    if (!admin) {
      await SessionRepository.revokeSession(session.tokenId);
      throw new AuthError('Admin account not found or inactive');
    }

    await SessionRepository.revokeSession(session.tokenId);

    return this._issueTokens(admin, ip, userAgent);
  });

  logout = this.wrapMethod(async ({ adminId, tokenId, refreshToken, allDevices = false }) => {
    if (allDevices) {
      await SessionRepository.revokeAllAdminSessions(adminId, tokenId);
      await this._logAudit(adminId, 'logout_all_devices', {});
    } else if (tokenId) {
      await SessionRepository.revokeSession(tokenId);
      await this._logAudit(adminId, 'logout', {});
    } else if (refreshToken) {
      const session = await SessionRepository.findByRefreshToken(refreshToken);
      if (session) {
        await SessionRepository.revokeSession(session.tokenId);
        await this._logAudit(adminId, 'logout', {});
      }
    }
    return { success: true };
  });

  getProfile = this.wrapMethod(async (adminId) => {
    const admin = await AdminRepository.findById(adminId);
    if (!admin) throw new AuthError('Admin not found');
    const activeSessions = await SessionRepository.countActiveSessions(adminId);
    return { ...admin.toJSON(), activeSessions };
  });

  listSessions = this.wrapMethod(async (adminId) => {
    return SessionRepository.findMany(
      { adminId, isRevoked: false },
      { sort: { createdAt: -1 } }
    );
  });

  revokeSession = this.wrapMethod(async (adminId, sessionTokenId) => {
    const session = await SessionRepository.findByTokenId(sessionTokenId);
    if (!session) throw new AuthError('Session not found');
    if (session.adminId.toString() !== adminId.toString()) {
      throw new ForbiddenError('Cannot revoke another admin\'s session');
    }
    await SessionRepository.revokeSession(sessionTokenId, adminId);
    await this._logAudit(adminId, 'revoke_session', { sessionTokenId });
    return { success: true };
  });

  setup2fa = this.wrapMethod(async (adminId) => {
    const secret = speakeasy.generateSecret({
      name: `HORNET:${adminId}`,
      length: 20,
    });
    await AdminRepository.updateById(adminId, { $set: { totpSecret: secret.base32 } });
    return {
      secret: secret.base32,
      otpauth_url: secret.otpauth_url,
    };
  });

  enable2fa = this.wrapMethod(async (adminId, totpCode) => {
    const admin = await AdminRepository.findById(adminId);
    if (!admin || !admin.totpSecret) throw new ValidationError('Generate 2FA secret first');

    const verified = speakeasy.totp.verify({
      secret: admin.totpSecret,
      encoding: 'base32',
      token: totpCode,
      window: 2,
    });

    if (!verified) throw new ValidationError('Invalid 2FA code');

    await AdminRepository.updateById(adminId, { $set: { totpEnabled: true } });
    await this._logAudit(adminId, '2fa_enabled', {});
    return { success: true, message: '2FA enabled successfully' };
  });

  disable2fa = this.wrapMethod(async (adminId, password) => {
    const admin = await AdminRepository.findByEmailWithPassword(
      (await AdminRepository.findById(adminId)).email
    );
    const valid = await admin.comparePassword(password);
    if (!valid) throw new AuthError('Invalid password');

    await AdminRepository.updateById(adminId, {
      $set: { totpEnabled: false, totpSecret: null },
    });
    await this._logAudit(adminId, '2fa_disabled', {});
    return { success: true, message: '2FA disabled' };
  });

  changePassword = this.wrapMethod(async (adminId, currentPassword, newPassword) => {
    const admin = await AdminRepository.findByEmailWithPassword(
      (await AdminRepository.findById(adminId)).email
    );
    const valid = await admin.comparePassword(currentPassword);
    if (!valid) throw new AuthError('Current password is incorrect');

    if (newPassword.length < 8) throw new ValidationError('New password must be at least 8 characters');

    admin.password = newPassword;
    await admin.save();
    await SessionRepository.revokeAllAdminSessions(adminId);
    await this._logAudit(adminId, 'password_changed', {});
    return { success: true };
  });

  async _issueTokens(admin, ip, userAgent) {
    const tokenId = crypto.randomUUID();
    const refreshToken = crypto.randomBytes(48).toString('hex');

    const accessToken = jwt.sign(
      { sub: admin._id, role: admin.role, jti: tokenId },
      config.jwt.secret,
      { expiresIn: this.accessTokenExpiry }
    );

    const permissions = admin.permissions && admin.permissions.length > 0
      ? admin.permissions
      : (await import('../../utils/permissions.js')).getPermissionsForRole(admin.role);

    await SessionRepository.createSession(
      admin._id,
      tokenId,
      refreshToken,
      { ip: ip || '', userAgent: userAgent || '', platform: '' },
      this.accessTokenExpiryMs,
      this.refreshTokenExpiryMs
    );

    await AdminRepository.updateLastLogin(admin._id, ip);

    await this._logAudit(admin._id, 'login_success', { ip, userAgent });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTokenExpiryMs,
      admin: {
        _id: admin._id,
        email: admin.email,
        displayName: admin.displayName,
        role: admin.role,
        permissions,
      },
    };
  }

  _generateTempToken(adminId) {
    return jwt.sign(
      { adminId, purpose: '2fa_verification' },
      config.jwt.secret,
      { expiresIn: '5m' }
    );
  }

  _verifyTempToken(token) {
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      if (payload.purpose !== '2fa_verification') throw new Error();
      return payload;
    } catch {
      throw new AuthError('Invalid or expired 2FA token');
    }
  }

  async _handleFailedAttempt(admin) {
    const attempts = admin.failedLoginAttempts + 1;
    if (attempts >= this.maxFailedAttempts) {
      await AdminRepository.lockAccount(admin._id, this.lockoutDurationMs);
      await this._logAudit(admin._id, 'account_locked', {
        reason: `${attempts} failed login attempts`,
      });
    } else {
      await AdminRepository.incrementFailedAttempts(admin._id);
    }
  }

  async _logAudit(adminId, action, metadata = {}) {
    try {
      await AuditLogRepository.create({
        adminId,
        action: `auth.${action}`,
        targetType: 'Admin',
        targetId: adminId,
        newValue: metadata,
      });
    } catch (err) {
      this.logger.warn({ err }, 'Failed to write audit log for auth action');
    }
  }
}

export default new AdminAuthService();
