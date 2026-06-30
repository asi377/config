class MemoryCache {
  constructor(options = {}) {
    this.store = new Map();
    this.ttl = options.ttl || 60000;
    this.maxSize = options.maxSize || 1000;
    this.hits = 0;
    this.misses = 0;
    this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    this._cleanupInterval.unref();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value;
  }

  set(key, value, ttl = this.ttl) {
    if (this.store.size >= this.maxSize) {
      this._evict();
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
    });
    return true;
  }

  del(key) {
    return this.store.delete(key);
  }

  flush() {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  wrap(key, fn, ttl = this.ttl) {
    const cached = this.get(key);
    if (cached !== null) return Promise.resolve(cached);

    return Promise.resolve(fn()).then(result => {
      this.set(key, result, ttl);
      return result;
    });
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(1) + '%' : '0%',
    };
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  _evict() {
    let oldest = null;
    let oldestKey = null;
    for (const [key, entry] of this.store) {
      if (!oldest || entry.createdAt < oldest.createdAt) {
        oldest = entry;
        oldestKey = key;
      }
    }
    if (oldestKey) this.store.delete(oldestKey);
  }
}

const defaultCache = new MemoryCache({ ttl: 30000, maxSize: 500 });

export { MemoryCache };
export default defaultCache;
