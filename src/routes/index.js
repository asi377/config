import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import adminRoutes from './adminRoutes.js';
import internalApiRoutes from './internalApiRoutes.js';
import webhookRoutes from './webhookRoutes.js';
import adminPageRoutes from './adminPageRoutes.js';
import authRoutes from './authRoutes.js';
import nodeRoutes from './nodeRoutes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/admin', internalApiRoutes);
router.use('/api/webhook', webhookRoutes);
router.use('/api', nodeRoutes);
router.use('/admin', adminPageRoutes);

// Legacy enterprise API — keep for backward compat, add JWT support
router.use('/api/enterprise', adminRoutes);

export default router;
