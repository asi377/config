import mongoose from 'mongoose';
import BaseService from '../shared/BaseService.js';
import { NotFoundError } from '../shared/errors.js';
import ReceiptRepository from '../repositories/ReceiptRepository.js';
import UserRepository from '../repositories/UserRepository.js';
import PlanRepository from '../repositories/PlanRepository.js';
import SettingRepository from '../repositories/SettingRepository.js';
import { extractBankMelliAmount } from '../utils/smsParser.js';
import { testSmsRegex } from '../utils/smsRegexBuilder.js';
import subscriptionService from './SubscriptionService.js';
import ProvisioningService from './ProvisioningService.js';
import FraudScoreService from './FraudScoreService.js';
import logger from '../config/logger.js';
import paymentGateway from '../billing/gateway/index.js';
import config from '../config/index.js';
import SmsC2CGateway from '../billing/gateway/SmsC2CGateway.js';
import CryptomusGateway from '../billing/gateway/CryptomusGateway.js';

class PaymentService extends BaseService {
  submitReceipt = this.wrapMethod(async (userId, planId, amount, photoFileId, gateway = null) => {
    const receipt = await ReceiptRepository.create({ userId, planId: planId || null, amount, photoFileId, status: 'pending', gateway });

    if (gateway === 'wallet' || gateway === null) {
      const walletBalance = await UserRepository.getWalletBalance(userId);
      if (walletBalance >= amount) {
        const session = await mongoose.startSession();
        try {
          return await session.withTransaction(async () => {
            const user = await UserRepository.findById(userId, { session });
            if (!user) throw new NotFoundError('User');

            user.walletBalance -= amount;
            await user.save({ session });

            receipt.status = 'paid';
            receipt.paidAt = new Date();
            receipt.paidBy = userId;
            await receipt.save({ session });

            logger.info({ userId, receiptId: receipt._id, amount }, '[payment] Wallet payment completed');
            return receipt;
          });
        } finally {
          await session.endSession();
        }
      } else {
        receipt.status = 'pending_payment';
        await receipt.save();
        logger.info({ userId, receiptId: receipt._id, amount }, '[payment] Wallet payment pending - insufficient balance');
        return receipt;
      }
    }

    const currency = gateway === 'crypto' ? 'usd' : 'irr';
    const paymentResult = await paymentGateway.createPayment(amount, currency, { userId, receiptId: receipt._id, planId }, gateway);

    receipt.status = 'pending_payment';
    receipt.gatewayPaymentId = paymentResult.paymentId || paymentResult.transactionId || paymentResult.orderId;
    receipt.gateway = paymentResult.gateway;
    await receipt.save();

    logger.info({ userId, receiptId: receipt._id, gateway, paymentId: receipt.gatewayPaymentId }, '[payment] Payment submitted to gateway');
    return { receipt, gatewayPayment: paymentResult };
  });

  processReceipt = this.wrapMethod(async (receiptId, adminId, action, opts = {}) => {
    const session = await mongoose.startSession();
    let approvedUser = null;
    let provisionPlanId = null;

    try {
      const receipt = await session.withTransaction(async () => {
        const r = await ReceiptRepository.findById(receiptId, { session });
        if (!r) throw new NotFoundError('Receipt');
        if (!['pending', 'sms_matched'].includes(r.status)) throw new Error('Receipt has already been processed');

        if (action === 'approve') {
          const user = await UserRepository.findById(r.userId, { session });
          if (!user) throw new NotFoundError('User');

          user.walletBalance += r.amount;
          await user.save({ session });

          approvedUser = user;
          provisionPlanId = r.planId;
          r.status = opts.auto ? 'auto_approved' : 'approved';
          r.autoApproved = !!opts.auto;
          if (typeof opts.fraudScore === 'number') r.fraudScore = opts.fraudScore;
        } else {
          r.status = 'rejected';
        }

        if (adminId) r.reviewedBy = adminId;
        return r.save({ session });
      });

      let subscription = null;
      let tunnelConfig = null;

      if (action === 'approve' && provisionPlanId && approvedUser) {
        subscription = await subscriptionService.createSubscription(approvedUser._id, provisionPlanId);
        subscription = await subscriptionService.activateSubscription(subscription._id);

        const plan = await PlanRepository.findById(provisionPlanId);
        try {
          const provisionResult = await ProvisioningService.provisionTunnelOnNode(subscription, plan, approvedUser);
          tunnelConfig = provisionResult.tunnelConfig;
        } catch (err) {
          logger.error({ err, subscriptionId: subscription._id }, '[payment] Xray provisioning failed after approval');
        }
      }

      return { receipt, subscription, tunnelConfig, user: approvedUser };
    } finally {
      await session.endSession();
    }
  });

  generateUniqueAmount = this.wrapMethod(async (baseAmount) => {
    const amount = await ReceiptRepository.findUniqueAmount(baseAmount);
    if (!amount) throw new Error('Unable to generate a unique payment amount');
    return amount;
  });

  processSmsWebhook = this.wrapMethod(async (smsText, _botInstance) => {
    // Prefer the admin-configured regex (built from a sample SMS in the panel);
    // fall back to the built-in Bank-Melli patterns if it isn't set or misses.
    const BotConfig = (await import('../models/BotConfig.js')).default;
    const botConfig = await BotConfig.getSingleton();
    const savedRegex = botConfig?.smsBankRegex || '';
    const amountRial = (savedRegex && testSmsRegex(savedRegex, smsText)) || extractBankMelliAmount(smsText);
    if (!amountRial) {
      logger.warn({ smsPreview: smsText.slice(0, 100) }, '[sms-webhook] could not extract amount');
      return;
    }
    // Bank SMS report Rial; receipts/plan prices are stored in Toman. Convert to
    // Toman so the quoted amount and the SMS amount compare on the same scale.
    const amount = Math.round(amountRial / 10);

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const receipt = await ReceiptRepository.findMatchingSms(amount, thirtyMinutesAgo);
    if (!receipt) {
      logger.warn({ amount }, '[sms-webhook] no matching pending receipt');
      return;
    }

    try {
      receipt.status = 'sms_matched';
      receipt.smsMatchedAt = new Date();
      await receipt.save();
      logger.info({ receiptId: receipt._id, amount }, '[sms-webhook] matched to receipt');

      const autoEnabled = await SettingRepository.get('payment.autoApprove.enabled', false);
      let autoApproved = false;

      // Note: receipt.planId can be null for wallet top-ups (no provisioning
      // needed, processReceipt still credits the wallet unconditionally).
      if (autoEnabled) {
        const tolerance = await SettingRepository.get('payment.autoApprove.toleranceAmount', 0);
        const ceiling = await SettingRepository.get('payment.autoApprove.ceilingAmount', 2000000);
        const maxFraud = await SettingRepository.get('payment.autoApprove.maxFraudScore', 40);

        const expectedAmount = receipt.amount;
        const withinTolerance = amount >= expectedAmount && amount <= expectedAmount + tolerance;
        const underCeiling = amount <= ceiling;

        if (withinTolerance && underCeiling) {
          let fraudScoreVal = 0;
          try {
            const fraudResult = await FraudScoreService.evaluateUser(receipt.userId);
            fraudScoreVal = fraudResult.score;
          } catch (err) {
            logger.error({ err, receiptId: receipt._id }, '[sms-webhook] fraud evaluation failed, treating as high risk');
            fraudScoreVal = 100;
          }

          if (fraudScoreVal < maxFraud) {
            autoApproved = true;
            const result = await this.processReceipt(receipt._id, null, 'approve', {
              auto: true, fraudScore: fraudScoreVal,
            });

            if (_botInstance && result.user?.telegramId) {
              await this._notifyUserOfDelivery(_botInstance.telegram, result);
            }
          }
        }
      }

      if (!autoApproved) {
        const adminUser = await UserRepository.findOne({ role: 'superadmin' }, { sort: { createdAt: 1 } });
        if (adminUser?.telegramId && _botInstance) {
          await _botInstance.telegram.sendMessage(
            adminUser.telegramId,
            [
              '📩 *تطابق پیامک - نیاز به تأیید*',
              '',
              `مبلغ: ${this._formatRials(amount)}`,
              `شناسه رسید: \`${receipt._id}\``,
              '',
              'برای تأیید یا رد، از پنل ادمین یا دکمه‌های زیر این رسید در بخش رسیدها استفاده کنید.',
            ].join('\n'),
            { parse_mode: 'Markdown' },
          );
        }
      }
    } catch (err) {
      logger.error({ err, receiptId: receipt._id }, '[sms-webhook] matching/auto-approve failed');
    }
  });

  /**
   * @param {object} telegram - a Telegraf `bot.telegram` API client (NOT the bot object itself).
   */
  async _notifyUserOfDelivery(telegram, { user, tunnelConfig, receipt }) {
    if (!tunnelConfig) {
      // No planId on the receipt means this was a wallet top-up, not a
      // subscription purchase — no tunnel is ever provisioned for those.
      const msg = receipt && !receipt.planId
        ? `✅ پرداخت شما تأیید شد. مبلغ ${this._formatRials(receipt.amount)} به کیف پول شما اضافه شد.`
        : '✅ پرداخت شما تأیید شد. اشتراک شما فعال شد.';
      await telegram.sendMessage(user.telegramId, msg);
      return;
    }
    const subLink = `${config.backendUrl}/sub/${tunnelConfig.uuid}`;

    // Enrich the delivery with the full payload: plan, remaining time, volume.
    let detailLines = [];
    try {
      const Subscription = (await import('../models/Subscription.js')).default;
      const sub = await Subscription.findById(tunnelConfig.subscriptionId).populate('planId', 'title');
      if (sub) {
        const days = sub.expireDate
          ? Math.max(0, Math.ceil((new Date(sub.expireDate).getTime() - Date.now()) / 86400000))
          : null;
        const GB = 1073741824;
        const totalGB = sub.totalVolumeBytes > 0 ? Math.round(sub.totalVolumeBytes / GB) : null;
        detailLines = [
          sub.planId?.title ? `📦 پلن: ${sub.planId.title}` : null,
          days != null ? `⏳ اعتبار: ${days} روز` : null,
          totalGB != null ? `📊 حجم: ${totalGB} گیگابایت` : '📊 حجم: نامحدود',
          `📶 وضعیت: فعال`,
        ].filter(Boolean);
      }
    } catch { /* best-effort enrichment; link is always sent below */ }

    await telegram.sendMessage(
      user.telegramId,
      [
        '✅ پرداخت شما تأیید و اشتراک شما فعال شد.',
        ...(detailLines.length ? ['', ...detailLines] : []),
        '',
        '🔗 لینک اشتراک شما (در اپلیکیشن کلاینت وارد کنید):',
        subLink,
      ].join('\n'),
    );
  }

  // `amount` is stored Toman; bank/display figures are Rial (×10).
  _formatRials(amount) {
    return `${(amount * 10).toLocaleString()} ریال`;
  }

  // === SMS C2C Gateway methods ===

  processSmsC2CWebhook = this.wrapMethod(async (_smsText, _userId, _botInstance) => {
    try {
      const result = await paymentGateway.handleWebhook('sms_c2c', { text: _smsText, userId: _userId }, {});
      return result;
    } catch (err) {
      logger.error({ err, smsPreview: _smsText?.slice(0, 100) }, '[sms-c2c-webhook] processing error');
      throw err;
    }
  });

  createSmsC2CPayment = this.wrapMethod(async (userId, amount) => {
    const metadata = { userId };
    const result = await paymentGateway.createPayment(amount, 'irr', metadata, 'sms_c2c');

    logger.info({ userId, amount, uniqueAmount: result.uniqueAmount }, '[payment] SMS C2C payment created');
    return {
      gateway: 'sms_c2c',
      paymentId: result.transactionId,
      uniqueAmount: result.uniqueAmount,
      status: 'pending_sms_verification',
      amount,
      currency: 'IRR',
    };
  });

  // === Cryptomus Gateway methods ===

  processCryptomusWebhook = this.wrapMethod(async (payload, headers) => {
    try {
      const result = await paymentGateway.handleWebhook('cryptomus', payload, headers);
      return result;
    } catch (err) {
      logger.error({ err }, '[cryptomus-webhook] processing error');
      throw err;
    }
  });

  createCryptomusPayment = this.wrapMethod(async (userId, amount) => {
    const metadata = { userId };
    const result = await paymentGateway.createPayment(amount, 'usd', metadata, 'cryptomus');

    logger.info({ userId, amount, paymentId: result.paymentId }, '[payment] Cryptomus payment created');
    return {
      gateway: 'cryptomus',
      paymentId: result.paymentId,
      orderId: result.orderId,
      status: result.status,
      amount,
      currency: 'USD',
      paymentUrl: result.paymentUrl,
      transactionId: result.transactionId,
    };
  });

  // === Unified deposit/payment generation ===

  submitPayment = this.wrapMethod(async (userId, planId, amount, gateway = null, metadata = {}) => {
    const receipt = await ReceiptRepository.create({ userId, planId, amount, metadata });

    if (gateway === 'wallet' || gateway === null) {
      const walletBalance = await UserRepository.getWalletBalance(userId);
      if (walletBalance >= amount) {
        const session = await mongoose.startSession();
        try {
          return await session.withTransaction(async () => {
            const user = await UserRepository.findById(userId, { session });
            if (!user) throw new NotFoundError('User');

            user.walletBalance -= amount;
            await user.save({ session });

            receipt.status = 'paid';
            receipt.paidAt = new Date();
            receipt.paidBy = userId;
            await receipt.save({ session });

            logger.info({ userId, receiptId: receipt._id, amount }, '[payment] Wallet payment completed');
            return receipt;
          });
        } finally {
          await session.endSession();
        }
      } else {
        receipt.status = 'pending_payment';
        await receipt.save();
        logger.info({ userId, receiptId: receipt._id, amount }, '[payment] Wallet payment pending - insufficient balance');
        return receipt;
      }
    }

    let paymentResult;
    if (gateway === 'sms_c2c') {
      const smsGateway = new SmsC2CGateway();
      paymentResult = await smsGateway.createPayment(amount, 'irr', { userId, receiptId: receipt._id, planId, ...metadata });
    } else if (gateway === 'crypto') {
      const cryptomusCfg = config.cryptomus || {};
      const cryptoGateway = new CryptomusGateway({
        apiKey: cryptomusCfg.apiKey,
        merchantId: cryptomusCfg.merchantId,
        webhookSecret: cryptomusCfg.webhookSecret,
        backendUrl: config.backendUrl,
        frontendUrl: config.corsOrigin,
      });
      paymentResult = await cryptoGateway.createPayment(amount, 'usd', { userId, receiptId: receipt._id, planId, ...metadata });
    } else {
      paymentResult = await paymentGateway.createPayment(amount, 'irr', { userId, receiptId: receipt._id, planId, ...metadata }, gateway);
    }

    receipt.status = 'pending_payment';
    receipt.gatewayPaymentId = paymentResult.paymentId || paymentResult.transactionId || paymentResult.orderId;
    receipt.gateway = paymentResult.gateway;
    await receipt.save();

    logger.info({ userId, receiptId: receipt._id, gateway, paymentId: receipt.gatewayPaymentId }, '[payment] Payment submitted to gateway');
    return { receipt, gatewayPayment: paymentResult };
  });
}

export default new PaymentService();
