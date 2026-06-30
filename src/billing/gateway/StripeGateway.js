import BaseGateway, { PaymentGatewayError } from './BaseGateway.js';
import logger from '../../config/logger.js';
import TransactionRepository from '../../repositories/TransactionRepository.js';
import UserRepository from '../../repositories/UserRepository.js';
import mongoose from 'mongoose';
import Stripe from 'stripe';

export default class StripeGateway extends BaseGateway {
  constructor(config = {}) {
    super(config);
    this.name = 'stripe';
    this.stripe = null;
    this.webhookSecret = config.webhookSecret;
  }

  async initialize() {
    if (!this.config.secretKey) throw new PaymentGatewayError('Stripe secret key is required');
    this.stripe = new Stripe(this.config.secretKey);
    logger.info('[stripe] Gateway initialized');
  }

  async createPayment(amount, currency = 'usd', metadata = {}) {
    if (!this.initialized) await this.initialize();
    const { userId, idempotencyKey } = metadata;
    if (!userId) throw new PaymentGatewayError('User ID is required');

    // Idempotency check
    if (idempotencyKey) {
      const existing = await TransactionRepository.findOne({
        'metadata.stripeIdempotencyKey': idempotencyKey,
      });
      if (existing) {
        logger.info({ txId: existing._id, idempotencyKey }, '[stripe] Idempotent create');
        return {
          gateway: 'stripe',
          paymentId: existing.metadata?.stripePaymentIntentId,
          status: existing.status,
          amount,
          transactionId: existing._id,
        };
      }
    }

    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: Math.round(amount * 100), // cents
        currency: currency.toLowerCase(),
        metadata: { userId, ...metadata },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: idempotencyKey ? `pi_${idempotencyKey}` : undefined },
    );

    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const user = await UserRepository.findById(userId, { session });
        if (!user) throw new PaymentGatewayError('User not found');

        const transaction = await TransactionRepository.create({
          userId,
          type: 'payment',
          status: 'pending',
          amount,
          currency,
          description: `Stripe payment (PI: ${paymentIntent.id})`,
          balanceBefore: user.walletBalance,
          balanceAfter: user.walletBalance,
          metadata: {
            stripePaymentIntentId: paymentIntent.id,
            stripeIdempotencyKey: idempotencyKey || null,
            ...metadata,
          },
        }, { session });

        return {
          gateway: 'stripe',
          paymentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          status: paymentIntent.status,
          amount,
          currency,
          transactionId: transaction._id,
        };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async handleWebhook(payload, headers) {
    if (!this.initialized) await this.initialize();
    const sig = headers['stripe-signature'];
    if (!sig) throw new PaymentGatewayError('Missing stripe-signature header');

    let event;
    try {
      event = this.stripe.webhooks.constructEvent(payload, sig, this.webhookSecret);
    } catch (err) {
      throw new PaymentGatewayError(`Stripe webhook signature verification failed: ${err.message}`);
    }

    // Idempotency: skip duplicate events
    const eventId = event.id;
    const alreadyProcessed = await TransactionRepository.findOne({
      'metadata.processedStripeEventIds': eventId,
    });
    if (alreadyProcessed) {
      logger.info({ eventId }, '[stripe] Duplicate webhook event — skipping');
      return { type: 'already_processed', processed: true };
    }

    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const intent = event.data.object;
        let transaction;

        switch (event.type) {
          case 'payment_intent.succeeded': {
            transaction = await TransactionRepository.findOne({
              'metadata.stripePaymentIntentId': intent.id,
            }, { session });
            if (!transaction) throw new PaymentGatewayError('Transaction not found');

            const updated = await TransactionRepository.model.findOneAndUpdate(
              {
                _id: transaction._id,
                status: { $ne: 'completed' },
              },
              {
                $set: {
                  status: 'completed',
                  balanceAfter: (transaction.balanceBefore || 0) + transaction.amount,
                  'metadata.verifiedAt': new Date(),
                },
                $push: { 'metadata.processedStripeEventIds': eventId },
              },
              { new: true, session },
            );
            if (!updated) {
              logger.info({ txId: transaction._id }, '[stripe] Already completed — skipping');
              return { type: 'already_processed', processed: true };
            }

            const user = await UserRepository.findById(updated.userId, { session });
            if (!user) throw new PaymentGatewayError('User not found');
            user.walletBalance = updated.balanceAfter;
            await user.save({ session });

            logger.info({ txId: updated._id, amount: updated.amount }, '[stripe] Payment confirmed');
            return { type: 'paid', transactionId: updated._id, processed: true };
          }

          case 'payment_intent.payment_failed': {
            transaction = await TransactionRepository.findOne({
              'metadata.stripePaymentIntentId': intent.id,
            }, { session });
            if (transaction) {
              await TransactionRepository.model.updateOne(
                { _id: transaction._id },
                {
                  $set: { status: 'failed', 'metadata.failureReason': intent.last_payment_error?.message },
                  $push: { 'metadata.processedStripeEventIds': eventId },
                },
                { session },
              );
            }
            return { type: 'failed', processed: true };
          }

          default:
            logger.warn({ eventType: event.type }, '[stripe] Unhandled event type');
            return { type: event.type, processed: false };
        }
      });
    } finally {
      await session.endSession();
    }
  }

  async verifyPayment(paymentId) {
    if (!this.initialized) await this.initialize();
    const intent = await this.stripe.paymentIntents.retrieve(paymentId);
    return {
      gateway: 'stripe',
      paymentId,
      status: intent.status,
      amount: intent.amount / 100,
      currency: intent.currency,
      verified: intent.status === 'succeeded',
    };
  }

  async refundPayment(paymentId, amount) {
    if (!this.initialized) await this.initialize();
    const refund = await this.stripe.refunds.create({
      payment_intent: paymentId,
      amount: amount ? Math.round(amount * 100) : undefined,
    });
    return {
      gateway: 'stripe',
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount / 100,
    };
  }
}
