import { Router } from 'express';
import config from '../config/index.js';
import healthRoutes from './healthRoutes.js';
import adminRoutes from './adminRoutes.js';
import internalApiRoutes from './internalApiRoutes.js';
import webhookRoutes from './webhookRoutes.js';
import adminPageRoutes from './adminPageRoutes.js';
import authRoutes from './authRoutes.js';
import nodeRoutes from './nodeRoutes.js';
import subscriptionRoutes from './subscriptionRoutes.js';
import InternalSubscriptionController from '../controllers/InternalSubscriptionController.js';

const router = Router();

// Cloudflare Worker access to raw subscription data — accepts X-API-Key or X-Sub-Secret
function internalSubAuth(req, res, next) {
  if (req.headers['x-api-key'] === config.adminApiKey) return next();
  if (req.headers['x-sub-secret'] && req.headers['x-sub-secret'] === config.internalSubSecret) return next();
  return res.status(401).json({ error: 'UNAUTHORIZED' });
}

router.get('/internal/sub/:token', internalSubAuth, (req, res, next) => {
  InternalSubscriptionController.getRawSubscription(req, res, next);
});

router.use('/health', healthRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/admin', internalApiRoutes);
router.use('/api/webhook', webhookRoutes);
router.use('/api', nodeRoutes);
router.use('/admin', adminPageRoutes);

// Smart subscription delivery — User-Agent aware (Clash / Sing-box / Base64)
router.use('/sub', subscriptionRoutes);

// Legacy enterprise API — keep for backward compat, add JWT support
router.use('/api/enterprise', adminRoutes);

export default router;
