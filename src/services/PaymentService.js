import mongoose from 'mongoose';
import BaseService from '../shared/BaseService.js';
import { NotFoundError } from '../shared/errors.js';
import ReceiptRepository from '../repositories/ReceiptRepository.js';
import UserRepository from '../repositories/UserRepository.js';
import { extractBankMelliAmount } from '../utils/smsParser.js';
import subscriptionService from './SubscriptionService.js';
import logger from '../config/logger.js';

class PaymentService extends BaseService {
  submitReceipt = this.wrapMethod(async (userId, planId, amount, photoFileId) => {
    return ReceiptRepository.create({ userId, planId: planId || null, amount, photoFileId, status: 'pending' });
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

  processSmsWebhook = this.wrapMethod(async (smsText, botInstance) => {
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
      if (adminUser?.telegramId && botInstance) {
        await botInstance.telegram.sendMessage(
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
}

export default new PaymentService();
