"use strict";
// 0.38 (H7) hidden live link: the "hairline" strip (version 6), one physical pixel tall along the
// top edge of the game, one bit per channel (0 or a dark 36), carrying the frame and five pages at
// once behind a CRC-16. The Lua encoder and the app decoder must agree byte for byte for every page
// kind, survive what the real client does to near-black colours (a model fitted from a real capture
// of the four-level version 5, which it broke), refuse torn frames whole, be told apart from the
// corner strips, and the app must say "paused" (not "couldn't read") while WoW is minimized or gone.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const L = require("../src/core/live-bridge.cjs");
const root = path.join(__dirname, "..");

function lua(body) {
  const r = spawnSync(process.execPath, [require.resolve("fengari-node-cli/src/lua-cli.js"), "-"], { cwd: root, input: body, encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1048576 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, "");
  return r.stdout.trim();
}
const json = (v) => `do local a={} for _,x in ipairs(${v}) do a[#a+1]=type(x)=='table' and ('['..x[1]..','..x[2]..','..x[3]..']') or x end print('['..table.concat(a,',')..']') end`;
const luaString = (text) => '"' + [...Buffer.from(text, "utf8")].map((b) => "\\" + b).join("") + '"';
const ID = 4242;
const STATE = `{seq=7,heartbeat=19,mapId=1454,x=0.4321,y=0.6543,level=12,health=88,targetNpcId=3057,targetHealth=100,xp=42,freeSlots=9,questId=93739,objectives=5,questHash=201,facing=1.5,identity=${ID}}`;
const QUESTION = "Où est le maître de vol à Orgrimmar ? 十字路口";

// One Lua run: a frame with every page kind, its bytes and its cells.
const LUA = (() => {
  const out = lua(`dofile('addon/BackstageForever/BackstageForeverLive.lua')
local main=BackstageForeverLivePayload(${STATE},6)
local log=BackstageForeverLivePages(1,{{id=93739,complete=true},{id=812,complete=false},{id=840},{id=844},{id=845},{id=846},{id=869}},${ID})
local turned=BackstageForeverLivePages(2,{786,788},${ID})
local moments=BackstageForeverLiveMomentPages({{type=5,seq=3,at=90,a=186,b=75,c=15},{type=2,seq=2,at=80,a=448,b=17,c=1}},${ID},100)
local q=BackstageForeverLiveQuestionPages(9,${luaString(QUESTION)},${ID})
local pages={log[1],turned[1],moments[1],q[1],q[2]}
local f=BackstageForeverLiveHairlineFrame(main,pages)
${json("main")} ${json("f")} ${json("BackstageForeverLiveHairlineCells(f)")}
for _,p in ipairs(pages) do ${json("p")} end
local e=BackstageForeverLiveHairlineFrame(main,{}) ${json("e")}
local L=BackstageForeverLiveLayout() print(L.mode..' '..L.width..' '..L.height..' '..L.cell..' '..L.cellH..' '..L.point..' '..L.row1..' '..L.row2)
local P=BackstageForeverLiveLayout('hairline','bottomright') print(P.point)`).split("\n");
  return { main: JSON.parse(out[0]), frame: JSON.parse(out[1]), cells: JSON.parse(out[2]), pages: out.slice(3, 8).map(JSON.parse), empty: JSON.parse(out[8]), layout: out[9], cornerPoint: out[10] };
})();

// A game picture (bright, varied) with `cells` drawn along row `y` from x0, `pitch` pixels a cell.
function image(cells, { width = L.TOPLEFT_REGION.width, height = L.TOPLEFT_REGION.height, pitch = 2, x0 = 0, y = 0, map = null, noise = 0, scene = (x, yy) => [90 + ((x * 7 + yy * 13) % 70), 110 + ((x * 3) % 50), 80 + ((yy * 11) % 60)] } = {}) {
  const rgb = Buffer.alloc(width * height * 3);
  for (let yy = 0; yy < height; yy++) for (let x = 0; x < width; x++) { const o = (yy * width + x) * 3, s = scene(x, yy); rgb[o] = s[0]; rgb[o + 1] = s[1]; rgb[o + 2] = s[2]; }
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  cells.forEach((c, i) => { for (let dx = 0; dx < pitch; dx++) { const o = (y * width + x0 + i * pitch + dx) * 3; for (let ch = 0; ch < 3; ch++) rgb[o + ch] = clamp((map ? map(c[ch]) : c[ch]) + (noise ? (rnd() * 2 - 1) * noise : 0)); } });
  return { width, height, rgb };
}
const asArray = (b) => Array.from(b);

test("Lua hairline frame and cells match the app encoder byte for byte; layout is 892 x 1 on the top edge", () => {
  const { main, frame, cells, pages, empty } = LUA;
  assert.equal(main[0], 6, "the frame payload says version 6");
  assert.equal(frame.length, 165); assert.equal(cells.length, 446);
  assert.deepEqual(L.encodeHairlineFrame(main, pages), frame);
  assert.deepEqual(L.encodeHairlineCells(frame), cells);
  assert.equal(frame[162], 5, "five pages"); assert.equal(empty[162], 0);
  assert.equal(L.crc16(frame, 163), (frame[163] << 8) | frame[164]);
  assert.equal(L.crc16(Buffer.from("123456789"), 9), 0x29b1, "CRC-16/CCITT-FALSE check value");
  assert.deepEqual(cells.slice(0, 6), [[36, 0, 36], [0, 36, 0], [36, 0, 36], [0, 36, 0], [0, 0, 0], [36, 36, 36]]);
  assert.ok(cells.every((c) => c.every((v) => v === 0 || v === 36)), "one bit a channel: 0 or a dark 36");
  assert.equal(LUA.layout, "hairline 892 1 2 1 TOPLEFT 446 0");
  assert.equal(LUA.cornerPoint, "TOPLEFT", "the hairline ignores the corner setting");
  assert.equal(L.HAIRLINE_WIDTH, 892, "fits a 1280-wide screen");
});

test("every page kind round-trips through a captured hairline: quest log, turned in, moments, question", () => {
  const d = L.decodeStrip(image(LUA.cells));
  assert.ok(d, "decodes");
  assert.equal(d.mode, "hairline"); assert.equal(d.version, 6); assert.equal(d.pitch, 2);
  assert.deepEqual(d.origin, { x: 0, y: 0 }); assert.deepEqual(d.footprint, { width: 892, height: 1 });
  const f = L.parsePayload(d.bytes);
  assert.equal(f.version, 6); assert.equal(f.position.mapId, 1454); assert.equal(f.characterHash, ID); assert.equal(f.heartbeat, 19);
  assert.deepEqual(f.quest, { id: 93739, objectivesDone: [1, 3] });
  assert.equal(d.pages.length, 5);
  assert.deepEqual(d.pages.map(asArray), LUA.pages);
  const log0 = L.parsePage(d.pages[0]);
  assert.equal(log0.kind, "questLog"); assert.equal(log0.count, 2); assert.deepEqual(log0.ids[0], { id: 93739, complete: true });
  assert.deepEqual(L.parsePage(d.pages[1]).ids.map((e) => e.id), [786, 788]);
  assert.deepEqual(L.parseMomentPage(d.pages[2]).moments.map((m) => [m.type, m.seq, m.ageS, m.a]), [[5, 3, 10, 186], [2, 2, 20, 448]]);
  const q = [L.parseQuestionPage(d.pages[3]), L.parseQuestionPage(d.pages[4])];
  assert.equal(q[0].count, 4, `${Buffer.byteLength(QUESTION)} bytes = four pages`);
  // An empty frame (no pages yet) decodes too.
  const e = L.decodeStrip(image(L.encodeHairlineCells(LUA.empty)));
  assert.ok(e && e.mode === "hairline"); assert.deepEqual(e.pages, []); assert.equal(e.page, null);
});

// What the real client did to the version 5 hairline (WoW Forever, PrintWindow capture, 3440x1440):
// grey references 0/12/24/36 came back as 4/10/30/48 (an S-shaped gamma curve), a lone lit channel
// was boosted more than greys (36 -> 51..59), and channels meant to be 0 read up to 9 beside a lit
// one. This model applies all of that, plus +-2 noise, to every cell of a line.
function realClient(cells, { seed = 7, boost = 1.2, bleed = [3, 9], noise = 2 } = {}) {
  const curve = [[0, 4], [12, 10], [24, 30], [36, 48], [255, 255]];
  const gamma = (v) => { for (let i = 1; i < curve.length; i++) if (v <= curve[i][0]) { const [x0, y0] = curve[i - 1], [x1, y1] = curve[i]; return y0 + ((v - x0) * (y1 - y0)) / (x1 - x0); } return 255; };
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  return cells.map((c) => {
    const lit = c.filter((v) => v > 0).length;
    return c.map((v) => {
      let out = gamma(v);
      if (v > 0 && lit === 1) out *= boost; else if (v > 0 && lit === 2) out *= 1 + (boost - 1) / 2;
      if (v === 0 && lit > 0) out += bleed[0] + rnd() * (bleed[1] - bleed[0]);
      return Math.max(0, Math.min(255, Math.round(out + (rnd() * 2 - 1) * noise)));
    });
  });
}

test("the real client's colour handling (fitted from a capture of the four-level line) no longer breaks the hairline", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const d = L.decodeStrip(image(realClient(LUA.cells, { seed })));
    assert.ok(d && d.mode === "hairline", `seed ${seed}`);
    assert.deepEqual(asArray(d.bytes), LUA.main); assert.deepEqual(d.pages.map(asArray), LUA.pages);
  }
  // Harsher than observed: more boost, more bleed, more noise.
  for (const opts of [{ boost: 1.5 }, { bleed: [6, 14] }, { noise: 5 }, { boost: 1.4, bleed: [5, 12], noise: 4 }]) {
    const d = L.decodeStrip(image(realClient(LUA.cells, opts)));
    assert.ok(d && d.pages.length === 5, JSON.stringify(opts));
  }
  // The four-level version 5 line of early test builds really was unreadable under the same model
  // (its 12 and 24 shades land beside the bleed and the boost): the reason for version 6.
  const levels = [0, 12, 24, 36], v5 = [[36, 0, 36], [0, 36, 0], [36, 0, 36], [0, 36, 0], [0, 0, 0], [12, 12, 12], [24, 24, 24], [36, 36, 36]];
  for (let i = 0; i < 400; i++) v5.push([0, 1, 2].map((ch) => levels[(i * 7 + ch * 3 + (i >> 3)) % 4]));
  const hit = realClient(v5);
  const nearest = (v, l) => l.reduce((b, x, k) => (Math.abs(v - x) < Math.abs(v - l[b]) ? k : b), 0);
  const refs = [0, 1, 2].map((ch) => hit.slice(4, 8).map((c) => c[ch]));
  let wrong = 0;
  for (let i = 8; i < v5.length; i++) for (let ch = 0; ch < 3; ch++) if (levels[nearest(hit[i][ch], refs[ch])] !== v5[i][ch]) wrong++;
  assert.ok(wrong > 20, `four shades a channel misread under the model: ${wrong} channels`);
});

test("the header of the real capture (sync cells and the off/on references) calibrates the binary decoder", () => {
  const { row } = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/live-hairline-v5-real-row0.json"), "utf8"));
  assert.equal(row.length, 400);
  for (let i = 0; i < row.length; i += 2) assert.deepEqual(row[i], row[i + 1], `2px cells are pixel-exact (cell ${i / 2})`);
  const cell = (i) => row[i * 2];
  // Version 5 header: magenta, green, magenta, green, then greys 0, 12, 24, 36. Version 6 uses the
  // same four sync cells, black and the dark grey "on" (36).
  const head = [cell(0), cell(1), cell(2), cell(3), cell(4), cell(7)];
  assert.deepEqual(head, [[51, 6, 50], [3, 56, 2], [51, 6, 50], [3, 56, 2], [4, 3, 3], [48, 47, 47]]);
  const th = L.hairlineThresholds(head);
  assert.ok(th, "calibrates");
  for (const t of th) assert.ok(t > 22 && t < 32, `threshold ${t}`);
  // Every channel the real client drew as "off" or bled into stays below; every lit one above.
  const offs = row.flat().filter((v) => v < 20), ons = row.flat().filter((v) => v >= 45);
  assert.ok(Math.max(...offs) < Math.min(...th) - 6 && Math.min(...ons) > Math.max(...th) + 12, "far from the threshold on both sides");
  // A line built from exactly these measured colours decodes.
  const real = (c) => [c[0] ? 51 : 4, c[1] ? 56 : 9, c[2] ? 50 : 3];
  const built = [...head, ...LUA.cells.slice(6).map((c) => real(c.map((v) => (v ? 1 : 0))))];
  const d = L.decodeStrip(image(built));
  assert.ok(d && d.pages.length === 5);
  // The old four-level line itself is (correctly) not decoded, and the app asks for /bf live safe.
  const old = image(row.map((p) => p), { pitch: 1 });
  assert.equal(L.decodeStrip(old), null);
});

test("calibration: shifted, scaled or noisy colours still decode; off and on too close are refused with a hint to use safe mode", () => {
  const shifts = {
    "lifted +20": (v) => v + 20, "dimmed x0.6": (v) => v * 0.6, "contrast x3": (v) => v * 3, "gamma 0.6": (v) => 255 * Math.pow(v / 255, 0.6),
    "per-channel tint": null, "noise 6": "noise",
  };
  for (const [name, map] of Object.entries(shifts)) {
    const opts = map === "noise" ? { noise: 6 } : map === null ? {} : { map };
    let cells = LUA.cells;
    if (map === null) cells = cells.map((c) => [c[0] + 10, c[1] * 1.3, c[2] + 4]);
    const d = L.decodeStrip(image(cells, opts));
    assert.ok(d && d.mode === "hairline", name);
    assert.deepEqual(asArray(d.bytes), LUA.main, name);
    assert.equal(d.pages.length, 5, name);
  }
  // Remote desktop flattening the darks: off and on come out within 8 of each other.
  const flat = image(LUA.cells, { map: (v) => 20 + v * 0.2 });
  assert.equal(L.decodeStrip(flat), null);
  assert.equal(L.stripHint(flat), "hairline-unreadable");
  // Heavy compression noise breaks the CRC: refused, with the same hint.
  const noisy = image(LUA.cells, { noise: 22 });
  assert.equal(L.decodeStrip(noisy), null);
  assert.equal(L.stripHint(noisy), "hairline-unreadable");
  // No line at all (live off, or an older addon not running) is not mistaken for one.
  assert.equal(L.stripHint(image([])), null);
  const dark = image([], { scene: (x) => [20 + (x % 9), 18 + (x % 7), 22] });
  assert.equal(L.stripHint(dark), null, "a uniformly dark scene (night, cave) is not a hairline");
});

test("a capture torn between two frames never decodes as either mix: the whole frame is refused", () => {
  const other = L.encodeHairlineFrame([...LUA.main.slice(0, 26).map((v, i) => (i === 1 ? 8 : i === 25 ? 20 : v)), 0], []);
  // fix the inner payload CRC so only the whole-line checks can catch a mix
  const m2 = other.slice(0, 27); m2[26] = L.crc8(m2, 26);
  const b = L.encodeHairlineCells(L.encodeHairlineFrame(m2, [LUA.pages[0], LUA.pages[1]])), a = LUA.cells;
  assert.ok(L.decodeStrip(image(b)), "the second frame alone decodes");
  let refused = 0;
  for (let split = 7; split < 446; split++) {
    for (const [first, second] of [[a, b], [b, a]]) {
      const mixed = [...first.slice(0, split), ...second.slice(split)];
      const d = L.decodeStrip(image(mixed));
      if (JSON.stringify(mixed) === JSON.stringify(first) || JSON.stringify(mixed) === JSON.stringify(second)) continue;
      if (!d) { refused++; continue; }
      // A mix is only accepted when it is byte-identical to one of the two whole frames.
      const whole = [a, b].map((c) => L.decodeStrip(image(c)));
      assert.ok(whole.some((w) => JSON.stringify(asArray(w.bytes)) === JSON.stringify(asArray(d.bytes)) && JSON.stringify(w.pages.map(asArray)) === JSON.stringify(d.pages.map(asArray))), `split at ${split} decoded a mix`);
    }
  }
  assert.ok(refused > 700, `torn captures refused: ${refused}`);
  // Single changed cells anywhere fail the CRC-16.
  for (let i = 6; i < 446; i += 7) { const bad = a.map((c) => [...c]); bad[i][i % 3] = bad[i][i % 3] === 0 ? 36 : 0; assert.equal(L.decodeStrip(image(bad)), null, `cell ${i}`); }
});

test("auto-detect: hairline, compact and safe strips are told apart; the hairline only at the top-left", () => {
  const v4 = L.encodeCellsV4(Uint8Array.from([4, ...LUA.main.slice(1, 26), 0]).map((v, i, arr) => (i === 26 ? L.crc8(arr, 26) : v)));
  const v4img = { width: 640, height: 28, rgb: Buffer.alloc(640 * 28 * 3, 30) };
  v4.forEach((c, i) => { for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const o = (dy * 640 + i * 2 + dx) * 3; v4img.rgb[o] = c[0]; v4img.rgb[o + 1] = c[1]; v4img.rgb[o + 2] = c[2]; } });
  const compact = L.decodeStrip(v4img);
  assert.equal(compact.mode, "compact"); assert.equal(compact.version, 4); assert.deepEqual(compact.pages, []);
  const hair = L.decodeStrip(image(LUA.cells));
  assert.equal(hair.mode, "hairline");
  // A hairline is not searched for in other corners (it lives on the top edge).
  assert.equal(L.decodeStrip(image(LUA.cells), { corner: "topright" }), null);
  // One pixel low (a client area that starts a row early) and 1px / 3px cells still decode.
  assert.equal(L.decodeStrip(image(LUA.cells, { y: 1 })).origin.y, 1);
  for (const pitch of [1, 3]) assert.equal(L.decodeStrip(image(LUA.cells, { pitch, width: 1400 })).pitch, pitch);
  // The small hairline capture region holds the whole line.
  const small = image(LUA.cells, { ...L.HAIRLINE_REGION });
  assert.equal(L.decodeStrip(small).mode, "hairline");
  // Random noise never decodes as anything.
  const noise = { ...L.TOPLEFT_REGION, rgb: Buffer.from(Array.from({ length: L.TOPLEFT_REGION.width * L.TOPLEFT_REGION.height * 3 }, (_, i) => ((i * 2654435761) >>> 0) % 40)) };
  assert.equal(L.decodeStrip(noise), null);
});

test("bridge: a hairline capture goes live, shrinks the region, reports the capture method and delivers several pages per capture", () => {
  let t = 1_000_000;
  const writes = [], questions = [];
  const b = new L.LiveBridge({ now: () => t, platform: "linux" });
  b.enabled = true; b.child = { stdin: { write: (s) => writes.push(s) } };
  b.subscribeQuestions((q) => questions.push(q));
  // A whole 4-page question in two frames of the line.
  const q = L.encodeQuestionPages(9, QUESTION, ID);
  const frame = (pages) => image(L.encodeHairlineCells(L.encodeHairlineFrame(LUA.main, pages)));
  const send = (img, method = "pw") => b.line(`ok topleft ${img.width} ${img.height} ${img.rgb.toString("base64")} ${method}`);
  const log = L.encodePages(1, [{ id: 93739, complete: true }, { id: 812 }, { id: 840 }, { id: 844 }, { id: 845 }, { id: 846 }, { id: 869 }], ID);
  send(frame([q[0], q[1], q[2], log[0], log[1]]));
  const s = b.status();
  assert.equal(s.signal, "live");
  assert.deepEqual({ ...s.strip, idle: undefined }, { mode: "hairline", version: 6, corner: "topleft", pitch: 2, width: 892, height: 1, capture: "window", idle: undefined });
  assert.deepEqual(writes, [`interval ${L.QUESTION_INTERVAL_MS}\n`, "region topleft 900 4\n"], "question pages speed up sampling; a found hairline needs only 900 x 4 pixels");
  assert.deepEqual(s.frame.questLog.map((e) => e.id), [93739, 812, 840, 844, 845, 846, 869], "both quest log pages from one capture");
  assert.equal(questions.length, 0);
  t += 400; send(frame([q[3], LUA.pages[1]]), "screen");
  assert.equal(questions.length, 1); assert.equal(questions[0].text, QUESTION);
  assert.equal(b.status().strip.capture, "screen");
  // Lost: the small region grows back; a dark unreadable line keeps the corner and asks for safe mode.
  const blank = { width: 900, height: 4, rgb: Buffer.alloc(900 * 4 * 3, 120) };
  send(blank);
  assert.equal(writes.at(-1), "region topleft 912 28\n");
  const n = writes.length;
  for (let i = 0; i < 3; i++) send(image(LUA.cells, { noise: 22 }));
  assert.equal(b.signal, "hairline-unreadable"); assert.equal(writes.length, n, "no corner walk while a line is visible");
  clearTimeout(b.slowTimer);
});

test("BF_LIVE_DUMP saves the raw top rows of a hairline that does not decode (rate-limited), and nothing otherwise", () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "bf-dump-"));
  let t = 2_000_000;
  const b = new L.LiveBridge({ now: () => t, platform: "linux", dumpDir: dir });
  b.enabled = true;
  const send = (img) => b.line(`ok topleft ${img.width} ${img.height} ${img.rgb.toString("base64")} pw`);
  send(image(LUA.cells));
  assert.deepEqual(fs.readdirSync(dir), [], "a good line is not saved");
  const bad = image(LUA.cells, { noise: 22, height: 4 });
  send(bad); t += 1000; send(bad);
  let files = fs.readdirSync(dir);
  assert.equal(files.length, 1, "at most one every 10 seconds");
  const dump = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  assert.equal(dump.capture, "window"); assert.equal(dump.rows.length, 3); assert.equal(dump.rows[0].length, 908);
  assert.deepEqual(dump.rows[0][0], [bad.rgb[0], bad.rgb[1], bad.rgb[2]]);
  t += 11000; send(bad);
  assert.equal(fs.readdirSync(dir).length, 2);
  // Off unless asked for: no BF_LIVE_DUMP, no files.
  const quiet = new L.LiveBridge({ now: () => t, platform: "linux", dumpDir: null });
  quiet.enabled = true; quiet.line(`ok topleft ${bad.width} ${bad.height} ${bad.rgb.toString("base64")} pw`);
  assert.equal(quiet.dump(bad), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a frozen hairline goes stale like a compact strip (heartbeat), older workers' lines still parse", () => {
  let t = 1000;
  const b = new L.LiveBridge({ now: () => t, platform: "linux" });
  b.enabled = true;
  const img = image(LUA.cells);
  for (let i = 0; i < 50; i++) { t += 500; b.line(`ok topleft ${img.width} ${img.height} ${img.rgb.toString("base64")}`); }
  assert.equal(b.status().signal, "stale", "same heartbeat for 25 seconds: a picture, not a live game");
  assert.equal(b.status().strip.capture, undefined, "5-field lines carry no capture method");
});

test("minimized and window-not-found say paused, keep the last live state with its age, and resume by themselves", () => {
  let t = 10_000_000;
  const b = new L.LiveBridge({ now: () => t, platform: "linux" });
  b.enabled = true;
  const img = image(LUA.cells);
  b.line(`ok topleft ${img.width} ${img.height} ${img.rgb.toString("base64")} pw`);
  assert.equal(b.status().last, null, "nothing to fall back on while live");
  t += 1000; b.line("minimized");
  t += 179000;
  const s = b.status();
  assert.equal(s.signal, "minimized"); assert.equal(s.frame, null, "never presented as live");
  assert.equal(s.last.ageMs, 180000); assert.equal(s.last.level, 12);
  assert.equal(s.last.position.mapId, 1454); assert.equal(s.last.position.zone, require("../src/core/companion-tools.cjs").MAP_NAMES[1454]);
  b.line("nogame"); assert.equal(b.status().signal, "nogame"); assert.ok(b.status().last);
  b.line("gone"); assert.equal(b.status().signal, "nogame");
  // Back: the next capture is live again, no user action.
  const back = L.encodeHairlineFrame([...LUA.main.slice(0, 25), 20, 0].map((v, i, a) => (i === 26 ? L.crc8(a, 26) : v)), []);
  b.line(`ok topleft ${img.width} ${img.height} ${image(L.encodeHairlineCells(back)).rgb.toString("base64")} pw`);
  assert.equal(b.status().signal, "live"); assert.equal(b.status().last, null);

  // The words the app shows (Settings -> Game connection and the Now status line).
  const c = { window: {}, document: { querySelectorAll: () => [], addEventListener() {} }, setInterval() {} };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, "src/renderer/live-link.js"), "utf8"), c);
  const LL = c.window.LiveLink, now = 50_000_000;
  const last = { receivedAt: now - 180000, ageMs: 180000, level: 12, position: { mapId: 1454, x: 0.551, y: 0.502, zone: "Orgrimmar" } };
  assert.equal(LL.text({ enabled: true, signal: "minimized", last }, now), "WoW is minimized — live updates are paused and resume when you bring it back. Last live: Orgrimmar 55.1, 50.2 · level 12 · 3 min ago.");
  assert.equal(LL.text({ enabled: true, signal: "nogame", last }, now), "WoW window not found — live updates are paused and resume when the game is back. Last live: Orgrimmar 55.1, 50.2 · level 12 · 3 min ago.");
  assert.equal(LL.text({ enabled: true, signal: "minimized", last: null }, now), "WoW is minimized — live updates are paused and resume when you bring it back.");
  assert.doesNotMatch(LL.text({ enabled: true, signal: "minimized", last }, now), /couldn.t read|can.t read/i);
  assert.match(LL.text({ enabled: true, signal: "hairline-unreadable" }, now), /Type \/bf live safe in WoW/);
  assert.match(LL.text({ enabled: true, signal: "no-signal" }, now), /\/bf live safe/);
  assert.equal(LL.stripLine({ enabled: true, strip: { mode: "hairline", corner: "topleft", width: 892, height: 1, capture: "window" } }), "Mode: Hairline · Placement: top edge · 892×1 px · read from the game window (works behind other windows)");
  const now_js = fs.readFileSync(path.join(root, "src/renderer/now.js"), "utf8");
  assert.match(now_js, /WoW is minimized — live updates are paused and resume when you bring it back\./);
  assert.match(now_js, /sig === "hairline-unreadable"/);
});

// Addon harness: frames with anchors, textures with colours/sizes/offsets, a clock and events.
const HARNESS = String.raw`
local frames,textures,handlers={}, {}, {}
local clock=100
GetTime=function() return clock end
UIParent={GetEffectiveScale=function()return 0.71 end}
GetPhysicalScreenSize=function()return 3440,1440 end
local messages={}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m)messages[#messages+1]=m end}
UnitGUID=function(u) if u=='player' then return 'Player-1-ABC' end end
UnitLevel=function() return 12 end
UnitHealth=function()return 50 end UnitHealthMax=function()return 100 end
COMBAT=false
InCombatLockdown=function()return COMBAT end
PX=0.5
C_Map={GetBestMapForUnit=function()return 1454 end,GetPlayerMapPosition=function()return {GetXY=function()return PX,0.5 end}end}
local LOG={} for i=1,20 do LOG[i]={questID=90000+i} end
C_QuestLog={GetNumQuestLogEntries=function() return #LOG end,GetInfo=function(i) return LOG[i] end,IsComplete=function() return false end}
local sets=0
CreateFrame=function(kind,name)
  local f={shown=false,scripts={},events={}}
  function f:SetScript(k,fn)self.scripts[k]=fn end
  function f:RegisterEvent(e)self.events[e]=true handlers[e]=handlers[e] or {} table.insert(handlers[e],self) end
  function f:SetIgnoreParentScale(v)self.ignore=v end
  function f:SetScale(v)self.scale=v end
  function f:Show()self.shown=true end
  function f:Hide()self.shown=false end
  function f:SetSize(w,h)self.w,self.h=w,h end
  function f:ClearAllPoints()self.point=nil end
  function f:SetPoint(p,_,rp,x,y)self.point,self.rp=p,rp end
  function f:CreateTexture()
    local t={shown=true}
    function t:SetSize(w,h)self.w,self.h=w,h end
    function t:ClearAllPoints()end
    function t:SetPoint(_,_,_,x,y)self.x,self.y=x,y end
    function t:SetColorTexture(r,g,b)self.c={math.floor(r*255+.5),math.floor(g*255+.5),math.floor(b*255+.5)} sets=sets+1 end
    function t:Show()self.shown=true end
    function t:Hide()self.shown=false end
    textures[#textures+1]=t return t
  end
  for _,k in ipairs({'SetFrameStrata','SetFrameLevel'})do f[k]=function()end end
  frames[#frames+1]=f return f
end
local function fire(e,...) for _,f in ipairs(handlers[e] or {}) do if f.scripts.OnEvent then f.scripts.OnEvent(f,e,...) end end end
dofile('addon/BackstageForever/BackstageForeverLive.lua')
local function strip() for _,f in ipairs(frames) do if f.scripts.OnUpdate then return f end end end
local function tick(dt) local s=strip() clock=clock+dt s.scripts.OnUpdate(s,dt) end
local function row(n,first) local a={} for i=first or 1,(first or 1)+n-1 do local c=textures[i].c or {0,0,0} a[#a+1]='['..c[1]..','..c[2]..','..c[3]..']' end return '['..table.concat(a,',')..']' end
local function shown() local n=0 for _,t in ipairs(textures) do if t.shown then n=n+1 end end return n end
`;
const decodeRow = (text) => L.decodeStrip(image(JSON.parse(text)));

test("addon: the default is a pixel-exact 892 x 1 hairline on the top edge; modes switch and persist; pos applies to corner strips", () => {
  const out = lua(HARNESS + String.raw`
fire('PLAYER_LOGIN')
local s=strip()
assert(BackstageForeverLiveSettings.enabled==true)
assert(s.shown and s.ignore==true and math.abs(s.scale-768/1440)<1e-9,'1 unit = 1 physical pixel')
assert(s.point=='TOPLEFT' and s.rp=='TOPLEFT' and s.w==892 and s.h==1,'892x1 on the top edge')
assert(#textures==446 and shown()==446)
assert(textures[1].w==2 and textures[1].h==1 and textures[446].x==890 and textures[446].y==0,'2x1 cells in one row')
print(messages[1])
tick(1) print(row(446))
-- Only changed cells are repainted.
local before=sets tick(0.2) local quiet=sets-before
print(quiet)
BackstageForeverLiveCommand('live pos bottomright')
assert(BackstageForeverLiveSettings.pos=='bottomright' and s.point=='TOPLEFT','the hairline stays on top')
print(messages[#messages])
BackstageForeverLiveCommand('live compact')
assert(BackstageForeverLiveSettings.compact==true and s.point=='BOTTOMRIGHT' and s.w==84 and shown()==78)
BackstageForeverLiveCommand('live safe')
assert(BackstageForeverLiveSettings.safe==true and BackstageForeverLiveSettings.compact==nil and s.w==456)
BackstageForeverLiveCommand('live off')
assert(not s.shown)
BackstageForeverLiveCommand('live hairline')
assert(BackstageForeverLiveSettings.enabled==true and BackstageForeverLiveSettings.safe==nil and BackstageForeverLiveSettings.compact==nil,'choosing a mode turns the link on')
assert(s.shown and s.w==892 and s.h==1 and s.point=='TOPLEFT' and shown()==446)
BackstageForeverLiveCommand('live status')
print(messages[#messages])
BackstageForeverLiveCommand('live sideways')
print(messages[#messages])
local function p(m) local a,v=BackstageForeverLiveParse(m) return a..':'..tostring(v) end
print(p('live hairline')..' '..p('LIVE HAIRLINE')..' '..p('live compact')..' '..p('live safe'))`).split("\n");
  assert.match(out[0], /thin dark line along the top edge of the game/);
  const d = decodeRow(out[1]);
  assert.ok(d && d.mode === "hairline", "the painted line decodes");
  const f = L.parsePayload(d.bytes);
  assert.equal(f.version, 6); assert.equal(f.position.mapId, 1454); assert.equal(f.characterHash, L.identityHash("Player-1-ABC"));
  assert.equal(d.pages.length, 5, "every page in the first frame: four quest log pages (20 quests) and turned in, no repeats");
  assert.deepEqual(d.pages.map((p) => L.parsePage(p).kind), ["questLog", "questLog", "questLog", "questLog", "turnedIn"]);
  assert.ok(Number(out[2]) < 40, `a quiet tick repaints few cells (${out[2]})`);
  assert.match(out[3], /hairline always runs along the top edge/);
  assert.match(out[4], /hairline 892x1 px at the top edge/);
  assert.match(out[5], /\/bf live hairline\|compact\|safe/);
  assert.equal(out[6], "hairline:nil hairline:nil compact:nil safe:nil");
});

test("addon: everyone moves to the hairline once (saved compact or safe too, with a chat note); a later /bf live safe sticks", () => {
  const out = lua(HARNESS + String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
BackstageForeverLiveSettings={enabled=true,safe=true}
fire('PLAYER_LOGIN') print(strip().w..'x'..strip().h)
local note=false for _,m in ipairs(said) do if m:find('/bf live safe',1,true) and m:find('thin dark line',1,true) then note=true end end print(tostring(note))
BackstageForeverLiveCommand('live safe') print(strip().w..'x'..strip().h)
fire('PLAYER_LOGIN') print(strip().w..'x'..strip().h)
BackstageForeverLiveSettings={enabled=true,compact=true}
fire('PLAYER_LOGIN') print(strip().w..'x'..strip().h)
BackstageForeverLiveSettings={enabled=true}
fire('PLAYER_LOGIN') print(strip().w..'x'..strip().h)`).split("\n");
  assert.deepEqual(out, ["892x1", "true", "456x12", "456x12", "892x1", "892x1"]);
});

// Runs the hairline for `seconds` after queueing `text`; one row per 0.2s tick.
function run(text, { seconds = 6, during = "" } = {}) {
  const out = lua(HARNESS + `
fire('PLAYER_LOGIN') tick(1) tick(1)
local id,count=BackstageForeverLiveQuestion(${luaString(text)})
print(tostring(id)..' '..tostring(count)..' '..BackstageForeverLiveQuestionStatus().passes)
for i=1,${Math.round(seconds / 0.2)} do ${during} tick(0.2) print(string.format('%.2f',clock)..'|'..row(446)) end
print(tostring(BackstageForeverLiveQuestionStatus()))`).split("\n");
  const [id, count, passes] = out[0].split(" ").map(Number);
  const frames = out.slice(1, -1).map((l) => { const [t, r] = l.split("|"); const d = decodeRow(r); assert.ok(d, `line at ${t} decodes`); return { t: Number(t), d }; });
  return { id, count, passes, frames, after: out.at(-1) };
}
// Distinct frames (each change of the pages), with when they went up.
function shownFrames(frames) {
  const seq = [];
  for (const f of frames) { const key = f.d.pages.map((p) => p.join(",")).join("|"); if (!seq.length || seq.at(-1).key !== key) seq.push({ key, t: f.t, pages: f.d.pages, combat: Boolean(f.d.bytes[10] & 1) }); }
  return seq;
}
// The app sampling every `period` seconds (from `phase`), then every `fast` seconds once it has seen a
// question page; returns when the question was complete (seconds after the first question frame) or null.
function deliver(seq, { period = 0.52, fast = 0.14, phase = 0 } = {}) {
  const bridge = new L.LiveBridge({ platform: "linux", now: () => 0 });
  bridge.frame = { characterHash: L.identityHash("Player-1-ABC") };
  let done = null;
  bridge.subscribeQuestions(() => { done = done ?? true; });
  const start = seq.find((s) => s.pages.some((p) => p[1] === 4)).t, end = seq.at(-1).t + 1;
  let t = start + phase, quick = false;
  while (t < end && done === null) {
    const f = [...seq].reverse().find((s) => s.t <= t + 1e-9);
    for (const p of f?.pages || []) if (p[1] === 4) { quick = true; const at = bridge.questionPage(L.parseQuestionPage(p)); if (at) done = t - start; }
    t += quick ? fast : period;
  }
  clearTimeout(bridge.slowTimer);
  return typeof done === "number" ? Math.round(done * 100) / 100 : null;
}

test("a 200-character question goes up four pages a frame, three passes, and arrives in about a second (A15 corner strip: 6.8s)", () => {
  const full = "Where do I find the flight master and the innkeeper in Crossroads, and which quests there are good for level 14? Also where can I train First Aid nearby? Thanks a lot for the help, friend!".padEnd(200, "!");
  const { count, passes, frames, after } = run(full, { seconds: 6 });
  assert.equal(count, 12); assert.equal(passes, 3);
  const seq = shownFrames(frames);
  const qFrames = seq.filter((s) => s.pages.some((p) => p[1] === 4));
  assert.deepEqual(qFrames.map((s) => s.pages.filter((p) => p[1] === 4).map((p) => p[3]).join(",")), ["0,1,2,3", "4,5,6,7", "8,9,10,11", "0,1,2,3", "4,5,6,7", "8,9,10,11", "0,1,2,3", "4,5,6,7", "8,9,10,11"], "a pass never wraps inside a frame");
  for (const s of qFrames) assert.ok(s.pages.some((p) => L.parsePage(p)), "a quest page rides along in every question frame");
  const dwell = qFrames.slice(0, -1).map((s, i) => Math.round((qFrames[i + 1].t - s.t) * 10) / 10);
  assert.ok(dwell.every((d) => d === 0.4), `question frames stay 0.4s: ${dwell}`);
  const pass1 = Math.round((qFrames[3].t - qFrames[0].t) * 10) / 10, all = Math.round((seq[seq.indexOf(qFrames.at(-1)) + 1].t - qFrames[0].t) * 10) / 10;
  assert.equal(pass1, 1.2); assert.equal(all, 3.6);
  assert.equal(after, "nil");
  // The app at its usual 0.5s (+ capture time), speeding up after the first question page.
  const times = [];
  for (let phase = 0; phase < 0.52; phase += 0.04) times.push(deliver(seq, { phase }));
  assert.ok(times.every((x) => x !== null), `always delivered: ${times}`);
  const worst = Math.max(...times), best = Math.min(...times);
  assert.ok(worst <= 2.0, `worst case ${worst}s`);
  // Even a 2-second sampler that never speeds up gets it from the three passes... or says so.
  const slow = deliver(seq, { period: 0.75, fast: 0.75 });
  console.log(`[throughput] hairline v6: 165 bytes a frame (frame + 5 pages x 27), 4 question pages a 0.4s frame; 200 ASCII chars = ${count} pages = 3 frames a pass; one pass ${pass1}s, all ${passes} passes ${all}s; delivered after ${best}-${worst}s with 0.52s/0.14s sampling (A15 corner strip: 6.8s one pass); 0.75s sampler without speed-up: ${slow}s; ${(68 / 0.4).toFixed(0)} question bytes/s`);
});

test("a short question fits one frame and is shown three times; question pages never go up in combat, and leave the line when combat starts", () => {
  const short = run("Where is my class trainer?", { seconds: 3 });
  const seq = shownFrames(short.frames).filter((s) => s.pages.some((p) => p[1] === 4));
  assert.equal(short.count, 2); assert.equal(seq.length, 3, "three passes, one frame each");
  assert.ok(deliver(shownFrames(short.frames)) !== null);
  // Combat begins while the question is on the line: its pages are dropped at the next page tick and none go up until it ends.
  const fight = run("x".repeat(170), { seconds: 8, during: "if i==2 then COMBAT=true end if i==20 then COMBAT=false end" });
  const all = shownFrames(fight.frames);
  const inCombat = fight.frames.filter((f) => f.d.bytes[10] & 1);
  assert.ok(inCombat.length > 10);
  const leaked = inCombat.slice(3).filter((f) => f.d.pages.some((p) => p[1] === 4));
  assert.equal(leaked.length, 0, "no question page on the line during combat (after the first page tick)");
  assert.ok(all.some((s) => !s.combat && s.t > 100 + 2 + 20 * 0.2 && s.pages.some((p) => p[1] === 4)), "the rest goes up after combat");
});

test("moments go up on the next frame and are shown in four frames; the quest log cycles six pages at a time", () => {
  const out = lua(HARNESS + `
fire('PLAYER_LOGIN') tick(1)
print(row(446))
BackstageForeverLiveMoment(5,186,75,15)
tick(0.2) print(row(446))
for _=1,6 do tick(1) print(row(446)) end`).split("\n").map(decodeRow);
  const kinds = (d) => d.pages.map((p) => p[1]).join("");
  assert.equal(kinds(out[0]), "11112", "20 quests = four quest log pages + turned in, all in one frame");
  assert.equal(out[1].pages[0][1], 3, "the moment straight away");
  const withMoment = out.slice(1).filter((d) => d.pages.some((p) => p[1] === 3));
  assert.equal(withMoment.length, 4, "shown in four frames");
  const ids = new Set(); for (const d of out) for (const p of d.pages) { const pg = L.parsePage(p); if (pg?.kind === "questLog") pg.ids.forEach((e) => ids.add(e.id)); }
  assert.equal(ids.size, 20, "the whole quest log within a few frames");
});

test("the capture worker prefers the game window's own picture (PrintWindow) and falls back to the screen; still no input APIs", () => {
  const w = L.WORKER;
  assert.match(w, /PrintWindow\(h, memDC, PW_CLIENTONLY_RENDERFULLCONTENT\)/);
  assert.match(w, /const uint PW_CLIENTONLY_RENDERFULLCONTENT = 3;/);
  assert.match(w, /CopyFromScreen/);
  assert.match(w, /\+ " pw"/); assert.match(w, /\+ " screen"/);
  assert.match(w, /if \(cw <= 0 \|\| ch <= 0\) return "minimized";/);
  assert.match(w, /printing = capture != "screen";/);
  assert.doesNotMatch(w, /SendInput|keybd_event|mouse_event|ReadProcessMemory|OpenProcess|PostMessage|SendMessage|SetForegroundWindow|SetWindowPos|MoveWindow|ShowWindow/);
  const calls = [];
  const b = new L.LiveBridge({ spawn: (exe, args, opts) => { calls.push(opts.env); return { stdout: { setEncoding() {}, on() {} }, stderr: { on() {} }, on() {} }; }, platform: "win32", capture: "screen" });
  b.enabled = true; b.start();
  assert.equal(calls[0].BF_LIVE_CAPTURE, "screen");
  b.stop();
  const a = new L.LiveBridge({ spawn: (exe, args, opts) => { calls.push(opts.env); return { stdout: { setEncoding() {}, on() {} }, stderr: { on() {} }, on() {} }; }, platform: "win32" });
  a.enabled = true; a.start(); assert.equal(calls[1].BF_LIVE_CAPTURE, "auto"); a.stop();
});
