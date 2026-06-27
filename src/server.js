import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import 'dotenv/config';
import mongoose from 'mongoose';
import config from './config/index.js';
import logger from './config/logger.js';
import { registerJobHandlers } from './queue/handlers.js';
import redisClient from './redis/client.js';
import BullMQManager from './queue/bullmq.js';
import { createBot } from './bot/index.js';
import router from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { metricsEndpoint } from './monitoring/metrics.js';

const app = express();

// Security & CORS
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Static files for admin panel
app.use(express.static('public'));
app.use('/admin', express.static('public/admin'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Metrics endpoint (protected in production)
app.get('/metrics', metricsEndpoint);

// API routes
app.use(router);

// Admin panel catch-all (for React Router)
app.get('/admin*', (req, res) => {
  res.sendFile(process.cwd() + '/public/admin/index.html');
});

// Error handling
app.use(errorHandler);

async function start() {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongoUri);
    logger.info('[server] MongoDB connected');

    // Connect to Redis
    await redisClient.connect();
    logger.info('[server] Redis connected');

    // Initialize queues
    BullMQManager.createQueue('default');
    BullMQManager.createQueue('telegram-out');
    BullMQManager.createQueue('provisioning');
    BullMQManager.createQueue('billing');
    BullMQManager.createQueue('node-commands');
    registerJobHandlers();
    logger.info('[server] Job queues initialized');

    // Initialize Telegram bot
    const bot = createBot();
    bot.launch();
    logger.info('[server] Telegram bot started');

    // Start server
    app.listen(config.port, () => {
      logger.info({ port: config.port }, '[server] Server started');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('[server] Shutting down...');
      await bot.stop();
      await mongoose.disconnect();
      await redisClient.disconnect();
      process.exit(0);
    });
  } catch (err) {
    logger.error({ err }, '[server] Startup failed');
    process.exit(1);
  }
}

start();
