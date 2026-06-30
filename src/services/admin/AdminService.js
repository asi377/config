import fs from 'fs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { exec } from 'child_process';
import { promisify } from 'util';
import BaseService from '../../shared/BaseService.js';
import { NotFoundError } from '../../shared/errors.js';
import UserRepository from '../../repositories/UserRepository.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import ServerRepository from '../../repositories/ServerRepository.js';
import SettingRepository from '../../repositories/SettingRepository.js';
import TunnelService from '../TunnelService.js';

const execAsync = promisify(exec);
const GB = 1073741824;

class AdminService extends BaseService {
  getGlobalMetrics = this.wrapMethod(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [userCount, activeSubCount, bandwidthResult, revenueResult] = await Promise.all([
      UserRepository.count(),
      SubscriptionRepository.count({ status: 'active' }),
      SubscriptionRepository.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, totalBytes: { $sum: '$usedVolumeBytes' } } },
      ]),
      SubscriptionRepository.aggregate([
        { $match: { createdAt: { $gte: monthStart }, status: { $ne: 'pending_shared_payment' } } },
        { $lookup: { from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan' } },
        { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
        { $group: { _id: null, totalRevenue: { $sum: '$plan.basePrice' } } },
      ]),
    ]);

    return {
      totalUsers: userCount,
      activeSubscriptions: activeSubCount,
      totalBandwidthGB: Number(((bandwidthResult[0]?.totalBytes ?? 0) / GB).toFixed(2)),
      monthlyRevenue: revenueResult[0]?.totalRevenue ?? 0,
    };
  });

  getServerHealth = this.wrapMethod(async () => ServerRepository.getHealthReport());

  getDeepUserSearch = this.wrapMethod(async (identifier) => {
    const isObjectId = /^[a-f0-9]{24}$/i.test(String(identifier));
    let telegramIdValue = identifier;
    if (!isObjectId && !isNaN(identifier)) {
      telegramIdValue = Number(identifier);
    }

    const matchStage = isObjectId
      ? { _id: new mongoose.Types.ObjectId(identifier) }
      : { telegramId: telegramIdValue };

    const results = await UserRepository.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'subscriptions',
          let: { userId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$ownerId', '$$userId'] } } },
            { $sort: { createdAt: -1 } },
            {
              $lookup: {
                from: 'plans', localField: 'planId', foreignField: '_id', as: 'plan',
              },
            },
            { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'servers', localField: 'serverId', foreignField: '_id', as: 'server',
              },
            },
            { $unwind: { path: '$server', preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: 'tunnelconfigs', localField: '_id', foreignField: 'subscriptionId', as: 'tunnelConfigs',
              },
            },
            { $project: { _id: 1, status: 1, totalVolumeBytes: 1, rolloverVolumeBytes: 1, usedVolumeBytes: 1, startDate: 1, expireDate: 1, createdAt: 1, plan: 1, 'server.name': 1, 'server.ipAddress': 1, 'server.port': 1, tunnelConfigs: { $map: { input: '$tunnelConfigs', as: 'tc', in: { name: '$$tc.name', uuid: '$$tc.uuid', allocatedQuotaBytes: '$$tc.allocatedQuotaBytes', usedQuotaBytes: '$$tc.usedQuotaBytes', isGuestLink: '$$tc.isGuestLink', isActive: '$$tc.isActive' } } } } },
          ],
          as: 'subscriptions',
        },
      },
      { $project: { telegramId: 1, walletBalance: 1, role: 1, joinedAt: 1, subscriptions: 1 } },
    ]);

    if (results.length === 0) throw new NotFoundError('User');
    return results[0];
  });

  toggleSuspend = this.wrapMethod(async (subscriptionId, suspend = true) => {
    const sub = await SubscriptionRepository.updateById(
      subscriptionId,
      { $set: { status: suspend ? 'suspended' : 'active' } },
    );
    if (!sub) throw new NotFoundError('Subscription');
    return sub;
  });

  manualCreateUserAndSubscription = this.wrapMethod(async (telegramId, planId) => {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        let user = await UserRepository.findByTelegramId(telegramId);
        if (!user) user = await UserRepository.create({ telegramId }, { session });

        const { default: Plan } = await import('../../models/Plan.js');
        const plan = await Plan.findById(planId).session(session);
        if (!plan) throw new NotFoundError('Plan');

        const server = await TunnelService.allocateServer();
        const now = new Date();
        const expireDate = new Date(now.getTime() + plan.durationDays * 86400000);

        return SubscriptionRepository.create({
          ownerId: user._id, planId: plan._id, serverId: server._id, status: 'active',
          totalVolumeBytes: plan.baseVolumeGB * GB, rolloverVolumeBytes: 0, usedVolumeBytes: 0,
          startDate: now, expireDate,
        }, { session });
      });
    } finally {
      await session.endSession();
    }
  });

  generateDatabaseBackup = this.wrapMethod(async (encryptKey = null) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = `/tmp/vpn-backup-${timestamp}.archive.gz`;
    const { stderr } = await execAsync(`mongodump --archive="${outPath}" --gzip`);
    if (stderr) this.logger.warn({ stderr }, '[backup] stderr');

    // Encrypt backup with AES-256 if key provided
    if (encryptKey) {
      const encryptedPath = `${outPath}.enc`;
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        crypto.createHash('sha256').update(String(encryptKey)).digest(),
        crypto.randomBytes(16),
      );
      const input = fs.createReadStream(outPath);
      const output = fs.createWriteStream(encryptedPath);
      input.pipe(cipher).pipe(output);
      await new Promise((resolve, reject) => {
        output.on('finish', resolve);
        output.on('error', reject);
      });
      await fs.promises.unlink(outPath);
      return encryptedPath;
    }

    return outPath;
  });

  updateSetting = this.wrapMethod(async (key, value) => SettingRepository.set(key, value));
}

export default new AdminService();
