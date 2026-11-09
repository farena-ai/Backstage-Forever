"use strict";
class CatalogCache {
  constructor({ now = Date.now, ttl = 300000 } = {}) {
    this.now = now;
    this.ttl = ttl;
    this.epoch = 0;
    this.entries = new Map();
  }
  clear() {
    this.epoch++;
    this.entries.clear();
  }
  async get(key, load, refresh = false) {
    const existing = this.entries.get(key);
    if (existing?.pending) return structuredClone(await existing.pending);
    if (!refresh && existing && this.now() - existing.at < this.ttl)
      return structuredClone(existing.value);
    const epoch = this.epoch,
      entry = {};
    entry.pending = Promise.resolve()
      .then(load)
      .then((value) => {
        if (epoch !== this.epoch)
          throw Error("Connection changed. Refresh models again.");
        this.entries.set(key, {
          value: structuredClone(value),
          at: this.now(),
        });
        return value;
      })
      .catch((error) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      });
    this.entries.set(key, entry);
    return structuredClone(await entry.pending);
  }
}
module.exports = { CatalogCache };
