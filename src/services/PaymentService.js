import mongoose from 'mongoose';
import BaseService from '../shared/BaseService.js';
import { NotFoundError } from '../shared/errors.js';
import ReceiptRepository from '../repositories/ReceiptRepository.js';
import UserRepository from '../repositories/UserRepository.js';
import { extractBankMelliAmount } from '../utils/smsParser.js';
import subscriptionService from './SubscriptionService.js';
import logger from '../config/logger.js';
import paymentGateway from '../billing/gateway/index.js';
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

    const paymentResult = await paymentGateway.createPayment(amount, 'irr', { userId, receiptId: receipt._id, planId }, gateway);

    receipt.status = 'pending_payment';
    receipt.gatewayPaymentId = paymentResult.paymentId || paymentResult.transactionId || paymentResult.orderId;
    receipt.gateway = paymentResult.gateway;
    await receipt.save();

    logger.info({ userId, receiptId: receipt._id, gateway, paymentId: receipt.gatewayPaymentId }, '[payment] Payment submitted to gateway');
    return { receipt, gatewayPayment: paymentResult };
  });

  processReceipt = this.wrapMethod(async (receiptId, adminId, action) => {
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
          r.status = 'approved';
        } else {
          r.status = 'rejected';
        }

        if (adminId) r.reviewedBy = adminId;
        return r.save({ session });
      });

      if (action === 'approve' && provisionPlanId && approvedUser) {
        await subscriptionService.createSubscription(approvedUser._id, provisionPlanId);
      }

      return receipt;
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
    const amount = extractBankMelliAmount(smsText);
    if (!amount) {
      logger.warn({ smsPreview: smsText.slice(0, 100) }, '[sms-webhook] could not extract amount');
      return;
    }

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const receipt = await ReceiptRepository.findMatchingSms(amount, thirtyMinutesAgo);
    if (!receipt) {
      logger.warn({ amount }, '[sms-webhook] no matching pending receipt');
      return;
    }

    try {
      // Mark receipt as sms_matched (requires admin approval to complete)
      receipt.status = 'sms_matched';
      receipt.smsMatchedAt = new Date();
      await receipt.save();
      logger.info({ receiptId: receipt._id, amount }, '[sms-webhook] matched to receipt, pending admin approval');

      // Notify admins about the match
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
            'لطفاً با دستور /approve_sms شناسه رسید را تأیید یا رد کنید.',
          ].join('\n'),
          { parse_mode: 'Markdown' },
        );
      }
    } catch (err) {
      logger.error({ err, receiptId: receipt._id }, '[sms-webhook] matching failed');
    }
  });

  _formatRials(amount) {
    return `${amount.toLocaleString()} ریال`;
  }

  // === SMS C2C Gateway methods ===

  processSmsC2CWebhook = this.wrapMethod(async (_smsText, _botInstance) => {
    const smsC2CGateway = new SmsC2CGateway();
    try {
      const result = await smsC2CGateway.handleWebhook({ text: _smsText }, {});
      return result;
    } catch (err) {
      logger.error({ err, smsPreview: _smsText?.slice(0, 100) }, '[sms-c2c-webhook] processing error');
      throw err;
    }
  });

  createSmsC2CPayment = this.wrapMethod(async (userId, amount) => {
    const smsC2CGateway = new SmsC2CGateway();
    const metadata = { userId };
    const result = await smsC2CGateway.createPayment(amount, 'irr', metadata);

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
    const cryptomusGateway = new CryptomusGateway();
    try {
      const result = await cryptomusGateway.handleWebhook(payload, headers);
      return result;
    } catch (err) {
      logger.error({ err }, '[cryptomus-webhook] processing error');
      throw err;
    }
  });

  createCryptomusPayment = this.wrapMethod(async (userId, amount) => {
    const cryptomusGateway = new CryptomusGateway();
    const metadata = { userId };
    const result = await cryptomusGateway.createPayment(amount, 'usd', metadata);

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

  // === Unified payment methods ===

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

    const paymentResult = await paymentGateway.createPayment(amount, 'irr', { userId, receiptId: receipt._id, planId, ...metadata }, gateway);

    receipt.status = 'pending_payment';
    receipt.gatewayPaymentId = paymentResult.paymentId || paymentResult.transactionId || paymentResult.orderId;
    receipt.gateway = paymentResult.gateway;
    await receipt.save();

    logger.info({ userId, receiptId: receipt._id, gateway, paymentId: receipt.gatewayPaymentId }, '[payment] Payment submitted to gateway');
    return { receipt, gatewayPayment: paymentResult };
  });
}

export default new PaymentService();
