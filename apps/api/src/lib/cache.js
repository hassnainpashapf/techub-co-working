// Phase 28 Track 5: In-memory LRU response cache. No dependencies.
// Used by cacheMiddleware for heavy GET endpoints (dashboard, reports).

function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

class LRUCache {
  constructor(maxEntries = 500) {
    this.max = maxEntries;
    this.map = new Map(); // key -> { value, expiresAt }
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // Refresh LRU order (most-recently-used goes last)
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return safeClone(entry.value);
  }

  set(key, value, ttlSec = 60) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      // Evict least-recently-used (first key in insertion order)
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, {
      value: safeClone(value),
      expiresAt: Date.now() + Math.max(1, ttlSec) * 1000,
    });
  }

  del(key) {
    this.map.delete(key);
  }

  // Remove every key starting with prefix. Returns count removed.
  delByPrefix(prefix) {
    let removed = 0;
    for (const k of Array.from(this.map.keys())) {
      if (k.startsWith(prefix)) {
        this.map.delete(k);
        removed++;
      }
    }
    return removed;
  }

  clear() {
    this.map.clear();
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.map.size,
      max: this.max,
      hitRate: total > 0 ? Math.round((this.hits / total) * 1000) / 1000 : 0,
    };
  }
}

// Shared singleton for the API process.
const cache = new LRUCache(500);

module.exports = { LRUCache, cache };
