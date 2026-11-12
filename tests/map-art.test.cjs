"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { blte, hashlittle2, nameHash, parseBuildInfo, parseConfig } = require("../src/core/casc-reader.cjs");
const { decodeBlp, encodePng } = require("../src/core/blp.cjs");
const { readBits } = require("../src/core/db2.cjs");
const { MapArt, folderCandidates, WIDTH, HEIGHT } = require("../src/core/map-art.cjs");

test("lookup3 hashlittle2 matches the reference vectors", () => {
  assert.deepEqual(hashlittle2(Buffer.alloc(0)), [0xdeadbeef, 0xdeadbeef]);
  assert.deepEqual(hashlittle2(Buffer.from("Four score and seven years ago")), [0x17770551, 0xce7226e6]);
  assert.equal(nameHash("a/b.blp"), nameHash("A\\B.BLP"), "paths are case and slash insensitive");
});

test("BLTE decodes raw, zlib and multi-chunk streams", () => {
  const single = Buffer.concat([Buffer.from("BLTE"), Buffer.alloc(4), Buffer.from("Nhello")]);
  assert.equal(blte(single).toString(), "hello");
  const a = Buffer.concat([Buffer.from("Z"), zlib.deflateSync(Buffer.from("map "))]), b = Buffer.from("Nart");
  const head = Buffer.alloc(12 + 48);
  head.write("BLTE", 0); head.writeUInt32BE(head.length, 4); head[8] = 0x0f; head.writeUIntBE(2, 9, 3);
  head.writeUInt32BE(a.length, 12); head.writeUInt32BE(4, 16); head.writeUInt32BE(b.length, 36); head.writeUInt32BE(3, 40);
  assert.equal(blte(Buffer.concat([head, a, b])).toString(), "map art");
  assert.throws(() => blte(Buffer.concat([Buffer.from("BLTE"), Buffer.alloc(4), Buffer.from("E..")])), { code: "ENCRYPTED" });
});

test("build info and config parse", () => {
  const rows = parseBuildInfo("Branch!STRING:0|Active!DEC:1|Product!STRING:0\nus|1|wowf\n");
  assert.deepEqual(rows, [{ Branch: "us", Active: "1", Product: "wowf" }]);
  assert.deepEqual(parseConfig("# x\nroot = aa\nencoding = bb cc\n").encoding, ["bb", "cc"]);
});

function blp(width, height, { compression, alphaType = 0, data, palette }) {
  const head = Buffer.alloc(148 + 1024);
  head.write("BLP2", 0); head.writeUInt32LE(1, 4); head[8] = compression; head[9] = palette ? 0 : 8; head[10] = alphaType;
  head.writeUInt32LE(width, 12); head.writeUInt32LE(height, 16);
  head.writeUInt32LE(head.length, 20); head.writeUInt32LE(data.length, 84);
  if (palette) palette.forEach((c, i) => head.writeUInt32LE(c, 148 + i * 4));
  return Buffer.concat([head, data]);
}

test("BLP decodes DXT1, raw BGRA and palettized textures", () => {
  // One DXT1 block: color0 pure red, color1 pure blue, all pixels index 0.
  const block = Buffer.alloc(8); block.writeUInt16LE(0xf800, 0); block.writeUInt16LE(0x001f, 2);
  const d = decodeBlp(blp(4, 4, { compression: 2, alphaType: 0, data: block }));
  assert.deepEqual([...d.rgba.subarray(0, 4)], [255, 0, 0, 255]);
  const raw = decodeBlp(blp(1, 1, { compression: 3, data: Buffer.from([10, 20, 30, 40]) }));
  assert.deepEqual([...raw.rgba], [30, 20, 10, 40]);
  const pal = decodeBlp(blp(1, 1, { compression: 1, data: Buffer.from([1]), palette: [0, 0x00112233] }));
  assert.deepEqual([...pal.rgba], [0x11, 0x22, 0x33, 255]);
  const png = encodePng(1, 1, pal.rgba);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
});

test("DB2 bit reader reads little-endian bit fields", () => {
  const b = Buffer.from([0b10110100, 0b00000001]);
  assert.equal(readBits(b, 0, 2, 3), 0b101);
  assert.equal(readBits(b, 0, 4, 5), 0b11011);
});

test("map art composes from the player's install, caches per build and explains gaps", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-art-"));
  const block = Buffer.alloc(8); block.writeUInt16LE(0x07e0, 0); // green
  const tile = blp(4, 4, { compression: 2, data: Buffer.concat(Array(1).fill(block)) });
  let opened = 0, reads = 0;
  const storage = {
    version: "1.60.1.1", _mapTables: null,
    fileIdForName: (p) => /orgrimmar\/orgrimmar\d+\.blp$/i.test(p) ? 1000 + Number(/(\d+)\.blp$/.exec(p)[1]) : null,
    readFileId: () => { reads++; return tile; },
    close() {},
  };
  const art = new MapArt({ getRoot: () => "C:/Games/World of Warcraft/_forever_", cacheDir: dir, idleMs: 5, open: () => { opened++; return storage; } });
  const r = art.art(1454);
  assert.ok(r.png && r.source.includes("1.60.1.1"));
  assert.equal(reads, 12);
  const again = art.art(1454);
  assert.equal(reads, 12, "second request comes from the cache");
  assert.ok(again.png.equals(r.png));
  assert.ok(fs.existsSync(path.join(dir, "1.60.1.1", "1454.png")));
  assert.match(art.art(1411).reason, /no map art/);
  assert.throws(() => art.art(-1));
  const none = new MapArt({ getRoot: () => null, cacheDir: dir });
  assert.match(none.art(1454).reason, /Connect your WoW/);
  assert.equal(WIDTH, 1002); assert.equal(HEIGHT, 668);
  assert.ok(folderCandidates(1413).includes("Barrens"));
  art.release();
});
