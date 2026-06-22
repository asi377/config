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
    this.supportedCoins = ['usdt', 'trx']; // Tether (TRC20) and TRON
    this.webhookSecret = config.webhookSecret;
  }

  async initialize() {
    if (!this.apiKey) {
      throw new PaymentGatewayError('Cryptomus API key is required');
    }
    logger.info('[cryptomus] Gateway initialized');
  }

  async createPayment(amount, currency = 'usd', metadata = {}) {
    if (!this.initialized) await this.initialize();
    const { userId } = metadata;

    if (!userId) throw new PaymentGatewayError('User ID is required');

    // Create a payment on Cryptomus
    const paymentData = {
      amount: amount.toString(),
      currency: currency.toLowerCase(),
      network: this.getNetworkForCoin(this.supportedCoins[0]),
      paycurrency: 'usd',
      order_id: crypto.randomBytes(16).toString('hex'),
      callback_url: `${this.config.backendUrl}/api/webhooks/cryptomus`,
      url_return: `${this.config.frontendUrl}/payment/success`,
      sign: this.generatePaymentSign(amount.toString(), this.supportedCoins[0], this.supportedCoins[0], 'usd'),
    };

    try {
      const response = await this.makeRequest('/merchant/v2/create', 'POST', paymentData);

      // Save pending transaction
      const session = await mongoose.startSession();
      try {
        const result = await session.withTransaction(async () => {
          const user = await UserRepository.findById(userId, { session });
          if (!user) throw new PaymentGatewayError('User not found');

          const transaction = await TransactionRepository.create({
            userId,
            type: 'payment',
            category: 'cryptomus_payment',
            amount,
            currency,
            description: `Cryptomus ${this.supportedCoins[0].toUpperCase()} payment via ${this.supportedCoins[0]}`,
            balanceBefore: user.walletBalance,
            balanceAfter: user.walletBalance,
            metadata: { cryptomusPaymentId: response.data.payment_id, orderId: paymentData.order_id, ...metadata },
            status: 'pending_cryptomus_payment',
          }, { session });

          logger.info({ paymentId: response.data.payment_id, userId, amount }, '[cryptomus] Payment created on Cryptomus');

          return {
            gateway: 'cryptomus',
            paymentId: response.data.payment_id,
            orderId: paymentData.order_id,
            status: response.data.status,
            amount,
            currency,
            paymentUrl: response.data.url,
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

    try {
      const paymentData = {
        type: 'merchant',
        merchant_id: this.merchantId,
        payment_id: paymentId,
          sign: this.generateStatusSign(paymentId, this.merchantId),
      };

      const response = await this.makeRequest('/merchant/v2/payment/status', 'POST', paymentData);

      return {
        gateway: 'cryptomus',
        paymentId,
        status: response.data.status,
        amount: parseFloat(response.data.amount),
        currency: response.data.currency,
        verified: response.data.status === 'paid',
        metadata: response.data,
      };
    } catch (error) {
      logger.error({ paymentId, error }, '[cryptomus] Failed to verify payment');
      throw new PaymentGatewayError(`Failed to verify Cryptomus payment: ${error.message}`);
    }
  }

  async handleWebhook(payload, headers) {
    if (!this.initialized) await this.initialize();

    // Verify webhook signature
    const signature = headers['cryptomus-signature'] || headers['x-cryptomus-signature'];
    if (!signature) throw new PaymentGatewayError('Missing cryptomus-signature header');

    const payloadString = JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payloadString)
      .digest('hex');

    if (signature !== expectedSignature) throw new PaymentGatewayError('Invalid webhook signature');

    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const { type, data } = payload;

        if (type !== 'payment') throw new PaymentGatewayError('Unsupported webhook type');

        const paymentId = data.payment_id;
        let transaction = await TransactionRepository.findOne({
          'metadata.cryptomusPaymentId': paymentId,
        }, { session });

        if (!transaction) throw new PaymentGatewayError('Transaction not found');

        // Handle different payment statuses
        let user;
        if (data.status === 'paid') {
          user = await UserRepository.findById(transaction.userId, { session });
          if (!user) throw new PaymentGatewayError('User not found');
          user.walletBalance += transaction.amount;
          await user.save({ session });
          transaction.balanceAfter = user.walletBalance;
        }

        switch (data.status) {
          case 'paid':
            if (transaction.status !== 'pending_cryptomus_payment') {
              logger.info({ transactionId: transaction._id, paymentId, status: transaction.status }, '[cryptomus] Transaction already processed');
              return { type: 'already_processed', processed: true };
            }

            // Update transaction
            transaction.status = 'cryptomus_paid';
            transaction.verifiedAt = new Date();
            transaction.metadata.verifiedAt = transaction.verifiedAt;

            logger.info({ transactionId: transaction._id, paymentId, amount: transaction.amount }, '[cryptomus] Payment verified and funds added');
            return { type: 'paid', transactionId: transaction._id, amount: transaction.amount, processed: true };

          case 'failed':
            transaction.status = 'cryptomus_failed';
            transaction.metadata.failureReason = data.failure_reason;
            await transaction.save({ session });
            logger.warn({ transactionId: transaction._id, paymentId, reason: data.failure_reason }, '[cryptomus] Payment failed');
            return { type: 'failed', transactionId: transaction._id, reason: data.failure_reason, processed: true };

          case 'refunded':
            transaction.status = 'cryptomus_refunded';
            transaction.metadata.refundedAt = new Date();
            await transaction.save({ session });
            logger.info({ transactionId: transaction._id, paymentId }, '[cryptomus] Payment refunded');
            return { type: 'refunded', transactionId: transaction._id, processed: true };

          default:
            logger.warn({ transactionId: transaction._id, status: data.status }, '[cryptomus] Unhandled payment status');
            return { type: data.status, transactionId: transaction._id, processed: false };
        }
      });

      return result;
    } finally {
      await session.endSession();
    }
  }

  generatePaymentSign(amount, coin, network, currency) {
    const data = `${amount}|${this.merchantId}|${coin}|${network}|${currency}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  generateStatusSign(paymentId, merchantId) {
    const data = `${paymentId}|${merchantId}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  getNetworkForCoin(coin) {
    // Map coin to network
    if (coin === 'usdt') return 'TRC20';
    if (coin === 'trx') return 'TRON';
    return 'TRC20'; // Default
  }

  async makeRequest(endpoint, method, data) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'merchant-id': this.merchantId,
      'api-key': this.apiKey,
      'Content-Type': 'application/json',
      'Content-MD5': crypto.createHash('md5').update(JSON.stringify(data)).digest('hex'),
    };

    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  async refundPayment(paymentId, amount) {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const transaction = await TransactionRepository.findOne({
          'metadata.cryptomusPaymentId': paymentId,
        }, { session });

        if (!transaction) throw new PaymentGatewayError('Transaction not found');
        if (transaction.status !== 'cryptomus_paid') throw new PaymentGatewayError('Payment not in paid status');

        const refundData = {
          payment_id: paymentId,
          amount: amount ? amount.toString() : transaction.amount.toString(),
          currency: transaction.currency,
        sign: this.generateStatusSign(paymentId, this.merchantId),
        };

        const response = await this.makeRequest('/merchant/v2/refund', 'POST', refundData);

        transaction.status = 'cryptomus_refunded';
        transaction.metadata.refundedAt = new Date();
        transaction.metadata.refundId = response.data.refund_id;
        await transaction.save({ session });

        logger.info({ transactionId: transaction._id, paymentId, amount }, '[cryptomus] Refund initiated');

        return {
          gateway: 'cryptomus',
          refundId: response.data.refund_id,
          status: 'pending',
          amount: amount || transaction.amount,
          currency: transaction.currency,
          transactionId: transaction._id,
        };
      });
    } finally {
      await session.endSession();
    }
  }
}