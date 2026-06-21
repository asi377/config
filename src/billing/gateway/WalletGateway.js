import BaseGateway, { PaymentGatewayError } from './BaseGateway.js';
import UserRepository from '../../repositories/UserRepository.js';
import TransactionRepository from '../../repositories/TransactionRepository.js';
import logger from '../../config/logger.js';

export default class WalletGateway extends BaseGateway {
  constructor() {
    super({ name: 'wallet' });
    this.name = 'wallet';
  }

  async createPayment(amount, currency, metadata = {}) {
    const { userId, planId, description } = metadata;
    if (!userId) throw new PaymentGatewayError('userId required');

    const user = await UserRepository.findById(userId);
    if (!user) throw new PaymentGatewayError('User not found');

    if (user.walletBalance < amount) {
      throw new PaymentGatewayError('Insufficient balance', 'INSUFFICIENT_FUNDS');
    }

    user.walletBalance -= amount;
    await user.save();

    const tx = await TransactionRepository.create({
      userId,
      type: 'payment',
      category: planId ? 'subscription_purchase' : 'wallet_debit',
      amount,
      description: description || 'Wallet payment',
      refId: planId || null,
      status: 'completed',
    });

    logger.info({ userId, amount, txId: tx._id }, '[wallet] Payment completed');
    return {
      gateway: 'wallet',
      paymentId: tx._id.toString(),
      status: 'completed',
      amount,
      transaction: tx,
    };
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
    const tx = await TransactionRepository.findById(paymentId);
    if (!tx) throw new PaymentGatewayError('Transaction not found');

    const user = await UserRepository.findById(tx.userId);
    if (!user) throw new PaymentGatewayError('User not found');

    const refundAmount = amount || tx.amount;
    user.walletBalance += refundAmount;
    await user.save();

    const refundTx = await TransactionRepository.create({
      userId: tx.userId,
      type: 'refund',
      category: 'wallet_refund',
      amount: refundAmount,
      description: `Refund for transaction ${paymentId}`,
      refId: tx._id,
      status: 'completed',
    });

    logger.info({ userId: tx.userId, refundAmount, txId: refundTx._id }, '[wallet] Refund completed');
    return { gateway: 'wallet', refundId: refundTx._id.toString(), amount: refundAmount };
  }

  async handleWebhook(_payload) {
    throw new PaymentGatewayError('Wallet gateway does not support webhooks');
  }
}
