import { Router } from 'express';
import User from '../models/User.js';

import {
  getDashboard,
} from '../controllers/admin/adminDashboardController.js';

import {
  searchUsers,
  getUser,
  updateUserRole,
  banUser,
  resetBandwidth,
} from '../controllers/admin/adminUserController.js';

import {
  getAllServers,
  addServer,
  toggleServerSales,
  rebootServer,
} from '../controllers/admin/adminServerController.js';

import {
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
} from '../controllers/admin/adminPlanController.js';

import {
  getDailySales,
  getMonthlySales,
  getDiscountCodes,
  getRevenueProjection,
} from '../controllers/admin/adminFinanceController.js';

import {
  getBroadcastTargets,
  sendBroadcast,
} from '../controllers/admin/adminBotController.js';

import {
  getLoadScalingActions,
} from '../controllers/admin/adminBandwidthController.js';

import {
  getAuditLogs,
} from '../controllers/admin/adminLogController.js';

import {
  getRetentionRate,
  getChurnRate,
  getServerPopularity,
} from '../controllers/admin/adminAnalyticsController.js';

import {
  getAllTickets,
  getTicket,
  replyToTicket,
  closeTicket,
  reopenTicket,
} from '../controllers/admin/adminTicketController.js';

const router = Router();

async function requireEnterpriseAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing API key' });
  }

  const adminId = req.headers['x-admin-id'];
  if (!adminId) {
    return res.status(401).json({ error: 'x-admin-id header is required' });
  }

  try {
    const admin = await User.findById(adminId).lean();
    if (!admin || (admin.role !== 'superadmin' && admin.role !== 'support')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.adminId = admin._id;
    req.adminRole = admin.role;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Internal error during authentication' });
  }
}

router.use(requireEnterpriseAuth);

router.get('/dashboard', getDashboard);

router.get('/users/search/:query', searchUsers);
router.get('/users/search', searchUsers);
router.get('/users/:id', getUser);
router.patch('/users/:id/role', updateUserRole);
router.post('/users/:id/ban', banUser);
router.post('/users/:id/reset-bandwidth', resetBandwidth);

router.get('/servers', getAllServers);
router.post('/servers', addServer);
router.patch('/servers/:id/sales', toggleServerSales);
router.post('/servers/:id/reboot', rebootServer);

router.get('/plans', getAllPlans);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.delete('/plans/:id', deletePlan);

router.get('/finance/daily', getDailySales);
router.get('/finance/monthly/:year/:month', getMonthlySales);
router.get('/finance/discounts', getDiscountCodes);
router.get('/finance/projection', getRevenueProjection);

router.get('/bot/broadcast-targets', getBroadcastTargets);
router.post('/bot/broadcast', sendBroadcast);

router.get('/bandwidth/scaling', getLoadScalingActions);

router.get('/logs', getAuditLogs);

router.get('/analytics/retention', getRetentionRate);
router.get('/analytics/churn', getChurnRate);
router.get('/analytics/server-popularity', getServerPopularity);

router.get('/tickets', getAllTickets);
router.get('/tickets/:id', getTicket);
router.post('/tickets/:id/reply', replyToTicket);
router.post('/tickets/:id/close', closeTicket);
router.post('/tickets/:id/reopen', reopenTicket);

export default router;
