"use strict";
// Read-only reader for the player's own local WoW installation (CASC storage).
// Used only to show the player's own copy of the game's map art inside the desktop
// app; nothing read here is bundled, uploaded or redistributed.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const hex = (b) => Buffer.from(b).toString("hex");

function parseBuildInfo(text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split("|").map((h) => h.split("!")[0]);
  return lines.map((l) => Object.fromEntries(l.split("|").map((v, i) => [head[i], v])));
}

function parseConfig(text) {
  const out = {};
  for (const l of String(text).split(/\r?\n/)) {
    const m = /^([\w-]+)\s*=\s*(.*)$/.exec(l);
    if (m) out[m[1]] = m[2].trim().split(/\s+/);
  }
  return out;
}

// BLTE container: one or more chunks, each raw (N), zlib (Z) or a nested frame (F).
// Encrypted chunks (E) need a key the player's client may not hold. With zeroEncrypted they
// become zero bytes of their declared size, so a DB2 can skip its encrypted sections instead.
function blte(buf, { zeroEncrypted = false } = {}) {
  if (buf.toString("latin1", 0, 4) !== "BLTE") throw Error("Not a BLTE stream.");
  const headerSize = buf.readUInt32BE(4);
  const decodeChunk = (c, size) => {
    const mode = String.fromCharCode(c[0]);
    if (mode === "N") return c.subarray(1);
    if (mode === "Z") return zlib.inflateSync(c.subarray(1));
    if (mode === "F") return blte(c.subarray(1));
    if (mode === "E" && zeroEncrypted && size !== undefined) return Buffer.alloc(size);
    if (mode === "E") { const e = Error("Encrypted content is not readable."); e.code = "ENCRYPTED"; throw e; }
    throw Error(`Unknown BLTE chunk mode ${mode}.`);
  };
  if (headerSize === 0) return decodeChunk(buf.subarray(8));
  const count = buf.readUIntBE(9, 3);
  const parts = [];
  let pos = headerSize;
  for (let i = 0; i < count; i++) {
    const comp = buf.readUInt32BE(12 + i * 24);
    parts.push(decodeChunk(buf.subarray(pos, pos + comp), buf.readUInt32BE(16 + i * 24)));
    pos += comp;
  }
  return Buffer.concat(parts);
}

// Bob Jenkins' lookup3 hashlittle2, as CASC uses for file name hashes.
function hashlittle2(key, pc = 0, pb = 0) {
  const rot = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  let length = key.length;
  let a, b, c;
  a = b = c = (0xdeadbeef + length + pc) >>> 0;
  c = (c + pb) >>> 0;
  let o = 0;
  const u = (i) => key[o + i] || 0;
  const mix = () => {
    a = (a - c) >>> 0; a ^= rot(c, 4); c = (c + b) >>> 0;
    b = (b - a) >>> 0; b ^= rot(a, 6); a = (a + c) >>> 0;
    c = (c - b) >>> 0; c ^= rot(b, 8); b = (b + a) >>> 0;
    a = (a - c) >>> 0; a ^= rot(c, 16); c = (c + b) >>> 0;
    b = (b - a) >>> 0; b ^= rot(a, 19); a = (a + c) >>> 0;
    c = (c - b) >>> 0; c ^= rot(b, 4); b = (b + a) >>> 0;
  };
  const fin = () => {
    c ^= b; c = (c - rot(b, 14)) >>> 0;
    a ^= c; a = (a - rot(c, 11)) >>> 0;
    b ^= a; b = (b - rot(a, 25)) >>> 0;
    c ^= b; c = (c - rot(b, 16)) >>> 0;
    a ^= c; a = (a - rot(c, 4)) >>> 0;
    b ^= a; b = (b - rot(a, 14)) >>> 0;
    c ^= b; c = (c - rot(b, 24)) >>> 0;
  };
  const word = (i) => (u(i) | (u(i + 1) << 8) | (u(i + 2) << 16) | (u(i + 3) << 24)) >>> 0;
  while (length > 12) {
    a = (a + word(0)) >>> 0; b = (b + word(4)) >>> 0; c = (c + word(8)) >>> 0;
    mix(); length -= 12; o += 12;
  }
  if (length === 0) return [c >>> 0, b >>> 0];
  const tail = (from, n) => { let v = 0; for (let i = 0; i < n; i++) v |= u(from + i) << (8 * i); return v >>> 0; };
  a = (a + tail(0, Math.min(4, length))) >>> 0;
  if (length > 4) b = (b + tail(4, Math.min(4, length - 4))) >>> 0;
  if (length > 8) c = (c + tail(8, length - 8)) >>> 0;
  fin();
  return [c >>> 0, b >>> 0];
}
function nameHash(filePath) {
  const [pc, pb] = hashlittle2(Buffer.from(String(filePath).replace(/\//g, "\\").toUpperCase(), "latin1"));
  return (BigInt(pc) << 32n) | BigInt(pb);
}

class CascStorage {
  constructor({ installDir, product = "wowf" }) {
    this.installDir = installDir;
    this.dataDir = path.join(installDir, "Data");
    const info = parseBuildInfo(fs.readFileSync(path.join(installDir, ".build.info"), "utf8"));
    const row = info.find((r) => r.Product === product && r.Active === "1") || info.find((r) => r.Product === product);
    if (!row) throw Error(`No ${product} build in this installation.`);
    this.version = row.Version;
    this.buildKey = row["Build Key"];
    this.build = parseConfig(fs.readFileSync(this.configPath(this.buildKey), "utf8"));
    this.indexes = this.loadIndexes();
    this.fds = new Map();
  }
  configPath(key) { return path.join(this.dataDir, "config", key.slice(0, 2), key.slice(2, 4), key); }
  loadIndexes() {
    const dir = path.join(this.dataDir, "data");
    const latest = new Map();
    for (const f of fs.readdirSync(dir)) {
      const m = /^([0-9a-f]{2})([0-9a-f]{8})\.idx$/i.exec(f);
      if (!m) continue;
      const bucket = parseInt(m[1], 16), ver = parseInt(m[2], 16);
      if (!latest.has(bucket) || latest.get(bucket).ver < ver) latest.set(bucket, { ver, f });
    }
    const out = new Map();
    for (const [bucket, { f }] of latest) {
      const buf = fs.readFileSync(path.join(dir, f));
      const headerHashSize = buf.readUInt32LE(0);
      const h = 8;
      const spec = { size: buf[h + 4], offset: buf[h + 5], key: buf[h + 6], bits: buf[h + 7] };
      let pos = (8 + headerHashSize + 15) & ~15;
      const entriesSize = buf.readUInt32LE(pos);
      pos += 8;
      const stride = spec.key + spec.offset + spec.size;
      out.set(bucket, { buf, start: pos, count: Math.floor(entriesSize / stride), stride, spec });
    }
    return out;
  }
  bucketOf(ekey) { let x = 0; for (let i = 0; i < 9; i++) x ^= ekey[i]; return (x & 0xf) ^ (x >> 4); }
  locate(ekey) {
    const idx = this.indexes.get(this.bucketOf(ekey));
    if (!idx) return null;
    const { buf, start, count, stride, spec } = idx;
    if (!idx.order) {
      // Entries are stored in runs, not globally sorted: sort once per bucket.
      const order = new Uint32Array(count);
      for (let i = 0; i < count; i++) order[i] = start + i * stride;
      order.sort((x, y) => buf.compare(buf, x, x + spec.key, y, y + spec.key) || x - y);
      idx.order = order;
    }
    let lo = 0, hi = count - 1;
    const want = ekey.subarray(0, spec.key);
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = idx.order[mid];
      const cmp = buf.compare(want, 0, spec.key, at, at + spec.key);
      if (cmp === 0) {
        const raw = buf.readUIntBE(at + spec.key, spec.offset);
        const shift = 2 ** spec.bits;
        return { archive: Math.floor(raw / shift), offset: raw % shift, size: buf.readUInt32LE(at + spec.key + spec.offset) };
      }
      if (cmp > 0) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  }
  readEKey(ekeyHex, opts) {
    const loc = this.locate(Buffer.from(ekeyHex, "hex"));
    if (!loc) { const e = Error("Not present in local storage."); e.code = "MISSING"; throw e; }
    const file = path.join(this.dataDir, "data", `data.${String(loc.archive).padStart(3, "0")}`);
    let fd = this.fds.get(file);
    if (fd === undefined) { fd = fs.openSync(file, "r"); this.fds.set(file, fd); }
    const buf = Buffer.alloc(loc.size);
    fs.readSync(fd, buf, 0, loc.size, loc.offset);
    return blte(buf.subarray(30), opts);
  }
  close() { for (const fd of this.fds.values()) try { fs.closeSync(fd); } catch {} this.fds.clear(); }

  // Encoding: content key -> encoding key. Only the pages that are needed get decoded.
  encoding() {
    if (this._enc) return this._enc;
    const buf = this.readEKey(this.build.encoding[1]);
    if (buf.toString("latin1", 0, 2) !== "EN") throw Error("Bad encoding file.");
    const ckeySize = buf[3], ekeySize = buf[4];
    const cPageKB = buf.readUInt16BE(5), cPages = buf.readUInt32BE(9);
    const especSize = buf.readUInt32BE(18);
    let pos = 22 + especSize;
    const firstKeys = [];
    for (let i = 0; i < cPages; i++) { firstKeys.push(buf.subarray(pos, pos + ckeySize)); pos += 32; }
    this._enc = { buf, ckeySize, ekeySize, pageSize: cPageKB * 1024, pagesAt: pos, firstKeys };
    return this._enc;
  }
  ekeyFor(ckey) {
    const e = this.encoding();
    let lo = 0, hi = e.firstKeys.length - 1, page = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (Buffer.compare(e.firstKeys[mid], ckey) <= 0) { page = mid; lo = mid + 1; } else hi = mid - 1; }
    if (page < 0) return null;
    let p = e.pagesAt + page * e.pageSize;
    const end = p + e.pageSize;
    while (p < end) {
      const n = e.buf[p];
      if (!n) break;
      const ck = e.buf.subarray(p + 6, p + 6 + e.ckeySize);
      if (ck.equals(ckey)) return hex(e.buf.subarray(p + 6 + e.ckeySize, p + 6 + e.ckeySize + e.ekeySize));
      p += 6 + e.ckeySize + n * e.ekeySize;
    }
    return null;
  }

  // Root (MFST): file data id / name hash -> content key, preferring enUS or locale-neutral entries.
  root() {
    if (this._root) return this._root;
    const ckey = Buffer.from(this.build.root[0], "hex");
    const buf = this.readEKey(this.ekeyFor(ckey));
    const byId = new Map(), byName = new Map();
    let pos = 0, version = 0;
    if (buf.toString("latin1", 0, 4) === "TSFM") {
      const maybeHeader = buf.readUInt32LE(4);
      if (maybeHeader < 100) { version = buf.readUInt32LE(8); pos = maybeHeader; } else pos = 12;
    }
    const enUS = 0x2, all = 0xffffffff;
    while (pos + 12 <= buf.length) {
      const num = buf.readUInt32LE(pos);
      let contentFlags, locale;
      if (version >= 2) {
        locale = buf.readUInt32LE(pos + 4);
        const f1 = buf.readUInt32LE(pos + 8), f2 = buf.readUInt32LE(pos + 12), f3 = buf[pos + 16];
        contentFlags = (f1 | f2 | (f3 << 17)) >>> 0;
        pos += 17;
      } else {
        contentFlags = buf.readUInt32LE(pos + 4); locale = buf.readUInt32LE(pos + 8); pos += 12;
      }
      const ids = new Array(num);
      let id = -1;
      for (let i = 0; i < num; i++) { id = id + 1 + buf.readInt32LE(pos + i * 4); ids[i] = id; }
      pos += num * 4;
      const ckeysAt = pos;
      pos += num * 16;
      const named = !(contentFlags & 0x10000000);
      const namesAt = pos;
      if (named) pos += num * 8;
      const good = (locale & enUS) || locale === all || locale === 0;
      if (!good) continue;
      for (let i = 0; i < num; i++) {
        const ck = buf.subarray(ckeysAt + i * 16, ckeysAt + i * 16 + 16);
        if (!byId.has(ids[i])) byId.set(ids[i], ck);
        if (named) {
          const h = buf.readBigUInt64LE(namesAt + i * 8);
          if (!byName.has(h)) byName.set(h, ids[i]);
        }
      }
    }
    this._root = { byId, byName };
    return this._root;
  }
  fileIdForName(filePath) { return this.root().byName.get(nameHash(filePath)) ?? null; }
  readFileId(id, opts) {
    const ck = this.root().byId.get(id);
    if (!ck) { const e = Error(`File ${id} is not in this build.`); e.code = "MISSING"; throw e; }
    const ek = this.ekeyFor(ck);
    if (!ek) { const e = Error(`File ${id} has no local copy.`); e.code = "MISSING"; throw e; }
    return this.readEKey(ek, opts);
  }
}

module.exports = { CascStorage, blte, parseBuildInfo, parseConfig, hashlittle2, nameHash };
