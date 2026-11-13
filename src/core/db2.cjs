"use strict";
// Minimal WDC5 (DB2) reader: returns rows of raw field values plus non-inline id and relation.
// Field meaning comes from the caller (WoWDBDefs layouts), checked by layout hash.
//
// Options (all by field index in storage order, i.e. the layout without non-inline columns):
//   strings: fields holding strings (offsets into the string table, or inline in sparse tables)
//   signed:  integer fields to sign-extend at their declared element size
//   floats:  32-bit fields to read as IEEE floats
//   typed:   split arrays by their declared element size (u8/u16 arrays) instead of 32-bit words
// Sparse tables (flag 1: variable-size records with inline strings) need `typed` field sizes and
// therefore always read fields at their declared sizes.

function readBits(buf, byteStart, bitOffset, bitSize) {
  let v = 0, mul = 1;
  for (let i = 0; i < bitSize; i++) {
    const bit = bitOffset + i;
    if ((buf[byteStart + (bit >> 3)] >> (bit & 7)) & 1) v += mul;
    mul *= 2;
  }
  return v;
}

const f32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b.readFloatLE(0); };
const sx = (v, bits) => (bits < 53 && v >= 2 ** (bits - 1) ? v - 2 ** bits : v);

function cstring(buf, at) {
  if (at < 0 || at >= buf.length) return "";
  let end = at;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.toString("utf8", at, end);
}

function readDb2(buf, opts = {}) {
  const magic = buf.toString("latin1", 0, 4);
  if (magic !== "WDC5" && magic !== "WDC4") throw Error(`Unsupported DB2 format ${magic}.`);
  const strings = new Set(opts.strings || []), signed = new Set(opts.signed || []), floats = new Set(opts.floats || []);
  const base = magic === "WDC5" ? 136 : 4;
  const u = (o) => buf.readUInt32LE(base + o);
  const h = {
    recordCount: u(0), fieldCount: u(4), recordSize: u(8), stringTableSize: u(12), tableHash: u(16), layoutHash: u(20),
    minId: u(24), maxId: u(28), locale: u(32), flags: buf.readUInt16LE(base + 36), idIndex: buf.readUInt16LE(base + 38),
    totalFieldCount: u(40), bitpackedOffset: u(44), lookupColumnCount: u(48), storageInfoSize: u(52),
    commonDataSize: u(56), palletDataSize: u(60), sectionCount: u(64),
  };
  const sparse = !!(h.flags & 1);
  const typed = !!opts.typed || sparse;
  let pos = base + 68;
  const sections = [];
  for (let i = 0; i < h.sectionCount; i++, pos += 40) {
    sections.push({
      tactKey: buf.readBigUInt64LE(pos), fileOffset: buf.readUInt32LE(pos + 8), recordCount: buf.readUInt32LE(pos + 12),
      stringTableSize: buf.readUInt32LE(pos + 16), offsetRecordsEnd: buf.readUInt32LE(pos + 20), idListSize: buf.readUInt32LE(pos + 24),
      relationshipSize: buf.readUInt32LE(pos + 28), offsetMapIdCount: buf.readUInt32LE(pos + 32), copyTableCount: buf.readUInt32LE(pos + 36),
    });
  }
  const elemBits = [];
  for (let i = 0; i < h.totalFieldCount; i++) elemBits.push(32 - buf.readInt16LE(pos + i * 4));
  pos += h.totalFieldCount * 4;
  const info = [];
  for (let i = 0; i < h.storageInfoSize / 24; i++, pos += 24) {
    info.push({ bitOffset: buf.readUInt16LE(pos), bitSize: buf.readUInt16LE(pos + 2), extra: buf.readUInt32LE(pos + 4), type: buf.readUInt32LE(pos + 8), v1: buf.readUInt32LE(pos + 12), v2: buf.readUInt32LE(pos + 16), v3: buf.readUInt32LE(pos + 20) });
  }
  const pallet = [], common = [];
  let pp = pos;
  for (const f of info) { if (f.type === 3 || f.type === 4) { pallet.push(pp); pp += f.extra; } else pallet.push(-1); }
  pos += h.palletDataSize;
  let cp = pos;
  for (const f of info) {
    if (f.type === 2) { const m = new Map(); for (let o = cp; o < cp + f.extra; o += 8) m.set(buf.readUInt32LE(o), buf.readUInt32LE(o + 4)); common.push(m); cp += f.extra; } else common.push(null);
  }
  // Non-sparse strings: offsets are relative to the field, as if all record blocks were followed by
  // all string tables. Map that virtual position back to each section's own string block.
  const totalRecords = sections.reduce((n, s) => n + s.recordCount, 0);
  const blocks = [];
  { let at = 0; for (const s of sections) { blocks.push({ at, size: s.stringTableSize, file: s.fileOffset + s.recordCount * h.recordSize }); at += s.stringTableSize; } }
  const stringAt = (virt) => {
    const idx = virt - totalRecords * h.recordSize;
    const b = blocks.find((x) => idx >= x.at && idx < x.at + x.size);
    return b ? cstring(buf, b.file + idx - b.at) : "";
  };
  const fix = (i, v) => (floats.has(i) ? f32(v) : signed.has(i) ? sx(v, elemBits[i] || 32) : v);

  const rows = [];
  let globalIndex = 0;
  for (const s of sections) {
    const recStart = s.fileOffset;
    const skip = s.tactKey !== 0n && (() => { // encrypted section: present only if the client holds the key (zero-filled otherwise)
      const probe = buf.subarray(s.fileOffset, s.fileOffset + Math.min(64, Math.max(1, s.recordCount * h.recordSize)));
      return probe.every((b) => b === 0);
    })();
    if (skip || !s.recordCount) { globalIndex += s.recordCount; continue; }
    let p = sparse ? s.offsetRecordsEnd : recStart + s.recordCount * h.recordSize + s.stringTableSize;
    let ids = [];
    for (let i = 0; i < s.idListSize / 4; i++) ids.push(buf.readUInt32LE(p + i * 4));
    p += s.idListSize;
    const copies = [];
    for (let i = 0; i < s.copyTableCount; i++) copies.push([buf.readUInt32LE(p + i * 8), buf.readUInt32LE(p + i * 8 + 4)]);
    p += s.copyTableCount * 8;
    const offsets = [];
    for (let i = 0; i < s.offsetMapIdCount; i++) offsets.push([buf.readUInt32LE(p + i * 6), buf.readUInt16LE(p + i * 6 + 4)]);
    p += s.offsetMapIdCount * 6;
    const relation = new Map();
    if (s.relationshipSize) {
      const n = buf.readUInt32LE(p);
      for (let i = 0; i < n; i++) relation.set(buf.readUInt32LE(p + 12 + i * 8 + 4), buf.readUInt32LE(p + 12 + i * 8));
      p += s.relationshipSize;
    }
    if (sparse && s.offsetMapIdCount) {
      const sparseIds = [];
      for (let i = 0; i < s.offsetMapIdCount; i++) sparseIds.push(buf.readUInt32LE(p + i * 4));
      ids = sparseIds;
    }
    const sectionRows = [];
    const count = sparse ? offsets.length : s.recordCount;
    for (let r = 0; r < count; r++) {
      let fields;
      if (sparse) {
        let at = offsets[r][0];
        const end = at + offsets[r][1];
        if (!offsets[r][1]) continue;
        fields = info.map((f, i) => {
          const bytes = (elemBits[i] || 32) >> 3;
          const n = Math.max(1, f.bitSize / (strings.has(i) ? 32 : elemBits[i] || 32) | 0);
          const one = () => {
            if (strings.has(i)) { const v = cstring(buf, at); at += Buffer.byteLength(v) + 1; return v; }
            const v = at + bytes <= end ? buf.readUIntLE(at, bytes) : 0;
            at += bytes;
            return fix(i, v);
          };
          return n === 1 ? one() : Array.from({ length: n }, one);
        });
      } else {
        const at = recStart + r * h.recordSize;
        const fieldBase = (globalIndex + r) * h.recordSize;
        fields = info.map((f, i) => {
          if (f.type === 0) {
            if (strings.has(i)) {
              const n = Math.max(1, f.bitSize / 32 | 0);
              const one = (k) => { const byte = (f.bitOffset >> 3) + k * 4; return stringAt(fieldBase + byte + buf.readUInt32LE(at + byte)); };
              return n === 1 ? one(0) : Array.from({ length: n }, (_, k) => one(k));
            }
            const eb = typed ? elemBits[i] || 32 : 32;
            const n = Math.max(1, f.bitSize / eb | 0);
            if (n === 1) return fix(i, readBits(buf, at, f.bitOffset, typed ? f.bitSize : f.bitSize));
            return Array.from({ length: n }, (_, k) => fix(i, readBits(buf, at, f.bitOffset + k * eb, eb)));
          }
          if (f.type === 1 || f.type === 5) {
            let v = readBits(buf, at, f.bitOffset, f.bitSize);
            if (f.type === 5 && v >= 2 ** (f.bitSize - 1)) v -= 2 ** f.bitSize;
            return f.type === 5 ? v : fix(i, v);
          }
          if (f.type === 3) return fix(i, buf.readUInt32LE(pallet[i] + readBits(buf, at, f.bitOffset, f.bitSize) * 4));
          if (f.type === 4) { const idx = readBits(buf, at, f.bitOffset, f.bitSize); return Array.from({ length: f.v3 }, (_, k) => fix(i, buf.readUInt32LE(pallet[i] + (idx * f.v3 + k) * 4))); }
          return null; // common data: resolved once the id is known
        });
      }
      const id = ids.length ? ids[r] : fields[h.idIndex];
      info.forEach((f, i) => { if (f.type === 2) fields[i] = fix(i, common[i].has(id) ? common[i].get(id) : f.v1); });
      sectionRows.push({ id, fields, relation: relation.get(r) });
    }
    globalIndex += s.recordCount;
    rows.push(...sectionRows);
    if (copies.length) {
      const byId = new Map(sectionRows.map((x) => [x.id, x]));
      for (const [newId, oldId] of copies) { const src = byId.get(oldId); if (src) rows.push({ ...src, id: newId }); }
    }
  }
  return { header: h, rows };
}

module.exports = { readDb2, readBits, cstring };
