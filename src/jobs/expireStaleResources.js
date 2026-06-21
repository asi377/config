import Subscription from '../models/Subscription.js';
import TunnelConfig from '../models/TunnelConfig.js';
import ServerRepository from '../repositories/ServerRepository.js';
import logger from '../config/logger.js';

export async function expireStaleResources() {
  const now = new Date();

  try {
    const expiredSubs = await Subscription.find({
      status: 'active',
      expireDate: { $lte: now },
    });

    for (const sub of expiredSubs) {
      if (sub.serverId) {
        await ServerRepository.releaseSlot(sub.serverId.toString());
      }
      sub.status = 'expired';
      await sub.save();
    }

    await TunnelConfig.updateMany(
      {
        isActive: true,
        $or: [
          { isGuestLink: true, guestExpireDate: { $lte: now } },
          {
            allocatedQuotaBytes: { $ne: null },
            $expr: { $gte: ['$usedQuotaBytes', '$allocatedQuotaBytes'] },
          },
        ],
      },
      { $set: { isActive: false } },
    );

    await Subscription.updateMany(
      {
        status: 'active',
        $expr: { $gte: ['$usedVolumeBytes', '$totalVolumeBytes'] },
      },
      { $set: { status: 'expired' } },
    );

    if (expiredSubs.length > 0) {
      logger.info({ count: expiredSubs.length }, '[job] Expired stale subscriptions');
    }
  } catch (err) {
    logger.error({ err }, '[job] expireStaleResources failed');
  }
}
