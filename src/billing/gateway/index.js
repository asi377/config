import config from '../../config/index.js';
import WalletGateway from './WalletGateway.js';
import StripeGateway from './StripeGateway.js';
import SmsC2CGateway from './SmsC2CGateway.js';
import CryptomusGateway from './CryptomusGateway.js';
import logger from '../../config/logger.js';

class PaymentGatewayManager {
  constructor() {
    this.gateways = new Map();
    this.defaultGateway = null;
  }

  async initialize() {
    this.register('wallet', new WalletGateway());

    if (config.stripe?.secretKey) {
      const stripe = new StripeGateway({
        secretKey: config.stripe.secretKey,
        webhookSecret: config.stripe.webhookSecret,
      });
      await stripe.initialize();
      this.register('stripe', stripe);
      this.defaultGateway = 'stripe';
      logger.info('[billing] Stripe gateway enabled');
    } else {
      this.defaultGateway = 'wallet';
      logger.info('[billing] Wallet-only mode (Stripe not configured)');
    }

    // SMS C2C gateway
    this.register('sms_c2c', new SmsC2CGateway());
    logger.info('[billing] SMS C2C gateway enabled');

    // Cryptomus gateway
    if (config.cryptomus?.apiKey && config.cryptomus?.merchantId) {
      const cryptomus = new CryptomusGateway({
        apiKey: config.cryptomus.apiKey,
        merchantId: config.cryptomus.merchantId,
        webhookSecret: config.cryptomus.webhookSecret,
        backendUrl: config.backendUrl,
        frontendUrl: config.corsOrigin,
      });
      await cryptomus.initialize();
      this.register('cryptomus', cryptomus);
      logger.info('[billing] Cryptomus gateway enabled');
    } else {
      logger.info('[billing] Cryptomus gateway disabled (not configured)');
    }
  }

  register(name, gateway) {
    this.gateways.set(name, gateway);
  }

  get(name) {
    const gw = name ? this.gateways.get(name) : this.gateways.get(this.defaultGateway);
    if (!gw) throw new Error(`Payment gateway "${name || this.defaultGateway}" not available`);
    return gw;
  }

  async createPayment(amount, currency = 'irr', metadata = {}, gateway = null) {
    return this.get(gateway).createPayment(amount, currency, metadata);
  }

  async verifyPayment(paymentId, gateway = null) {
    return this.get(gateway).verifyPayment(paymentId);
  }

  async refundPayment(paymentId, amount = null, gateway = null) {
    return this.get(gateway).refundPayment(paymentId, amount);
  }

  async handleWebhook(gateway, payload, headers) {
    return this.get(gateway).handleWebhook(payload, headers);
  }

  getAvailableGateways() {
    return Array.from(this.gateways.keys());
  }
}

export default new PaymentGatewayManager();
