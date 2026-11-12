"use strict";
// Minimal WDC5 (DB2) reader: returns rows of raw field values plus non-inline id and relation.
// Field meaning comes from the caller (WoWDBDefs layouts), checked by layout hash.

function readBits(buf, byteStart, bitOffset, bitSize) {
  let v = 0, mul = 1;
  for (let i = 0; i < bitSize; i++) {
    const bit = bitOffset + i;
    if ((buf[byteStart + (bit >> 3)] >> (bit & 7)) & 1) v += mul;
    mul *= 2;
  }
  return v;
}

function readDb2(buf) {
  const magic = buf.toString("latin1", 0, 4);
  if (magic !== "WDC5" && magic !== "WDC4") throw Error(`Unsupported DB2 format ${magic}.`);
  const base = magic === "WDC5" ? 136 : 4;
  const u = (o) => buf.readUInt32LE(base + o);
  const h = {
    recordCount: u(0), fieldCount: u(4), recordSize: u(8), stringTableSize: u(12), tableHash: u(16), layoutHash: u(20),
    minId: u(24), maxId: u(28), locale: u(32), flags: buf.readUInt16LE(base + 36), idIndex: buf.readUInt16LE(base + 38),
    totalFieldCount: u(40), bitpackedOffset: u(44), lookupColumnCount: u(48), storageInfoSize: u(52),
    commonDataSize: u(56), palletDataSize: u(60), sectionCount: u(64),
  };
  let pos = base + 68;
  const sections = [];
  for (let i = 0; i < h.sectionCount; i++, pos += 40) {
    sections.push({
      tactKey: buf.readBigUInt64LE(pos), fileOffset: buf.readUInt32LE(pos + 8), recordCount: buf.readUInt32LE(pos + 12),
      stringTableSize: buf.readUInt32LE(pos + 16), offsetRecordsEnd: buf.readUInt32LE(pos + 20), idListSize: buf.readUInt32LE(pos + 24),
      relationshipSize: buf.readUInt32LE(pos + 28), offsetMapIdCount: buf.readUInt32LE(pos + 32), copyTableCount: buf.readUInt32LE(pos + 36),
    });
  }
  pos += h.totalFieldCount * 4; // field_structure (sizes/offsets are repeated in storage info)
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
  if (h.flags & 1) throw Error("Variable-size DB2 records are not supported.");
  const rows = [];
  for (const s of sections) {
    if (s.tactKey !== 0n) { // encrypted section: present only if the client holds the key (zero-filled otherwise)
      const probe = buf.subarray(s.fileOffset, s.fileOffset + Math.min(64, s.recordCount * h.recordSize));
      if (probe.every((b) => b === 0)) continue;
    }
    const recStart = s.fileOffset;
    let p = recStart + s.recordCount * h.recordSize + s.stringTableSize;
    const ids = [];
    for (let i = 0; i < s.idListSize / 4; i++) ids.push(buf.readUInt32LE(p + i * 4));
    p += s.idListSize;
    const copies = [];
    for (let i = 0; i < s.copyTableCount; i++) copies.push([buf.readUInt32LE(p + i * 8), buf.readUInt32LE(p + i * 8 + 4)]);
    p += s.copyTableCount * 8 + s.offsetMapIdCount * 6;
    const relation = new Map();
    if (s.relationshipSize) {
      const n = buf.readUInt32LE(p);
      for (let i = 0; i < n; i++) relation.set(buf.readUInt32LE(p + 12 + i * 8 + 4), buf.readUInt32LE(p + 12 + i * 8));
    }
    const sectionRows = [];
    for (let r = 0; r < s.recordCount; r++) {
      const at = recStart + r * h.recordSize;
      const fields = info.map((f, i) => {
        if (f.type === 0) {
          const n = Math.max(1, f.bitSize / 32 | 0);
          if (n === 1) return readBits(buf, at, f.bitOffset, f.bitSize);
          return Array.from({ length: n }, (_, k) => readBits(buf, at, f.bitOffset + k * 32, 32));
        }
        if (f.type === 1 || f.type === 5) {
          let v = readBits(buf, at, f.bitOffset, f.bitSize);
          if (f.type === 5 && v >= 2 ** (f.bitSize - 1)) v -= 2 ** f.bitSize;
          return v;
        }
        if (f.type === 3) return buf.readUInt32LE(pallet[i] + readBits(buf, at, f.bitOffset, f.bitSize) * 4);
        if (f.type === 4) { const idx = readBits(buf, at, f.bitOffset, f.bitSize); return Array.from({ length: f.v3 }, (_, k) => buf.readUInt32LE(pallet[i] + (idx * f.v3 + k) * 4)); }
        return null; // common data: resolved once the id is known
      });
      const id = ids.length ? ids[r] : fields[h.idIndex];
      info.forEach((f, i) => { if (f.type === 2) fields[i] = common[i].has(id) ? common[i].get(id) : f.v1; });
      sectionRows.push({ id, fields, relation: relation.get(r) });
    }
    rows.push(...sectionRows);
    for (const [newId, oldId] of copies) { const src = sectionRows.find((x) => x.id === oldId); if (src) rows.push({ ...src, id: newId }); }
  }
  return { header: h, rows };
}

module.exports = { readDb2, readBits };
