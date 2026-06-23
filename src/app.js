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

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(requestLogger);
  app.use(correlationMiddleware);
  app.use(tracingMiddleware);

  // Rate limiter on all /api routes
  app.use('/api', createRateLimiter({ windowMs: 60000, max: 200 }));

  // Prometheus metrics
  app.get('/metrics', metricsEndpoint);

  // API docs
  docsRoutes(app);

  // Main routes
  app.use(routes);

  // Attach WebSocket to HTTP server
  if (httpServer) {
    DashboardSocket.attach(httpServer);
  }

  app.use(errorHandler);

  return app;
}

export async function initializeDeps() {
  await mongoose.connect(config.mongoUri);
  logger.info('[app] Connected to MongoDB');

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
  }
  logger.info('[app] Job systems initialized');
}
