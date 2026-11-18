"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const v = require("./validation.cjs");
const { reconcileJourneys } = require("./journeys.cjs");
const { changeObjective, reconcileObjectives } = require("./objectives.cjs");
const { preserveMemories } = require("./memory-data.cjs");
const { RecoveryCheckpoints } = require("./recovery-checkpoints.cjs");
const { encodeJournalState, decodeJournalState, hasInlineDesktopAwards } = require("./journal-persistence.cjs");
class StoreStartupError extends Error {
  constructor(kind) { super("Saved local data could not be opened."); this.name = "StoreStartupError"; this.kind = kind; }
}
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
  constructor(dir, safeStorage, { recovery, now = Date.now } = {}) {
    this.dir = dir;
    this.safe = safeStorage;
    this.now = now;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "state.json");
    this.keyFile = path.join(dir, "credentials.json");
    let persisted;
    try {
      if (fs.existsSync(this.file)) {
        persisted = JSON.parse(fs.readFileSync(this.file, "utf8"));
        this.state = decodeJournalState(persisted);
      } else this.state = v.defaultState();
    } catch { throw new StoreStartupError("journal"); }
    this.state.journeys = reconcileJourneys(
      this.state.journeys,
      this.state.profiles,
    );
    this.state.objectives = reconcileObjectives(this.state.objectives, this.state.profiles);
    try { this.keys = fs.existsSync(this.keyFile)
      ? JSON.parse(fs.readFileSync(this.keyFile, "utf8"))
      : {};
    v.object(
      this.keys,
      v.providers.map((p) => p.id),
    );
    for (const val of Object.values(this.keys)) v.str(val, 20000, false);
    } catch { throw new StoreStartupError("credentials"); }
    // Rewrite only the validated wire format, without persisting startup reconciliation.
    // A blocked write is not journal damage and must not offer checkpoint replacement.
    if (persisted && hasInlineDesktopAwards(persisted)) {
      try { atomic(this.file, JSON.stringify(encodeJournalState(persisted), null, 2)); }
      catch { throw new StoreStartupError("migration"); }
    }
    this.recovery = recovery || new RecoveryCheckpoints(dir, { now });
    this.recoveryStarted = false;
  }
  recoveryStatus() { return this.recovery.status(); }
  startRecovery() { this.recoveryStarted = true; this.#automaticPoint("startup"); }
  closeRecovery() { this.#automaticPoint("close"); }
  #automaticPoint(reason) {
    if (!this.recoveryStarted || !(this.state.profiles.length || this.state.journeys.length || this.state.onboarded)) return;
    try { this.recovery.create(this.state, reason); } catch { /* Journaling remains available when protection fails. */ }
  }
  saveState(s) {
    const next = preserveMemories(this.state, s);
    const ids = new Set(next.profiles.map(p => p.id));
    return this.#writeState({ ...next, objectives: this.state.objectives.filter(o => ids.has(o.profileId)) }, true);
  }
  changeObjective(action) {
    return this.#writeState({ ...this.state, objectives: changeObjective(this.state, action, this.now) }, true);
  }
  saveMemories(memories) {
    return this.#writeState({ ...this.state, memories }, true);
  }
  clearRecoveryOriginal() { this.recovery.clearDamagedOriginal(); }
  #writeState(s, preserveObserved, capture = true) {
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
    valid.objectives = reconcileObjectives(valid.objectives, valid.profiles);
    const deleting = preserveObserved && this.state.profiles.some(p => !valid.profiles.some(next => next.id === p.id));
    if (deleting) this.recovery.clear();
    atomic(this.file, JSON.stringify(encodeJournalState(valid), null, 2));
    this.state = valid;
    if (capture && !deleting) this.#automaticPoint("save");
    this.onStateChange?.();
    return structuredClone(valid);
  }
  validateBackup(text) {
    if (Buffer.byteLength(text) > MAX_BACKUP_BYTES)
      throw new Error("Backup is too large.");
    return decodeJournalState(JSON.parse(text));
  }
  importData(text) {
    const valid = this.validateBackup(text);
    this.clearRecoveryOriginal();
    if (this.state.profiles.length || this.state.journeys.length || this.state.onboarded) this.recovery.create(this.state, "import");
    return this.#writeState({ ...valid, memories: [] }, false, false);
  }
  restoreCheckpoint(id, sha256) {
    const selected = this.recovery.read(id, sha256);
    this.recovery.create(this.state, "restore");
    return this.#writeState({ ...selected.state, memories: [] }, false, false);
  }
  exportData() {
    const { memories, ...exported } = this.state;
    return JSON.stringify(encodeJournalState(exported), null, 2);
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
    this.recovery.clear({ preferences: true });
    this.#writeState(v.defaultState(), false, false);
    atomic(this.keyFile, "{}");
    this.keys = {};
    return structuredClone(this.state);
  }
}
module.exports = { Store, StoreStartupError, atomic, MAX_BACKUP_BYTES };
