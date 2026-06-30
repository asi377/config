import { Scenes } from 'telegraf';
import logger from '../../config/logger.js';
import { t } from '../../utils/i18n.js';
import PaymentService from '../../services/PaymentService.js';

const receiptUploadScene = new Scenes.BaseScene('receiptUploadScene');

receiptUploadScene.enter(async (ctx) => {
  const lang = ctx.lang || 'fa';
  await ctx.msgQueue.sendMessage(ctx.chat.id, t('receipt_upload_prompt', lang));
});

receiptUploadScene.on('photo', async (ctx) => {
  const lang = ctx.lang || 'fa';
  try {
    const { pendingPlanId, pendingAmount } = ctx.session || {};

    if (!pendingPlanId || !pendingAmount) {
      await ctx.msgQueue.sendMessage(ctx.chat.id, t('receipt_missing_session', lang));
      await ctx.scene.leave();
      return;
    }

    const user = ctx.user;
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    await PaymentService.submitReceipt(user._id, pendingPlanId, pendingAmount, fileId, 'card_to_card');

    delete ctx.session.pendingPlanId;
    delete ctx.session.pendingAmount;

    await ctx.msgQueue.sendMessage(ctx.chat.id, t('receipt_submitted_auto_or_review', lang));
    await ctx.scene.leave();
  } catch (err) {
    logger.error({ err }, '[bot] receiptUploadScene error');
    await ctx.reply(t('receipt_upload_error', lang));
  }
});

export default receiptUploadScene;
