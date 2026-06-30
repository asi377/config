import logger from '../../config/logger.js';

export async function getAllServers(req, res, next) {
  try {
    const Server = (await import('../../models/Server.js')).default;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const [servers, total] = await Promise.all([
      Server.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Server.countDocuments(),
    ]);

    res.json({ success: true, data: { servers, total, page, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
}

export async function addServer(req, res, next) {
  try {
    const Server = (await import('../../models/Server.js')).default;
    const AuditLogRepository = (await import('../../repositories/AuditLogRepository.js')).default;
    const { name, region, port, maxCapacity, tags } = req.body;

    if (!name || !region) return res.status(400).json({ success: false, error: 'name and region are required' });

    const server = await Server.create({ name, region, port, maxCapacity, tags: tags || [] });

    await AuditLogRepository.create({
      adminId: req.adminId,
      action: 'server.create',
      targetType: 'Server',
      targetId: server._id,
      newValue: { name, region },
    });

    res.status(201).json({ success: true, data: server });
  } catch (err) { next(err); }
}

export async function toggleServerSales(req, res, next) {
  try {
    const Server = (await import('../../models/Server.js')).default;
    const server = await Server.findById(req.params.id);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });

    server.salesEnabled = !server.salesEnabled;
    await server.save();

    res.json({ success: true, data: { salesEnabled: server.salesEnabled } });
  } catch (err) { next(err); }
}

export async function rebootServer(req, res, next) {
  try {
    logger.info({ serverId: req.params.id }, '[admin] Server reboot requested');
    res.json({ success: true, data: { rebootScheduled: true } });
  } catch (err) { next(err); }
}

export async function deletePlan(req, res, next) {
  try {
    const Plan = (await import('../../models/Plan.js')).default;
    const plan = await Plan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'Plan not found' });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
}
