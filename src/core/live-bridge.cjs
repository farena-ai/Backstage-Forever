"use strict";
// Live game link: decodes the opt-in status strip drawn by BackstageForeverLive.lua.
// A bounded PowerShell worker copies only a small region at the top-left of the game
// window's client area twice per second; pixels are decoded here and never stored.
// The worker sends no input, reads no process memory and touches no game files.
const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const CELL = 6, MARKERS = 4, PAYLOAD_CELLS = 72, PAYLOAD_BYTES = 27, VERSION = 3;
// Version 2 strips (addon 0.18.1 and earlier): 4px cells, four levels per channel.
const V2 = { cell: 4, payloadCells: 36, version: 2 };
const REGION = { width: 640, height: 16 }; // room for the strip at up to 8px per cell
const FRESH_MS = 4000;

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
function decodeCells(cells) {
  if (!Array.isArray(cells) || cells.length < MARKERS) return null;
  return (cells.length >= MARKERS + PAYLOAD_CELLS && decodeCellsV3(cells)) || decodeCellsV2(cells.slice(0, MARKERS + V2.payloadCells));
}
const px = (rgb, width, x, y) => { const i = (y * width + x) * 3; return [rgb[i], rgb[i + 1], rgb[i + 2]]; };
const magentaish = (p) => p[0] - p[1] > 60 && p[2] - p[1] > 60;
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
// Find the magenta finder near the client origin, measure the cell pitch from its run,
// then try the version 3 layout and the older version 2 layout (each checked by CRC).
function decodeStrip({ width, height, rgb }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Buffer.isBuffer(rgb) || rgb.length !== width * height * 3) return null;
  for (let y = 0; y + 3 <= height && y < 10; y++) {
    for (let x = 0; x < width && x < 40; x++) {
      if (!magentaish(px(rgb, width, x, y))) continue;
      let run = 1;
      while (x + run < width && run < 20 && magentaish(px(rgb, width, x + run, y))) run++;
      if (run < 3) continue;
      const tries = [];
      for (const pitch of [run, run + 1, run - 1, CELL, V2.cell]) if (pitch >= 3 && !tries.includes(pitch)) tries.push(pitch);
      for (const pitch of tries) {
        const v3 = sampleCells(rgb, width, height, x, y, pitch, MARKERS + PAYLOAD_CELLS);
        const b3 = v3 && decodeCellsV3(v3);
        if (b3) return { bytes: b3, origin: { x, y }, pitch, version: VERSION };
        const v2 = sampleCells(rgb, width, height, x, y, pitch, MARKERS + V2.payloadCells);
        const b2 = v2 && decodeCellsV2(v2);
        if (b2) return { bytes: b2, origin: { x, y }, pitch, version: V2.version };
      }
      x += run - 1;
    }
  }
  return null;
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

// Windows-only capture worker. The C# helper copies one small client-area region.
const WORKER = String.raw`
$ErrorActionPreference='Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Drawing; using System.Drawing.Imaging;
public static class BFLiveCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  public static void Init() { SetProcessDPIAware(); }
  public static string Grab(IntPtr h, int w, int ht) {
    if (!IsWindow(h)) return "gone";
    if (IsIconic(h)) return "minimized";
    RECT r; if (!GetClientRect(h, out r) || r.R - r.L < w || r.B - r.T < ht) return "small";
    POINT p = new POINT(); if (!ClientToScreen(h, ref p)) return "gone";
    using (Bitmap bmp = new Bitmap(w, ht, PixelFormat.Format24bppRgb)) {
      using (Graphics g = Graphics.FromImage(bmp)) { g.CopyFromScreen(p.X, p.Y, 0, 0, new Size(w, ht)); }
      BitmapData d = bmp.LockBits(new Rectangle(0, 0, w, ht), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      byte[] row = new byte[d.Stride]; byte[] rgb = new byte[w * ht * 3];
      for (int y = 0; y < ht; y++) {
        Marshal.Copy(IntPtr.Add(d.Scan0, y * d.Stride), row, 0, d.Stride);
        for (int x = 0; x < w; x++) { int s = x * 3, o = (y * w + x) * 3; rgb[o] = row[s + 2]; rgb[o + 1] = row[s + 1]; rgb[o + 2] = row[s]; }
      }
      bmp.UnlockBits(d);
      return "ok " + Convert.ToBase64String(rgb);
    }
  }
}
"@
[BFLiveCapture]::Init()
$name = $env:BF_LIVE_PROCESS; $w = [int]$env:BF_LIVE_W; $h = [int]$env:BF_LIVE_H
$handle = [IntPtr]::Zero; $tick = 0
while ($true) {
  if ($handle -eq [IntPtr]::Zero -or ($tick % 10) -eq 0) {
    $proc = if ($env:BF_LIVE_PID) { Get-Process -Id ([int]$env:BF_LIVE_PID) -ErrorAction SilentlyContinue } else { Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
    if ($proc -and $proc.MainWindowHandle -eq 0) { $proc = $null }
    $handle = if ($proc) { $proc.MainWindowHandle } else { [IntPtr]::Zero }
  }
  if ($handle -eq [IntPtr]::Zero) { [Console]::Out.WriteLine('nogame') } else {
    try { [Console]::Out.WriteLine([BFLiveCapture]::Grab($handle, $w, $h)) } catch { [Console]::Out.WriteLine('error') }
  }
  [Console]::Out.Flush(); $tick++
  Start-Sleep -Milliseconds ([int]$env:BF_LIVE_MS)
}
`;

class LiveBridge {
  constructor({ dataDir = null, spawn = childProcess.spawn, platform = process.platform, processName = "Wow", processId = null, intervalMs = 500, now = Date.now } = {}) {
    Object.assign(this, { dataDir, spawn, platform, processName, processId, intervalMs, now });
    this.listeners = new Set();
    this.child = null;
    this.frame = null;
    this.signal = "off";
    this.enabled = this.readPreference();
    this.buffer = "";
  }
  prefFile() { return this.dataDir ? path.join(this.dataDir, "live-link.json") : null; }
  readPreference() {
    try { return JSON.parse(fs.readFileSync(this.prefFile(), "utf8")).enabled !== false; } catch { return true; }
  }
  setEnabled(enabled) {
    if (typeof enabled !== "boolean") throw Error("Invalid live link preference.");
    this.enabled = enabled;
    try { if (this.prefFile()) fs.writeFileSync(this.prefFile(), JSON.stringify({ enabled })); } catch {}
    if (enabled) this.start(); else this.stop();
    this.emit();
    return this.status();
  }
  start() {
    if (this.child || !this.enabled) return;
    if (this.platform !== "win32") { this.signal = "unsupported"; return; }
    const exe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const encoded = Buffer.from(WORKER, "utf16le").toString("base64");
    this.signal = "starting";
    const child = this.spawn(exe, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { SystemRoot: process.env.SystemRoot, windir: process.env.windir, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, BF_LIVE_PROCESS: this.processName, BF_LIVE_W: String(REGION.width), BF_LIVE_H: String(REGION.height), BF_LIVE_MS: String(this.intervalMs), ...(Number.isInteger(this.processId) ? { BF_LIVE_PID: String(this.processId) } : {}) },
    });
    this.child = child;
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
    this.signal = "off"; this.frame = null; this.buffer = "";
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
    const before = JSON.stringify([this.signal, this.frame?.seq]);
    if (line.startsWith("ok ")) {
      const rgb = Buffer.from(line.slice(3), "base64");
      const decoded = decodeStrip({ width: REGION.width, height: REGION.height, rgb });
      if (decoded) { this.frame = { ...parsePayload(decoded.bytes), receivedAt: this.now() }; this.signal = "live"; }
      else this.signal = "no-signal";
    } else if (["nogame", "minimized", "small", "gone", "error"].includes(line)) this.signal = line === "gone" ? "nogame" : line;
    if (JSON.stringify([this.signal, this.frame?.seq]) !== before) this.emit();
  }
  /** Live frame only while fresh; older frames are never presented as live. */
  current() {
    if (!this.frame || this.now() - this.frame.receivedAt > FRESH_MS) return null;
    return { ...this.frame, ageMs: this.now() - this.frame.receivedAt };
  }
  status() {
    const frame = this.current();
    if (frame?.position) frame.zone = require("./companion-tools.cjs").MAP_NAMES[frame.position.mapId] || `Map ${frame.position.mapId}`;
    return { enabled: this.enabled, signal: this.enabled ? (frame ? "live" : this.signal === "live" ? "stale" : this.signal) : "off", frame };
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { const s = this.status(); for (const fn of this.listeners) { try { fn(s); } catch {} } }
}
module.exports = { LiveBridge, identityHash, rememberLiveKey, liveKeyFor, isKnownLiveKey, decodeStrip, decodeCells, encodeCells, encodeCellsV2, parsePayload, crc8, REGION, CELL, FRESH_MS, WORKER };
