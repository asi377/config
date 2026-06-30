export class PaymentGatewayError extends Error {
  constructor(message, code = 'GATEWAY_ERROR') {
    super(message);
    this.name = 'PaymentGatewayError';
    this.code = code;
  }
}

export default class BaseGateway {
  constructor(config = {}) {
    this.config = config;
    this.name = 'base';
  }

  async createPayment(_amount, _currency, _metadata) {
    throw new Error('Not implemented');
  }

  async verifyPayment(_paymentId) {
    throw new Error('Not implemented');
  }

  async refundPayment(_paymentId, _amount) {
    throw new Error('Not implemented');
  }

  async handleWebhook(_payload, _headers) {
    throw new Error('Not implemented');
  }

  formatAmount(amount, currency = 'irr') {
    if (currency === 'irr') return { amount: Math.round(amount), currency: 'irr' };
    return { amount: Math.round(amount * 100), currency: currency.toLowerCase() };
  }
}
