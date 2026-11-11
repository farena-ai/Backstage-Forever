"use strict";
// Live game link: decodes the opt-in status strip drawn by BackstageForeverLive.lua.
// A bounded PowerShell worker copies only a small region at the top-left of the game
// window's client area twice per second; pixels are decoded here and never stored.
// The worker sends no input, reads no process memory and touches no game files.
const path = require("node:path");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const CELL = 4, MARKERS = 4, PAYLOAD_CELLS = 32, PAYLOAD_BYTES = 24, VERSION = 1;
const REGION = { width: 200, height: 16 };
const FRESH_MS = 4000;

function crc8(bytes, n) {
  let crc = 0;
  for (let i = 0; i < n; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 0x80 ? ((crc << 1) ^ 7) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}
// Encoder mirror of the addon (used by tests and the synthetic fixture).
function encodeCells(bytes) {
  const L = [0, 85, 170, 255];
  const cells = [[255, 0, 255], [0, 255, 0], [85, 85, 85], [170, 170, 170]];
  const bits = [];
  for (const b of bytes) for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1);
  for (let c = 0; c < PAYLOAD_CELLS; c++) {
    const rgb = [];
    for (let ch = 0; ch < 3; ch++) { const i = c * 6 + ch * 2; rgb.push(L[(bits[i] || 0) * 2 + (bits[i + 1] || 0)]); }
    cells.push(rgb);
  }
  return cells;
}
// Thresholds per channel come from the four calibration markers, so moderate gamma,
// brightness or colour-filter shifts still decode.
function thresholds(m) {
  const levels = [
    [m[1][0], m[2][0], m[3][0], m[0][0]], // R: 0, 85, 170, 255
    [m[0][1], m[2][1], m[3][1], m[1][1]], // G
    [m[1][2], m[2][2], m[3][2], m[0][2]], // B: 0 (green marker), 85, 170, 255 (magenta)
  ];
  for (const l of levels) if (!(l[0] < l[1] && l[1] < l[2] && l[2] < l[3]) || l[3] - l[0] < 120) return null;
  return levels.map((l) => [(l[0] + l[1]) / 2, (l[1] + l[2]) / 2, (l[2] + l[3]) / 2]);
}
function decodeCells(cells) {
  if (!Array.isArray(cells) || cells.length < MARKERS + PAYLOAD_CELLS) return null;
  const t = thresholds(cells.slice(0, MARKERS));
  if (!t) return null;
  const bits = [];
  for (let c = 0; c < PAYLOAD_CELLS; c++) {
    const rgb = cells[MARKERS + c];
    for (let ch = 0; ch < 3; ch++) {
      const v = rgb[ch], th = t[ch];
      const level = v < th[0] ? 0 : v < th[1] ? 1 : v < th[2] ? 2 : 3;
      bits.push(level >> 1, level & 1);
    }
  }
  const bytes = new Uint8Array(PAYLOAD_BYTES);
  for (let i = 0; i < PAYLOAD_BYTES; i++) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[i * 8 + k]; bytes[i] = v; }
  if (bytes[0] !== VERSION || crc8(bytes, PAYLOAD_BYTES - 1) !== bytes[PAYLOAD_BYTES - 1]) return null;
  return bytes;
}
const px = (rgb, width, x, y) => { const i = (y * width + x) * 3; return [rgb[i], rgb[i + 1], rgb[i + 2]]; };
// Find the magenta marker near the client origin, then sample each cell centre.
function decodeStrip({ width, height, rgb }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || !Buffer.isBuffer(rgb) || rgb.length !== width * height * 3) return null;
  const span = (MARKERS + PAYLOAD_CELLS) * CELL;
  for (let y = 0; y + CELL <= height && y < 10; y++) {
    for (let x = 0; x + span <= width && x < 40; x++) {
      const p = px(rgb, width, x, y);
      if (!(p[0] > 180 && p[1] < 80 && p[2] > 180)) continue;
      const cells = [];
      for (let c = 0; c < MARKERS + PAYLOAD_CELLS; c++) {
        // Average the 2×2 centre of the cell to resist edge blending.
        const cx = x + c * CELL + 1, cy = y + 1, acc = [0, 0, 0];
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const q = px(rgb, width, cx + dx, Math.min(height - 1, cy + dy)); acc[0] += q[0]; acc[1] += q[1]; acc[2] += q[2]; }
        cells.push(acc.map((v) => v / 4));
      }
      const bytes = decodeCells(cells);
      if (bytes) return { bytes, origin: { x, y } };
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
    try { return JSON.parse(fs.readFileSync(this.prefFile(), "utf8")).enabled === true; } catch { return false; }
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
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.read(chunk));
    child.stderr.on("data", () => {});
    child.on("error", () => { this.child = null; this.signal = "error"; this.emit(); });
    child.on("close", () => { if (this.child === child) { this.child = null; if (this.enabled) { this.signal = "error"; this.emit(); this.retry = setTimeout(() => this.start(), 5000); } } });
  }
  stop() {
    clearTimeout(this.retry);
    const child = this.child; this.child = null;
    try { child?.kill(); } catch {}
    this.signal = "off"; this.frame = null; this.buffer = "";
  }
  read(chunk) {
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
module.exports = { LiveBridge, decodeStrip, decodeCells, encodeCells, parsePayload, crc8, REGION, CELL, FRESH_MS, WORKER };
