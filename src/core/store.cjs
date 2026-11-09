"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const v = require("./validation.cjs");
const { reconcileJourneys } = require("./journeys.cjs");
// Bounded capacity for 100 profiles with complete quest histories and journals.
const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
function atomic(file, text) {
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safe = safeStorage;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "state.json");
    this.keyFile = path.join(dir, "credentials.json");
    this.state = fs.existsSync(this.file)
      ? v.validateState(JSON.parse(fs.readFileSync(this.file, "utf8")))
      : v.defaultState();
    this.state.journeys = reconcileJourneys(
      this.state.journeys,
      this.state.profiles,
    );
    this.keys = fs.existsSync(this.keyFile)
      ? JSON.parse(fs.readFileSync(this.keyFile, "utf8"))
      : {};
    v.object(
      this.keys,
      v.providers.map((p) => p.id),
    );
    for (const val of Object.values(this.keys)) v.str(val, 20000, false);
  }
  saveState(s) {
    return this.#writeState(s, true);
  }
  #writeState(s, preserveObserved) {
    const valid = v.validateState(s);
    if (preserveObserved) {
      // A stale ordinary edit must not erase a completion already saved locally.
      const previous = new Map(
        this.state.journeys.map((j) => [
          j.id,
          new Map(j.steps.map((step) => [step.id, step])),
        ]),
      );
      for (const journey of valid.journeys)
        for (const step of journey.steps) {
          const before = previous.get(journey.id)?.get(step.id);
          if (
            before?.observed &&
            step.quest &&
            before.quest &&
            step.profileId === before.profileId &&
            Object.keys(before.quest).every(
              (key) => before.quest[key] === step.quest[key],
            )
          )
            step.observed = structuredClone(before.observed);
        }
    }
    valid.journeys = reconcileJourneys(valid.journeys, valid.profiles);
    atomic(this.file, JSON.stringify(valid, null, 2));
    this.state = valid;
    return structuredClone(valid);
  }
  importData(text) {
    if (Buffer.byteLength(text) > MAX_BACKUP_BYTES)
      throw new Error("Backup is too large.");
    return this.#writeState(v.validateState(JSON.parse(text)), false);
  }
  exportData() {
    return JSON.stringify(this.state, null, 2);
  }
  secretStatus() {
    return Object.fromEntries(
      v.providers.map((p) => [p.id, Boolean(this.keys[p.id])]),
    );
  }
  getKey(id) {
    v.provider(id);
    if (!this.keys[id]) return "";
    if (!this.safe.isEncryptionAvailable())
      throw new Error("Secure credential storage is unavailable.");
    return this.safe.decryptString(Buffer.from(this.keys[id], "base64"));
  }
  saveKey(id, key) {
    v.provider(id);
    v.str(key, 8000, false);
    if (!this.safe.isEncryptionAvailable())
      throw new Error("Secure credential storage is unavailable.");
    const next = {
      ...this.keys,
      [id]: this.safe.encryptString(key).toString("base64"),
    };
    atomic(this.keyFile, JSON.stringify(next));
    this.keys = next;
  }
  deleteKey(id) {
    v.provider(id);
    const next = { ...this.keys };
    delete next[id];
    atomic(this.keyFile, JSON.stringify(next));
    this.keys = next;
    return this.secretStatus();
  }
  reset() {
    this.#writeState(v.defaultState(), false);
    atomic(this.keyFile, "{}");
    this.keys = {};
    return structuredClone(this.state);
  }
}
module.exports = { Store, atomic, MAX_BACKUP_BYTES };
