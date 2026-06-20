import mongoose from 'mongoose';
import { Receipt, User, Plan } from '../models/index.js';
import subscriptionService from './SubscriptionService.js';
import { extractBankMelliAmount } from '../utils/smsParser.js';
import { NotFoundError } from '../utils/errors.js';
import { formatRials } from '../utils/formatters.js';

class PaymentService {
    /**
     * Submit a manual payment receipt for admin review.
     *
     * @param {string} userId
     * @param {string|null} planId
     * @param {number} amount
     * @param {string} photoFileId
     * @returns {Promise<import('mongoose').Document>}
     */
    async submitReceipt(userId, planId, amount, photoFileId) {
        return Receipt.create({
            userId,
            planId: planId || null,
            amount,
            photoFileId,
            status: 'pending',
        });
    }

    /**
     * Approve or reject a pending receipt inside a MongoDB transaction.
     *
     * approve: credits wallet. If planId exists, provisions the subscription
     * using the standard SubscriptionService.
     * reject:  flips status.
     *
     * @param {string} receiptId
     * @param {string} adminId
     * @param {'approve'|'reject'} action
     * @returns {Promise<import('mongoose').Document>}
     */
    async processReceipt(receiptId, adminId, action) {
        const session = await mongoose.startSession();
        let approvedUser = null;
        let provisionPlanId = null;

        try {
            const receipt = await session.withTransaction(async () => {
                const r = await Receipt.findById(receiptId).session(session);
                if (!r) throw new NotFoundError('Receipt');
                if (r.status !== 'pending') {
                    throw new Error('Receipt has already been processed');
                }

                if (action === 'approve') {
                    const user = await User.findById(r.userId).session(session);
                    if (!user) throw new NotFoundError('User');

                    // شارژ کردن کیف پول کاربر
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

            // اختصاص سرور و ساخت پلن خارج از تراکنش رسید بانکی انجام می‌شود
            // تا از وابستگی‌های چرخشی و خطای لاگین همزمان جلوگیری شود.
            // این متد خودش تراکنش مالی را مدیریت می‌کند.
            if (action === 'approve' && provisionPlanId && approvedUser) {
                await subscriptionService.createSubscription(
                    approvedUser._id,
                    provisionPlanId,
                );
            }

            return receipt;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Generate an exact amount (basePrice + random 1–999) not used by any
     * pending receipt, to enable automatic SMS amount matching.
     *
     * @param {number} baseAmount
     * @param {number} [maxAttempts=20]
     * @returns {Promise<number>}
     */
    async generateUniqueAmount(baseAmount, maxAttempts = 20) {
        for (let i = 0; i < maxAttempts; i++) {
            const offset = Math.floor(Math.random() * 999) + 1;
            const exactAmount = baseAmount + offset;

            const existing = await Receipt.findOne({
                amount: exactAmount,
                status: 'pending',
            }).lean();

            if (!existing) return exactAmount;
        }
        throw new Error('Unable to generate a unique payment amount after 20 attempts');
    }

    /**
     * Process an incoming SMS webhook payload.
     *
     * 1. Extracts the transferred amount via the SMS parser.
     * 2. Finds a matching pending Receipt created in the last 30 minutes.
     * 3. Approves it via processReceipt and notifies the user on Telegram.
     *
     * @param {string} smsText
     * @param {import('telegraf').Telegraf} botInstance
     * @returns {Promise<void>}
     */
    async processSmsWebhook(smsText, botInstance) {
        const amount = extractBankMelliAmount(smsText);
        if (!amount) {
            console.warn('[sms-webhook] could not extract amount from:', smsText.slice(0, 100));
            return;
        }

        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const receipt = await Receipt.findOne({
            amount,
            status: 'pending',
            createdAt: { $gte: thirtyMinutesAgo },
        }).lean();

        if (!receipt) {
            console.warn(`[sms-webhook] no matching pending receipt for amount ${amount}`);
            return;
        }

        try {
            await this.processReceipt(receipt._id, null, 'approve');

            const user = await User.findById(receipt.userId).lean();
            if (user?.telegramId) {
                const msg = [
                    '✅ *پرداخت شهد تأیید شد*',
                    '',
                    '🍯 مبلغ: ' + formatRials(receipt.amount),
                    '',
                    'بال‌های شما آماده است. پرواز خوش!',
                    '🐝 HORNET',
                ].join('\n');

                await botInstance.telegram.sendMessage(
                    user.telegramId,
                    msg,
                    { parse_mode: 'Markdown' },
                );
            }

            console.log(`[sms-webhook] receipt ${receipt._id} approved automatically`);
        } catch (err) {
            console.error(`[sms-webhook] failed to approve receipt ${receipt._id}:`, err.message);
        }
    }
}

export default new PaymentService();
