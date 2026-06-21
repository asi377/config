import { EventEmitter } from 'events';
import logger from '../config/logger.js';

class EventBus {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.listeners = new Map();
  }

  on(event, handler, { name = null, once = false } = {}) {
    const listenerId = name || `${event}_${handler.name || Date.now()}`;
    if (this.listeners.has(listenerId)) return listenerId;

    const wrapped = once ? (...args) => { handler(...args); this.off(listenerId); } : handler;

    this.emitter[once ? 'once' : 'on'](event, wrapped);
    this.listeners.set(listenerId, { event, handler: wrapped });
    logger.debug({ event, listenerId }, '[events] Listener registered');
    return listenerId;
  }

  once(event, handler) {
    return this.on(event, handler, { once: true });
  }

  emit(event, data = {}) {
    const start = Date.now();
    this.emitter.emit(event, data);
    const duration = Date.now() - start;
    if (duration > 100) {
      logger.warn({ event, duration }, '[events] Slow emit');
    }
  }

  off(listenerId) {
    const entry = this.listeners.get(listenerId);
    if (!entry) return false;
    this.emitter.off(entry.event, entry.handler);
    this.listeners.delete(listenerId);
    return true;
  }

  removeAll(event) {
    if (event) {
      this.emitter.removeAllListeners(event);
      for (const [id, entry] of this.listeners) {
        if (entry.event === event) this.listeners.delete(id);
      }
    } else {
      this.emitter.removeAllListeners();
      this.listeners.clear();
    }
  }

  listenerCount(event) {
    return this.emitter.listenerCount(event);
  }
}

const bus = new EventBus();

export { EventBus };
export default bus;
