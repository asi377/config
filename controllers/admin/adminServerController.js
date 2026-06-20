import adminServerService from '../../services/admin/adminServerService.js';
import adminLogService from '../../services/admin/adminLogService.js';
import { NotFoundError } from '../../utils/errors.js';

export async function getAllServers(req, res) {
  try {
    const servers = await adminServerService.getAllServers();
    res.json({ success: true, data: servers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function addServer(req, res) {
  try {
    const { name, ipAddress, port, xrayApiPort, maxCapacity } = req.body;
    if (!name || !ipAddress) {
      return res.status(400).json({ success: false, error: 'name and ipAddress are required' });
    }
    const server = await adminServerService.addServer(req.body);
    await adminLogService.log(req.adminId, 'add_server', 'server', server._id, null, req.body, req.ip);
    res.status(201).json({ success: true, data: server });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function toggleServerSales(req, res) {
  try {
    const server = await adminServerService.toggleSales(req.params.id, req.body.active !== false);
    await adminLogService.log(req.adminId, 'toggle_server_sales', 'server', req.params.id, null, { active: req.body.active }, req.ip);
    res.json({ success: true, data: server });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function rebootServer(req, res) {
  try {
    const result = await adminServerService.rebootServer(req.params.id);
    await adminLogService.log(req.adminId, 'reboot_server', 'server', req.params.id, null, null, req.ip);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof NotFoundError) return res.status(404).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
}
