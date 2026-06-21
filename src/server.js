import mongoose from 'mongoose';
import http from 'http';
import config from './config/index.js';
import logger from './config/logger.js';
import { createApp, initializeDeps } from './app.js';
import { createBot } from './bot/index.js';
import JobManager from './jobs/JobManager.js';

async function main() {
  let httpServer = http.createServer();
  await initializeDeps();
  const app = await createApp(httpServer);

  httpServer.on('request', app);

  const bot = createBot();
  app.set('bot', bot);

  httpServer.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'Server listening');
  });

  let botLaunched = false;
  try {
    await bot.launch();
    botLaunched = true;
    logger.info('Telegraf bot running');
    JobManager.start(bot);
  } catch (err) {
    logger.warn({ err: err.message }, 'Bot unavailable — server continues without Telegram');
  }

  const gracefulShutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down gracefully');

    const tasks = [
      new Promise((resolve) => httpServer?.close(() => resolve())),
      mongoose.disconnect(),
      JobManager.stop(),
    ];

    if (botLaunched) tasks.push(bot.stop(signal));

    // Hard timeout
    const timeout = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15000);

    await Promise.allSettled(tasks);
    clearTimeout(timeout);
    logger.info('Goodbye.');
    process.exit(0);
  };

  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
