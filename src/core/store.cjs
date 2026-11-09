"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const v = require("./validation.cjs");
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
    const valid = v.validateState(s);
    atomic(this.file, JSON.stringify(valid, null, 2));
    this.state = valid;
    return structuredClone(valid);
  }
  importData(text) {
    if (Buffer.byteLength(text) > 4000000)
      throw new Error("Backup is too large.");
    return this.saveState(v.validateState(JSON.parse(text)));
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
    this.saveState(v.defaultState());
    atomic(this.keyFile, "{}");
    this.keys = {};
    return structuredClone(this.state);
  }
}
module.exports = { Store, atomic };
