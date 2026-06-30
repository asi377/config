import mongoose from 'mongoose';
import BaseService from '../shared/BaseService.js';
import { NotFoundError, InsufficientBalanceError } from '../shared/errors.js';
import UserRepository from '../repositories/UserRepository.js';
import SubscriptionRepository from '../repositories/SubscriptionRepository.js';

const GB = 1073741824;
const FALLBACK_PRICE_PER_GB = 50000; // IRR, used only if the subscription's plan has no baseVolumeGB to derive a ratio from

class AddonService extends BaseService {
  /**
   * Price is derived from the subscription's own plan (basePrice / baseVolumeGB),
   * so it stays consistent with whatever the admin sets for that plan in the panel.
   */
  async quoteExtraDataPrice(subscriptionId, gb) {
    const sub = await SubscriptionRepository.findById(subscriptionId, { populate: 'planId' });
    if (!sub) throw new NotFoundError('Subscription');
    const plan = sub.planId;
    const pricePerGB = plan?.baseVolumeGB
      ? Math.round(plan.basePrice / plan.baseVolumeGB)
      : FALLBACK_PRICE_PER_GB;
    return { pricePerGB, total: pricePerGB * gb };
  }

  /**
   * Extra-data top-ups only extend `totalVolumeBytes` on the subscription —
   * quota enforcement is app-level (UsageService compares usedVolumeBytes vs
   * totalVolumeBytes), there is no separate node-agent command for it.
   */
  purchaseExtraData = this.wrapMethod(async (userId, subscriptionId, gb) => {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const sub = await SubscriptionRepository.findById(subscriptionId, { session, populate: 'planId' });
        if (!sub) throw new NotFoundError('Subscription');
        if (String(sub.ownerId) !== String(userId)) throw new NotFoundError('Subscription');
        if (sub.status !== 'active') throw new Error('Subscription is not active');

        const plan = sub.planId;
        const pricePerGB = plan?.baseVolumeGB
          ? Math.round(plan.basePrice / plan.baseVolumeGB)
          : FALLBACK_PRICE_PER_GB;
        const price = pricePerGB * gb;

        const user = await UserRepository.findById(userId, { session });
        if (!user) throw new NotFoundError('User');
        if (user.walletBalance < price) throw new InsufficientBalanceError(user.walletBalance, price);

        user.walletBalance -= price;
        await user.save({ session });

        sub.totalVolumeBytes += gb * GB;
        await sub.save({ session });

        return { subscription: sub, price };
      });
    } finally {
      await session.endSession();
    }
  });
}

export default new AddonService();
