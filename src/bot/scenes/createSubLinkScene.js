import { Scenes } from 'telegraf';
import { t } from '../../utils/i18n.js';
import logger from '../../config/logger.js';
import config from '../../config/index.js';
import SubscriptionRepository from '../../repositories/SubscriptionRepository.js';
import PlanRepository from '../../repositories/PlanRepository.js';
import ProvisioningService from '../../services/ProvisioningService.js';

const createSubLinkScene = new Scenes.BaseScene('createSubLinkScene');

createSubLinkScene.enter(async (ctx) => {
  const lang = ctx.lang || 'fa';

  const subs = await SubscriptionRepository.findMany(
    { ownerId: ctx.user._id, status: 'active' },
    { sort: { createdAt: -1 } },
  );

  if (!subs || subs.length === 0) {
    await ctx.msgQueue.sendMessage(ctx.chat.id, t('create_sublink_no_active_subscription', lang));
    await ctx.scene.leave();
    return;
  }

  ctx.session.subLinkSubscriptionId = String(subs[0]._id);
  await ctx.msgQueue.sendMessage(ctx.chat.id, t('create_sublink_enter_name', lang));
});

createSubLinkScene.on('text', async (ctx) => {
  const lang = ctx.lang || 'fa';
  const name = ctx.message.text;

  try {
    const subscriptionId = ctx.session.subLinkSubscriptionId;
    if (!subscriptionId) {
      await ctx.msgQueue.sendMessage(ctx.chat.id, t('create_sublink_no_active_subscription', lang));
      await ctx.scene.leave();
      return;
    }

    const subscription = await SubscriptionRepository.findById(subscriptionId);
    if (!subscription) {
      await ctx.msgQueue.sendMessage(ctx.chat.id, t('create_sublink_no_active_subscription', lang));
      await ctx.scene.leave();
      return;
    }

    const plan = await PlanRepository.findById(subscription.planId);

    const { tunnelConfig } = await ProvisioningService.provisionTunnelOnNode(subscription, plan, ctx.user, name);

    const subLink = `${config.backendUrl}/sub/${tunnelConfig.uuid}`;
    await ctx.msgQueue.sendMessage(ctx.chat.id, t('sublink_created', lang, { name, link: subLink }));
    delete ctx.session.subLinkSubscriptionId;
    await ctx.scene.leave();
  } catch (err) {
    logger.error({ err }, '[bot] createSubLinkScene provisioning error');
    await ctx.msgQueue.sendMessage(ctx.chat.id, t('sublink_provisioning_failed', lang));
    await ctx.scene.leave();
  }
});

export default createSubLinkScene;
