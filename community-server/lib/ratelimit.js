"use strict";
// In-memory fixed-window rate limiter. Nothing here is persisted or logged.
class RateLimiter {
  constructor({ limit, windowMs, maxKeys = 50000 }) {
    this.limit = limit; this.windowMs = windowMs; this.maxKeys = maxKeys;
    this.buckets = new Map();
  }

  // Returns { ok, retryAfterSec }. Counts the hit only when it is allowed.
  hit(key, now = Date.now()) {
    let b = this.buckets.get(key);
    if (!b || now - b.start >= this.windowMs) {
      if (!b && this.buckets.size >= this.maxKeys) this.sweep(now);
      b = { start: now, count: 0 };
      this.buckets.set(key, b);
    }
    if (b.count >= this.limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.start + this.windowMs - now) / 1000)) };
    b.count += 1;
    return { ok: true, retryAfterSec: 0 };
  }

  sweep(now = Date.now()) {
    for (const [k, b] of this.buckets) if (now - b.start >= this.windowMs) this.buckets.delete(k);
    // Under a flood of distinct keys, start over rather than grow without bound.
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}

module.exports = { RateLimiter };
