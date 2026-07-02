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

// Safety net: a stray promise rejection (e.g. a transient Telegram / upstream
// network error) must be logged, not crash-loop the whole backend in Docker.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: reason?.message || reason }, '[server] Unhandled promise rejection (kept alive)');
});
process.on('uncaughtException', (err) => {
  logger.error({ err: err?.message, stack: err?.stack }, '[server] Uncaught exception (kept alive)');
});

/**
 * Launch the Telegram bot without letting a transient Telegram-API failure take
 * down the process. Retries with backoff; each attempt's rejection is caught.
 */
function launchBotWithRetry(bot, attempt = 1) {
  // Apply the command menu + description once (the pre-start "/" menu + the
  // "What can this bot do?" text). Independent of polling; non-fatal on failure.
  if (attempt === 1) {
    import('./bot/applyBotCommands.js')
      .then(({ applyBotCommands }) => applyBotCommands(bot))
      .catch((err) => logger.warn({ err: err?.message }, '[server] applyBotCommands failed'));
  }

  bot.launch()
    .then(() => logger.info('[server] Telegram bot started'))
    .catch((err) => {
      const delay = Math.min(60_000, 5_000 * attempt);
      logger.error(
        { err: err?.message, attempt, retryInMs: delay },
        '[server] Telegram bot launch failed — backend stays up, will retry',
      );
      setTimeout(() => launchBotWithRetry(bot, attempt + 1), delay);
    });
}

async function start() {
  try {
    await initializeDeps();

    const httpServer = http.createServer();
    const app = await createApp(httpServer);
    httpServer.on('request', app);

    // Initialize Telegram bot. launch() performs an initial getMe against
    // api.telegram.org; if that network call fails (e.g. transient upstream
    // outage), its rejection must NOT crash the whole backend. Launch in the
    // background with retry so the HTTP API + agent WebSocket stay up.
    const bot = createBot();
    setBotInstance(bot);
    // Expose the bot to HTTP handlers (webhookRoutes reads req.app.get('bot')).
    // Without this, SMS auto-approve could not deliver the subscription link to
    // the user via Telegram.
    app.set('bot', bot);
    launchBotWithRetry(bot);

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
