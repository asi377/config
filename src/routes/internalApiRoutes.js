import { Router } from 'express';
import { apiKeyAuth } from '../middlewares/auth.js';
import AdminService from '../services/admin/AdminService.js';

const router = Router();

router.use(apiKeyAuth);

router.get('/metrics', async (req, res, next) => {
  try {
    const metrics = await AdminService.getGlobalMetrics();
    res.json({ success: true, data: metrics });
  } catch (err) {
    next(err);
  }
});

router.get('/servers', async (req, res, next) => {
  try {
    const servers = await AdminService.getServerHealth();
    res.json({ success: true, data: servers });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:identifier', async (req, res, next) => {
  try {
    const user = await AdminService.getDeepUserSearch(req.params.identifier);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});

router.post('/suspend', async (req, res, next) => {
  try {
    const { subscriptionId, suspended } = req.body;
    if (!subscriptionId) return res.status(400).json({ success: false, error: 'subscriptionId is required' });
    const sub = await AdminService.toggleSuspend(subscriptionId, suspended !== false);
    res.json({ success: true, data: { _id: sub._id, status: sub.status } });
  } catch (err) {
    next(err);
  }
});

export default router;
