import { Scenes } from 'telegraf';
import logger from '../../config/logger.js';
import { t } from '../../utils/i18n.js';
import { formatRials, toRial, rialToToman } from '../utils.js';
import PaymentService from '../../services/PaymentService.js';
import SettingRepository from '../../repositories/SettingRepository.js';
import config from '../../config/index.js';

const walletTopupScene = new Scenes.BaseScene('walletTopupScene');

walletTopupScene.enter(async (ctx) => {
  const lang = ctx.lang || 'fa';
  await ctx.msgQueue.sendMessage(ctx.chat.id, t('wallet_topup_enter_amount', lang));
});

walletTopupScene.on('text', async (ctx) => {
  const lang = ctx.lang || 'fa';
  const raw = ctx.message.text.replace(/[^\d]/g, '');
  // The user enters the top-up amount in RIAL (matching what they see); wallet
  // balances are stored in Toman, so convert before generating the order amount.
  const enteredRial = parseInt(raw, 10);

  if (!enteredRial || enteredRial < 10000) {
    await ctx.msgQueue.sendMessage(ctx.chat.id, t('wallet_topup_invalid_amount', lang));
    return;
  }

  try {
    const amountToman = rialToToman(enteredRial);
    const uniqueAmount = await PaymentService.generateUniqueAmount(amountToman);
    const cardNumber = await SettingRepository.get('payment.cardNumber', config.cardNumber);

    ctx.session.walletTopupAmount = uniqueAmount;

    await ctx.msgQueue.sendMessage(ctx.chat.id, t('card_payment_instructions', lang, {
      cardNumber,
      amountRaw: toRial(uniqueAmount),
      amount: formatRials(uniqueAmount, lang),
    }), { parse_mode: 'HTML' });
    await ctx.msgQueue.sendMessage(ctx.chat.id, t('card_payment_exact_amount_notice', lang, {
      amount: formatRials(uniqueAmount, lang),
    }));
    ctx.scene.state.awaitingPhoto = true;
  } catch (err) {
    logger.error({ err }, '[bot] walletTopupScene amount error');
    await ctx.msgQueue.sendMessage(ctx.chat.id, t('error_generic_request', lang));
    await ctx.scene.leave();
  }
});

walletTopupScene.on('photo', async (ctx) => {
  const lang = ctx.lang || 'fa';
  try {
    const amount = ctx.session.walletTopupAmount;
    if (!amount) {
      await ctx.msgQueue.sendMessage(ctx.chat.id, t('receipt_missing_session', lang));
      await ctx.scene.leave();
      return;
    }

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await PaymentService.submitReceipt(ctx.user._id, null, amount, fileId, 'card_to_card');

    delete ctx.session.walletTopupAmount;
    await ctx.msgQueue.sendMessage(ctx.chat.id, t('receipt_submitted_auto_or_review', lang));
    await ctx.scene.leave();
  } catch (err) {
    logger.error({ err }, '[bot] walletTopupScene receipt error');
    await ctx.msgQueue.sendMessage(ctx.chat.id, t('receipt_upload_error', lang));
    await ctx.scene.leave();
  }
});

export default walletTopupScene;
