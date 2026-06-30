import BaseRepository from './BaseRepository.js';
import { Setting } from '../models/index.js';

class SettingRepository extends BaseRepository {
  constructor() {
    super(Setting);
  }

  async get(key, defaultValue = null) {
    return Setting.get(key, defaultValue);
  }

  async set(key, value) {
    return Setting.set(key, value);
  }
}

export default new SettingRepository();
