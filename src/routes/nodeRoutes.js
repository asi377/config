import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nodeAuth, nodeRegistrationAuth } from '../middlewares/nodeAuth.js';
import { requirePermission } from '../middlewares/rbac.js';
import { jwtAuth } from '../middlewares/jwtAuth.js';
import NodeManagerService from '../services/infra/NodeManagerService.js';
import HealthMonitorService from '../services/infra/HealthMonitorService.js';
import LoadBalancerService from '../services/infra/LoadBalancerService.js';
import ConfigGeneratorService from '../services/infra/ConfigGeneratorService.js';
import ProvisionLog from '../models/ProvisionLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// ==================== NODE AGENT ENDPOINTS (token-authenticated) ====================

router.get('/node-agent/bootstrap.sh', (_req, res) => {
  res.type('text/x-shellscript');
  res.sendFile(path.join(__dirname, '../../infra/bootstrap.sh'));
});

router.post('/nodes/register', nodeRegistrationAuth, async (req, res, next) => {
  try {
    const result = await NodeManagerService.registerNode({
      ...req.body,
      isBootstrapRegistration: req.isBootstrapRegistration,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/nodes/heartbeat', nodeAuth, async (req, res, next) => {
  try {
    const result = await NodeManagerService.processHeartbeat(req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/nodes/shutdown', nodeAuth, async (req, res, next) => {
  try {
    const result = await NodeManagerService.handleShutdown(req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/nodes/sync-users', nodeAuth, async (req, res, next) => {
  try {
    const result = await NodeManagerService.syncUsers(req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/nodes/command-result', nodeAuth, async (req, res, next) => {
  try {
    const result = await NodeManagerService.reportCommandResult(req.body);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// ==================== ADMIN INFRASTRUCTURE ENDPOINTS (JWT + RBAC) ====================

router.get('/nodes', jwtAuth, requirePermission('servers.read'), async (req, res, next) => {
  try {
    const summary = await NodeManagerService.getInfraSummary();
    res.json({ success: true, data: summary });
  } catch (err) { next(err); }
});

router.post('/nodes/servers', jwtAuth, requirePermission('servers.write'), async (req, res, next) => {
  try {
    const server = await NodeManagerService.addServer(req.body);
    const bootstrap = NodeManagerService._generateBootstrapCommand(server);
    res.status(201).json({ success: true, data: { server, bootstrap } });
  } catch (err) { next(err); }
});

router.get('/nodes/servers/:id', jwtAuth, requirePermission('servers.read'), async (req, res, next) => {
  try {
    const status = await NodeManagerService.getServerStatus(req.params.id);
    res.json({ success: true, data: status });
  } catch (err) { next(err); }
});

router.delete('/nodes/servers/:id', jwtAuth, requirePermission('servers.delete'), async (req, res, next) => {
  try {
    const result = await NodeManagerService.removeServer(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/nodes/servers/:id/migrate', jwtAuth, requirePermission('servers.manage'), async (req, res, next) => {
  try {
    const { targetServerId } = req.body;
    const result = await LoadBalancerService.migrateUsers(req.params.id, targetServerId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.get('/nodes/health', jwtAuth, requirePermission('servers.read'), async (req, res, next) => {
  try {
    const dashboard = await HealthMonitorService.getDashboard();
    res.json({ success: true, data: dashboard });
  } catch (err) { next(err); }
});

router.post('/nodes/health/check-all', jwtAuth, requirePermission('servers.manage'), async (req, res, next) => {
  try {
    const results = await HealthMonitorService.checkAllServers();
    res.json({ success: true, data: results });
  } catch (err) { next(err); }
});

router.get('/nodes/health/:serverId', jwtAuth, requirePermission('servers.read'), async (req, res, next) => {
  try {
    const history = await HealthMonitorService.getServerHealthHistory(req.params.serverId);
    const metrics = await HealthMonitorService.getMetrics(req.params.serverId);
    res.json({ success: true, data: { history, metrics } });
  } catch (err) { next(err); }
});

router.get('/nodes/load-balancer', jwtAuth, requirePermission('servers.read'), async (req, res, next) => {
  try {
    const [distribution, scaling] = await Promise.all([
      LoadBalancerService.getServerDistribution(),
      LoadBalancerService.getInfraScalingRecommendation(),
    ]);
    res.json({ success: true, data: { distribution, scaling } });
  } catch (err) { next(err); }
});

router.get('/nodes/configs/generate', jwtAuth, requirePermission('configs.write'), async (req, res, next) => {
  try {
    const Server = (await import('../models/Server.js')).default;
    const server = await Server.findById(req.query.serverId);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });

    const uuid = ConfigGeneratorService.generateUUID();
    const port = parseInt(req.query.port) || server.port;
    const protocol = req.query.protocol || 'vmess';

    let config;
    switch (protocol) {
      case 'vless':
        config = ConfigGeneratorService.generateVLESSConfig({ uuid, server, port });
        break;
      case 'trojan':
        config = ConfigGeneratorService.generateTrojanConfig({ uuid, server, port });
        break;
      default:
        config = ConfigGeneratorService.generateVMessConfig({ uuid, server, port });
    }

    res.json({ success: true, data: { uuid, ...config, qrCode: ConfigGeneratorService.generateQRCode(config.shareLink) } });
  } catch (err) { next(err); }
});

router.get('/nodes/provision-logs', jwtAuth, requirePermission('audit.read'), async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.serverId) filter.serverId = req.query.serverId;
    if (req.query.action) filter.action = req.query.action;
    const logs = await ProvisionLog.find(filter).sort({ createdAt: -1 }).limit(100).populate('serverId', 'name').lean();
    res.json({ success: true, data: logs });
  } catch (err) { next(err); }
});

export default router;
