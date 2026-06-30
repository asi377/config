import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import config from './config/index.js';
import logger from './config/logger.js';
import routes from './routes/index.js';
import { errorHandler, requestLogger, createRateLimiter } from './middlewares/index.js';
import { registerJobHandlers } from './queue/handlers.js';
import JobQueue from './queue/JobQueue.js';
import BullMQManager from './queue/bullmq.js';
import redisClient from './redis/client.js';
import { correlationMiddleware, tracingMiddleware } from './monitoring/tracer.js';
import { metricsEndpoint } from './monitoring/metrics.js';
import certManager from './crypto/CertManager.js';
import paymentGateway from './billing/gateway/index.js';
import { docsRoutes } from './docs/index.js';
import DashboardSocket from './services/DashboardSocket.js';
import wsServer from './services/ws/WSServer.js';
import { startNodeCommandWorker } from './services/ws/NodeCommandBridge.js';

export async function createApp(httpServer) {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ['\'self\''],
        scriptSrc: ['\'self\'', (req, res) => `'nonce-${res.locals.cspNonce}'`],
        scriptSrcAttr: ['\'none\''],
        styleSrc: ['\'self\'', 'https:', (req, res) => `'nonce-${res.locals.cspNonce}'`],
        imgSrc: ['\'self\'', 'data:', 'https:'],
        connectSrc: ['\'self\'', 'http://localhost:*', 'https://*', 'ws:', 'wss:'],
        fontSrc: ['\'self\'', 'https:', 'data:'],
        formAction: ['\'self\''],
        frameAncestors: ['\'none\''],
        baseUri: ['\'self\''],
        objectSrc: ['\'none\''],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    noSniff: true,
    xssFilter: true,
  }));

  // Generate CSP nonce per request
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  app.use(cors({
    origin: config.env === 'production' ? config.corsOrigin : '*',
    credentials: true,
  }));

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());
  app.use(requestLogger);
  app.use(correlationMiddleware);
  app.use(tracingMiddleware);

  // Rate limiter on all /api routes
  app.use('/api', createRateLimiter({ windowMs: 60000, max: 200 }));

  // Static files for admin panel
  app.use(express.static('public'));
  app.use('/admin', express.static('public/admin'));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  // Prometheus metrics
  app.get('/metrics', metricsEndpoint);

  // API docs
  docsRoutes(app);

  // Main routes
  app.use(routes);

  // Admin panel catch-all (for React Router)
  app.get('/admin/*splat', (req, res) => {
    res.sendFile(process.cwd() + '/public/admin/index.html');
  });

  // Attach WebSocket servers to HTTP server
  if (httpServer) {
    DashboardSocket.attach(httpServer);
    wsServer.attach(httpServer);
  }

  app.use(errorHandler);

  return app;
}

export async function initializeDeps() {
  await mongoose.connect(config.mongoUri);
  logger.info('[app] Connected to MongoDB');

  const ResellerPlan = (await import('./models/ResellerPlan.js')).default;
  await ResellerPlan.seedDefaults();

  // Ensure a free-trial plan exists so the bot's "free trial" button always
  // has something to provision (idempotent — only inserts if none exists yet).
  const Plan = (await import('./models/Plan.js')).default;
  const existingTrial = await Plan.findOne({ isTrial: true });
  if (!existingTrial) {
    await Plan.create({
      title: 'طرح آزمایشی رایگان',
      type: 'economy',
      basePrice: 0,
      baseVolumeGB: 1,
      durationDays: 3,
      maxSubLinks: 1,
      isTrial: true,
      salesEnabled: false,
      sortOrder: 0,
      pricing: [{ currency: 'IRR', amount: 0, gateway: 'wallet', enabled: true }],
    });
    logger.info('[app] Seeded default free-trial plan');
  }

  // Seed a few default purchasable plans so "Buy / Renew" is never empty on
  // first run. Idempotent (only runs if no non-trial plans exist yet) and
  // fully editable afterward from the admin panel (Plans CRUD).
  const existingSalesPlan = await Plan.findOne({ isTrial: { $ne: true } });
  if (!existingSalesPlan) {
    await Plan.create([
      {
        title: 'برنزی',
        type: 'economy',
        basePrice: 150000,
        baseVolumeGB: 30,
        durationDays: 30,
        maxSubLinks: 2,
        sortOrder: 10,
        pricing: [{ currency: 'IRR', amount: 150000, gateway: 'wallet', enabled: true }],
      },
      {
        title: 'نقره‌ای',
        type: 'normal',
        basePrice: 350000,
        baseVolumeGB: 80,
        durationDays: 30,
        maxSubLinks: 4,
        sortOrder: 20,
        pricing: [{ currency: 'IRR', amount: 350000, gateway: 'wallet', enabled: true }],
      },
      {
        title: 'طلایی',
        type: 'vip',
        basePrice: 650000,
        baseVolumeGB: 200,
        durationDays: 30,
        maxSubLinks: 8,
        sortOrder: 30,
        pricing: [{ currency: 'IRR', amount: 650000, gateway: 'wallet', enabled: true }],
      },
    ]);
    logger.info('[app] Seeded default purchasable plans (Bronze/Silver/Gold)');
  }

  // Seed the force-subscribe channel list with the default HORNET channel if it
  // hasn't been configured yet. Left DISABLED by default — the admin enables it
  // from the panel once the bot has been added as an admin of the channel
  // (membership checks fail-closed, so enabling without that blocks everyone).
  const SettingModel = (await import('./models/Setting.js')).default;
  const existingChannels = await SettingModel.get('forceSubscribe.channels', null);
  if (existingChannels === null) {
    await SettingModel.set('forceSubscribe.channels', [
      { id: '@hornet_ch', inviteLink: 'https://t.me/hornet_ch', title: 'HORNET Channel' },
    ]);
    await SettingModel.set('forceSubscribe.enabled', false);
    logger.info('[app] Seeded default force-subscribe channel (@hornet_ch, disabled)');
  }

  if (config.redis?.url) {
    try {
      await redisClient.connect();
      logger.info('[app] Redis connected');
    } catch (err) {
      logger.warn({ err }, '[app] Redis unavailable, using in-memory fallback');
    }
  }

  await certManager.initialize();
  logger.info('[app] CA initialized for node mTLS');

  await paymentGateway.initialize();

  registerJobHandlers();
  JobQueue.start(5);
  if (redisClient.connected) {
    BullMQManager.createQueue('default', { attempts: 3 });
    BullMQManager.createQueue('node-commands', { attempts: 5, backoffDelay: 5000 });
    BullMQManager.createQueue('provisioning', { attempts: 3 });
    BullMQManager.createQueue('billing', { attempts: 2 });
    BullMQManager.createQueue('telegram-out', {
      attempts: 3,
      concurrency: 5,
      limiter: { max: 30, duration: 1000 },
    });
    // Recover any jobs stalled from previous crash
    BullMQManager.recoverStalledJobs().catch(err => {
      logger.warn({ err }, '[app] Stall recovery check failed');
    });

    // Start the websocket → agent command bridge worker
    startNodeCommandWorker();
  }
  logger.info('[app] Job systems initialized');
}
