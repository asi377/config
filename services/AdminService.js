import mongoose from 'mongoose';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
    User,
    Subscription,
    Plan,
    TunnelConfig,
    Server,
    Setting,
} from '../models/index.js';
import tunnelService from './TunnelService.js';
import { NotFoundError } from '../utils/errors.js';

const execAsync = promisify(exec);
const GB = 1073741824;

class AdminService {
    async getGlobalMetrics() {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const [userCount, activeSubCount, bandwidthResult, revenueResult] =
            await Promise.all([
                User.countDocuments(),
                Subscription.countDocuments({ status: 'active' }),
                Subscription.aggregate([
                    { $match: { status: 'active' } },
                    {
                        $group: {
                            _id: null,
                            totalBytes: { $sum: '$usedVolumeBytes' },
                        },
                    },
                ]),
                Subscription.aggregate([
                    {
                        $match: {
                            createdAt: { $gte: monthStart },
                            status: { $ne: 'pending_shared_payment' },
                        },
                    },
                    {
                        $lookup: {
                            from: 'plans',
                            localField: 'planId',
                            foreignField: '_id',
                            as: 'plan',
                        },
                    },
                    {
                        $unwind: {
                            path: '$plan',
                            preserveNullAndEmptyArrays: true,
                        },
                    },
                    {
                        $group: {
                            _id: null,
                            totalRevenue: { $sum: '$plan.basePrice' },
                        },
                    },
                ]),
            ]);

        return {
            totalUsers: userCount,
            activeSubscriptions: activeSubCount,
            totalBandwidthGB: Number(
                ((bandwidthResult[0]?.totalBytes ?? 0) / GB).toFixed(2),
            ),
            monthlyRevenue: revenueResult[0]?.totalRevenue ?? 0,
        };
    }

    async getServerHealth() {
        const servers = await Server.find()
            .sort({ currentActiveUsers: -1 })
            .lean();
        return servers.map((s) => ({
            _id: s._id,
            name: s.name,
            ipAddress: s.ipAddress,
            port: s.port,
            xrayApiPort: s.xrayApiPort,
            maxCapacity: s.maxCapacity,
            currentActiveUsers: s.currentActiveUsers,
            remainingCapacity: Math.max(
                0,
                s.maxCapacity - s.currentActiveUsers,
            ),
            loadPercent:
                s.maxCapacity > 0
                    ? Number(
                          (
                              (s.currentActiveUsers / s.maxCapacity) *
                              100
                          ).toFixed(1),
                      )
                    : 100,
            status: s.status,
        }));
    }

    async getDeepUserSearch(identifier) {
        const isObjectId = /^[a-f0-9]{24}$/i.test(String(identifier));

        // بازگردانی اصلاحیه کستینگ اعداد برای جلوگیری از خطای Aggregation
        let telegramIdValue = identifier;
        if (!isObjectId && !isNaN(identifier)) {
            telegramIdValue = Number(identifier);
        }

        const matchStage = isObjectId
            ? { _id: new mongoose.Types.ObjectId(identifier) }
            : { telegramId: telegramIdValue };

        const results = await User.aggregate([
            { $match: matchStage },
            {
                $lookup: {
                    from: 'subscriptions',
                    let: { userId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ['$ownerId', '$$userId'] },
                            },
                        },
                        { $sort: { createdAt: -1 } },
                        {
                            $lookup: {
                                from: 'plans',
                                localField: 'planId',
                                foreignField: '_id',
                                as: 'plan',
                            },
                        },
                        {
                            $unwind: {
                                path: '$plan',
                                preserveNullAndEmptyArrays: true,
                            },
                        },
                        {
                            $lookup: {
                                from: 'servers',
                                localField: 'serverId',
                                foreignField: '_id',
                                as: 'server',
                            },
                        },
                        {
                            $unwind: {
                                path: '$server',
                                preserveNullAndEmptyArrays: true,
                            },
                        },
                        {
                            $lookup: {
                                from: 'tunnelconfigs',
                                localField: '_id',
                                foreignField: 'subscriptionId',
                                as: 'tunnelConfigs',
                            },
                        },
                        {
                            $project: {
                                _id: 1,
                                status: 1,
                                totalVolumeBytes: 1,
                                rolloverVolumeBytes: 1,
                                usedVolumeBytes: 1,
                                startDate: 1,
                                expireDate: 1,
                                createdAt: 1,
                                plan: 1,
                                'server.name': 1,
                                'server.ipAddress': 1,
                                'server.port': 1,
                                tunnelConfigs: {
                                    $map: {
                                        input: '$tunnelConfigs',
                                        as: 'tc',
                                        in: {
                                            name: '$$tc.name',
                                            uuid: '$$tc.uuid',
                                            allocatedQuotaBytes:
                                                '$$tc.allocatedQuotaBytes',
                                            usedQuotaBytes:
                                                '$$tc.usedQuotaBytes',
                                            isGuestLink: '$$tc.isGuestLink',
                                            isActive: '$$tc.isActive',
                                        },
                                    },
                                },
                            },
                        },
                    ],
                    as: 'subscriptions',
                },
            },
            {
                $project: {
                    telegramId: 1,
                    walletBalance: 1,
                    role: 1,
                    joinedAt: 1,
                    subscriptions: 1,
                },
            },
        ]);

        if (results.length === 0) throw new NotFoundError('User');
        return results[0];
    }

    async toggleSuspend(subscriptionId, suspend = true) {
        const sub = await Subscription.findById(subscriptionId);
        if (!sub) throw new NotFoundError('Subscription');
        sub.status = suspend ? 'suspended' : 'active';
        return sub.save();
    }

    // -----------------------------------------------------------------------
    // 1. Force-create a user + subscription (bypasses wallet)
    // -----------------------------------------------------------------------

    async manualCreateUserAndSubscription(telegramId, planId) {
        const session = await mongoose.startSession();

        try {
            const subscription = await session.withTransaction(async () => {
                // ۱. پیدا کردن یا ساخت کاربر در لحظه
                let user = await User.findOne({ telegramId }).session(session);
                if (!user) {
                    const [newUser] = await User.create([{ telegramId }], {
                        session,
                    });
                    user = newUser;
                }

                // ۲. اعتبارسنجی پلن
                const plan = await Plan.findById(planId).session(session);
                if (!plan) throw new NotFoundError('Plan');

                // ۳. تخصیص امن سرور
                const server = await tunnelService.allocateServer();

                const now = new Date();
                const expireDate = new Date(
                    now.getTime() + plan.durationDays * 86400000,
                );

                // ۴. ساخت اشتراک دور از چک کردن کیف پول
                const [sub] = await Subscription.create(
                    [
                        {
                            ownerId: user._id,
                            planId: plan._id,
                            serverId: server._id,
                            status: 'active',
                            totalVolumeBytes: plan.baseVolumeGB * GB,
                            rolloverVolumeBytes: 0,
                            usedVolumeBytes: 0,
                            startDate: now,
                            expireDate,
                        },
                    ],
                    { session },
                );

                return sub;
            });

            return subscription;
        } finally {
            await session.endSession();
        }
    }

    // -----------------------------------------------------------------------
    // 2. mongodump backup
    // -----------------------------------------------------------------------

    async generateDatabaseBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outPath = `/tmp/vpn-backup-${timestamp}.archive.gz`;

        const { stderr } = await execAsync(
            `mongodump --archive="${outPath}" --gzip`,
        );
        if (stderr) console.warn('[backup] stderr:', stderr);

        return outPath;
    }

    // -----------------------------------------------------------------------
    // 3. Broadcast targets
    // -----------------------------------------------------------------------

    async getBroadcastTargets(audienceType) {
        // اگر هدف همه کاربران است، نیازی به جوین با سابسکریپشن نیست.
        if (audienceType === 'all') {
            const users = await User.find({ telegramId: { $exists: true } })
                .select('telegramId')
                .lean();
            return users.map((u) => u.telegramId);
        }

        const match =
            audienceType === 'active'
                ? { status: 'active' }
                : { status: 'expired' };

        const results = await Subscription.aggregate([
            { $match: match },
            { $group: { _id: '$ownerId' } },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user',
                },
            },
            { $unwind: '$user' },
            {
                $group: {
                    _id: null,
                    telegramIds: { $addToSet: '$user.telegramId' },
                },
            },
        ]);

        return results[0]?.telegramIds ?? [];
    }

    // -----------------------------------------------------------------------
    // 4. Update Setting singleton
    // -----------------------------------------------------------------------

    async updateSetting(key, value) {
        return Setting.set(key, value);
    }
}

export default new AdminService();
