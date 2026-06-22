import BaseGateway, { PaymentGatewayError } from './BaseGateway.js';
import logger from '../../config/logger.js';
import crypto from 'crypto';
import TransactionRepository from '../../repositories/TransactionRepository.js';
import UserRepository from '../../repositories/UserRepository.js';
import mongoose from 'mongoose';

export default class CryptomusGateway extends BaseGateway {
  constructor(config = {}) {
    super(config);
    this.name = 'cryptomus';
    this.apiKey = config.apiKey;
    this.merchantId = config.merchantId;
    this.baseUrl = 'https://api.cryptomus.com/v1';
    this.supportedCoins = ['usdt', 'trx'];
    this.webhookSecret = config.webhookSecret;
    this.backendUrl = config.backendUrl;
    this.frontendUrl = config.frontendUrl;
  }

  async initialize() {
    if (!this.apiKey) throw new PaymentGatewayError('Cryptomus API key is required');
    if (!this.merchantId) throw new PaymentGatewayError('Cryptomus merchant ID is required');
    logger.info({ merchantId: this.merchantId }, '[cryptomus] Gateway initialized');
  }

  async createPayment(amount, currency = 'usd', metadata = {}) {
    if (!this.initialized) await this.initialize();
    const { userId } = metadata;
    if (!userId) throw new PaymentGatewayError('User ID is required');

    const orderId = crypto.randomBytes(16).toString('hex');
    const network = this.getNetworkForCoin('usdt');

    const paymentPayload = {
      amount: amount.toString(),
      currency: currency.toLowerCase(),
      network,
      paycurrency: 'usdt',
      order_id: orderId,
      callback_url: `${this.backendUrl}/api/webhooks/cryptomus`,
      url_return: `${this.frontendUrl}/payment/success`,
      is_payment_multiple: false,
    };

    try {
      const response = await this.makeRequest('/payment', 'POST', paymentPayload);

      const session = await mongoose.startSession();
      try {
        const result = await session.withTransaction(async () => {
          const user = await UserRepository.findById(userId, { session });
          if (!user) throw new PaymentGatewayError('User not found');

          const transaction = await TransactionRepository.create({
            userId,
            type: 'payment',
            amount,
            currency,
            description: `Cryptomus USDT payment via TRC20 (order ${orderId})`,
            balanceBefore: user.walletBalance,
            balanceAfter: user.walletBalance,
            metadata: {
              cryptomusStatus: 'pending_cryptomus_payment',
              cryptomusPaymentId: response.result.uuid,
              orderId,
              cryptomusOrderId: response.result.order_id,
              ...metadata,
            },
          }, { session });

          logger.info(
            { paymentId: response.result.uuid, userId, amount, orderId },
            '[cryptomus] Payment created on Cryptomus'
          );

          return {
            gateway: 'cryptomus',
            paymentId: response.result.uuid,
            orderId,
            status: response.result.status,
            amount,
            currency,
            paymentUrl: response.result.url,
            transactionId: transaction._id,
          };
        });

        return result;
      } finally {
        await session.endSession();
      }
    } catch (error) {
      logger.error({ error }, '[cryptomus] Failed to create payment');
      throw new PaymentGatewayError(`Failed to create Cryptomus payment: ${error.message}`);
    }
  }

  async verifyPayment(paymentId) {
    if (!this.initialized) await this.initialize();

    const statusPayload = {
      merchant_id: this.merchantId,
      payment_id: paymentId,
    };

    try {
      const response = await this.makeRequest('/payment/status', 'POST', statusPayload);

      return {
        gateway: 'cryptomus',
        paymentId,
        status: response.result.status,
        amount: parseFloat(response.result.amount),
        currency: response.result.currency,
        verified: response.result.status === 'paid' || response.result.status === 'paid_over',
        metadata: response.result,
      };
    } catch (error) {
      logger.error({ paymentId, error }, '[cryptomus] Failed to verify payment');
      throw new PaymentGatewayError(`Failed to verify Cryptomus payment: ${error.message}`);
    }
  }

  async handleWebhook(payload, headers) {
    if (!this.initialized) await this.initialize();

    const signature = headers['cryptomus-signature'] || headers['x-cryptomus-signature'];
    if (!signature) throw new PaymentGatewayError('Missing cryptomus-signature header');

    const payloadString = JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret || this.apiKey)
      .update(payloadString)
      .digest('base64');

    if (signature !== expectedSignature) throw new PaymentGatewayError('Invalid webhook signature');

    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const { type, data } = payload;

        if (type !== 'payment') throw new PaymentGatewayError('Unsupported webhook type');

        const paymentId = data.uuid || data.payment_id;
        const orderId = data.order_id;

        const transaction = await TransactionRepository.findOne({
          $or: [
            { 'metadata.cryptomusPaymentId': paymentId },
            { 'metadata.orderId': orderId },
            { 'metadata.cryptomusOrderId': orderId },
          ],
        }, { session });

        if (!transaction) throw new PaymentGatewayError('Transaction not found');

        const currentStatus = transaction.metadata?.cryptomusStatus;

        if (data.status === 'paid' || data.status === 'paid_over') {
          if (currentStatus === 'cryptomus_paid') {
            logger.info(
              { transactionId: transaction._id, paymentId, cryptomusStatus: currentStatus },
              '[cryptomus] Transaction already processed'
            );
            return { type: 'already_processed', processed: true };
          }

          const user = await UserRepository.findById(transaction.userId, { session });
          if (!user) throw new PaymentGatewayError('User not found');

          const newBalance = user.walletBalance + transaction.amount;

          transaction.metadata.cryptomusStatus = 'cryptomus_paid';
          transaction.metadata.verifiedAt = new Date();
          transaction.metadata.cryptomusPaymentId = paymentId;
          transaction.balanceAfter = newBalance;
          await transaction.save({ session });

          user.walletBalance = newBalance;
          await user.save({ session });

          logger.info(
            { transactionId: transaction._id, paymentId, amount: transaction.amount, userId: transaction.userId },
            '[cryptomus] Payment verified and funds added'
          );

          return { type: 'paid', transactionId: transaction._id, amount: transaction.amount, processed: true };
        }

        if (data.status === 'failed') {
          transaction.metadata.cryptomusStatus = 'cryptomus_failed';
          transaction.metadata.failureReason = data.failure_reason || data.message || 'Unknown failure reason';
          await transaction.save({ session });
          logger.warn(
            { transactionId: transaction._id, paymentId, reason: transaction.metadata.failureReason },
            '[cryptomus] Payment failed'
          );
          return { type: 'failed', transactionId: transaction._id, reason: transaction.metadata.failureReason, processed: true };
        }

        if (data.status === 'refunded') {
          transaction.metadata.cryptomusStatus = 'cryptomus_refunded';
          transaction.metadata.refundedAt = new Date();
          await transaction.save({ session });
          logger.info({ transactionId: transaction._id, paymentId }, '[cryptomus] Payment refunded');
          return { type: 'refunded', transactionId: transaction._id, processed: true };
        }

        transaction.metadata.cryptomusStatus = data.status;
        await transaction.save({ session });
        logger.warn(
          { transactionId: transaction._id, status: data.status },
          '[cryptomus] Unhandled payment status'
        );
        return { type: data.status, transactionId: transaction._id, processed: false };
      });

      return result;
    } finally {
      await session.endSession();
    }
  }

  generatePaymentSign(data) {
    const jsonString = JSON.stringify(data);
    const base64Data = Buffer.from(jsonString).toString('base64');
    return crypto.createHash('md5').update(base64Data + this.apiKey).digest('hex');
  }

  generateStatusSign(data) {
    const jsonString = JSON.stringify(data);
    const base64Data = Buffer.from(jsonString).toString('base64');
    return crypto
      .createHmac('sha256', this.apiKey)
      .update(base64Data)
      .digest('base64');
  }

  getNetworkForCoin(coin) {
    if (coin === 'usdt') return 'TRC20';
    if (coin === 'trx') return 'TRON';
    return 'TRC20';
  }

  async makeRequest(endpoint, method, data) {
    const url = `${this.baseUrl}${endpoint}`;
    const payloadString = JSON.stringify(data);

    const sign = (endpoint === '/payment' || endpoint === '/v1/payment')
      ? this.generatePaymentSign(data)
      : this.generateStatusSign(data);

    const headers = {
      merchant: this.merchantId,
      sign,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: payloadString,
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw new Error(`Cryptomus API error (${response.status}): ${JSON.stringify(responseData)}`);
    }

    return responseData;
  }

  async refundPayment(paymentId, amount) {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const transaction = await TransactionRepository.findOne({
          'metadata.cryptomusPaymentId': paymentId,
        }, { session });

        if (!transaction) throw new PaymentGatewayError('Transaction not found');
        if (transaction.metadata?.cryptomusStatus !== 'cryptomus_paid') {
          throw new PaymentGatewayError('Payment not in paid status');
        }

        const refundAmount = amount ? amount.toString() : transaction.amount.toString();

        const refundData = {
          payment_id: paymentId,
          amount: refundAmount,
          currency: transaction.currency,
        };

        const response = await this.makeRequest('/refund', 'POST', refundData);

        transaction.metadata.cryptomusStatus = 'cryptomus_refunded';
        transaction.metadata.refundedAt = new Date();
        transaction.metadata.refundId = response.result.refund_id;
        await transaction.save({ session });

        logger.info(
          { transactionId: transaction._id, paymentId, amount: refundAmount },
          '[cryptomus] Refund initiated'
        );

        return {
          gateway: 'cryptomus',
          refundId: response.result.refund_id,
          status: 'pending',
          amount: parseFloat(refundAmount),
          currency: transaction.currency,
          transactionId: transaction._id,
        };
      });
    } finally {
      await session.endSession();
    }
  }
}
