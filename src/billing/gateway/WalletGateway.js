import BaseGateway, { PaymentGatewayError } from './BaseGateway.js';
import UserRepository from '../../repositories/UserRepository.js';
import TransactionRepository from '../../repositories/TransactionRepository.js';
import logger from '../../config/logger.js';
import mongoose from 'mongoose';

export default class WalletGateway extends BaseGateway {
  constructor() {
    super({ name: 'wallet' });
    this.name = 'wallet';
  }

  async createPayment(amount, currency, metadata = {}) {
    const { userId, planId, description, idempotencyKey } = metadata;
    if (!userId) throw new PaymentGatewayError('userId required');

    // Idempotency check
    if (idempotencyKey) {
      const existing = await TransactionRepository.findOne({
        'metadata.idempotencyKey': idempotencyKey,
      });
      if (existing) {
        logger.info({ txId: existing._id, idempotencyKey }, '[wallet] Idempotent create — returning existing');
        return {
          gateway: 'wallet',
          paymentId: existing._id.toString(),
          status: existing.status,
          amount,
          transaction: existing,
        };
      }
    }

    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const user = await UserRepository.findById(userId, { session });
        if (!user) throw new PaymentGatewayError('User not found');

        if (user.walletBalance < amount) {
          throw new PaymentGatewayError('Insufficient balance', 'INSUFFICIENT_FUNDS');
        }

        user.walletBalance -= amount;
        await user.save({ session });

        const tx = await TransactionRepository.create({
          userId,
          type: 'payment',
          amount,
          description: description || 'Wallet payment',
          balanceBefore: user.walletBalance + amount,
          balanceAfter: user.walletBalance,
          status: 'completed',
          referenceType: planId ? 'subscription' : null,
          referenceId: planId || null,
          metadata: {
            category: planId ? 'subscription_purchase' : 'wallet_debit',
            idempotencyKey: idempotencyKey || null,
          },
        }, { session });

        logger.info({ userId, amount, txId: tx._id }, '[wallet] Payment completed');
        return tx;
      });

      return {
        gateway: 'wallet',
        paymentId: result._id.toString(),
        status: 'completed',
        amount,
        transaction: result,
      };
    } finally {
      await session.endSession();
    }
  }

  async verifyPayment(paymentId) {
    const tx = await TransactionRepository.findById(paymentId);
    if (!tx) throw new PaymentGatewayError('Transaction not found');
    return {
      gateway: 'wallet',
      paymentId: tx._id.toString(),
      status: tx.status,
      amount: tx.amount,
      verified: tx.status === 'completed',
    };
  }

  async refundPayment(paymentId, amount) {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const tx = await TransactionRepository.findById(paymentId, { session });
        if (!tx) throw new PaymentGatewayError('Transaction not found');

        const user = await UserRepository.findById(tx.userId, { session });
        if (!user) throw new PaymentGatewayError('User not found');

        const refundAmount = amount || tx.amount;
        user.walletBalance += refundAmount;
        await user.save({ session });

        const refundTx = await TransactionRepository.create({
          userId: tx.userId,
          type: 'refund',
          amount: refundAmount,
          description: `Refund for transaction ${paymentId}`,
          status: 'completed',
          referenceType: 'refund',
          referenceId: tx._id,
          balanceBefore: user.walletBalance - refundAmount,
          balanceAfter: user.walletBalance,
          metadata: { category: 'wallet_refund' },
        }, { session });

        return { gateway: 'wallet', refundId: refundTx._id.toString(), amount: refundAmount };
      });
    } finally {
      await session.endSession();
    }
  }

  async handleWebhook(_payload) {
    throw new PaymentGatewayError('Wallet gateway does not support webhooks');
  }
}
