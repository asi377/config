import { Router } from 'express';
import adminService from '../services/AdminService.js';
import { NotFoundError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing API key' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

router.use(apiKeyAuth);

/**
 * GET /api/admin/metrics
 * Global platform metrics (users, subs, bandwidth, revenue).
 */
router.get('/metrics', async (_req, res) => {
  try {
    const metrics = await adminService.getGlobalMetrics();
    res.json({ success: true, data: metrics });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/servers
 * Server health report (load, capacity, status).
 */
router.get('/servers', async (_req, res) => {
  try {
    const servers = await adminService.getServerHealth();
    res.json({ success: true, data: servers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/users/:identifier
 * Deep user search by telegramId or MongoID.
 */
router.get('/users/:identifier', async (req, res) => {
  try {
    const user = await adminService.getDeepUserSearch(req.params.identifier);
    res.json({ success: true, data: user });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/suspend
 * Body: { subscriptionId, suspended: boolean }
 */
router.post('/suspend', async (req, res) => {
  try {
    const { subscriptionId, suspended } = req.body;
    if (!subscriptionId) {
      return res.status(400).json({ success: false, error: 'subscriptionId is required' });
    }
    const sub = await adminService.toggleSuspend(subscriptionId, suspended !== false);
    res.json({ success: true, data: { _id: sub._id, status: sub.status } });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
