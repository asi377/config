import logger from '../config/logger.js';

const STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.resetTimeout = options.resetTimeout || 30000;
    this.state = STATE.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  isOpen() {
    if (this.state === STATE.CLOSED) return false;
    if (this.state === STATE.OPEN) {
      if (Date.now() >= this.nextAttemptTime) {
        this.state = STATE.HALF_OPEN;
        this.successCount = 0;
        logger.info({ breaker: this.name }, '[cb] Half-open');
        return false;
      }
      return true;
    }
    return false;
  }

  async call(fn, fallback = null) {
    if (this.isOpen()) {
      logger.warn({ breaker: this.name, state: this.state }, '[cb] Circuit open, using fallback');
      if (fallback) return typeof fallback === 'function' ? fallback() : fallback;
      throw new Error(`Circuit breaker open for ${this.name}`);
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      if (fallback) return typeof fallback === 'function' ? fallback() : fallback;
      throw err;
    }
  }

  _onSuccess() {
    if (this.state === STATE.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = STATE.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        logger.info({ breaker: this.name }, '[cb] Closed');
      }
    } else {
      this.failureCount = 0;
    }
  }

  _onFailure(err) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    logger.warn({ breaker: this.name, failureCount: this.failureCount, err: err.message }, '[cb] Failure');

    if (this.failureCount >= this.failureThreshold) {
      this.state = STATE.OPEN;
      this.nextAttemptTime = Date.now() + this.resetTimeout;
      logger.error({ breaker: this.name, resetTimeout: this.resetTimeout }, '[cb] Opened');
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }
}

const breakers = new Map();

export function getCircuitBreaker(name, options = {}) {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker(name, options));
  }
  return breakers.get(name);
}

export { CircuitBreaker, STATE };
export default { getCircuitBreaker, CircuitBreaker };
