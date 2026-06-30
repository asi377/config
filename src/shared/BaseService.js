import logger from '../config/logger.js';
import { AppError } from './errors.js';

export default class BaseService {
  constructor() {
    this.logger = logger.child({ service: this.constructor.name });
  }

  wrapMethod(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        if (error instanceof AppError) throw error;
        this.logger.error({ err: error, args }, `${this.constructor.name} method failed`);
        throw error;
      }
    };
  }
}
