"use strict";
// Reader for the game client's hotfix cache (Cache/ADB/<locale>/DBCache.bin, "XFTH").
// The game stores every hotfixed table row there. Some items exist only as hotfixes, so the
// installed game tables do not describe them. This file is read on the player's own computer,
// never changed, never uploaded and never bundled.
//
// Layout (version 9): "XFTH", u32 version, u32 build, 32-byte hash, then entries:
//   "XFTH", i32 region, i32 push, u32 unique, u32 tableHash, u32 recordId, u32 size, u8 status, 3 pad, data[size]
// An entry's data is one table row in inline form: each field at its declared size, strings in place.
const crypto = require("node:crypto");
const MAGIC = 0x48544658; // "XFTH" little-endian
const HEADER = 44, ENTRY = 32;
const MAX_FILE = 64 * 1024 * 1024, MAX_RECORD = 64 * 1024, MAX_KEPT = 200000;
const STATUS = { VALID: 1, REMOVED: 2, INVALID: 3, NOT_PUBLIC: 4 };

// tables: iterable of table hashes to keep. Returns null when the buffer is not a cache this
// reader understands; otherwise { build, signature, tables: Map(hash -> Map(recordId -> { status, data })) }.
// Later entries replace earlier ones for the same row. Entries the game marked invalid or not
// public say nothing about the row and are skipped.
function readHotfixCache(buf, tables) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER || buf.length > MAX_FILE || buf.readUInt32LE(0) !== MAGIC) return null;
  const version = buf.readUInt32LE(4);
  if (version !== 9) return null;
  const out = new Map([...tables].map((h) => [h >>> 0, new Map()]));
  const hash = crypto.createHash("sha256");
  let p = HEADER, kept = 0;
  while (p + ENTRY <= buf.length) {
    if (buf.readUInt32LE(p) !== MAGIC) return null;
    const table = buf.readUInt32LE(p + 16), id = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24), status = buf[p + 28];
    const end = p + ENTRY + size;
    if (end > buf.length) return null;
    const rows = out.get(table);
    if (rows && size <= MAX_RECORD && (status === STATUS.VALID || status === STATUS.REMOVED) && kept < MAX_KEPT) {
      rows.set(id, { status, data: status === STATUS.VALID ? buf.subarray(p + ENTRY, end) : null });
      hash.update(buf.subarray(p + 16, p + 29)); // table, row, size, status
      if (status === STATUS.VALID) hash.update(buf.subarray(p + ENTRY, end));
      kept++;
    }
    p = end;
  }
  if (p !== buf.length) return null;
  return { build: buf.readUInt32LE(8), signature: kept ? hash.digest("hex").slice(0, 32) : null, tables: out };
}

module.exports = { readHotfixCache, STATUS, MAX_FILE };
