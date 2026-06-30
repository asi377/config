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
// API-key-only internal endpoints (metrics/servers/users/suspend) — separate
// namespace from the JWT-secured admin panel API to avoid path collisions.
router.use('/api/admin-internal', internalApiRoutes);
router.use('/api/webhook', webhookRoutes);
router.use('/api', nodeRoutes);
router.use('/admin', adminPageRoutes);

// Smart subscription delivery — User-Agent aware (Clash / Sing-box / Base64)
router.use('/sub', subscriptionRoutes);

// Admin panel API (JWT-secured). Mounted at both /api/admin (primary, used
// by most admin-panel pages) and /api/enterprise (legacy alias, still used
// by a few pages) — same router instance, no behavior difference.
router.use('/api/admin', adminRoutes);
router.use('/api/enterprise', adminRoutes);

export default router;
