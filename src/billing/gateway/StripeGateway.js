import BaseGateway, { PaymentGatewayError } from './BaseGateway.js';
import logger from '../../config/logger.js';

export default class StripeGateway extends BaseGateway {
  constructor(config = {}) {
    super(config);
    this.name = 'stripe';
    this.stripe = null;
  }

  async initialize() {
    const Stripe = (await import('stripe')).default;
    this.stripe = new Stripe(this.config.secretKey, {
      apiVersion: '2025-02-24.acacia',
      maxNetworkRetries: 3,
    });
    logger.info('[stripe] Gateway initialized');
  }

  async createPayment(amount, currency, metadata = {}) {
    if (!this.stripe) await this.initialize();
    const { userId, description } = metadata;
    const formatted = this.formatAmount(amount, currency);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: formatted.amount,
      currency: formatted.currency,
      metadata: { userId: userId?.toString(), ...metadata },
      description: description || 'HORNET VPN Service',
      automatic_payment_methods: { enabled: true },
    });

    logger.info({ paymentId: paymentIntent.id, amount: formatted.amount }, '[stripe] Payment intent created');
    return {
      gateway: 'stripe',
      paymentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status,
      amount: formatted.amount,
      currency: formatted.currency,
    };
  }

  async verifyPayment(paymentId) {
    if (!this.stripe) await this.initialize();
    const intent = await this.stripe.paymentIntents.retrieve(paymentId);
    return {
      gateway: 'stripe',
      paymentId: intent.id,
      status: intent.status,
      amount: intent.amount,
      currency: intent.currency,
      verified: intent.status === 'succeeded',
      metadata: intent.metadata,
    };
  }

  async refundPayment(paymentId, amount) {
    if (!this.stripe) await this.initialize();
    const refund = await this.stripe.refunds.create({
      payment_intent: paymentId,
      amount: amount ? Math.round(amount * 100) : undefined,
    });
    logger.info({ refundId: refund.id, paymentId }, '[stripe] Refund created');
    return {
      gateway: 'stripe',
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount,
    };
  }

  async handleWebhook(payload, headers) {
    if (!this.stripe) await this.initialize();
    const sig = headers['stripe-signature'];
    if (!sig) throw new PaymentGatewayError('Missing stripe-signature header');

    try {
      const event = this.stripe.webhooks.constructEvent(payload, sig, this.config.webhookSecret);
      return {
        type: event.type,
        data: event.data.object,
        processed: true,
      };
    } catch (err) {
      throw new PaymentGatewayError(`Webhook verification failed: ${err.message}`);
    }
  }
}
