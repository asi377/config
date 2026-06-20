import adminUserService from '../../services/admin/adminUserService.js';
import adminLogService from '../../services/admin/adminLogService.js';
import { NotFoundError } from '../../utils/errors.js';

export async function searchUsers(req, res) {
  try {
    const query = req.params.query || req.query.q || '';
    const users = await adminUserService.searchUsers(query);
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getUser(req, res) {
  try {
    const user = await adminUserService.getUserById(req.params.id);
    res.json({ success: true, data: user });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function updateUserRole(req, res) {
  try {
    const { role } = req.body;
    if (!role) return res.status(400).json({ success: false, error: 'role is required' });
    const user = await adminUserService.updateUserRole(req.params.id, role);
    await adminLogService.log(req.adminId, 'update_user_role', 'user', req.params.id, null, { role }, req.ip);
    res.json({ success: true, data: user });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function banUser(req, res) {
  try {
    const user = await adminUserService.banUser(req.params.id);
    await adminLogService.log(req.adminId, 'ban_user', 'user', req.params.id, null, { status: 'banned' }, req.ip);
    res.json({ success: true, data: user });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function resetBandwidth(req, res) {
  try {
    const result = await adminUserService.resetUserBandwidth(req.params.id);
    await adminLogService.log(req.adminId, 'reset_bandwidth', 'user', req.params.id, null, result, req.ip);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
