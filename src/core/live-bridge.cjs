"use strict";
// Live game link: decodes the opt-in status strip drawn by BackstageForeverLive.lua.
// A bounded PowerShell worker copies only a small region at one corner of the game
// window's client area twice per second; pixels are decoded here and never stored.
// The worker sends no input, reads no process memory and touches no game files.
// While a question typed in game arrives (page kind 4) it samples faster for a short while, and
// every two seconds it reports the game window's client rectangle (where the answer panel goes).
const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const CELL = 6, MARKERS = 4, PAYLOAD_CELLS = 72, PAYLOAD_BYTES = 27, VERSION = 3;
// Version 2 strips (addon 0.18.1 and earlier): 4px cells, four levels per channel.
const V2 = { cell: 4, payloadCells: 36, version: 2 };
// Version 4 ("compact", addon 0.32+): 2px cells, four calibrated levels per channel (2 bits),
// so 27 bytes fit in 36 cells. Header: two magenta finder cells, then grey 0/85/170/255
// reference cells that the decoder measures per channel. Row 2 (pages) has no header.
const V4 = { version: 4, cell: 2, finder: 2, header: 6, payloadCells: 36, levels: [0, 85, 170, 255] };
const V4_HEADER = [[255, 0, 255], [255, 0, 255], [0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]];
// Neighbouring calibrated levels closer than this (per channel) cannot be told apart reliably;
// such strips are refused (stripHint says "compact-unreadable": /bf live safe switches to 1 bit).
const MIN_LEVEL_GAP = 16;
const REGION = { width: 640, height: 28 }; // room for both strip rows at up to 8px per cell
// Once a compact strip is found the worker copies only this much of its corner.
const COMPACT_REGION = { width: 200, height: 16 };
const CORNERS = ["topleft", "topright", "bottomleft", "bottomright"];
// An idle addon repaints its heartbeat every 2s; a compact strip whose heartbeat has not moved
// for this long is a frozen picture (hung UI), not a live game.
const HEARTBEAT_STALE_MS = 20000, IDLE_MS = 6000;
// Second row (addon 0.25+): pages of the quest log and of quests turned in this session.
const PAGE_VERSION = 80, PAGE_IDS = 6, KIND = { 1: "questLog", 2: "turnedIn" };
const PAGES_FRESH_MS = 30000; // a full cycle takes a few seconds; older sets are dropped
// Third page kind (addon 0.33+): recent "moments", two to a page (see BackstageForeverLiveMomentPages).
// A moment is new when its (character, seq, type, a, b, c) has not been seen; one first seen
// already older than MOMENT_MAX_AGE_S (the app started late, or a long fight) is remembered, not shown.
const MOMENT_KIND = 3, MOMENT_FORMAT = 1, MOMENT_RING = 6, MOMENT_MAX_AGE_S = 120, MOMENT_SEEN_MS = 30 * 60000;
const FRESH_MS = 4000;
// Fourth page kind (addon 0.38+): a question typed in game, 17 UTF-8 bytes a page (see
// BackstageForeverLiveQuestionPages). Pages of one question are collected across passes until all
// are in; a complete question is reported once (dedup by character, id, checksum and length).
const QUESTION_KIND = 4, QUESTION_CHUNK = 17, QUESTION_MAX_BYTES = 600, QUESTION_MAX_CHARS = 200;
const QUESTION_PARTIAL_MS = 90000, QUESTION_SEEN_MS = 30 * 60000;
// While question pages arrive the worker samples faster (question pages stay up about 0.4s).
const QUESTION_INTERVAL_MS = 120, QUESTION_FAST_MS = 30000;
// The game window's client rectangle is reported every few samples (for the in-game answer panel).
const RECT_FRESH_MS = 15000;
// Version 6 ("hairline", addon 0.38+, the default): one physical pixel tall along the top edge of
// the game client area, from the left, 892 pixels wide. 2px cells, one bit per colour channel: off
// is 0 and on is a dark 36 of 255, so it reads as a thin dark border. Six header cells (dark magenta,
// dark green, magenta, green, black, dark grey) give each channel's measured "off" and "on"; a value
// is on above their midpoint. That threshold sits far from what real clients do to near-black
// colours (a gamma S-curve, saturated channels boosted about 1.2x, up to +9 bleeding into an off
// channel beside a lit one), which broke the four-level version 5 of early 0.38 test builds.
// Then 440 cells = 165 bytes: the 27-byte main payload (version 6), five 27-byte page slots (kinds
// 1-4, unchanged formats; unused slots zero), the page count and a CRC-16 over bytes 0-162. A
// capture taken while the line was being redrawn fails the CRC and is refused whole.
const HAIRLINE = { version: 6, cell: 2, header: 6, on: 36, slots: 5, bytes: 165, cells: 440, minGap: 12 };
const HAIRLINE_HEADER = [[1, 0, 1], [0, 1, 0], [1, 0, 1], [0, 1, 0], [0, 0, 0], [1, 1, 1]];
const HAIRLINE_WIDTH = (HAIRLINE.header + HAIRLINE.cells) * HAIRLINE.cell; // 892 physical pixels
// Once a hairline is found the worker copies only the top-left of the client area.
const HAIRLINE_REGION = { width: 900, height: 4 };
// The top-left search region is wide enough for the whole hairline; other corners keep REGION.
const TOPLEFT_REGION = { width: 912, height: 28 };
const searchRegion = (corner) => (corner === "topleft" ? TOPLEFT_REGION : REGION);

// Mirrors BackstageForeverLiveIdentity: binds frames to the saved character (UnitGUID).
function identityHash(guid) {
  if (typeof guid !== "string") return 0;
  let h = 0;
  for (let i = 0; i < Math.min(guid.length, 200); i++) h = (h * 31 + guid.charCodeAt(i)) % 65521;
  return h;
}
// Profiles keep only a private digest of the character GUID, so the live key (the
// addon's 16-bit hash of the raw GUID) is remembered here when SavedVariables are read.
const liveKeys = new Map();
function rememberLiveKey(sourceId, guid) { if (typeof sourceId === "string" && typeof guid === "string") liveKeys.set(sourceId, identityHash(guid)); }
// -> 16-bit key, or null when this session has not read that character's GUID yet
// (callers then treat identified frames as another character's).
function liveKeyFor(sourceId) { return liveKeys.has(sourceId) ? liveKeys.get(sourceId) : null; }
// True when the frame belongs to some character this session has read (just not, perhaps, the selected one).
function isKnownLiveKey(hash) { for (const v of liveKeys.values()) if (v === hash) return true; return false; }
function crc8(bytes, n) {
  let crc = 0;
  for (let i = 0; i < n; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 0x80 ? ((crc << 1) ^ 7) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}
// CRC-16/CCITT (poly 0x1021, start 0xFFFF), mirrors the addon's crc16.
function crc16(bytes, n) {
  let crc = 0xffff;
  for (let i = 0; i < n; i++) {
    crc ^= (bytes[i] & 255) << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
const bitsOf = (bytes) => { const bits = []; for (const b of bytes) for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1); return bits; };
const bytesOf = (bits) => { const out = new Uint8Array(PAYLOAD_BYTES); for (let i = 0; i < PAYLOAD_BYTES; i++) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[i * 8 + k]; out[i] = v; } return out; };
const valid = (bytes, version) => bytes[0] === version && crc8(bytes, PAYLOAD_BYTES - 1) === bytes[PAYLOAD_BYTES - 1];
// Encoder mirror of the addon (used by tests and the synthetic fixture): one bit per channel.
function encodeCells(bytes) {
  const cells = [[255, 0, 255], [0, 255, 0], [255, 255, 255], [0, 0, 0]], bits = bitsOf(bytes);
  for (let c = 0; c < PAYLOAD_CELLS; c++) cells.push([0, 1, 2].map((ch) => (bits[c * 3 + ch] || 0) * 255));
  return cells;
}
// Version 2 encoder, kept so older addons stay covered by tests.
function encodeCellsV2(bytes) {
  const L = [0, 85, 170, 255], cells = [[255, 0, 255], [0, 255, 0], [85, 85, 85], [170, 170, 170]], bits = bitsOf(bytes);
  for (let c = 0; c < V2.payloadCells; c++) cells.push([0, 1, 2].map((ch) => { const i = c * 6 + ch * 2; return L[(bits[i] || 0) * 2 + (bits[i + 1] || 0)]; }));
  return cells;
}
// Version 3: per channel, a value is "on" when nearer the white marker than the black one.
// Any monotonic colour shift (gamma, HDR mapping, colour profiles, remote sessions) keeps that.
function decodeCellsV3(cells) {
  if (!Array.isArray(cells) || cells.length < MARKERS + PAYLOAD_CELLS) return null;
  const [magenta, green, white, black] = cells;
  const mid = [0, 1, 2].map((ch) => (white[ch] + black[ch]) / 2);
  for (let ch = 0; ch < 3; ch++) if (white[ch] - black[ch] < 60) return null;
  const on = (rgb) => rgb.map((v, ch) => (v > mid[ch] ? 1 : 0));
  if (on(magenta).join("") !== "101" || on(green).join("") !== "010") return null;
  const bits = [];
  for (let c = 0; c < PAYLOAD_CELLS; c++) bits.push(...on(cells[MARKERS + c]));
  const bytes = bytesOf(bits);
  return valid(bytes, VERSION) ? bytes : null;
}
// Thresholds per channel come from the four calibration markers (version 2 strips).
function thresholds(m) {
  const levels = [
    [m[1][0], m[2][0], m[3][0], m[0][0]], // R: 0, 85, 170, 255
    [m[0][1], m[2][1], m[3][1], m[1][1]], // G
    [m[1][2], m[2][2], m[3][2], m[0][2]], // B: 0 (green marker), 85, 170, 255 (magenta)
  ];
  for (const l of levels) if (!(l[0] < l[1] && l[1] < l[2] && l[2] < l[3]) || l[3] - l[0] < 120) return null;
  return levels.map((l) => [(l[0] + l[1]) / 2, (l[1] + l[2]) / 2, (l[2] + l[3]) / 2]);
}
function decodeCellsV2(cells) {
  if (!Array.isArray(cells) || cells.length < MARKERS + V2.payloadCells) return null;
  const t = thresholds(cells.slice(0, MARKERS));
  if (!t) return null;
  const bits = [];
  for (let c = 0; c < V2.payloadCells; c++) {
    const rgb = cells[MARKERS + c];
    for (let ch = 0; ch < 3; ch++) { const v = rgb[ch], th = t[ch]; const level = v < th[0] ? 0 : v < th[1] ? 1 : v < th[2] ? 2 : 3; bits.push(level >> 1, level & 1); }
  }
  const bytes = bytesOf(bits);
  return valid(bytes, V2.version) ? bytes : null;
}
// Version 4: per channel, the nearest of the four measured reference levels.
function v4Levels(header) {
  if (!Array.isArray(header) || header.length < V4.header) return null;
  const cal = header.slice(V4.finder, V4.header), levels = [0, 1, 2].map((ch) => cal.map((c) => c[ch]));
  for (const l of levels) {
    if (l[3] - l[0] < 60) return null;
    for (let i = 1; i < 4; i++) if (l[i] - l[i - 1] < MIN_LEVEL_GAP) return null;
  }
  return levels;
}
const isV4Header = (cells) => cells.length >= V4.header && magentaish(cells[0]) && magentaish(cells[1]);
const nearest = (v, l) => { let best = 0; for (let i = 1; i < l.length; i++) if (Math.abs(v - l[i]) < Math.abs(v - l[best])) best = i; return best; };
function bitsFromLevels(cells, levels) {
  const bits = [];
  for (const rgb of cells) for (let ch = 0; ch < 3; ch++) { const i = nearest(rgb[ch], levels[ch]); bits.push(i >> 1, i & 1); }
  return bits;
}
// Full compact row (header + payload), or a header-less page row decoded with the main row's levels.
function decodeCellsV4(cells, levels = null, version = V4.version) {
  if (!Array.isArray(cells)) return null;
  let payload = cells;
  if (!levels) {
    if (cells.length < V4.header + V4.payloadCells || !isV4Header(cells)) return null;
    levels = v4Levels(cells);
    if (!levels) return null;
    payload = cells.slice(V4.header);
  }
  if (payload.length < V4.payloadCells) return null;
  const bytes = bytesOf(bitsFromLevels(payload.slice(0, V4.payloadCells), levels));
  return valid(bytes, version) ? bytes : null;
}
// Encoder mirror of the addon's compact strip (tests and fixtures).
function levelCells(bytes) {
  const bits = bitsOf(bytes), cells = [];
  for (let c = 0; c < V4.payloadCells; c++) cells.push([0, 1, 2].map((ch) => { const i = c * 6 + ch * 2; return V4.levels[(bits[i] || 0) * 2 + (bits[i + 1] || 0)]; }));
  return cells;
}
const encodeCellsV4 = (bytes) => [...V4_HEADER.map((c) => [...c]), ...levelCells(bytes)];
const encodePageCellsV4 = (bytes) => levelCells(bytes);
// Mirror of BackstageForeverLiveHairlineFrame: main payload + up to six pages -> 192 bytes.
function encodeHairlineFrame(main, pages = []) {
  const b = new Array(HAIRLINE.bytes).fill(0);
  if (main) for (let i = 0; i < PAYLOAD_BYTES; i++) b[i] = main[i] & 255;
  let n = 0;
  for (const p of pages.slice(0, HAIRLINE.slots)) { if (!p) continue; n++; for (let i = 0; i < PAYLOAD_BYTES; i++) b[PAYLOAD_BYTES * n + i] = p[i] & 255; }
  b[HAIRLINE.bytes - 3] = n;
  const c = crc16(b, HAIRLINE.bytes - 2);
  b[HAIRLINE.bytes - 2] = c >> 8; b[HAIRLINE.bytes - 1] = c & 255;
  return b;
}
// Mirror of BackstageForeverLiveHairlineCells: 165 bytes -> 6 header + 440 payload cells, one bit per channel.
function encodeHairlineCells(frame) {
  const on = HAIRLINE.on, bits = bitsOf(frame), cells = HAIRLINE_HEADER.map((h) => h.map((b) => b * on));
  for (let c = 0; c < HAIRLINE.cells; c++) cells.push([0, 1, 2].map((ch) => (bits[c * 3 + ch] || 0) * on));
  return cells;
}
// Per-channel thresholds (midpoint of the measured off and on values in the header), or null when
// the header is not there, off and on are too close, or a sync cell reads wrong.
function hairlineThresholds(cells) {
  if (!Array.isArray(cells) || cells.length < HAIRLINE.header) return null;
  const head = cells.slice(0, HAIRLINE.header), th = [];
  for (let ch = 0; ch < 3; ch++) {
    const off = head.filter((_, i) => !HAIRLINE_HEADER[i][ch]).map((c) => c[ch]), on = head.filter((_, i) => HAIRLINE_HEADER[i][ch]).map((c) => c[ch]);
    const lo = Math.max(...off), hi = Math.min(...on);
    if (hi - lo < HAIRLINE.minGap) return null;
    th.push((off.reduce((a, b) => a + b, 0) / off.length + on.reduce((a, b) => a + b, 0) / on.length) / 2);
  }
  return th;
}
// Header + payload cells -> { bytes (main payload), pages: [page bytes...] }, or null. The whole
// frame is refused when its CRC-16, the main payload or any page fails its own check.
function decodeHairlineCells(cells, th = hairlineThresholds(cells)) {
  if (!th || cells.length < HAIRLINE.header + HAIRLINE.cells) return null;
  const bits = [];
  for (const c of cells.slice(HAIRLINE.header, HAIRLINE.header + HAIRLINE.cells)) for (let ch = 0; ch < 3; ch++) bits.push(c[ch] > th[ch] ? 1 : 0);
  const b = new Uint8Array(HAIRLINE.bytes);
  for (let i = 0; i < HAIRLINE.bytes; i++) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[i * 8 + k]; b[i] = v; }
  if (crc16(b, HAIRLINE.bytes - 2) !== ((b[HAIRLINE.bytes - 2] << 8) | b[HAIRLINE.bytes - 1])) return null;
  const n = b[HAIRLINE.bytes - 3], main = b.slice(0, PAYLOAD_BYTES);
  if (n > HAIRLINE.slots || !valid(main, HAIRLINE.version)) return null;
  const pages = [];
  for (let s = 1; s <= n; s++) { const p = b.slice(PAYLOAD_BYTES * s, PAYLOAD_BYTES * (s + 1)); if (!valid(p, PAGE_VERSION)) return null; pages.push(p); }
  return { bytes: main, pages };
}
// Page frames use the version 3 cell layout with their own version byte.
function decodePageCells(cells) {
  if (!Array.isArray(cells) || cells.length < MARKERS + PAYLOAD_CELLS) return null;
  const [magenta, green, white, black] = cells;
  const mid = [0, 1, 2].map((ch) => (white[ch] + black[ch]) / 2);
  for (let ch = 0; ch < 3; ch++) if (white[ch] - black[ch] < 60) return null;
  const on = (rgb) => rgb.map((v, ch) => (v > mid[ch] ? 1 : 0));
  if (on(magenta).join("") !== "101" || on(green).join("") !== "010") return null;
  const bits = [];
  for (let c = 0; c < PAYLOAD_CELLS; c++) bits.push(...on(cells[MARKERS + c]));
  const bytes = bytesOf(bits);
  return valid(bytes, PAGE_VERSION) ? bytes : null;
}
// Mirror of BackstageForeverLivePages (tests and fixtures).
function encodePages(kind, entries, identity = 0) {
  const n = Math.min(entries.length, PAGE_IDS * 15), count = Math.max(1, Math.ceil(n / PAGE_IDS));
  let gen = kind;
  for (let i = 0; i < n; i++) { const e = entries[i], id = typeof e === "object" ? e.id : e; gen = (gen * 31 + (id % 65521) + (typeof e === "object" && e.complete ? 7 : 0)) % 256; }
  const pages = [];
  for (let p = 0; p < count; p++) {
    const b = new Array(PAYLOAD_BYTES).fill(0);
    b[0] = PAGE_VERSION; b[1] = kind; b[2] = p * 16 + count; b[3] = gen;
    let bits = 0;
    for (let k = 0; k < PAGE_IDS; k++) {
      const at = p * PAGE_IDS + k; if (at >= n) break;
      const e = entries[at], id = typeof e === "object" ? e.id : e;
      b[4 + k * 3] = (id >> 16) & 255; b[5 + k * 3] = (id >> 8) & 255; b[6 + k * 3] = id & 255;
      if (typeof e === "object" && e.complete) bits |= 1 << k;
    }
    b[22] = bits; b[23] = (identity >> 8) & 255; b[24] = identity & 255; b[25] = Math.min(255, n);
    b[26] = crc8(b, PAYLOAD_BYTES - 1);
    pages.push(b);
  }
  return pages;
}
function parsePage(b) {
  if (!b || b[0] !== PAGE_VERSION || !KIND[b[1]]) return null;
  const index = b[2] >> 4, count = b[2] & 15, total = b[25];
  if (!count || index >= count) return null;
  const ids = [];
  for (let k = 0; k < PAGE_IDS && index * PAGE_IDS + k < total; k++) {
    const id = (b[4 + k * 3] << 16) | (b[5 + k * 3] << 8) | b[6 + k * 3];
    if (id) ids.push({ id, complete: Boolean(b[22] & (1 << k)) });
  }
  return { kind: KIND[b[1]], index, count, generation: b[3], identity: (b[23] << 8) | b[24], total, ids };
}
// Mirror of BackstageForeverLiveMomentPages (tests and fixtures). events newest first: { type, seq, age, a, b, c }.
function encodeMomentPages(events, identity = 0) {
  const n = Math.min(events.length, MOMENT_RING), count = Math.ceil(n / 2), pages = [];
  for (let p = 0; p < count; p++) {
    const b = new Array(PAYLOAD_BYTES).fill(0);
    b[0] = PAGE_VERSION; b[1] = MOMENT_KIND; b[2] = p * 16 + count; b[3] = events[0].seq & 255;
    for (let k = 0; k < 2; k++) {
      const at = p * 2 + k; if (at >= n) break;
      const e = events[at], o = 4 + k * 9;
      b[o] = e.type & 255; b[o + 1] = e.seq & 255; b[o + 2] = Math.max(0, Math.min(255, Math.floor(e.age || 0)));
      b[o + 3] = (e.a >> 16) & 255; b[o + 4] = (e.a >> 8) & 255; b[o + 5] = e.a & 255; b[o + 6] = (e.b >> 8) & 255; b[o + 7] = e.b & 255; b[o + 8] = (e.c || 0) & 255;
    }
    b[22] = MOMENT_FORMAT; b[23] = (identity >> 8) & 255; b[24] = identity & 255; b[25] = n;
    b[26] = crc8(b, PAYLOAD_BYTES - 1);
    pages.push(b);
  }
  return pages;
}
// One moments page -> { index, count, newest, identity, total, moments: [{ type, seq, ageS, a, b, c }] }, or null.
function parseMomentPage(b) {
  if (!b || b[0] !== PAGE_VERSION || b[1] !== MOMENT_KIND || b[22] !== MOMENT_FORMAT) return null;
  const index = b[2] >> 4, count = b[2] & 15, total = b[25];
  if (!count || index >= count || total > MOMENT_RING) return null;
  const moments = [];
  for (let k = 0; k < 2 && index * 2 + k < total; k++) {
    const o = 4 + k * 9;
    if (!b[o] || !b[o + 1]) continue;
    moments.push({ type: b[o], seq: b[o + 1], ageS: b[o + 2], a: (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5], b: (b[o + 6] << 8) | b[o + 7], c: b[o + 8] });
  }
  return { kind: "moments", index, count, newest: b[3], identity: (b[23] << 8) | b[24], total, moments };
}
// Mirror of BackstageForeverLiveQuestionPages (tests and fixtures): text -> pages, or [] when invalid.
function encodeQuestionPages(id, text, identity = 0) {
  const all = Buffer.from(String(text ?? ""), "utf8");
  if (!Number.isInteger(id) || id < 1 || id > 255 || !all.length || all.length > QUESTION_MAX_BYTES) return [];
  const sum = crc8(all, all.length), count = Math.ceil(all.length / QUESTION_CHUNK), pages = [];
  for (let p = 0; p < count; p++) {
    const b = new Array(PAYLOAD_BYTES).fill(0), first = p * QUESTION_CHUNK, n = Math.min(QUESTION_CHUNK, all.length - first);
    b[0] = PAGE_VERSION; b[1] = QUESTION_KIND; b[2] = id; b[3] = p; b[4] = count;
    for (let k = 0; k < n; k++) b[5 + k] = all[first + k];
    b[22] = sum; b[23] = (identity >> 8) & 255; b[24] = identity & 255; b[25] = n;
    b[26] = crc8(b, PAYLOAD_BYTES - 1);
    pages.push(b);
  }
  return pages;
}
// One question page -> { kind: "question", id, index, count, sum, identity, bytes }, or null.
function parseQuestionPage(b) {
  if (!b || b[0] !== PAGE_VERSION || b[1] !== QUESTION_KIND) return null;
  const id = b[2], index = b[3], count = b[4], n = b[25];
  if (!id || !count || index >= count || count > Math.ceil(QUESTION_MAX_BYTES / QUESTION_CHUNK) || n < 1 || n > QUESTION_CHUNK) return null;
  // Every page but the last is full.
  if (index < count - 1 && n !== QUESTION_CHUNK) return null;
  return { kind: "question", id, index, count, sum: b[22], identity: (b[23] << 8) | b[24], bytes: Array.from(b.slice(5, 5 + n)) };
}
// Complete pages (index -> bytes) -> the question text, or null when the checksum or UTF-8 is wrong.
const OPEN_SIGNAL = "\u0001open";
function assembleQuestion(parts, count, sum) {
  const all = [];
  for (let i = 0; i < count; i++) { const p = parts.get(i); if (!p) return null; all.push(...p); }
  if (!all.length || all.length > QUESTION_MAX_BYTES || crc8(all, all.length) !== sum) return null;
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(all)); } catch { return null; }
  // The owl's "open the panel" signal (0.39.1): a control byte no typed question can contain.
  if (text === OPEN_SIGNAL) return OPEN_SIGNAL;
  // Control characters never come from the game's edit box; the text stays one plain line.
  text = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!text || [...text].length > QUESTION_MAX_CHARS) return null;
  return text;
}
function decodeCells(cells) {
  if (!Array.isArray(cells) || cells.length < MARKERS) return null;
  return decodeCellsV4(cells) || (cells.length >= MARKERS + PAYLOAD_CELLS && decodeCellsV3(cells)) || decodeCellsV2(cells.slice(0, MARKERS + V2.payloadCells));
}
const px = (rgb, width, x, y) => { const i = (y * width + x) * 3; return [rgb[i], rgb[i + 1], rgb[i + 2]]; };
function magentaish(p) { return p[0] - p[1] > 60 && p[2] - p[1] > 60; }
// Average the centre of each cell (pitch measured from the image) to resist edge blending.
function sampleCells(rgb, width, height, x, y, pitch, count) {
  if (x + count * pitch > width) return null;
  const cells = [], r = pitch >= 5 ? 1 : 0, cy = Math.min(height - 1, y + Math.floor(pitch / 2));
  for (let c = 0; c < count; c++) {
    const cx = x + c * pitch + Math.floor(pitch / 2), acc = [0, 0, 0];
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const q = px(rgb, width, Math.min(width - 1, Math.max(0, cx + dx)), Math.min(height - 1, Math.max(0, cy + dy))); acc[0] += q[0]; acc[1] += q[1]; acc[2] += q[2]; n++; }
    cells.push(acc.map((v) => v / n));
  }
  return cells;
}
// One row of hairline cells: the pixel in the middle of each cell (the line is one pixel tall).
function sampleRow(rgb, width, x, y, pitch, count) {
  if (x + count * pitch > width) return null;
  const cells = [];
  for (let c = 0; c < count; c++) cells.push(px(rgb, width, x + c * pitch + (pitch >> 1), y));
  return cells;
}
// The hairline starts at the client area's top-left. Rows 0-2 and small offsets are tried in case
// the client area starts a pixel early; 2px cells are expected, 1, 3 and 4 cover odd UI setups.
function decodeHairline(img) {
  const { width, height, rgb } = img;
  for (let y = 0; y < Math.min(3, height); y++) {
    for (const pitch of [2, 1, 3, 4]) {
      for (let x0 = 0; x0 < Math.min(4, pitch + 2); x0++) {
        const head = sampleRow(rgb, width, x0, y, pitch, HAIRLINE.header);
        const th = head && hairlineThresholds(head);
        if (!th) continue;
        const cells = sampleRow(rgb, width, x0, y, pitch, HAIRLINE.header + HAIRLINE.cells);
        const d = cells && decodeHairlineCells(cells, th);
        if (d) return { bytes: d.bytes, pages: d.pages, page: d.pages[0] || null, origin: { x: x0, y }, pitch, version: HAIRLINE.version, mode: "hairline", footprint: { width: (HAIRLINE.header + HAIRLINE.cells) * pitch, height: 1 } };
      }
    }
  }
  return null;
}
// True when the top rows hold what looks like a hairline that does not decode: a near-black,
// varied line clearly unlike the picture just below it (remote desktop or a colour filter changing
// its shades). The app then suggests /bf live safe.
function hairlineHint({ width, height, rgb }) {
  const n = Math.min(width, HAIRLINE_WIDTH);
  if (n < 64 || height < 3) return false;
  for (let y = 0; y + 2 < height && y < 2; y++) {
    let dark = 0, diff = 0;
    const distinct = new Set();
    for (let x = 0; x < n; x++) {
      const p = px(rgb, width, x, y), q = px(rgb, width, x, y + 2);
      if (Math.max(p[0], p[1], p[2]) <= 100) dark++;
      distinct.add(p.join());
      diff += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    }
    if (dark >= n * 0.95 && distinct.size >= 8 && diff / n >= 24) return true;
  }
  return false;
}
const okImage = ({ width, height, rgb }) => Number.isInteger(width) && Number.isInteger(height) && Buffer.isBuffer(rgb) && rgb.length === width * height * 3;
// Magenta finder runs where a strip anchored at `corner` can start. The top-left search keeps
// the old bounds (within 40 x 10 pixels of the client origin); right corners search the whole
// width and bottom corners the last 18 rows (two rows of up to 8px cells, plus a small inset).
// `visit` returns a result to stop.
function scanFinders({ width, height, rgb }, corner, visit) {
  const right = corner === "topright" || corner === "bottomright", bottom = corner === "bottomleft" || corner === "bottomright";
  const y0 = bottom ? Math.max(0, height - 18) : 0, xEnd = right ? width : Math.min(width, 40);
  for (let y = y0; y + 2 <= height && (bottom || y < 10); y++) {
    for (let x = 0; x < xEnd; x++) {
      if (!magentaish(px(rgb, width, x, y))) continue;
      let run = 1;
      while (x + run < width && run < 20 && magentaish(px(rgb, width, x + run, y))) run++;
      if (run >= 3) { const out = visit(x, y, run); if (out !== undefined) return out; }
      x += run - 1;
    }
  }
  return null;
}
const unique = (list) => list.filter((v, i) => list.indexOf(v) === i);
// Compact strips: the finder is two cells, so the pitch is about half its run.
function tryV4(img, x, y, run) {
  const { width, height, rgb } = img;
  for (const pitch of unique([Math.round(run / 2), Math.floor(run / 2), Math.ceil(run / 2), 2, 3]).filter((p) => p >= 2 && p <= 8)) {
    for (const x0 of unique([x, x + run - 2 * pitch]).filter((v) => v >= 0)) {
      const cells = sampleCells(rgb, width, height, x0, y, pitch, V4.header + V4.payloadCells);
      const levels = cells && isV4Header(cells) && v4Levels(cells);
      const bytes = levels && decodeCellsV4(cells.slice(V4.header), levels);
      if (!bytes) continue;
      const row2 = y + 2 * pitch <= height ? sampleCells(rgb, width, height, x0, y + pitch, pitch, V4.payloadCells) : null;
      const page = (row2 && decodeCellsV4(row2, levels, PAGE_VERSION)) || null;
      return { bytes, origin: { x: x0, y }, pitch, version: V4.version, mode: "compact", footprint: { width: (V4.header + V4.payloadCells) * pitch, height: 2 * pitch }, page, pages: page ? [page] : [] };
    }
  }
  return undefined;
}
// Auto-detects the version drawn. At the top-left the hairline (version 5) is tried first; then the
// magenta finder, whose run gives the cell pitch, for the compact version 4 layout, the version 3
// layout ("safe" mode) and the older version 2 layout (each checked by CRC). Results carry the main
// payload `bytes` and the decoded `pages` (six at most on a hairline, one on a corner strip).
function decodeStrip(img, { corner = "topleft" } = {}) {
  if (!img || !okImage(img)) return null;
  const { width, height, rgb } = img;
  if (!CORNERS.includes(corner) || corner === "topleft") { const h = decodeHairline(img); if (h) return h; }
  return scanFinders(img, CORNERS.includes(corner) ? corner : "topleft", (x, y, run) => {
    const v4 = tryV4(img, x, y, run);
    if (v4) return v4;
    const tries = [];
    for (const pitch of [run, run + 1, run - 1, CELL, V2.cell]) if (pitch >= 3 && !tries.includes(pitch)) tries.push(pitch);
    for (const pitch of tries) {
      const v3 = sampleCells(rgb, width, height, x, y, pitch, MARKERS + PAYLOAD_CELLS);
      const b3 = v3 && decodeCellsV3(v3);
      if (b3) {
        const row2 = y + pitch + 3 <= height ? sampleCells(rgb, width, height, x, y + pitch, pitch, MARKERS + PAYLOAD_CELLS) : null;
        const page = (row2 && decodePageCells(row2)) || null;
        return { bytes: b3, origin: { x, y }, pitch, version: VERSION, mode: "safe", footprint: { width: (MARKERS + PAYLOAD_CELLS) * pitch, height: 2 * pitch }, page, pages: page ? [page] : [] };
      }
      const v2 = sampleCells(rgb, width, height, x, y, pitch, MARKERS + V2.payloadCells);
      const b2 = v2 && decodeCellsV2(v2);
      if (b2) return { bytes: b2, origin: { x, y }, pitch, version: V2.version, mode: "legacy", footprint: { width: (MARKERS + V2.payloadCells) * pitch, height: pitch }, page: null, pages: [] };
    }
    return undefined;
  });
}
// Why a strip that is on screen did not decode: "old-addon" when its calibration cells are the
// grey shades of the version 2 strip (the game still runs an addon from before 0.18.2 and needs a
// /reload), "compact-unreadable" for a compact (version 4) strip whose grey reference cells are
// too close together or whose payload fails its checksum (/bf live safe fixes that), "unreadable"
// for any other visible strip, "hairline-unreadable" when the top edge holds a dark line that looks
// like a hairline but does not decode (/bf live safe fixes that too), null when there is no strip.
function stripHint(img, { corner = "topleft" } = {}) {
  if (!img || !okImage(img)) return null;
  const { width, height, rgb } = img;
  const grey = (c) => Math.max(...c) - Math.min(...c) < 40;
  const mean = (c) => (c[0] + c[1] + c[2]) / 3;
  const found = scanFinders(img, CORNERS.includes(corner) ? corner : "topleft", (x, y, run) => {
    const head = sampleCells(rgb, width, height, x, y, Math.max(2, Math.round(run / 2)), V4.header);
    if (head && isV4Header(head)) {
      const cal = head.slice(V4.finder);
      if (cal.every(grey) && mean(cal[0]) < mean(cal[3]) && mean(cal[0]) <= mean(cal[1]) && mean(cal[1]) <= mean(cal[2]) && mean(cal[2]) <= mean(cal[3])) return "compact-unreadable";
    }
    const cells = sampleCells(rgb, width, height, x, y, run, MARKERS);
    if (!cells) return "unreadable";
    const [, green, a, b] = cells;
    const greenish = green[1] - green[0] > 60 && green[1] - green[2] > 60;
    // Version 2 markers are dark grey then light grey; version 3 are white then black.
    if (greenish && grey(a) && grey(b) && mean(a) > 40 && mean(b) < 245 && mean(b) - mean(a) > 25) return "old-addon";
    return "unreadable";
  });
  if (found) return found;
  return (!CORNERS.includes(corner) || corner === "topleft") && hairlineHint(img) ? "hairline-unreadable" : null;
}
function parsePayload(b) {
  const u16 = (i) => (b[i] << 8) | b[i + 1], u24 = (i) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
  const flags = b[10];
  const known = (v) => (v === 255 ? null : v);
  const out = {
    version: b[0], seq: b[1],
    combat: Boolean(flags & 1), dead: Boolean(flags & 2), resting: Boolean(flags & 4), mounted: Boolean(flags & 8), inInstance: Boolean(flags & 16), afk: Boolean(flags & 32),
  };
  out.characterHash = u16(23);
  // Frames from 0.32+ addons count this up at least every two seconds even when nothing else
  // changes (idle heartbeat); older addons leave it at 0.
  out.heartbeat = b[25];
  if (out.combat) return out; // Frozen during combat by design.
  if (flags & 64) out.position = { mapId: u16(2), x: u16(4) / 65535, y: u16(6) / 65535, facing: (b[22] / 256) * 2 * Math.PI };
  out.level = b[8] || null;
  out.healthPercent = known(b[9]);
  if (flags & 128) out.target = { npcId: u24(11), healthPercent: known(b[14]) };
  out.xpPercent = known(b[15]);
  out.freeBagSlots = known(b[16]);
  const quest = u24(17);
  if (quest) out.quest = { id: quest, objectivesDone: [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => b[20] & (1 << i)).map((i) => i + 1) };
  out.questLogHash = b[21];
  return out;
}

// Windows-only capture worker. The C# helper copies one small client-area region at one
// corner. The app may move or resize that region with "region <corner> <w> <h>" lines on
// stdin (corner names and sizes are checked); nothing else is read from stdin.
// Since 0.38 it first asks Windows for the game window's own picture with PrintWindow
// (PW_CLIENTONLY | PW_RENDERFULLCONTENT), which keeps working while another window covers the game.
// PrintWindow has no source rectangle, so it draws into a reused bitmap only as large as the client
// area up to the far edge of the region (544 x 4 pixels for a hairline at the top-left). A failed or
// all-black result falls back to copying the screen (CopyFromScreen) for that sample; after five
// such misses in a row the worker stays on the screen copy for 20 samples before trying again.
// Each "ok" line ends with the method used: "pw" (game window) or "screen".
const WORKER = String.raw`
$ErrorActionPreference='Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.IO; using System.Threading; using System.Runtime.InteropServices; using System.Drawing; using System.Drawing.Imaging;
public static class BFLiveCapture {
  static readonly string[] Corners = { "topleft", "topright", "bottomleft", "bottomright" };
  static readonly object Gate = new object();
  static string corner = "topleft"; static int rw = 640, rh = 28, delay = 500;
  static bool printing = true; static int printMiss = 0, printSkip = 0;
  static IntPtr memDC = IntPtr.Zero, dib = IntPtr.Zero, dibBits = IntPtr.Zero, dibOld = IntPtr.Zero; static int dibW = 0, dibH = 0;
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
  [DllImport("gdi32.dll")] static extern bool GdiFlush();
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bi, uint usage, out IntPtr bits, IntPtr section, uint offset);
  const uint PW_CLIENTONLY_RENDERFULLCONTENT = 3;
  // The region (x, y, w, ht of the client area) from the game window's own picture, as RGB; null
  // when PrintWindow fails or the region came back all black (nothing drawn).
  static byte[] Print(IntPtr h, int x, int y, int w, int ht) {
    int W = x + w, H = y + ht;
    if (memDC == IntPtr.Zero) memDC = CreateCompatibleDC(IntPtr.Zero);
    if (memDC == IntPtr.Zero) return null;
    if (dib == IntPtr.Zero || dibW != W || dibH != H) {
      if (dib != IntPtr.Zero) { SelectObject(memDC, dibOld); DeleteObject(dib); dib = IntPtr.Zero; }
      BITMAPINFOHEADER bi = new BITMAPINFOHEADER(); bi.biSize = 40; bi.biWidth = W; bi.biHeight = -H; bi.biPlanes = 1; bi.biBitCount = 32;
      dib = CreateDIBSection(memDC, ref bi, 0, out dibBits, IntPtr.Zero, 0);
      if (dib == IntPtr.Zero) return null;
      dibOld = SelectObject(memDC, dib); dibW = W; dibH = H;
    }
    byte[] row = new byte[w * 4];
    for (int r = 0; r < ht; r++) Marshal.Copy(row, 0, IntPtr.Add(dibBits, ((y + r) * W + x) * 4), w * 4);
    if (!PrintWindow(h, memDC, PW_CLIENTONLY_RENDERFULLCONTENT)) return null;
    GdiFlush();
    byte[] rgb = new byte[w * ht * 3]; bool any = false;
    for (int r = 0; r < ht; r++) {
      Marshal.Copy(IntPtr.Add(dibBits, ((y + r) * W + x) * 4), row, 0, w * 4);
      for (int c = 0; c < w; c++) { int s = c * 4, o = (r * w + c) * 3; rgb[o] = row[s + 2]; rgb[o + 1] = row[s + 1]; rgb[o + 2] = row[s]; if ((row[s] | row[s + 1] | row[s + 2]) != 0) any = true; }
    }
    return any ? rgb : null;
  }
  static void Set(string c, int w, int h) {
    if (Array.IndexOf(Corners, c) < 0 || w < 16 || w > 1024 || h < 4 || h > 64) return;
    lock (Gate) { corner = c; rw = w; rh = h; }
  }
  static void Listen() {
    try {
      StreamReader input = new StreamReader(Console.OpenStandardInput());
      string line;
      while ((line = input.ReadLine()) != null) {
        string[] p = line.Trim().Split(' '); int w, h, ms;
        if (p.Length == 4 && p[0] == "region" && int.TryParse(p[2], out w) && int.TryParse(p[3], out h)) Set(p[1], w, h);
        else if (p.Length == 2 && p[0] == "interval" && int.TryParse(p[1], out ms) && ms >= 100 && ms <= 2000) { lock (Gate) { delay = ms; } }
      }
    } catch { }
  }
  public static void Init(string c, int w, int h, int ms, string capture) {
    SetProcessDPIAware(); Set(c, w, h);
    if (ms >= 100 && ms <= 2000) delay = ms;
    printing = capture != "screen";
    Thread t = new Thread(Listen); t.IsBackground = true; t.Start();
  }
  public static int Delay() { lock (Gate) { return delay; } }
  // The game window's client area in screen pixels (where the app places its answer panel).
  public static string Rect(IntPtr h) {
    RECT r; POINT p = new POINT();
    if (!IsWindow(h) || IsIconic(h) || !GetClientRect(h, out r) || !ClientToScreen(h, ref p)) return "";
    return "rect " + p.X + " " + p.Y + " " + (r.R - r.L) + " " + (r.B - r.T);
  }
  public static string Grab(IntPtr h) {
    string c; int w, ht;
    lock (Gate) { c = corner; w = rw; ht = rh; }
    if (!IsWindow(h)) return "gone";
    if (IsIconic(h)) return "minimized";
    RECT r; if (!GetClientRect(h, out r)) return "gone";
    int cw = r.R - r.L, ch = r.B - r.T;
    // A window with no client area left is minimized in all but name (some games do this).
    if (cw <= 0 || ch <= 0) return "minimized";
    if (cw < w || ch < ht) return "small";
    int rx = c.EndsWith("right") ? cw - w : 0, ry = c.StartsWith("bottom") ? ch - ht : 0;
    byte[] rgb = null;
    if (printing) {
      if (printSkip > 0) printSkip--;
      else {
        try { rgb = Print(h, rx, ry, w, ht); } catch { rgb = null; }
        if (rgb != null) printMiss = 0; else if (++printMiss >= 5) { printMiss = 0; printSkip = 20; }
      }
    }
    if (rgb != null) return "ok " + c + " " + w + " " + ht + " " + Convert.ToBase64String(rgb) + " pw";
    POINT p = new POINT(); p.X = rx; p.Y = ry;
    if (!ClientToScreen(h, ref p)) return "gone";
    using (Bitmap bmp = new Bitmap(w, ht, PixelFormat.Format24bppRgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) { g.CopyFromScreen(p.X, p.Y, 0, 0, new Size(w, ht)); }
      BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, ht), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      byte[] row = new byte[d.Stride]; rgb = new byte[w * ht * 3];
      for (int y = 0; y < ht; y++) {
        Marshal.Copy(IntPtr.Add(d.Scan0, y * d.Stride), row, 0, d.Stride);
        for (int x = 0; x < w; x++) { int s = x * 3, o = (y * w + x) * 3; rgb[o] = row[s + 2]; rgb[o + 1] = row[s + 1]; rgb[o + 2] = row[s]; }
      }
      bmp.UnlockBits(d);
      return "ok " + c + " " + w + " " + ht + " " + Convert.ToBase64String(rgb) + " screen";
    }
  }
}
"@
$name = $env:BF_LIVE_PROCESS
[BFLiveCapture]::Init($env:BF_LIVE_CORNER, [int]$env:BF_LIVE_W, [int]$env:BF_LIVE_H, [int]$env:BF_LIVE_MS, $env:BF_LIVE_CAPTURE)
$handle = [IntPtr]::Zero; $tick = 0; $looked = [DateTime]::MinValue; $placed = [DateTime]::MinValue
while ($true) {
  $now = [DateTime]::UtcNow
  if ($handle -eq [IntPtr]::Zero -or ($now - $looked).TotalSeconds -ge 5) {
    $looked = $now
    $proc = if ($env:BF_LIVE_PID) { Get-Process -Id ([int]$env:BF_LIVE_PID) -ErrorAction SilentlyContinue } else { Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
    if ($proc -and $proc.MainWindowHandle -eq 0) { $proc = $null }
    $handle = if ($proc) { $proc.MainWindowHandle } else { [IntPtr]::Zero }
  }
  if ($handle -eq [IntPtr]::Zero) { [Console]::Out.WriteLine('nogame') } else {
    try { [Console]::Out.WriteLine([BFLiveCapture]::Grab($handle)) } catch { [Console]::Out.WriteLine('error') }
    if (($now - $placed).TotalSeconds -ge 2) { $placed = $now; try { $r = [BFLiveCapture]::Rect($handle); if ($r) { [Console]::Out.WriteLine($r) } } catch { } }
  }
  [Console]::Out.Flush(); $tick++
  Start-Sleep -Milliseconds ([BFLiveCapture]::Delay())
}
`;

class LiveBridge {
  // capture: "auto" (the game window's own picture, falling back to the screen) or "screen".
  constructor({ dataDir = null, spawn = childProcess.spawn, platform = process.platform, processName = "Wow", processId = null, intervalMs = 500, now = Date.now, capture = "auto", dumpDir = undefined } = {}) {
    Object.assign(this, { dataDir, spawn, platform, processName, processId, intervalMs, now, capture });
    this.listeners = new Set();
    this.child = null;
    this.frame = null;
    this.signal = "off";
    this.enabled = platform === "win32" && this.readPreference();
    this.buffer = "";
    // Capture only the corner where the strip was last seen; walk the others only when it is lost.
    this.corner = "topleft"; this.region = TOPLEFT_REGION; this.misses = 0; this.strip = null; this.beat = null;
    // BF_LIVE_DUMP=<dir>: save the raw top rows of a hairline that is there but does not decode.
    this.dumpDir = dumpDir === undefined ? process.env.BF_LIVE_DUMP || null : dumpDir; this.dumps = 0; this.dumpedAt = 0;
  }
  prefFile() { return this.dataDir ? path.join(this.dataDir, "live-link.json") : null; }
  readPreference() {
    try { return JSON.parse(fs.readFileSync(this.prefFile(), "utf8")).enabled !== false; } catch { return true; }
  }
  setEnabled(enabled) {
    if (typeof enabled !== "boolean") throw Error("Invalid live link preference.");
    if (this.platform !== "win32") return this.status();
    this.enabled = enabled;
    try { if (this.prefFile()) fs.writeFileSync(this.prefFile(), JSON.stringify({ enabled })); } catch {}
    if (enabled) this.start(); else this.stop();
    this.emit();
    return this.status();
  }
  start() {
    if (this.platform !== "win32" || this.child || !this.enabled) return;
    const exe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const encoded = Buffer.from(WORKER, "utf16le").toString("base64");
    this.signal = "starting";
    const child = this.spawn(exe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { SystemRoot: process.env.SystemRoot, windir: process.env.windir, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, BF_LIVE_PROCESS: this.processName, BF_LIVE_CORNER: this.corner, BF_LIVE_W: String(this.region.width), BF_LIVE_H: String(this.region.height), BF_LIVE_MS: String(this.intervalMs), BF_LIVE_CAPTURE: this.capture === "screen" ? "screen" : "auto", ...(Number.isInteger(this.processId) ? { BF_LIVE_PID: String(this.processId) } : {}) },
    });
    this.child = child;
    child.stdin?.on?.("error", () => {});
    // Output and errors from a stopped or replaced worker are ignored.
    const current = () => this.child === child && this.enabled;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { if (current()) this.read(chunk); });
    child.stderr.on("data", () => {});
    child.on("error", () => { if (!current()) return; this.signal = "error"; this.emit(); this.restartLater(child); });
    child.on("close", () => { if (!current()) return; this.signal = "error"; this.emit(); this.restartLater(child); });
  }
  restartLater(child) {
    if (this.child !== child) return;
    this.child = null;
    try { child.kill(); } catch {}
    clearTimeout(this.retry);
    this.retry = setTimeout(() => { if (this.enabled) this.start(); }, 5000);
  }
  stop() {
    clearTimeout(this.retry);
    const child = this.child; this.child = null;
    try { child?.kill(); } catch {}
    this.signal = "off"; this.frame = null; this.buffer = ""; this.beat = null; this.gameRect = null;
    clearTimeout(this.slowTimer); this.sampling = null;
  }
  /** Moves the worker's capture to another corner or size (no-op when unchanged). */
  setRegion(corner, region = searchRegion(corner)) {
    if (!CORNERS.includes(corner)) return;
    if (corner === this.corner && region.width === this.region.width && region.height === this.region.height) return;
    this.corner = corner; this.region = region;
    try { this.child?.stdin?.write?.(`region ${corner} ${region.width} ${region.height}\n`); } catch {}
  }
  read(chunk) {
    if (!this.enabled) return;
    this.buffer += chunk;
    if (this.buffer.length > 200000) this.buffer = this.buffer.slice(-100000);
    let nl;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim(); this.buffer = this.buffer.slice(nl + 1);
      this.line(line);
    }
  }
  line(line) {
    const eventKey = () => JSON.stringify([this.signal, this.frame?.seq, this.frame?.characterHash]);
    const before = eventKey();
    let changed = false;
    if (line.startsWith("ok ")) {
      // "ok <corner> <w> <h> <base64> [pw|screen]"; older workers (and saved fixtures) send
      // "ok <base64>" of a top-left region 640 wide, sized from the data.
      const parts = line.split(" ");
      let corner = "topleft", width = REGION.width, height, rgb, capture = null;
      if ((parts.length === 5 || parts.length === 6) && CORNERS.includes(parts[1])) { corner = parts[1]; width = Number(parts[2]); height = Number(parts[3]); rgb = Buffer.from(parts[4], "base64"); capture = { pw: "window", screen: "screen" }[parts[5]] || null; }
      else { rgb = Buffer.from(parts[1] || "", "base64"); height = rgb.length % (REGION.width * 3) === 0 ? rgb.length / (REGION.width * 3) : REGION.height; }
      const img = { width, height, rgb }, decoded = decodeStrip(img, { corner });
      if (decoded) {
        const at = this.now(), frame = parsePayload(decoded.bytes);
        // Heartbeat: a frame whose sequence or heartbeat moved is proof the addon is still painting.
        // The sequence moves only when the game state changed (sameSince feeds the idle flag).
        if (!this.beat || this.beat.seq !== frame.seq || this.beat.heartbeat !== frame.heartbeat) this.beat = { seq: frame.seq, heartbeat: frame.heartbeat, at, sameSince: this.beat?.seq === frame.seq ? this.beat.sameSince : at };
        this.frame = { ...frame, receivedAt: at, changedAt: this.beat.at, sameSince: this.beat.sameSince };
        this.signal = "live"; this.misses = 0;
        if (!this.strip || this.strip.mode !== decoded.mode || this.strip.corner !== corner || this.strip.pitch !== decoded.pitch || (this.strip.capture || null) !== capture) changed = true;
        this.strip = { mode: decoded.mode, version: decoded.version, corner, pitch: decoded.pitch, width: decoded.footprint.width, height: decoded.footprint.height, ...(capture ? { capture } : {}) };
        for (const page of decoded.pages || (decoded.page ? [decoded.page] : [])) {
          if (page[1] === QUESTION_KIND) this.questionPage(parseQuestionPage(page));
          else if (page[1] === MOMENT_KIND) this.momentPage(parseMomentPage(page));
          else if (this.page(parsePage(page))) changed = true;
        }
        // A hairline needs only the top-left of the client area, a compact strip a small slice of its corner.
        if (decoded.mode === "hairline") this.setRegion(corner, HAIRLINE_REGION);
        else if (decoded.mode === "compact" && decoded.pitch <= 4) this.setRegion(corner, COMPACT_REGION);
        else this.setRegion(corner, searchRegion(corner));
      } else {
        const hint = stripHint(img, { corner });
        this.signal = hint || "no-signal";
        if (hint === "hairline-unreadable") this.dump(img, capture);
        if (this.region !== searchRegion(corner)) { this.setRegion(corner, searchRegion(corner)); this.misses = 0; }
        else if (!hint && ++this.misses >= 2) { this.misses = 0; const next = CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length]; this.setRegion(next, searchRegion(next)); }
      }
    } else if (line.startsWith("rect ")) {
      const [x, y, width, height] = line.split(" ").slice(1).map(Number);
      if ([x, y].every((v) => Number.isInteger(v) && Math.abs(v) <= 100000) && [width, height].every((v) => Number.isInteger(v) && v > 0 && v <= 100000)) this.gameRect = { x, y, width, height, at: this.now() };
      return;
    } else if (["nogame", "minimized", "small", "gone", "error"].includes(line)) {
      this.signal = line === "gone" ? "nogame" : line;
      if (line !== "error" && line !== "small") this.gameRect = null;
    }
    if (changed || eventKey() !== before) this.emit();
  }
  /**
   * Debugging (BF_LIVE_DUMP=<dir>): writes the top three rows of a capture whose hairline did not
   * decode as hairline-<time>.json ({ at, width, height, capture, rows: [[[r,g,b], ...], ...] }),
   * at most one every 10 seconds and 20 per run. Only those pixels; nothing else is saved.
   */
  dump(img, capture = null) {
    if (!this.dumpDir || this.dumps >= 20 || this.now() - this.dumpedAt < 10000) return null;
    this.dumpedAt = this.now(); this.dumps++;
    const rows = [];
    for (let y = 0; y < Math.min(3, img.height); y++) { const row = []; for (let x = 0; x < Math.min(img.width, HAIRLINE_WIDTH + 16); x++) row.push(px(img.rgb, img.width, x, y)); rows.push(row); }
    const file = path.join(this.dumpDir, `hairline-${new Date(this.now()).toISOString().replace(/[:.]/g, "-")}.json`);
    try { fs.mkdirSync(this.dumpDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ at: new Date(this.now()).toISOString(), width: img.width, height: img.height, capture, rows })); return file; } catch { return null; }
  }
  /** Collects second-row pages; returns true when a complete set of one kind changed. */
  page(pg) {
    // Pages bind to the character on the main row; anything else is ignored.
    if (!pg || pg.identity !== this.frame?.characterHash) return false;
    this.pageSets ||= new Map(); this.pageLists ||= {};
    const at = this.now();
    let set = this.pageSets.get(pg.kind);
    if (!set || set.generation !== pg.generation || set.count !== pg.count || set.identity !== pg.identity) {
      set = { generation: pg.generation, count: pg.count, identity: pg.identity, total: pg.total, parts: new Map() };
      this.pageSets.set(pg.kind, set);
    }
    set.parts.set(pg.index, pg.ids);
    const have = this.pageLists[pg.kind];
    if (set.parts.size === set.count) {
      if (have && have.generation === set.generation && have.identity === set.identity) { have.at = at; return false; }
      const list = [];
      for (let i = 0; i < set.count; i++) list.push(...set.parts.get(i));
      this.pageLists[pg.kind] = { generation: set.generation, identity: set.identity, list, at };
      return true;
    }
    if (have && have.generation === set.generation) have.at = at;
    return false;
  }
  /** New moments from a moments page are passed to subscribeMoments listeners, once each. */
  momentPage(pg) {
    // Moments bind to the character on the main row, like quest pages.
    if (!pg || pg.identity !== this.frame?.characterHash) return [];
    const at = this.now(), fresh = [];
    this.momentSeen ||= new Map();
    for (const [k, t] of this.momentSeen) if (at - t > MOMENT_SEEN_MS) this.momentSeen.delete(k);
    for (const m of pg.moments) {
      const key = [pg.identity, m.seq, m.type, m.a, m.b, m.c].join(":");
      if (this.momentSeen.has(key)) continue;
      this.momentSeen.set(key, at);
      if (m.ageS > MOMENT_MAX_AGE_S) continue;
      fresh.push({ ...m, characterHash: pg.identity, at: at - m.ageS * 1000 });
    }
    // Oldest first, so a burst is told in the order it happened.
    fresh.sort((x, y) => x.at - y.at || x.seq - y.seq);
    for (const m of fresh) for (const fn of this.momentListeners || []) { try { fn(m); } catch {} }
    return fresh;
  }
  subscribeMoments(fn) { (this.momentListeners ||= new Set()).add(fn); return () => this.momentListeners.delete(fn); }
  /**
   * Collects question pages (kind 4). A question complete for the first time is passed to
   * subscribeQuestions listeners as { id, text, characterHash, at }; later passes of the same
   * question (same character, id, checksum and length) are ignored. Returns the question or null.
   */
  questionPage(pg) {
    // Questions bind to the character on the main row, like quest and moment pages.
    if (!pg || pg.identity !== this.frame?.characterHash) return null;
    const at = this.now();
    this.sampleFast(at);
    this.questionSeen ||= new Map(); this.questionParts ||= new Map();
    for (const [k, t] of this.questionSeen) if (at - t > QUESTION_SEEN_MS) this.questionSeen.delete(k);
    for (const [k, set] of this.questionParts) if (at - set.at > QUESTION_PARTIAL_MS) this.questionParts.delete(k);
    const key = [pg.identity, pg.id, pg.sum, pg.count].join(":");
    if (this.questionSeen.has(key)) return null;
    let set = this.questionParts.get(key);
    if (!set) { set = { parts: new Map(), at }; this.questionParts.set(key, set); }
    set.parts.set(pg.index, pg.bytes); set.at = at;
    if (set.parts.size < pg.count) return null;
    this.questionParts.delete(key);
    const text = assembleQuestion(set.parts, pg.count, pg.sum);
    if (!text) return null;
    this.questionSeen.set(key, at);
    const question = text === OPEN_SIGNAL ? { id: pg.id, kind: "open", text: "", characterHash: pg.identity, at } : { id: pg.id, text, characterHash: pg.identity, at };
    for (const fn of this.questionListeners || []) { try { fn(question); } catch {} }
    return question;
  }
  subscribeQuestions(fn) { (this.questionListeners ||= new Set()).add(fn); return () => this.questionListeners.delete(fn); }
  /** Faster sampling for a while after a question page (back to intervalMs afterwards). */
  sampleFast(at = this.now()) {
    this.fastUntil = at + QUESTION_FAST_MS;
    if (this.sampling !== QUESTION_INTERVAL_MS) { this.sampling = QUESTION_INTERVAL_MS; this.sendInterval(QUESTION_INTERVAL_MS); }
    clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => { if (this.now() >= this.fastUntil) { this.sampling = null; this.sendInterval(this.intervalMs); } }, QUESTION_FAST_MS + 50);
    this.slowTimer.unref?.();
  }
  sendInterval(ms) { try { this.child?.stdin?.write?.(`interval ${ms}\n`); } catch {} }
  /** The game window's client rectangle in screen pixels while recently reported, else null. */
  gameWindow() {
    const r = this.gameRect;
    return r && this.now() - r.at <= RECT_FRESH_MS ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }
  /** Live frame only while fresh; older frames are never presented as live. */
  current() {
    if (!this.frame || this.now() - this.frame.receivedAt > FRESH_MS) return null;
    // An unchanged strip stays live while its heartbeat moves; a compact strip whose heartbeat
    // froze (hung game UI) is a picture, not a live game.
    if ((this.frame.version === V4.version || this.frame.version === HAIRLINE.version) && this.frame.changedAt && this.now() - this.frame.changedAt > HEARTBEAT_STALE_MS) return null;
    const out = { ...this.frame, ageMs: this.now() - this.frame.receivedAt };
    // Quest pages only count for the same character and while recently seen.
    for (const [kind, v] of Object.entries(this.pageLists || {})) {
      if (v.identity !== out.characterHash || this.now() - v.at > PAGES_FRESH_MS) continue;
      out[kind] = kind === "questLog" ? v.list.map((e) => ({ id: e.id, complete: e.complete })) : v.list.map((e) => e.id);
    }
    return out;
  }
  status() {
    if (this.platform !== "win32") return { enabled: false, signal: "unsupported", frame: null, strip: null, last: null };
    const frame = this.current();
    if (frame?.position) frame.zone = require("./companion-tools.cjs").MAP_NAMES[frame.position.mapId] || `Map ${frame.position.mapId}`;
    // Last strip seen: mode (compact / safe / legacy), corner and footprint in physical pixels.
    const strip = this.enabled && this.strip ? { ...this.strip, idle: Boolean(frame?.sameSince && this.now() - frame.sameSince > IDLE_MS) } : null;
    // While nothing live can be read (WoW minimized, closed, covered...), the last live state and its
    // age, for display only: it is never presented as live and feeds nothing else.
    let last = null;
    if (this.enabled && !frame && this.frame?.receivedAt) {
      const f = this.frame;
      last = { receivedAt: f.receivedAt, ageMs: this.now() - f.receivedAt, level: f.level || null, combat: Boolean(f.combat), dead: Boolean(f.dead) };
      if (f.position) last.position = { mapId: f.position.mapId, x: f.position.x, y: f.position.y, zone: require("./companion-tools.cjs").MAP_NAMES[f.position.mapId] || `Map ${f.position.mapId}` };
    }
    return { enabled: this.enabled, signal: this.enabled ? (frame ? "live" : this.signal === "live" ? "stale" : this.signal) : "off", frame, strip, last };
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { const s = this.status(); for (const fn of this.listeners) { try { fn(s); } catch {} } }
}
module.exports = { HAIRLINE, HAIRLINE_REGION, HAIRLINE_WIDTH, TOPLEFT_REGION, hairlineThresholds, crc16, encodeHairlineFrame, encodeHairlineCells, decodeHairlineCells, decodeHairline, hairlineHint, encodeQuestionPages, parseQuestionPage, assembleQuestion, OPEN_SIGNAL, QUESTION_KIND, QUESTION_CHUNK, QUESTION_MAX_BYTES, QUESTION_MAX_CHARS, QUESTION_INTERVAL_MS, encodePages, parsePage, encodeMomentPages, parseMomentPage, MOMENT_KIND, MOMENT_MAX_AGE_S, decodePageCells, PAGE_VERSION, LiveBridge, identityHash, rememberLiveKey, liveKeyFor, isKnownLiveKey, decodeStrip, stripHint, decodeCells, decodeCellsV4, encodeCells, encodeCellsV2, encodeCellsV4, encodePageCellsV4, parsePayload, crc8, REGION, COMPACT_REGION, CORNERS, CELL, V4, MIN_LEVEL_GAP, FRESH_MS, HEARTBEAT_STALE_MS, WORKER };
