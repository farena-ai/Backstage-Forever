"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { validateState } = require("./validation.cjs");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_POINT_BYTES = 64 * 1024 * 1024, MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const REASONS = ["startup", "save", "close", "manual", "import", "restore"];
const pointName = name => name.endsWith(".json") && UUID.test(name.slice(0, -5));
const temporaryName = name => {
  if (!name.endsWith(".tmp") || !UUID.test(name.slice(-40, -4))) return false;
  const stem = name.slice(0, -41);
  return pointName(stem) || ["damaged-original.bin", "recovery-preferences.json"].includes(stem);
};
const ERRORS = Object.freeze({ unavailable: "Recovery is unavailable. Check local storage and try again.", limit: "Recovery limit reached. A point must fit within 64 MiB; journal content was not trimmed.", changed: "Recovery point changed. Preview it again before restoring.", invalid: "Recovery request is invalid." });
class RecoveryError extends Error { constructor(kind) { super(ERRORS[kind] || ERRORS.unavailable); this.kind = kind; } }
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
function regular(file) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || path.resolve(fs.realpathSync.native(file)).toLowerCase() !== path.resolve(file).toLowerCase()) throw new RecoveryError("unavailable");
  return s;
}
function readRegular(file, max) {
  const before = regular(file); if (before.size > max) throw new RecoveryError("limit");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!sameFile(before, fs.fstatSync(fd))) throw new RecoveryError("changed");
    // Read at most the checked length plus one, even if another process grows it.
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) { const n = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
    if (length !== before.size || !sameFile(before, regular(file)) || !sameFile(before, fs.fstatSync(fd))) throw new RecoveryError("changed");
    return { bytes: bytes.subarray(0, length), identity: before };
  } finally { fs.closeSync(fd); }
}
function writeAtomic(file, bytes, stagingDir = path.dirname(file)) {
  if (fs.existsSync(file)) regular(file);
  const temp = path.join(stagingDir, path.basename(file) + "." + crypto.randomUUID() + ".tmp");
  try { fs.writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 }); if (fs.existsSync(file)) regular(file); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
class RecoveryCheckpoints {
  constructor(dataDir, { now = Date.now, maxPointBytes = MAX_POINT_BYTES, maxTotalBytes = MAX_TOTAL_BYTES } = {}) {
    this.dataDir = dataDir; this.now = now; this.maxPointBytes = Math.min(maxPointBytes, MAX_POINT_BYTES); this.maxTotalBytes = Math.min(maxTotalBytes, MAX_TOTAL_BYTES); this.phase = "ready"; this.lastCapture = null;
  }
  root() { return fs.realpathSync.native(this.dataDir); }
  directory(create = false) {
    const dir = path.join(this.root(), "recovery");
    if (!fs.existsSync(dir)) { if (!create) return null; fs.mkdirSync(dir); }
    const s = fs.lstatSync(dir);
    if (!s.isDirectory() || s.isSymbolicLink() || fs.realpathSync.native(dir).toLowerCase() !== dir.toLowerCase()) throw new RecoveryError("unavailable");
    return dir;
  }
  entries() {
    const dir = this.directory(); if (!dir) return [];
    const handle = fs.opendirSync(dir), entries = [];
    try { let entry; while ((entry = handle.readSync())) { if (entries.length >= 64) throw new RecoveryError("unavailable"); entries.push(entry.name); } } finally { handle.closeSync(); }
    return entries.filter(name => pointName(name) || temporaryName(name) || name === "damaged-original.bin");
  }
  preference() {
    const file = path.join(this.root(), "recovery-preferences.json"); if (!fs.existsSync(file)) return true;
    const value = JSON.parse(readRegular(file, 1024).bytes.toString("utf8"));
    if (!value || Object.keys(value).length !== 1 || typeof value.automatic !== "boolean") throw new RecoveryError("unavailable");
    return value.automatic;
  }
  setAutomatic(value) {
    if (typeof value !== "boolean") throw new RecoveryError("invalid");
    try { writeAtomic(path.join(this.root(), "recovery-preferences.json"), JSON.stringify({ automatic: value }), this.directory(true)); this.phase = "ready"; return this.status(); }
    catch { this.phase = "unavailable"; throw new RecoveryError("unavailable"); }
  }
  read(id, expectedHash) {
    if (!UUID.test(id)) throw new RecoveryError("invalid");
    const dir = this.directory(); if (!dir) throw new RecoveryError("unavailable");
    return this.#readEnvelope(id, path.join(dir, id + ".json"), expectedHash);
  }
  #readEnvelope(id, file, expectedHash) {
    try {
      const { bytes } = readRegular(file, this.maxPointBytes), envelope = JSON.parse(bytes.toString("utf8"));
      if (Object.keys(envelope).sort().join() !== "createdAt,id,payload,reason,sha256,version" || envelope.version !== 1 || envelope.id !== id || !REASONS.includes(envelope.reason) || typeof envelope.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(envelope.createdAt) || new Date(envelope.createdAt).toISOString() !== envelope.createdAt || Date.parse(envelope.createdAt) > this.now() + 300000 || typeof envelope.payload !== "object" || !envelope.payload || Object.hasOwn(envelope.payload, "memories")) throw Error();
      const sha256 = hash(JSON.stringify(envelope.payload));
      if (sha256 !== envelope.sha256 || expectedHash && sha256 !== expectedHash) throw new RecoveryError("changed");
      const state = validateState(envelope.payload);
      return { id, createdAt: envelope.createdAt, reason: envelope.reason, bytes: bytes.length, profileCount: state.profiles.length, journeyCount: state.journeys.length, sha256, state, fileHash: hash(bytes) };
    } catch (e) { throw e instanceof RecoveryError ? e : new RecoveryError("unavailable"); }
  }
  list() {
    let inspectedBytes = 0;
    return this.entries().filter(n => n.endsWith(".json")).flatMap(name => {
      let size;
      try { size = regular(path.join(this.directory(), name)).size; } catch { return []; }
      if (size > this.maxPointBytes) return [];
      inspectedBytes += size;
      if (inspectedBytes > this.maxTotalBytes) throw new RecoveryError("unavailable");
      try { const { state, fileHash, ...point } = this.read(name.slice(0, -5)); return [point]; } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 3);
  }
  status() {
    let automatic = false;
    try { automatic = this.preference(); const points = this.list(); return { phase: this.phase, automatic, count: points.length, latestAt: points[0]?.createdAt || null }; }
    catch { return { phase: "unavailable", automatic, count: 0, latestAt: null }; }
  }
  #clearAbandonedStages() {
    const names = this.entries().filter(name => temporaryName(name) && pointName(name.slice(0, -41)));
    const files = names.map(name => ({ file: path.join(this.directory(), name), id: name.slice(0, 36) }));
    if (files.reduce((total, { file }) => total + regular(file).size, 0) > this.maxPointBytes) throw new RecoveryError("unavailable");
    // An uncommitted, fully validated memory-free stage can be retried from the journal.
    // Damaged or linked remnants remain untouched until an explicit privacy clear.
    for (const { file, id } of files) this.#readEnvelope(id, file);
    for (const { file } of files) { regular(file); fs.unlinkSync(file); }
  }
  create(input, reason) {
    try {
      if (!REASONS.includes(reason)) throw new RecoveryError("invalid");
      if (["startup", "save", "close", "import"].includes(reason) && !this.preference()) return null;
      this.#clearAbandonedStages();
      const { memories, ...payload } = validateState(input), sha256 = hash(JSON.stringify(payload));
      const points = this.list(), identical = points.find(p => p.sha256 === sha256);
      if (identical) { this.phase = "ready"; return identical; }
      const last = this.lastCapture ?? (points[0] ? Date.parse(points[0].createdAt) : null);
      if (reason === "save" && last !== null && this.now() - last < 900000) return null;
      const created = Math.max(this.now(), points[0] ? Date.parse(points[0].createdAt) + 1 : 0);
      const envelope = { version: 1, id: crypto.randomUUID(), createdAt: new Date(created).toISOString(), reason, sha256, payload }, bytes = Buffer.from(JSON.stringify(envelope));
      if (bytes.length > this.maxPointBytes || bytes.length > this.maxTotalBytes) throw new RecoveryError("limit");
      const dir = this.directory(true), files = this.entries().filter(n => n.endsWith(".json"));
      if (this.entries().some(temporaryName)) throw new RecoveryError("unavailable");
      // Unknown/corrupt managed points are never discarded to make room.
      if (files.length !== points.length) throw new RecoveryError("unavailable");
      for (const p of points) regular(path.join(dir, p.id + ".json"));
      const retained = [...points], evicted = []; let total = points.reduce((n, p) => n + p.bytes, bytes.length);
      while (retained.length >= 3 || total > this.maxTotalBytes) { const old = retained.pop(); if (!old) throw new RecoveryError("limit"); total -= old.bytes; evicted.push(old); }
      // Keep the new envelope uncommitted until permanent history fits its bounds.
      // Production's total >= 2 * single-point cap leaves a prior usable point
      // throughout eviction; a process exit cannot strand a fourth permanent file.
      if (points.length && !retained.length) throw new RecoveryError("limit");
      const file = path.join(dir, envelope.id + ".json"), staged = file + "." + crypto.randomUUID() + ".tmp";
      const rollback = evicted.map(old => ({ file: path.join(dir, old.id + ".json"), bytes: readRegular(path.join(dir, old.id + ".json"), this.maxPointBytes).bytes })), removed = [];
      try {
        fs.writeFileSync(staged, bytes, { flag: "wx", mode: 0o600 }); this.#readEnvelope(envelope.id, staged, sha256);
        for (const previous of rollback) { regular(previous.file); fs.unlinkSync(previous.file); removed.push(previous); }
        fs.renameSync(staged, file);
      } catch (e) {
        for (const previous of removed) if (!fs.existsSync(previous.file)) writeAtomic(previous.file, previous.bytes);
        throw e;
      } finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
      this.lastCapture = this.now(); this.phase = "ready";
      const { state, fileHash, ...point } = this.read(envelope.id); return point;
    } catch (e) { this.phase = e.kind === "limit" ? "limit" : "unavailable"; throw e instanceof RecoveryError ? e : new RecoveryError("unavailable"); }
  }
  clear({ preferences = false } = {}) {
    try {
      const dir = this.directory(), files = this.entries().map(name => path.join(dir, name));
      const pref = path.join(this.root(), "recovery-preferences.json"); if (preferences && fs.existsSync(pref)) files.push(pref);
      for (const file of files) regular(file);
      for (const file of files) { regular(file); fs.unlinkSync(file); }
      this.lastCapture = null; this.phase = "ready"; return this.status();
    } catch { this.phase = "unavailable"; throw new RecoveryError("unavailable"); }
  }
  prepareStartupRestore(id) {
    const point = this.read(id), original = readRegular(path.join(this.root(), "state.json"), MAX_POINT_BYTES);
    return { id, sha256: point.sha256, fileHash: point.fileHash, originalHash: hash(original.bytes), identity: original.identity };
  }
  clearDamagedOriginal() {
    try {
      const dir = this.directory(); if (!dir) return;
      const files = this.entries().filter(name => name === "damaged-original.bin" || name.startsWith("damaged-original.bin.") && temporaryName(name)).map(name => path.join(dir, name));
      for (const file of files) regular(file);
      for (const file of files) { regular(file); fs.unlinkSync(file); }
    } catch { this.phase = "unavailable"; throw new RecoveryError("unavailable"); }
  }
  disconnectSavedGame() {
    try {
      const file = path.join(this.root(), "game-connection.private.json");
      try { regular(file); } catch (e) { if (e.code === "ENOENT") return; throw e; }
      fs.unlinkSync(file);
    } catch { throw new RecoveryError("unavailable"); }
  }
  restoreDamaged(token) {
    try {
      if (this.entries().some(name => name.startsWith("damaged-original.bin.") && temporaryName(name))) throw new RecoveryError("unavailable");
      const point = this.read(token.id, token.sha256), file = path.join(this.root(), "state.json"), original = readRegular(file, MAX_POINT_BYTES);
      if (point.fileHash !== token.fileHash || hash(original.bytes) !== token.originalHash || !sameFile(original.identity, token.identity)) throw new RecoveryError("changed");
      const preserved = path.join(this.directory(true), "damaged-original.bin");
      if (fs.existsSync(preserved)) {
        if (hash(readRegular(preserved, MAX_POINT_BYTES).bytes) !== token.originalHash) throw new RecoveryError("unavailable");
      } else writeAtomic(preserved, original.bytes);
      // Preservation must complete and verify before replacement; keep it on every later failure.
      if (hash(readRegular(preserved, MAX_POINT_BYTES).bytes) !== token.originalHash) throw new RecoveryError("unavailable");
      const current = readRegular(file, MAX_POINT_BYTES);
      if (!sameFile(current.identity, token.identity) || hash(current.bytes) !== token.originalHash || this.read(token.id, token.sha256).fileHash !== token.fileHash) throw new RecoveryError("changed");
      this.disconnectSavedGame();
      writeAtomic(file, JSON.stringify({ ...point.state, memories: [] }, null, 2));
    } catch (e) { throw e instanceof RecoveryError ? e : new RecoveryError("unavailable"); }
  }
}
module.exports = { RecoveryCheckpoints, RecoveryError, ERRORS, UUID, MAX_POINT_BYTES, MAX_TOTAL_BYTES, readRegular, writeAtomic, hash, sameFile };
