import http from 'http';
import 'dotenv/config';
import mongoose from 'mongoose';
import config from './config/index.js';
import logger from './config/logger.js';
import redisClient from './redis/client.js';
import { createBot } from './bot/index.js';
import { setBotInstance } from './bot/botInstance.js';
import JobManager from './jobs/JobManager.js';
import { createApp, initializeDeps } from './app.js';

async function start() {
  try {
    await initializeDeps();

    const httpServer = http.createServer();
    const app = await createApp(httpServer);
    httpServer.on('request', app);

    // Initialize Telegram bot
    const bot = createBot();
    setBotInstance(bot);
    bot.launch();
    logger.info('[server] Telegram bot started');

    // Register cron jobs (expiry checks, billing, notifications)
    JobManager.start(bot);

    httpServer.listen(config.port, () => {
      logger.info({ port: config.port }, '[server] Server started');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('[server] Shutting down...');
      JobManager.stop();
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
