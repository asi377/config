/**
 * Public subscription delivery route.
 *
 * GET /sub/:uuid
 *
 * This endpoint is intentionally unauthenticated — the UUID acts as an
 * opaque access token.  Rate-limiting is applied to prevent enumeration.
 */

import { Router } from 'express';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import SubscriptionController from '../controllers/SubscriptionController.js';

const router = Router();

// 60 requests per 10 minutes per IP — prevents brute-force UUID enumeration
const subRateLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 60 });

router.get('/:uuid', subRateLimit, (req, res, next) =>
  SubscriptionController.getSubscription(req, res, next),
);

export default router;
