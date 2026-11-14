"use strict";
// G13: one painting per zone, shared by the in-game banner (TGA) and the app (WebP).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const EXPECTED = [1411, 1412, 1420, 1429, 1426, 1438, 1413, 1421, 1436, 1432, 1439, 1433, 1442, 1440, 1431, 1424, 1437, 1441, 1416, 1417, 1443, 1434, 1445, 1418, 1435, 1444, 1425, 1446, 1427, 1447, 1419, 1449, 1448, 1428, 1422, 1423, 1452, 1430, 1451, 1450, 1453, 1454, 1455, 1456, 1457, 1458];
const ids = (text) => text.split(",").map((s) => Number(s.trim()));
const luaIds = () => ids(/local ZONE_PAINTINGS=\{([\d,]+)\}/.exec(read("addon/BackstageForever/BackstageForeverRoute.lua"))[1]);
function zoneArt() {
  const window = {};
  vm.runInNewContext(read("src/renderer/zone-art.js"), { window });
  return window.ZoneArt;
}

test("the addon and the app list the same 46 painted zones", () => {
  assert.equal(EXPECTED.length, 46);
  assert.equal(new Set(EXPECTED).size, 46);
  assert.deepEqual(luaIds(), EXPECTED);
  assert.deepEqual(Array.from(zoneArt().paintedIds(), Number), EXPECTED);
});

test("the app uses a zone's own painting when it has one, else its biome vista", () => {
  const z = zoneArt();
  assert.equal(z.url(1411), "art/zones/map-1411.webp");
  assert.equal(z.url(1450), "art/zones/map-1450.webp", "Moonglade has no biome but has a painting");
  assert.equal(z.painted(1414), false);
  assert.equal(z.url(1414), null);
  // Marked elements get the painting as a CSS variable (CSP: never an inline style attribute).
  const set = [];
  const el = (id) => ({ dataset: { zoneArt: String(id) }, style: { setProperty: (k, v) => set.push([id, k, v]) } });
  const a = el(1413), b = el(9999), host = { matches: () => false, querySelectorAll: () => [a, b] };
  z.paint(host);
  assert.deepEqual(set, [[1413, "--zone-art", 'url("art/zones/map-1413.webp")']]);
  const self = { ...el(1454), matches: () => true, querySelectorAll: () => [] };
  z.paint(self);
  assert.deepEqual(set.at(-1), [1454, "--zone-art", 'url("art/zones/map-1454.webp")']);
  for (const f of ["src/renderer/now.js", "src/renderer/app.js"]) {
    const src = read(f);
    assert.match(src, /data-zone-art/, f);
    assert.match(src, /ZoneArt\??\.paint\(/, f);
    assert.doesNotMatch(src, /style="[^"]*zone-art/, f);
  }
  assert.match(read("src/renderer/now.css"), /\.now-zc-head\[data-zone-art\][^{]*\{ background-image: var\(--zone-art\); \}/);
  assert.match(read("src/renderer/styles.css"), /\.expedition-card\[data-zone-art\]::before \{ background-image: var\(--zone-art\); \}/);
});

test("zone paintings are credited as original Backstage Coding art made with local ComfyUI", () => {
  const notice = read("src/renderer/art/NOTICE.md");
  assert.match(notice, /`zones\/map-\*\.webp`[^\n]*ComfyUI/);
  assert.match(notice, /`addon\/BackstageForever\/Art\/Zones\/\*\.tga`[^\n]*ComfyUI/);
});

// Expected to fail until the painted art is dropped in: 46 TGA + default.tga for the addon, 46 WebP for the app.
test("every painted zone has its in-game TGA and app WebP, plus the default banner", () => {
  const missing = [];
  const need = (f) => { if (!fs.existsSync(path.join(root, f))) missing.push(f); };
  need("addon/BackstageForever/Art/Zones/default.tga");
  for (const id of EXPECTED) {
    need(`addon/BackstageForever/Art/Zones/${id}.tga`);
    need(`src/renderer/art/zones/map-${id}.webp`);
  }
  assert.deepEqual(missing, [], `${missing.length} zone paintings missing`);
  // TGA: uncompressed true colour, 1024x128, 24 or 32 bit.
  for (const id of [...EXPECTED, "default"]) {
    const h = fs.readFileSync(path.join(root, `addon/BackstageForever/Art/Zones/${id}.tga`)).subarray(0, 18);
    assert.equal(h[2], 2, `${id}.tga must be uncompressed true colour (type 2)`);
    assert.equal(h.readUInt16LE(12), 1024, `${id}.tga width`);
    assert.equal(h.readUInt16LE(14), 128, `${id}.tga height`);
    assert.ok(h[16] === 24 || h[16] === 32, `${id}.tga bit depth`);
  }
});
