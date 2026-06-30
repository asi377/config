import { Router } from 'express';
import AdminAuthService from '../services/admin/AdminAuthService.js';
import { jwtAuth } from '../middlewares/jwtAuth.js';
import { requirePermission } from '../middlewares/rbac.js';
import AuditLogRepository from '../repositories/AuditLogRepository.js';
import { createRateLimiter } from '../middlewares/index.js';

const loginLimiter = createRateLimiter({ windowMs: 60000, max: 10 });

const router = Router();

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.ip
    || req.socket?.remoteAddress
    || '';
}

function getUserAgent(req) {
  return req.headers['user-agent'] || '';
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    const result = await AdminAuthService.login({
      email,
      password,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/verify-2fa', async (req, res, next) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ success: false, error: 'tempToken and code are required' });
    }
    const result = await AdminAuthService.verify2fa({
      tempToken,
      totpCode: code,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'refreshToken is required' });
    }
    const result = await AdminAuthService.refreshToken({
      refreshToken,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
    });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/logout', jwtAuth, async (req, res, next) => {
  try {
    const { refreshToken, allDevices } = req.body;
    await AdminAuthService.logout({
      adminId: req.adminId,
      tokenId: req.tokenId,
      refreshToken,
      allDevices,
    });
    res.json({ success: true, data: { message: 'Logged out successfully' } });
  } catch (err) { next(err); }
});

router.get('/me', jwtAuth, async (req, res, next) => {
  try {
    const profile = await AdminAuthService.getProfile(req.adminId);
    res.json({ success: true, data: profile });
  } catch (err) { next(err); }
});

router.get('/sessions', jwtAuth, async (req, res, next) => {
  try {
    const sessions = await AdminAuthService.listSessions(req.adminId);
    res.json({ success: true, data: sessions });
  } catch (err) { next(err); }
});

router.delete('/sessions/:tokenId', jwtAuth, async (req, res, next) => {
  try {
    await AdminAuthService.revokeSession(req.adminId, req.params.tokenId);
    res.json({ success: true, data: { message: 'Session revoked' } });
  } catch (err) { next(err); }
});

router.post('/2fa/setup', jwtAuth, async (req, res, next) => {
  try {
    const result = await AdminAuthService.setup2fa(req.adminId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/2fa/enable', jwtAuth, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: '2FA code is required' });
    const result = await AdminAuthService.enable2fa(req.adminId, code);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/2fa/disable', jwtAuth, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, error: 'Password is required' });
    const result = await AdminAuthService.disable2fa(req.adminId, password);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/change-password', jwtAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
    }
    const result = await AdminAuthService.changePassword(req.adminId, currentPassword, newPassword);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// Admin management (superadmin only)
import AdminRepository from '../repositories/AdminRepository.js';

router.get('/admins', jwtAuth, requirePermission('admin.read'), async (req, res, next) => {
  try {
    const admins = await AdminRepository.findActiveAdmins();
    res.json({ success: true, data: admins });
  } catch (err) { next(err); }
});

router.post('/admins', jwtAuth, requirePermission('admin.write'), async (req, res, next) => {
  try {
    const { email, password, displayName, role } = req.body;
    if (!email || !password || !displayName) {
      return res.status(400).json({ success: false, error: 'email, password, and displayName are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    const existing = await AdminRepository.findByEmail(email);
    if (existing) return res.status(409).json({ success: false, error: 'Email already exists' });

    const admin = await AdminRepository.create({
      email,
      password,
      displayName,
      role: role || 'admin',
      createdBy: req.adminId,
    });
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'admin.create', targetType: 'Admin', targetId: admin._id,
      newValue: { email, role: role || 'admin' },
    });
    res.status(201).json({ success: true, data: admin });
  } catch (err) { next(err); }
});

router.patch('/admins/:id', jwtAuth, requirePermission('admin.write'), async (req, res, next) => {
  try {
    const { displayName, role, isActive } = req.body;
    const updates = {};
    if (displayName) updates.displayName = displayName;
    if (role) updates.role = role;
    if (isActive !== undefined) updates.isActive = isActive;

    const admin = await AdminRepository.updateById(req.params.id, { $set: updates });
    if (!admin) return res.status(404).json({ success: false, error: 'Admin not found' });

    await AuditLogRepository.create({
      adminId: req.adminId, action: 'admin.update', targetType: 'Admin', targetId: admin._id,
      newValue: updates, oldValue: { role: admin.role },
    });
    res.json({ success: true, data: admin });
  } catch (err) { next(err); }
});

router.delete('/admins/:id', jwtAuth, requirePermission('admin.delete'), async (req, res, next) => {
  try {
    if (req.params.id === req.adminId.toString()) {
      return res.status(400).json({ success: false, error: 'Cannot delete yourself' });
    }
    const admin = await AdminRepository.updateById(req.params.id, { $set: { isActive: false } });
    if (!admin) return res.status(404).json({ success: false, error: 'Admin not found' });
    await AuditLogRepository.create({
      adminId: req.adminId, action: 'admin.deactivate', targetType: 'Admin', targetId: admin._id,
    });
    res.json({ success: true, data: { message: 'Admin deactivated' } });
  } catch (err) { next(err); }
});

export default router;
