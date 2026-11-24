"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const db2 = require("../src/core/db2.cjs");
const blp = require("../src/core/blp.cjs");
const { blte } = require("../src/core/casc-reader.cjs");
const gd = require("../src/core/game-data.cjs");
const { GameData, TABLES, itemView, resolveDescription, arithmetic } = gd;
const { registerGameDataHandlers } = require("../src/core/game-data-ipc.cjs");

// --- Synthetic WDC5 files -----------------------------------------------------------------------
// fields: [{ bits: 32|16|8, count, string }]; rows: [{ id, values }]; one plain section plus an
// optional encrypted (zero-filled) section the reader must skip.
function wdc5({ fields, rows, sparse = false, layoutHash = 0x1234abcd, encrypted = false }) {
  let bit = 0;
  const info = fields.map((f) => { const size = (f.string ? 32 : f.bits) * (f.count || 1); const o = { bitOffset: bit, bitSize: size, bits: f.string ? 32 : f.bits }; bit += size; return o; });
  const sections = encrypted ? 2 : 1;
  const headerSize = 136 + 68 + 40 * sections + fields.length * 4 + fields.length * 24;
  const recordSize = sparse ? 0 : Math.ceil(bit / 8);
  const head = Buffer.alloc(headerSize);
  head.write("WDC5", 0); head.writeUInt32LE(5, 4);
  const enc = encrypted ? 1 : 0, total = rows.length + enc;
  let body;
  const sectionHeader = [];
  if (!sparse) {
    const strings = [];
    let strSize = 0;
    const rec = Buffer.alloc(rows.length * recordSize);
    rows.forEach((r, ri) => {
      fields.forEach((f, fi) => {
        const vals = [].concat(r.values[fi]);
        vals.forEach((v, k) => {
          const bitAt = info[fi].bitOffset + k * info[fi].bits;
          if (f.string) {
            const idx = strSize; strings.push(Buffer.from(v + "\0")); strSize += Buffer.byteLength(v) + 1;
            const byte = bitAt >> 3;
            rec.writeUInt32LE(idx + total * recordSize - (ri * recordSize + byte), ri * recordSize + byte);
          } else {
            let u = v < 0 ? v + 2 ** f.bits : v;
            if (f.float) { const b = Buffer.alloc(4); b.writeFloatLE(v); u = b.readUInt32LE(0); }
            for (let i = 0; i < info[fi].bits; i++) if (Math.floor(u / 2 ** i) % 2) rec[ri * recordSize + ((bitAt + i) >> 3)] |= 1 << ((bitAt + i) & 7);
          }
        });
      });
    });
    const ids = Buffer.alloc(rows.length * 4); rows.forEach((r, i) => ids.writeUInt32LE(r.id, i * 4));
    body = Buffer.concat([rec, ...strings, ids]);
    sectionHeader.push({ fileOffset: headerSize, recordCount: rows.length, stringTableSize: strSize, idListSize: rows.length * 4, offsetRecordsEnd: 0, offsetMapIdCount: 0 });
  } else {
    const recs = [], map = [];
    let at = headerSize;
    for (const r of rows) {
      const parts = fields.map((f, fi) => Buffer.concat([].concat(r.values[fi]).map((v) => {
        if (f.string) return Buffer.from(v + "\0");
        const b = Buffer.alloc(f.bits / 8);
        if (f.float) b.writeFloatLE(v); else if (v < 0) b.writeIntLE(v, 0, f.bits / 8); else b.writeUIntLE(v, 0, f.bits / 8);
        return b;
      })));
      const rec = Buffer.concat(parts);
      map.push([at, rec.length]); recs.push(rec); at += rec.length;
    }
    const om = Buffer.alloc(rows.length * 6); map.forEach(([o, n], i) => { om.writeUInt32LE(o, i * 6); om.writeUInt16LE(n, i * 6 + 4); });
    const ids = Buffer.alloc(rows.length * 4); rows.forEach((r, i) => ids.writeUInt32LE(r.id, i * 4));
    body = Buffer.concat([...recs, om, ids]);
    sectionHeader.push({ fileOffset: headerSize, recordCount: rows.length, stringTableSize: 0, idListSize: 0, offsetRecordsEnd: at, offsetMapIdCount: rows.length });
  }
  if (encrypted) {
    const size = Math.max(recordSize, 16);
    sectionHeader.push({ tactKey: 1n, fileOffset: headerSize + body.length, recordCount: 1, stringTableSize: 0, idListSize: 4, offsetRecordsEnd: sparse ? headerSize + body.length + size : 0, offsetMapIdCount: 0 });
    body = Buffer.concat([body, Buffer.alloc(size + 4)]);
  }
  const u = (o, v) => head.writeUInt32LE(v, 136 + o);
  u(0, total); u(4, fields.length); u(8, recordSize); u(12, 0); u(20, layoutHash); u(24, 1); u(28, 999);
  head.writeUInt16LE(sparse ? 5 : 4, 136 + 36); u(40, fields.length); u(52, fields.length * 24); u(64, sections);
  let p = 136 + 68;
  for (const s of sectionHeader) {
    head.writeBigUInt64LE(s.tactKey || 0n, p); head.writeUInt32LE(s.fileOffset, p + 8); head.writeUInt32LE(s.recordCount, p + 12);
    head.writeUInt32LE(s.stringTableSize, p + 16); head.writeUInt32LE(s.offsetRecordsEnd, p + 20); head.writeUInt32LE(s.idListSize, p + 24);
    head.writeUInt32LE(s.offsetMapIdCount, p + 32); p += 40;
  }
  info.forEach((f) => { head.writeInt16LE(32 - f.bits, p); head.writeUInt16LE(f.bitOffset >> 3, p + 2); p += 4; });
  info.forEach((f) => { head.writeUInt16LE(f.bitOffset, p); head.writeUInt16LE(f.bitSize, p + 2); p += 24; });
  return Buffer.concat([head, body]);
}

test("DB2 reader decodes strings, typed arrays, signed and float fields, and skips encrypted sections", () => {
  const fields = [{ string: true, bits: 32 }, { bits: 16, count: 3 }, { bits: 8 }, { bits: 32, float: true }, { bits: 32 }];
  const rows = [{ id: 7, values: ["Worn Shortsword", [1, 2, 3], -1, 0.5, 1900] }, { id: 9, values: ["Fireball", [4, 5, 65535], 3, 2.25, 0] }];
  const buf = wdc5({ fields, rows, encrypted: true });
  const plain = db2.readDb2(buf, { strings: [0], typed: true, signed: [2], floats: [3] });
  assert.equal(plain.header.layoutHash, 0x1234abcd);
  assert.deepEqual(plain.rows.map((r) => [r.id, ...r.fields]), [[7, "Worn Shortsword", [1, 2, 3], -1, 0.5, 1900], [9, "Fireball", [4, 5, 65535], 3, 2.25, 0]]);
  // Default (map-art) behaviour is unchanged: no options, raw 32-bit words.
  const raw = db2.readDb2(buf);
  assert.equal(typeof raw.rows[0].fields[0], "number");
  assert.equal(raw.rows[0].fields[2], 255);

  const sparse = db2.readDb2(wdc5({ fields, rows, sparse: true, encrypted: true }), { strings: [0], signed: [2], floats: [3] });
  assert.deepEqual(sparse.rows.map((r) => [r.id, ...r.fields]), [[7, "Worn Shortsword", [1, 2, 3], -1, 0.5, 1900], [9, "Fireball", [4, 5, 65535], 3, 2.25, 0]]);
});

test("BLTE can zero-fill encrypted chunks so DB2 sections stay skippable", () => {
  const z = Buffer.concat([Buffer.from("Z"), zlib.deflateSync(Buffer.from("head"))]);
  const e = Buffer.concat([Buffer.from("E"), Buffer.from([8]), Buffer.alloc(8, 1), Buffer.from([4]), Buffer.alloc(4), Buffer.from("S"), Buffer.alloc(6, 7)]);
  const table = Buffer.alloc(4 + 2 * 24); table[0] = 0x0f; table.writeUIntBE(2, 1, 3);
  table.writeUInt32BE(z.length, 4); table.writeUInt32BE(4, 8); table.writeUInt32BE(e.length, 28); table.writeUInt32BE(6, 32);
  const head = Buffer.alloc(8); head.write("BLTE"); head.writeUInt32BE(8 + table.length, 4);
  const file = Buffer.concat([head, table, z, e]);
  assert.throws(() => blte(file), { code: "ENCRYPTED" });
  assert.deepEqual([...blte(file, { zeroEncrypted: true })], [...Buffer.from("head"), 0, 0, 0, 0, 0, 0]);
});

// --- Item, spell and talent extraction over mocked tables ---------------------------------------
const L = (name) => TABLES[name].layout;
function sparseRow(id, { name, quality, ilvl, req, inv, statTypes = [], shares = [], delay = 0, variance = 0, sell = 0, bonding = 0, mask = -1, flags2 = 0 }) {
  const f = Array(68).fill(0);
  f[0] = f[1] = f[2] = f[3] = ""; f[4] = name; f[6] = variance;
  f[14] = Array(10).fill(0); f[15] = Array(10).fill(0); f[16] = Array(10).fill(-1);
  statTypes.forEach((t, i) => { f[16][i] = t; f[15][i] = shares[i]; });
  f[21] = [-1, -1]; f[22] = sell; f[27] = [0, flags2, 0, 0, 0]; f[46] = delay; f[50] = ilvl; f[51] = mask; f[59] = bonding; f[64] = req; f[65] = inv; f[66] = quality;
  return { id, fields: f };
}
const itemRow = (id, cls, sub, icon) => ({ id, fields: [cls, sub, 0, 0, 0, 0, 255, icon, 0, 0, 0, 0, 0, 0, 0, 0] });
const levelRow = (lvl, values) => ({ id: lvl, fields: [lvl, values] });
function fakeTables(overrides = {}) {
  const t = {
    itemSparse: [
      sparseRow(25, { name: "Worn Shortsword", quality: 1, ilvl: 2, req: 1, inv: 21, delay: 1900, variance: 0.6, sell: 7 }),
      sparseRow(1275, { name: "Deputy Chain Coat", quality: 2, ilvl: 25, req: 0, inv: 5, statTypes: [7, 6], shares: [4444, 7778], sell: 1668, bonding: 1 }),
      sparseRow(12784, { name: "Arcanite Reaper", quality: 3, ilvl: 63, req: 58, inv: 17, statTypes: [7, 38], shares: [2000, 9538], delay: 3800, variance: 0.5, bonding: 2 }),
      sparseRow(50, { name: "Robe of Spells", quality: 2, ilvl: 25, req: 20, inv: 20, statTypes: [5, 51], shares: [10000, 2222], mask: 1 << 7 | 1 << 4 | 1 << 8 }),
      sparseRow(60, { name: "Tower Shield", quality: 2, ilvl: 25, req: 20, inv: 14 }),
    ],
    item: [itemRow(25, 2, 7, 135274), itemRow(1275, 4, 3, 132624), itemRow(12784, 2, 1, 132400), itemRow(50, 4, 1, 132644), itemRow(60, 4, 6, 134955)],
    randPropPoints: [{ id: 25, fields: [0, 0, 0, 0, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [9, 7, 5, 4, 0]] }, { id: 63, fields: [0, 0, 0, 0, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [65, 48, 37, 31, 0], [0, 0, 0, 0, 0]] }],
    armorQuality: [{ id: 25, fields: [[0.9, 0.95, 1, 1.1, 1.2, 1.3, 1.1]] }],
    armorTotal: [{ id: 25, fields: [25, 70, 140, 1144, 1600] }],
    armorShield: [{ id: 25, fields: [[0, 0, 410.4, 0, 0, 0, 0], 25] }],
    armorLocation: [{ id: 5, fields: [0.16, 0.16, 0.16, 0.16, 0.16] }],
    damageOneHand: [levelRow(2, [0, 1.1, 1, 0, 0, 0, 0])],
    damageOneHandCaster: [], damageTwoHandCaster: [], damageRanged: [], damageWand: [],
    damageTwoHand: [levelRow(63, [0, 0, 0, 53.9, 0, 0, 0])],
    spellName: [{ id: 133, fields: ["Fireball"] }, { id: 12282, fields: ["Improved Heroic Strike"] }, { id: 12296, fields: ["Anger Management"] }],
    spellMisc: [{ id: 1, relation: 133, fields: [[], 0, 0, 35, 0, 0, 0, 0, 0, 0, 135812] }, { id: 2, relation: 12282, fields: [[], 0, 0, 0, 0, 0, 0, 0, 0, 0, 132282] }],
    spell: [{ id: 133, fields: ["Rank 1", "Hurls a fiery ball that causes $s1 Fire damage and an additional $o2 Fire damage over $d.", ""] }, { id: 12282, fields: ["", "Reduces the cost of your Heroic Strike ability by $/10;s1 Rage.", ""] }, { id: 12296, fields: ["", "Uses $?s1[a][b] $h odd tokens.", ""] }],
    spellEffect: [
      { id: 1, relation: 133, fields: [0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.444, 0, 0, 18] },
      { id: 2, relation: 133, fields: [0, 0, 1, 6, 0, 0, 2000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] },
      { id: 3, relation: 12282, fields: [0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -10] },
    ],
    spellDuration: [{ id: 35, fields: [4000, 0, 4000, 0] }],
    talentTab: [{ id: 161, fields: ["Arms", "WarriorArms", "", 0, 0, 1, 0, 132292, 0, [0, 0]] }, { id: 41, fields: ["Fire", "MageFire", "", 1, 0, 128, 0, 135810, 0, [0, 0]] }],
    talent: [
      { id: 137, fields: ["", 2, 0, 1, 161, 0, 0, 0, 0, 0, [0, 0], [12296, 0, 0, 0, 0, 0, 0, 0, 0], [124, 0, 0], [2, 0, 0]] },
      { id: 124, fields: ["", 0, 0, 0, 161, 0, 0, 0, 0, 0, [0, 0], [12282, 12663, 12664, 0, 0, 0, 0, 0, 0], [0, 0, 0], [0, 0, 0]] },
    ],
    ...overrides,
  };
  return t;
}
// readDb2 is replaced by a table lookup keyed by the FileDataID the storage hands back.
function withFakeDb2(tables, layouts = {}) {
  const original = db2.readDb2;
  const byFdid = Object.fromEntries(Object.entries(TABLES).map(([n, t]) => [t.fdid, n]));
  db2.readDb2 = (buf) => { const name = byFdid[buf.fdid]; if (!tables[name]) throw Object.assign(Error("missing"), { code: "MISSING" }); return { header: { layoutHash: layouts[name] ?? L(name) }, rows: tables[name] }; };
  return () => { db2.readDb2 = original; };
}
const temp = [];
test.after(() => { for (const d of temp) fs.rmSync(d, { recursive: true, force: true }); });
function install() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-gd-"));
  temp.push(root);
  fs.mkdirSync(path.join(root, "_forever_"));
  fs.writeFileSync(path.join(root, ".build.info"), "Branch!STRING:0|Active!DEC:1|Version!STRING:0|Product!STRING:0\nus|1|1.60.1.70938|wowf\nus|1|12.1.5.1|wow\n");
  return { root, game: path.join(root, "_forever_"), cache: path.join(root, "cache") };
}
function fakeStorage(stats) {
  return () => { stats.opened++; return { readFileId: (fdid, opts) => { stats.reads.push(fdid); return { fdid, opts }; }, close() { stats.closed++; } }; };
}

test("items: slot names, stat budget, armor, weapon damage and class masks", (t) => {
  const restore = withFakeDb2(fakeTables()); t.after(restore);
  const dirs = install(), stats = { opened: 0, reads: [], closed: 0 };
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage(stats) });
  assert.deepEqual(g.status(), { available: true, build: "1.60.1.70938" });
  assert.deepEqual(g.item(25), { id: 25, name: "Worn Shortsword", quality: 1, itemLevel: 2, requiredLevel: 1, classId: 2, subclassId: 7, inventoryType: 21, slot: "Main Hand", kind: "Sword", armor: null, stats: [], damage: { min: 1, max: 3 }, speed: 1.9, dps: 1.1, sellPrice: 7, bonding: null, classes: null, iconFileId: 135274 });
  const coat = g.item(1275);
  assert.equal(coat.slot, "Chest"); assert.equal(coat.kind, "Mail"); assert.equal(coat.armor, 183); assert.equal(coat.bonding, "Binds when picked up");
  assert.deepEqual(coat.stats, [{ stat: "Stamina", amount: 4 }, { stat: "Spirit", amount: 7 }]);
  const reaper = g.item(12784);
  assert.equal(reaper.slot, "Two-Hand");
  assert.deepEqual(reaper.damage, { min: 153, max: 256 });
  assert.deepEqual(reaper.stats, [{ stat: "Stamina", amount: 13 }, { stat: "Attack Power", amount: 62 }]);
  const robe = g.item(50);
  assert.equal(robe.slot, "Chest"); assert.deepEqual(robe.classes, ["Priest", "Mage", "Warlock"]);
  assert.deepEqual(robe.stats, [{ stat: "Intellect", amount: 9 }, { stat: "Fire Resistance", amount: 2 }]);
  assert.equal(g.item(60).armor, 410); assert.equal(g.item(60).slot, "Off Hand"); assert.equal(g.item(60).kind, "Shield");
  assert.equal(g.item(999), null); assert.equal(g.item(-1), null); assert.equal(g.item(1.5), null);
  assert.deepEqual(g.items([25, 999]).map((x) => x && x.id), [25, null]);
  for (const name of ["itemSparse", "item"]) assert.ok(stats.reads.includes(TABLES[name].fdid));
  assert.ok(stats.reads.length && stats.reads.every((x) => typeof x === "number"));

  // Cached per build: a fresh instance reads JSON from disk without opening the game.
  const file = path.join(dirs.cache, "1.60.1.70938", "items.json");
  assert.ok(fs.existsSync(file));
  const stats2 = { opened: 0, reads: [], closed: 0 };
  const again = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, open: fakeStorage(stats2) });
  assert.deepEqual(again.item(1275), coat);
  assert.equal(stats2.opened, 0);
  // A different build replaces the old cache folder.
  fs.writeFileSync(path.join(dirs.root, ".build.info"), "Active!DEC:1|Version!STRING:0|Product!STRING:0\n1|1.60.2.1|wowf\n");
  assert.equal(again.status().build, "1.60.2.1");
  assert.equal(stats2.opened, 1);
  assert.deepEqual(fs.readdirSync(dirs.cache), ["1.60.2.1"]);
  g.release(); again.release();
});

test("status explains a missing game, unreadable install and unknown table layouts", (t) => {
  const restore = withFakeDb2(fakeTables(), { itemSparse: 0xdeadbeef }); t.after(restore);
  const none = new GameData({ getRoot: () => null, cacheDir: os.tmpdir() });
  assert.deepEqual(none.status(), { available: false, build: null, reason: "Connect your WoW Forever folder first." });
  assert.equal(none.item(25), null); assert.equal(none.icon(1), null); assert.equal(none.talents("Warrior"), null);
  const dirs = install();
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage({ opened: 0, reads: [], closed: 0 }) });
  const s = g.status();
  assert.equal(s.available, false); assert.equal(s.build, "1.60.1.70938"); assert.match(s.reason, /layout this app does not read/);
  assert.equal(g.item(25), null);
  assert.equal(fs.existsSync(path.join(dirs.cache, "1.60.1.70938", "items.json")), false, "a failure is not cached on disk");
  const broken = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, open: () => { throw Error("no data"); } });
  assert.match(broken.status().reason, /could not be read/);
  g.release();
});

test("optional tables that differ leave their facts empty instead of failing", (t) => {
  const restore = withFakeDb2(fakeTables(), { randPropPoints: 1, armorTotal: 2 }); t.after(restore);
  const dirs = install();
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage({ opened: 0, reads: [], closed: 0 }) });
  const s = g.status();
  assert.equal(s.available, true);
  assert.ok(s.limitations.some((x) => /randPropPoints: layout differs/.test(x)));
  assert.equal(g.item(1275).stats, null);
  assert.equal(g.item(1275).armor, null);
  assert.deepEqual(g.item(25).damage, { min: 1, max: 3 });
  g.release();
});

test("spells, descriptions and talent trees", (t) => {
  const restore = withFakeDb2(fakeTables()); t.after(restore);
  const dirs = install();
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage({ opened: 0, reads: [], closed: 0 }) });
  assert.deepEqual(g.spell(133), { id: 133, name: "Fireball", iconFileId: 135812, rank: "Rank 1", description: "Hurls a fiery ball that causes 14 to 22 Fire damage and an additional 2 Fire damage over 4 sec." });
  assert.equal(g.spell(12282).description, "Reduces the cost of your Heroic Strike ability by 1 Rage.");
  assert.deepEqual(g.spell(12296), { id: 12296, name: "Anger Management", iconFileId: null }, "unresolvable text is omitted");
  assert.equal(g.spell(1), null);
  const tree = g.talents("warrior");
  assert.equal(tree.className, "Warrior"); assert.equal(tree.classId, 1);
  assert.deepEqual(tree.tabs.map((x) => [x.name, x.order, x.background, x.iconFileId]), [["Arms", 0, "WarriorArms", 132292]]);
  assert.deepEqual(tree.tabs[0].talents, [
    { id: 124, row: 0, column: 0, maxRank: 3, ranks: [12282, 12663, 12664], name: "Improved Heroic Strike", iconFileId: 132282, descriptions: ["Reduces the cost of your Heroic Strike ability by 1 Rage.", null, null], prerequisites: [] },
    { id: 137, row: 2, column: 1, maxRank: 1, ranks: [12296], name: "Anger Management", iconFileId: null, descriptions: [null], prerequisites: [{ talentId: 124, rank: 3 }] },
  ]);
  assert.equal(g.talents("Mage").tabs[0].name, "Fire");
  assert.equal(g.talents("Monk"), null); assert.equal(g.talents(null), null);
  g.release();
});

test("description tokens resolve crudely and arithmetic stays numeric only", () => {
  const facts = { effects: new Map([[1, [{ bp: -2000, variance: 0, period: 0, chain: 0 }, { bp: 15, variance: 0, period: 3000, chain: 3 }]]]), duration: new Map([[1, 600000]]), text: new Map([[2, "Other text $s1."]]) };
  assert.equal(resolveDescription("Cooldown ${$s1/-1000} sec, range $s2 yards, every $t2 sec for $d, $x2 targets.", 1, facts), "Cooldown 2 sec, range 15 yards, every 3 sec for 10 min, 3 targets.");
  assert.equal(resolveDescription("$lpoint:points; and $gHe:She;", 1, facts), "points and He");
  assert.equal(resolveDescription("Unknown $h chance.", 1, facts), null);
  assert.equal(resolveDescription("${process.exit()}", 1, facts), null);
  assert.equal(arithmetic("(-2000)/-1000"), 2); assert.equal(arithmetic("2*(3+1)"), 8);
  assert.equal(arithmetic("alert(1)"), null); assert.equal(arithmetic("1+"), null); assert.equal(arithmetic("?"), null);
});

test("icons: only known icons, PNG cached on disk, bounded in size and count", (t) => {
  const restore = withFakeDb2(fakeTables()); t.after(restore);
  const decode = blp.decodeBlp;
  let side = 2;
  blp.decodeBlp = () => ({ width: side, height: side, rgba: Buffer.alloc(side * side * 4, 200) });
  t.after(() => { blp.decodeBlp = decode; });
  const dirs = install(), stats = { opened: 0, reads: [], closed: 0 };
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage(stats), maxIconBytes: 200, memoryIcons: 1, maxIconSide: 4 });
  assert.equal(g.icon(424242), null, "file ids the game tables never reference are refused");
  assert.equal(stats.reads.includes(424242), false);
  const png = g.icon(135274);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  const icons = path.join(dirs.cache, "1.60.1.70938", "icons");
  assert.ok(fs.existsSync(path.join(icons, "135274.png")));
  const before = stats.reads.length;
  assert.ok(g.icon(135274).equals(png)); assert.equal(stats.reads.length, before, "memory hit");
  g.icon(132624); g.icon(132400); g.icon(135812);
  const total = fs.readdirSync(icons).reduce((n, f) => n + fs.statSync(path.join(icons, f)).size, 0);
  assert.ok(total <= 200, `icon cache stays under its cap (${total})`);
  assert.ok(g.iconMemo.size <= 1);
  side = 64;
  assert.equal(g.icon(132282), null, "oversized textures are not served");
  assert.equal(g.icon(0), null); assert.equal(g.icon("1"), null);
  g.release();
});

test("game data IPC validates inputs strictly", () => {
  const handlers = {}, calls = [];
  const gameData = {
    status: () => ({ available: true, build: "b" }),
    items: (ids) => { calls.push(["items", ids]); return ids.map(() => null); },
    spell: (id) => ({ id }), icon: (id) => (id === 5 ? Buffer.from([1, 2]) : null), talents: (c) => ({ className: c }),
  };
  registerGameDataHandlers({ handle: (n, fn) => (handlers[n] = fn), gameData });
  assert.deepEqual(handlers.gameDataStatus(), { available: true, build: "b" });
  assert.deepEqual(handlers.gameItems([1, 2]), [null, null]);
  assert.deepEqual(handlers.gameSpell(133), { id: 133 });
  const icon = handlers.gameIcon(5);
  assert.ok(icon instanceof Uint8Array && !Buffer.isBuffer(icon)); assert.deepEqual([...icon], [1, 2]);
  assert.equal(handlers.gameIcon(6), null);
  assert.deepEqual(handlers.gameTalents("hunter"), { className: "hunter" });
  for (const [name, args] of [
    ["gameDataStatus", [1]], ["gameItems", []], ["gameItems", [[]]], ["gameItems", [[1, "2"]]], ["gameItems", [[0]]], ["gameItems", [[1.5]]],
    ["gameItems", [Array(65).fill(1)]], ["gameItems", [1]], ["gameItems", [[2 ** 31]]], ["gameSpell", ["133"]], ["gameSpell", [-1]], ["gameSpell", [1, 2]],
    ["gameIcon", [null]], ["gameIcon", [NaN]], ["gameTalents", ["Monk"]], ["gameTalents", [1]], ["gameTalents", ["x".repeat(30)]],
  ]) assert.throws(() => handlers[name](...args), Error, `${name} ${JSON.stringify(args)}`);
  assert.equal(calls.length, 1);
});

test("itemView maps every slot and keeps unknown stats readable", () => {
  const row = (inv, stats = [], mask = -1) => ["X", 2, 10, 5, 4, 0, inv, 0, stats, 0, 0, 0, 1, 0, mask, 0];
  const slots = { 1: "Head", 2: "Neck", 3: "Shoulder", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands", 11: "Finger", 12: "Trinket", 13: "One-Hand", 14: "Off Hand", 15: "Ranged", 16: "Back", 17: "Two-Hand", 20: "Chest", 21: "Main Hand", 22: "Off Hand", 23: "Held In Off-hand", 25: "Thrown", 26: "Ranged" };
  for (const [inv, slot] of Object.entries(slots)) assert.equal(itemView(1, row(Number(inv))).slot, slot);
  assert.deepEqual(itemView(1, row(1, [3, 2, 4, 1, 5, 3, 6, 4, 7, 5, 99, 1])).stats.map((s) => s.stat), ["Agility", "Strength", "Intellect", "Spirit", "Stamina", "Stat 99"]);
  assert.deepEqual(itemView(1, row(1, [], 4)).classes, ["Hunter"]);
  assert.equal(itemView(1, row(1, [], 0x5ff)).classes, null, "every class allowed");
  assert.equal(itemView(1, null), null);
});

// --- Hotfix cache (items the game delivers as hotfixes) -----------------------------------------
const { readHotfixCache } = require("../src/core/hotfix-cache.cjs");
const SPARSE_HASH = 0x919be54e, ITEM_HASH = 0x50238ec2;
// entries: [{ table, id, status = 1, data = Buffer }]
function xfth(build, entries) {
  const head = Buffer.alloc(44); head.write("XFTH"); head.writeUInt32LE(9, 4); head.writeUInt32LE(build, 8);
  return Buffer.concat([head, ...entries.map((e) => {
    const data = e.data || Buffer.alloc(0), h = Buffer.alloc(32);
    h.write("XFTH"); h.writeInt32LE(91, 4); h.writeInt32LE(7, 8); h.writeUInt32LE(7, 12);
    h.writeUInt32LE(e.table, 16); h.writeUInt32LE(e.id, 20); h.writeUInt32LE(data.length, 24); h[28] = e.status ?? 1;
    return Buffer.concat([h, data]);
  })]);
}
function itemBytes(cls, sub, icon) {
  const b = Buffer.alloc(43); b.writeInt32LE(cls, 0); b[4] = sub; b[5] = 1; b.writeInt8(21, 6); b[7] = 3; b[12] = 255; b.writeInt32LE(icon, 13); b[17] = 8;
  return b;
}

test("hotfix cache: keeps valid and removed rows of the asked tables, last entry wins", () => {
  const a = Buffer.from("first"), b = Buffer.from("second");
  const buf = xfth(70938, [
    { table: SPARSE_HASH, id: 5, data: a }, { table: 0x11111111, id: 5, data: a }, { table: SPARSE_HASH, id: 5, data: b },
    { table: SPARSE_HASH, id: 6, status: 3, data: a }, { table: SPARSE_HASH, id: 7, status: 4, data: a }, { table: ITEM_HASH, id: 8, status: 2 },
  ]);
  const p = readHotfixCache(buf, [SPARSE_HASH, ITEM_HASH]);
  assert.equal(p.build, 70938);
  assert.deepEqual([...p.tables.get(SPARSE_HASH)].map(([id, e]) => [id, e.status, e.data.toString()]), [[5, 1, "second"]]);
  assert.deepEqual([...p.tables.get(ITEM_HASH)], [[8, { status: 2, data: null }]]);
  assert.match(p.signature, /^[0-9a-f]{32}$/);
  assert.notEqual(readHotfixCache(xfth(70938, [{ table: SPARSE_HASH, id: 5, data: a }]), [SPARSE_HASH]).signature, p.signature);
  // Rows of other tables do not change the signature; nothing kept means no signature.
  assert.equal(readHotfixCache(xfth(70938, [{ table: 0x11111111, id: 5, data: a }]), [SPARSE_HASH]).signature, null);
  // Anything this reader does not understand is refused whole.
  assert.equal(readHotfixCache(buf.subarray(0, buf.length - 1), [SPARSE_HASH]), null);
  assert.equal(readHotfixCache(Buffer.concat([buf, Buffer.from("junk")]), [SPARSE_HASH]), null);
  const other = Buffer.from(buf); other.writeUInt32LE(8, 4);
  assert.equal(readHotfixCache(other, [SPARSE_HASH]), null);
  assert.equal(readHotfixCache(Buffer.from("WDC5"), [SPARSE_HASH]), null);
  assert.equal(readHotfixCache(null, [SPARSE_HASH]), null);
});

test("DB2 reader decodes one inline row and refuses bytes that do not fit the layout", () => {
  const fields = [{ string: true, bits: 32 }, { bits: 16, count: 3 }, { bits: 8 }, { bits: 32, float: true }, { bits: 32 }];
  const db = db2.readDb2(wdc5({ fields, rows: [{ id: 7, values: ["Worn Shortsword", [1, 2, 3], -1, 0.5, 1900] }], sparse: true }), { strings: [0], signed: [2], floats: [3] });
  const rec = Buffer.concat([Buffer.from("Cursed Felblade\0"), Buffer.from([4, 0, 5, 0, 6, 0]), Buffer.from([0xfe]), Buffer.from([0, 0, 0x10, 0x40]), Buffer.from([0x34, 0x12, 0, 0])]);
  assert.deepEqual(db.inline(rec), ["Cursed Felblade", [4, 5, 6], -2, 2.25, 0x1234]);
  assert.equal(db.inline(rec.subarray(0, rec.length - 1)), null);
  assert.equal(db.inline(Buffer.concat([rec, Buffer.alloc(1)])), null);
});

// The fake tables carry the real table hashes and decode a sparse hotfix row from JSON.
function withHotfixDb2(tables) {
  const original = db2.readDb2;
  const byFdid = Object.fromEntries(Object.entries(TABLES).map(([n, t]) => [t.fdid, n]));
  const hashes = { itemSparse: SPARSE_HASH, item: ITEM_HASH };
  db2.readDb2 = (buf) => { const name = byFdid[buf.fdid]; if (!tables[name]) throw Object.assign(Error("missing"), { code: "MISSING" }); return { header: { layoutHash: L(name), tableHash: hashes[name] || 1 }, rows: tables[name], inline: (rec) => { try { return JSON.parse(rec.toString()); } catch { return null; } } }; };
  return () => { db2.readDb2 = original; };
}
const sparseBytes = (id, o) => Buffer.from(JSON.stringify(sparseRow(id, o).fields));
function writeHotfix(dirs, build, entries, locale = "enUS") {
  const dir = path.join(dirs.game, "Cache", "ADB", locale);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "DBCache.bin"), xfth(build, entries));
}

test("items: hotfix-only items get their name, quality, stats and icon from the hotfix cache", (t) => {
  const restore = withHotfixDb2(fakeTables()); t.after(restore);
  const dirs = install(), stats = { opened: 0, reads: [], closed: 0 };
  const felblade = { name: "Cursed Felblade", quality: 1, ilvl: 2, req: 1, inv: 21, delay: 1900, variance: 0.6 };
  writeHotfix(dirs, 70938, [
    { table: SPARSE_HASH, id: 14145, data: sparseBytes(14145, felblade) }, { table: ITEM_HASH, id: 14145, data: itemBytes(2, 7, 135648) },
    { table: SPARSE_HASH, id: 60, status: 2 },                                 // removed by hotfix
    { table: SPARSE_HASH, id: 25, data: sparseBytes(25, { name: "Worn Shortsword", quality: 2, ilvl: 2, req: 1, inv: 21, delay: 1900, variance: 0.6, sell: 7 }) }, // changed
    { table: SPARSE_HASH, id: 1275, data: Buffer.from("not a row") },        // unreadable: the installed row stays
    { table: ITEM_HASH, id: 50, data: Buffer.alloc(40) },                    // wrong size: the installed row stays
  ]);
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage(stats), hotfixCheckMs: 0 });
  const blade = g.item(14145);
  assert.equal(blade.name, "Cursed Felblade"); assert.equal(blade.quality, 1); assert.equal(blade.kind, "Sword"); assert.equal(blade.iconFileId, 135648);
  assert.deepEqual(blade.damage, { min: 1, max: 3 });
  assert.equal(g.item(60), null);
  assert.equal(g.item(25).quality, 2);
  assert.equal(g.item(1275).name, "Deputy Chain Coat");
  assert.equal(g.item(50).iconFileId, 132644);
  assert.equal(g.knownIcon(135648), true);
  const status = g.status();
  assert.equal(status.available, true);
  assert.deepEqual(status.limitations, ["itemSparse: 1 hotfix rows unreadable", "item: 1 hotfix rows unreadable"]);
  assert.equal(stats.opened, 1);

  // Same hotfixes: a fresh instance uses the saved copy without opening the game.
  const stats2 = { opened: 0, reads: [], closed: 0 };
  const again = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage(stats2), hotfixCheckMs: 0 });
  assert.equal(again.item(14145).name, "Cursed Felblade");
  assert.equal(stats2.opened, 0);
  // New item hotfixes arrive while the app runs: items are read again.
  writeHotfix(dirs, 70938, [{ table: SPARSE_HASH, id: 14146, data: sparseBytes(14146, { ...felblade, name: "Felblade Two" }) }, { table: ITEM_HASH, id: 14146, data: itemBytes(2, 7, 135649) }]);
  assert.equal(again.item(14146).name, "Felblade Two");
  assert.equal(again.item(14145), null);
  assert.equal(again.item(60).kind, "Shield");
  assert.equal(again.knownIcon(135649), true);
  assert.equal(stats2.opened, 1);
  // A cache written by another game build is not used.
  writeHotfix(dirs, 70937, [{ table: SPARSE_HASH, id: 14147, data: sparseBytes(14147, felblade) }]);
  assert.equal(again.item(14147), null);
  assert.equal(again.item(14146), null);
  assert.equal(again.item(60).kind, "Shield");
  g.release(); again.release();
});

test("items: when re-reading after new hotfixes fails, the earlier items stay; other locales are found", (t) => {
  const restore = withHotfixDb2(fakeTables()); t.after(restore);
  const dirs = install();
  let broken = false, opened = 0;
  const open = () => { opened++; if (broken) throw Error("locked"); return { readFileId: (fdid, opts) => ({ fdid, opts }), close() {} }; };
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open, hotfixCheckMs: 0 });
  assert.equal(g.item(25).name, "Worn Shortsword");
  assert.equal(opened, 1);
  g.release(); broken = true;
  writeHotfix(dirs, 70938, [{ table: SPARSE_HASH, id: 14145, data: sparseBytes(14145, { name: "Cursed Felblade", quality: 3, ilvl: 2, req: 1, inv: 21 }) }], "deDE");
  assert.equal(g.item(25).name, "Worn Shortsword");
  assert.equal(g.item(14145), null);
  const tries = opened;
  assert.equal(g.item(25).name, "Worn Shortsword");
  assert.equal(opened, tries, "a failed re-read is not repeated for the same hotfixes");
  broken = false;
  const fresh = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open, hotfixCheckMs: 0 });
  assert.equal(fresh.item(14145).name, "Cursed Felblade");
  g.release(); fresh.release();
});

// --- Flight points, flight prices, reputation sizes and spell levels (kind "extras") --------------
const taxiNode = (id, name, x, y, continent, flags) => ({ id, fields: [name, [x, y, 30], [0, 0], [0, 0], id, continent, 0, id, flags, 0, 4689, 0, 0, 0, [0, 0]] });
function extraTables(overrides = {}) {
  return fakeTables({
    taxiNodes: [taxiNode(2, "Stormwind, Elwynn", -8832.84, 478.61, 0, 1025), taxiNode(23, "Orgrimmar, Durotar", 1677.59, -4315.71, 1, 1026), taxiNode(40, "", 1, 1, 0, 0), taxiNode(41, "Nowhere", NaN, 5, 0, 3)],
    taxiPath: [{ id: 6, fields: [6, 2, 4, 110] }, { id: 7, fields: [7, 4, 2, 110] }, { id: 8, fields: [8, 2, 2, 5] }, { id: 9, fields: [9, 5, 6, 300] }, { id: 10, fields: [10, 5, 6, 400] }, { id: 11, fields: [11, 5, 6, 300] }, { id: 12, fields: [12, 0, 6, 1] }],
    questFactionReward: [{ id: 1, fields: [[0, 10, 25, 50, 75, 100, 150, 200, 1, 5]] }, { id: 2, fields: [[0, 65486, 65411, 65286, 65161, 65036, 64786, 64536, 65535, 65531]] }],
    spellLevels: [{ id: 1, relation: 543, fields: [0, 0, 0, 20, 20] }, { id: 2, relation: 134, fields: [0, 22, 0, 0, 9] }, { id: 3, relation: 10074, fields: [0, 0, 0, 0, 1] }, { id: 4, relation: 543, fields: [0, 0, 0, 30, 30] }, { id: 5, relation: 77, fields: [1, 0, 0, 40, 40] }, { id: 6, relation: 78, fields: [0, 0, 0, 0, 0] }],
    ...overrides,
  });
}

test("extras: flight points, flight prices, reputation sizes and spell levels from the game's own tables", (t) => {
  const restore = withFakeDb2(extraTables()); t.after(restore);
  const dirs = install(), stats = { opened: 0, reads: [], closed: 0 };
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage(stats) });
  const f = g.flights();
  assert.deepEqual(f.points, { 2: ["Stormwind, Elwynn", 0, -8832.8, 478.6, 1], 23: ["Orgrimmar, Durotar", 1, 1677.6, -4315.7, 2] }, "a point without a name or a place is left out");
  assert.deepEqual(f.costs, { "2>4": 110, "4>2": 110 }, "rows that disagree on a price, or go nowhere, are left out");
  assert.deepEqual(g.repTiers(), { gain: [0, 10, 25, 50, 75, 100, 150, 200, 1, 5], loss: [0, -50, -125, -250, -375, -500, -750, -1000, -1, -5] });
  assert.deepEqual(g.spellLevels(), { 543: 20, 134: 9, 10074: 1 }, "the first row of the base difficulty; a level of 0 is no level");
  for (const name of ["taxiNodes", "taxiPath", "questFactionReward", "spellLevels"]) assert.ok(stats.reads.includes(TABLES[name].fdid), name);
  assert.equal(stats.reads.every((id) => [1068100, 1067802, 1282622, 1140079].includes(id)), true, "only the four tables are read");
  // Cached per game build: a second service reads nothing from the game.
  assert.ok(fs.existsSync(path.join(dirs.cache, "1.60.1.70938", "extras.json")));
  const again = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, open: () => { throw Error("must not open the game"); } });
  assert.deepEqual(again.flights(), f);
  g.release(); again.release();
});

test("extras: a table with another layout or a missing table leaves only its own part empty", (t) => {
  const restore = withFakeDb2(extraTables({ taxiPath: undefined, questFactionReward: [{ id: 1, fields: [[0, 10, 25]] }] }), { taxiNodes: 0xdeadbeef }); t.after(restore);
  const dirs = install();
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage({ opened: 0, reads: [], closed: 0 }) });
  assert.equal(g.flights(), null, "no flight point without the node table, whatever else is readable");
  assert.equal(g.repTiers(), null, "a reward table of another shape is not used");
  assert.deepEqual(g.spellLevels(), { 543: 20, 134: 9, 10074: 1 });
  const { notes } = gd.extractExtras({ readFileId: (fdid) => ({ fdid }) });
  assert.deepEqual(notes, ["taxiNodes: layout differs", "taxiPath: unreadable"]);
  g.release();
  const none = new GameData({ getRoot: () => null, cacheDir: os.tmpdir() });
  assert.equal(none.flights(), null); assert.equal(none.repTiers(), null); assert.equal(none.spellLevels(), null);
});

// --- Boats, zeppelins and airships (kind "transports") --------------------------------------------
const pathNode = (path, index, continent, x, y, flags = 0, delay = 0, z = 0) => ({ id: path * 100 + index, relation: path, fields: [[x, y, z], path * 100 + index, path, index, continent, flags, delay, 0, 0] });
test("transports: stops and path lengths come from the waypoints flagged as a stop", (t) => {
  const restore = withFakeDb2(extraTables({ taxiPathNode: [
    // Path 70 crosses the sea: 300 yards out, moved to the other continent, 400 in; then 500 and 600 back.
    pathNode(70, 0, 1, 0, 0), pathNode(70, 1, 1, 100, 0, 2, 60), pathNode(70, 2, 1, 400, 0), pathNode(70, 3, 0, 5000, 0), pathNode(70, 4, 0, 5400, 0, 2, 60), pathNode(70, 5, 0, 5900, 0),
    // Path 71 stays on one continent: a waypoint flagged to jump, and a step too long to be sailed.
    pathNode(71, 0, 0, 0, 0, 2, 30), pathNode(71, 1, 0, 0, 300, 1), pathNode(71, 2, 0, 0, 9000), pathNode(71, 3, 0, 0, 9400, 2, 30, 300), pathNode(71, 4, 0, 0, 20000),
    // An ordinary flight path (no stop), a path with one stop and a path with a missing waypoint are left out.
    pathNode(6, 0, 0, 1, 1), pathNode(6, 1, 0, 50, 50), pathNode(72, 0, 0, 0, 0, 2, 60), pathNode(72, 1, 0, 9, 9), pathNode(73, 0, 0, 0, 0, 2, 60), pathNode(73, 2, 0, 90, 0, 2, 60),
    { id: 1, relation: 0, fields: [[1, 1, 1], 1, 0, 0, 0, 2, 60, 0, 0] }, { id: 2, relation: 74, fields: [[NaN, 1, 1], 2, 74, 0, 0, 2, 60, 0, 0] },
  ] })); t.after(restore);
  const dirs = install(), stats = { opened: 0, reads: [], closed: 0 };
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage(stats) });
  const paths = g.transportPaths();
  assert.deepEqual(paths, {
    70: { stops: [[1, 100, 0, 60], [0, 5400, 0, 60]], yards: [700, 600] },
    71: { stops: [[0, 0, 0, 30], [0, 0, 9400, 30]], yards: [800, 0] },
  }, "what lies across a continent change, a jump flag or a step over 2,000 yards is not counted as sailed");
  assert.deepEqual(stats.reads, [TABLES.taxiPathNode.fdid], "only the path waypoint table is read");
  assert.ok(fs.existsSync(path.join(dirs.cache, "1.60.1.70938", "transports.json")));
  const again = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, open: () => { throw Error("must not open the game"); } });
  assert.deepEqual(again.transportPaths(), paths);
  g.release(); again.release();
});

test("transports: another layout, a missing table or no game leaves them unknown", (t) => {
  const restore = withFakeDb2(extraTables({ taxiPathNode: [pathNode(70, 0, 1, 0, 0, 2, 60), pathNode(70, 1, 1, 100, 0, 2, 60)] }), { taxiPathNode: 0xdeadbeef }); t.after(restore);
  const dirs = install();
  const g = new GameData({ getRoot: () => dirs.game, cacheDir: dirs.cache, idleMs: 5, open: fakeStorage({ opened: 0, reads: [], closed: 0 }) });
  assert.equal(g.transportPaths(), null);
  assert.deepEqual(gd.extractTransports({ readFileId: (fdid) => ({ fdid }) }).notes, ["taxiPathNode: layout differs"]);
  assert.ok(g.flights(), "the flight points are still read");
  g.release();
  assert.equal(new GameData({ getRoot: () => null, cacheDir: os.tmpdir() }).transportPaths(), null);
});

// One read-only look at a real install, when this PC has one (BF_REAL_GAME_DIR, or the default
// folder with BF_REAL_GAME=1). Nothing is written to the game folder; the cache goes to a temp folder.
test("extras: the real client's tables read as expected", { skip: !(process.env.BF_REAL_GAME_DIR || process.env.BF_REAL_GAME) }, () => {
  const root = process.env.BF_REAL_GAME_DIR || "F:/WorldofWarcraft/World of Warcraft/_forever_";
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "bf-gd-real-")); temp.push(cache);
  const g = new GameData({ getRoot: () => root, cacheDir: cache });
  const f = g.flights(), tiers = g.repTiers(), levels = g.spellLevels();
  assert.ok(f && Object.keys(f.points).length >= 60, "flight points");
  assert.equal(f.points[2][0], "Stormwind, Elwynn"); assert.equal(f.points[2][4], 1); assert.equal(f.points[23][4], 2);
  assert.ok(Math.abs(f.points[2][2] + 8833) < 5 && Math.abs(f.points[2][3] - 479) < 5);
  assert.equal(f.costs["2>4"], 110);
  assert.deepEqual(tiers.gain.slice(0, 8), [0, 10, 25, 50, 75, 100, 150, 200]); assert.equal(tiers.loss[5], -500);
  assert.equal(levels[543], 20, "Fire Ward is learned at 20");
  // The Orgrimmar to Undercity zeppelin (path 302): one stop on each continent, a minute at each.
  const paths = g.transportPaths();
  assert.ok(paths && Object.keys(paths).length >= 8, "transport paths");
  assert.deepEqual(paths[302].stops.map((s) => [s[0], s[3]]), [[1, 60], [0, 60]]);
  assert.ok(Math.abs(paths[302].stops[0][1] - 1318) < 5 && Math.abs(paths[302].stops[0][2] + 4658) < 5);
  assert.ok(paths[302].yards.every((y) => y > 1500 && y < 5000));
  g.release();
});
