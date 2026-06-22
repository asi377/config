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
          category: 'sms_c2c_deposit',
          amount: uniqueAmount,
          currency,
          description: `Card-to-card deposit for ${amount.toLocaleString()} IRR (payment ID: ${randomSuffix})`,
          balanceBefore: user.walletBalance,
          balanceAfter: user.walletBalance,
          metadata: { baseAmount: amount, randomSuffix, originalMetadata: metadata },
          status: 'pending_sms_verification',
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

    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        // SmsParser webhook endpoint receives SMS text in payload.text
        const smsText = payload.text || payload.message || payload.body;
        if (!smsText) throw new PaymentGatewayError('No SMS text provided in webhook payload');

        // Get smsBankRegex from BotConfig (would normally import BotConfig here)
        // For now, using the default pattern from existing smsParser
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

        // Find the pending transaction with this exact amount
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        let transaction = await TransactionRepository.findOne({
          amount: extractedAmount,
          status: 'pending_sms_verification',
          createdAt: { $gte: thirtyMinutesAgo },
        }, { session });

        if (!transaction) throw new PaymentGatewayError('No matching pending transaction');

        // Get the user to update wallet balance
        const user = await UserRepository.findById(transaction.userId, { session });
        if (!user) throw new PaymentGatewayError('User not found');

        // Update transaction status
        transaction.status = 'sms_verified';
        transaction.verifiedAt = new Date();
        transaction.metadata.verifiedAt = transaction.verifiedAt;
        await transaction.save({ session });

        // Add funds to user wallet
        user.walletBalance += transaction.amount;
        await user.save({ session });

        // Update transaction with final balance
        transaction.balanceAfter = user.walletBalance;
        await transaction.save({ session });

        logger.info({ transactionId: transaction._id, amount: transaction.amount, userId: transaction.userId }, '[sms-c2c] Payment verified and funds added');

        return {
          type: 'sms_verified',
          transactionId: transaction._id,
          amount: transaction.amount,
          userId: transaction.userId,
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