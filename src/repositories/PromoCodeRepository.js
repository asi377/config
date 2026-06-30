import BaseRepository from './BaseRepository.js';
import { PromoCode } from '../models/index.js';

class PromoCodeRepository extends BaseRepository {
  constructor() {
    super(PromoCode);
  }

  async findByCode(code) {
    return this.findOne({ code: code.toUpperCase() });
  }

  async isValid(code) {
    const promo = await this.findByCode(code);
    if (!promo) return false;
    if (!promo.isActive) return false;
    if (promo.isExpired) return false;
    if (promo.isExhausted) return false;
    return true;
  }
}

export default new PromoCodeRepository();
