import AdminServerService from '../../services/admin/AdminServerService.js';
import AdminLogService from '../../services/admin/AdminLogService.js';

export async function getAllServers(req, res, next) {
  try {
    const servers = await AdminServerService.getAllServers();
    res.json({ success: true, data: servers });
  } catch (err) {
    next(err);
  }
}

export async function addServer(req, res, next) {
  try {
    const { name, ipAddress } = req.body;
    if (!name || !ipAddress) {
      return res.status(400).json({ success: false, error: 'name and ipAddress are required' });
    }
    const server = await AdminServerService.addServer(req.body);
    await AdminLogService.log(req.adminId, 'add_server', 'server', server._id, null, req.body, req.ip);
    res.status(201).json({ success: true, data: server });
  } catch (err) {
    next(err);
  }
}

export async function toggleServerSales(req, res, next) {
  try {
    const server = await AdminServerService.toggleSales(req.params.id, req.body.active !== false);
    await AdminLogService.log(req.adminId, 'toggle_server_sales', 'server', req.params.id, null, { active: req.body.active }, req.ip);
    res.json({ success: true, data: server });
  } catch (err) {
    next(err);
  }
}

export async function rebootServer(req, res, next) {
  try {
    const result = await AdminServerService.rebootServer(req.params.id);
    await AdminLogService.log(req.adminId, 'reboot_server', 'server', req.params.id, null, null, req.ip);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
