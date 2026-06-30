import BaseGateway, { PaymentGatewayError } from './BaseGateway.js';
import logger from '../../config/logger.js';
import TransactionRepository from '../../repositories/TransactionRepository.js';
import UserRepository from '../../repositories/UserRepository.js';
import mongoose from 'mongoose';

export default class SmsC2CGateway extends BaseGateway {
  constructor(config = {}) {
    super(config);
    this.name = 'sms_c2c';
  }

  async initialize() {
    logger.info('[sms-c2c] Gateway initialized');
  }

  async createPayment(amount, currency = 'irr', metadata = {}) {
    if (!this.initialized) await this.initialize();
    const { userId } = metadata;

    if (!userId) throw new PaymentGatewayError('User ID is required');

    // Generate unique amount: baseAmount + random suffix (1-999)
    const randomSuffix = Math.floor(Math.random() * 999) + 1;
    const uniqueAmount = amount + randomSuffix;

    // Start a transaction to save the pending transaction atomically
    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        // Get user to verify they exist
        const user = await UserRepository.findById(userId, { session });
        if (!user) throw new PaymentGatewayError('User not found');

        // Save a pending transaction with the unique amount
        const transaction = await TransactionRepository.create({
          userId,
          type: 'payment',
          status: 'pending',
          amount: uniqueAmount,
          currency,
          description: `Card-to-card deposit for ${amount.toLocaleString()} IRR (payment ID: ${randomSuffix})`,
          balanceBefore: user.walletBalance,
          balanceAfter: user.walletBalance,
          metadata: {
            cryptomusStatus: 'pending_sms_verification',
            baseAmount: amount,
            randomSuffix,
            originalMetadata: metadata,
          },
        }, { session });

        logger.info({ userId, amount, uniqueAmount, transactionId: transaction._id }, '[sms-c2c] Pending transaction created');

        return { gateway: 'sms_c2c', uniqueAmount, transactionId: transaction._id };
      });

      return result;
    } finally {
      await session.endSession();
    }
  }

  async verifyPayment(_transactionId) {
    if (!this.initialized) await this.initialize();

    const session = await mongoose.startSession();
    try {
      const transaction = await session.withTransaction(async () => {
        const tx = await TransactionRepository.findById(_transactionId, { session });
        if (!tx) throw new PaymentGatewayError('Transaction not found');
        if (tx.status !== 'pending_sms_verification') {
          throw new PaymentGatewayError(`Transaction status is ${tx.status}, not pending_sms_verification`);
        }
        return tx;
      });

      return {
        gateway: 'sms_c2c',
        transactionId: _transactionId,
        status: transaction.status,
        amount: transaction.amount,
        metadata: transaction.metadata,
        verified: true,
      };
    } finally {
      await session.endSession();
    }
  }

  async handleWebhook(payload, _headers) {
    if (!this.initialized) await this.initialize();

    const smsText = payload.text || payload.message || payload.body;
    const userId = payload.userId;
    if (!smsText) throw new PaymentGatewayError('No SMS text provided in webhook payload');
    if (!userId) throw new PaymentGatewayError('userId is required in webhook payload');

    // Extract amount from SMS text using bank patterns
    const BANK_PATTERNS = [
      /انتقال:([\d,]+)\+/,
      /انتقالي:([\d,]+)\+/,
      /مبلغ:?\s*([\d,]+)\s*ریال/,
      /مبلغ:?\s*([\d,]+)/,
      /(\d{4,})\s*ریال/,
    ];

    let extractedAmount = null;
    for (const pattern of BANK_PATTERNS) {
      const match = smsText.match(pattern);
      if (match) {
        const cleaned = match[1].replace(/,/g, '').trim();
        extractedAmount = parseInt(cleaned, 10);
        if (!isNaN(extractedAmount) && extractedAmount > 0) break;
      }
    }
    if (!extractedAmount) throw new PaymentGatewayError('Could not extract amount from SMS');

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        // Atomic: match by userId + amount AND transition only if still pending
        const updated = await TransactionRepository.model.findOneAndUpdate(
          {
            userId,
            amount: extractedAmount,
            'metadata.cryptomusStatus': 'pending_sms_verification',
            status: 'pending',
            createdAt: { $gte: thirtyMinutesAgo },
          },
          {
            $set: {
              status: 'completed',
              'metadata.cryptomusStatus': 'sms_verified',
              'metadata.verifiedAt': new Date(),
            },
          },
          { new: true, session },
        );

        if (!updated) {
          logger.info({ amount: extractedAmount, userId }, '[sms-c2c] No matching pending transaction or already processed');
          throw new PaymentGatewayError('No matching pending transaction');
        }

        const user = await UserRepository.findById(userId, { session });
        if (!user) throw new PaymentGatewayError('User not found');

        const newBalance = user.walletBalance + updated.amount;
        user.walletBalance = newBalance;
        await user.save({ session });

        // Record the final balance on the transaction
        await TransactionRepository.model.updateOne(
          { _id: updated._id },
          { $set: { balanceAfter: newBalance } },
          { session },
        );

        logger.info({ transactionId: updated._id, amount: updated.amount, userId }, '[sms-c2c] Payment verified and funds added');

        return {
          type: 'sms_verified',
          transactionId: updated._id,
          amount: updated.amount,
          userId,
          verified: true,
        };
      });

      return result;
    } finally {
      await session.endSession();
    }
  }

  async refundPayment(_paymentId, _amount) {
    throw new PaymentGatewayError('SMS C2C gateway does not support refunds');
  }
}