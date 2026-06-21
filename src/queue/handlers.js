import logger from '../config/logger.js';
import JobQueue from './JobQueue.js';
import NodeManagerService from '../services/infra/NodeManagerService.js';
import subscriptionService from '../services/SubscriptionService.js';
import webhookService from '../services/WebhookService.js';
import ConfigGeneratorService from '../services/infra/ConfigGeneratorService.js';
import ServerRepository from '../repositories/ServerRepository.js';
import UserRepository from '../repositories/UserRepository.js';

export function registerJobHandlers() {
  JobQueue.register('provision:user', provisionUserHandler, { concurrency: 2 });
  JobQueue.register('provision:config', provisionConfigHandler, { concurrency: 3 });
  JobQueue.register('sync:node', syncNodeHandler, { concurrency: 2 });
  JobQueue.register('notify:webhook', notifyWebhookHandler, { concurrency: 5 });
  JobQueue.register('backup:database', backupDatabaseHandler, { concurrency: 1 });
  JobQueue.register('cleanup:metrics', cleanupMetricsHandler, { concurrency: 1 });
  JobQueue.register('migrate:server', migrateServerHandler, { concurrency: 1 });
  JobQueue.register('email:send', emailSendHandler, { concurrency: 2 });
  logger.info('[queue] All job handlers registered');
}

async function provisionUserHandler(payload) {
  const { userId, planId } = payload;
  const user = await UserRepository.findById(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const sub = await subscriptionService.createSubscription(userId, planId);
  logger.info({ userId, planId, subId: sub._id }, '[queue] User provisioned');
  return { subscriptionId: sub._id };
}

async function provisionConfigHandler(payload) {
  const { subscriptionId, serverId, uuid } = payload;
  const server = await ServerRepository.findById(serverId);
  if (!server) throw new Error(`Server ${serverId} not found`);

  const config = ConfigGeneratorService.generateVMessConfig({
    uuid,
    server: server.toJSON(),
    port: server.port,
  });
  logger.info({ subscriptionId, serverId }, '[queue] Config provisioned');
  return config;
}

async function syncNodeHandler(payload) {
  const { serverId } = payload;
  const result = await NodeManagerService.syncUsers({ serverId, users: payload.users || [] });
  logger.info({ serverId, toCreate: result.toCreate?.length, toRemove: result.toRemove?.length }, '[queue] Node synced');
  return result;
}

async function notifyWebhookHandler(payload) {
  const { event, data } = payload;
  await webhookService.sendEvent(event, data);
  logger.debug({ event }, '[queue] Webhook sent');
  return { event };
}

async function backupDatabaseHandler(payload) {
  const { encryptKey } = payload;
  const { default: AdminService } = await import('../services/admin/AdminService.js');
  const path = await AdminService.generateDatabaseBackup(encryptKey);
  logger.info({ path }, '[queue] Database backup completed');
  return { path };
}

async function cleanupMetricsHandler() {
  const { default: ServerMetrics } = await import('../models/ServerMetrics.js');
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const res = await ServerMetrics.deleteMany({ createdAt: { $lt: cutoff } });
  logger.info({ deleted: res.deletedCount }, '[queue] Old metrics cleaned');
  return { deleted: res.deletedCount };
}

async function migrateServerHandler(payload) {
  const { fromServerId, toServerId, subscriptionIds } = payload;
  const { default: SubscriptionRepository } = await import('../repositories/SubscriptionRepository.js');
  const result = await SubscriptionRepository.updateMany(
    { _id: { $in: subscriptionIds } },
    { $set: { serverId: toServerId } },
  );
  logger.info({ fromServerId, toServerId, count: result.modifiedCount }, '[queue] Server migration completed');
  return { migrated: result.modifiedCount };
}

async function emailSendHandler(payload) {
  const { to, subject, html } = payload;
  const config = (await import('../config/index.js')).default;
  if (!config.smtp?.host) {
    logger.warn('[queue] SMTP not configured, skipping email');
    return { skipped: true };
  }
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  await transporter.sendMail({ from: config.smtp.from, to, subject, html });
  logger.info({ to, subject }, '[queue] Email sent');
  return { sent: true };
}
