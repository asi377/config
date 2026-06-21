import AdminUserService from '../../services/admin/AdminUserService.js';
import AdminLogService from '../../services/admin/AdminLogService.js';

export async function searchUsers(req, res, next) {
  try {
    const query = req.params.query || req.query.q || '';
    const users = await AdminUserService.searchUsers(query);
    res.json({ success: true, data: users });
  } catch (err) {
    next(err);
  }
}

export async function getUser(req, res, next) {
  try {
    const user = await AdminUserService.getUserById(req.params.id);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function updateUserRole(req, res, next) {
  try {
    const { role } = req.body;
    if (!role) return res.status(400).json({ success: false, error: 'role is required' });
    const user = await AdminUserService.updateUserRole(req.params.id, role);
    await AdminLogService.log(req.adminId, 'update_user_role', 'user', req.params.id, null, { role }, req.ip);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function banUser(req, res, next) {
  try {
    const user = await AdminUserService.banUser(req.params.id);
    await AdminLogService.log(req.adminId, 'ban_user', 'user', req.params.id, null, { status: 'banned' }, req.ip);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function resetBandwidth(req, res, next) {
  try {
    const result = await AdminUserService.resetUserBandwidth(req.params.id);
    await AdminLogService.log(req.adminId, 'reset_bandwidth', 'user', req.params.id, null, result, req.ip);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
