"use strict";
// Windows only, needs a desktop session: the real capture worker (PowerShell + PrintWindow) reads a
// hairline painted by an Electron "game" window (scripts/live-bridge-fixture-window.cjs):
//   1. visible: live, mode hairline, read from the game window ("pw");
//   2. covered by another always-on-top window: still live from the game window, while a screen-only
//      reader (the pre-0.38 method) loses it;
//   3. minimized: "minimized" with the last live state kept; 4. restored: live again by itself.
// It sends nothing to any window (the fixture takes commands from a file) and never moves the game.
const path = require("node:path"), fs = require("node:fs"), os = require("node:os"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { LiveBridge } = require("../src/core/live-bridge.cjs");
if (process.platform !== "win32") { console.log("Live capture smoke skipped (Windows only)"); process.exit(0); }
const electron = require("electron");
// A plain white always-on-top window that never takes focus (WS_EX_NOACTIVATE), 700 x 160 pixels.
const COVER = String.raw`
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System.Windows.Forms; using System.Drawing; using System.Runtime.InteropServices;
public class BFCover : Form {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { CreateParams p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x00000008 | 0x00000080; return p; } }
  public BFCover(int x, int y) { FormBorderStyle = FormBorderStyle.None; StartPosition = FormStartPosition.Manual; Location = new Point(x, y); ClientSize = new Size(700, 160); BackColor = Color.White; TopMost = true; ShowInTaskbar = false; }
}
"@
[BFCover]::SetProcessDPIAware() | Out-Null
$f = New-Object BFCover ([int]$env:BF_COVER_X), ([int]$env:BF_COVER_Y)
$f.Add_Shown({ [Console]::Out.WriteLine('covered'); [Console]::Out.Flush() })
[System.Windows.Forms.Application]::Run($f)
`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await wait(100); }
  throw Error(`Timed out waiting for ${what}`);
}
(async () => {
  const watchdog = setTimeout(() => { console.error("Live capture smoke exceeded 120 seconds"); process.exit(1); }, 120000);
  const ctl = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bf-capture-")), "commands.txt");
  fs.writeFileSync(ctl, "");
  const tell = (cmd) => fs.appendFileSync(ctl, cmd + " ");
  const fixture = spawn(electron, [path.join(__dirname, "live-bridge-fixture-window.cjs")], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, BF_FIXTURE_CTL: ctl } });
  let out = "";
  fixture.stdout.setEncoding("utf8"); fixture.stdout.on("data", (c) => { out += c; });
  const bridges = [];
  let cover = null;
  try {
    const pid = Number((await until("the fixture window", () => out.match(/ready (\d+)/), 30000))[1]);
    const said = (word) => until(word, () => out.includes(word + "\n"));
    const reader = (capture) => { const b = new LiveBridge({ processId: pid, intervalMs: 200, capture }); b.enabled = true; b.start(); bridges.push(b); return b; };
    const pw = reader("auto");
    const s1 = await until("a live hairline", () => { const s = pw.status(); return s.signal === "live" && s.strip?.mode === "hairline" && s.strip; }, 30000);
    assert.equal(s1.capture, "window", "read from the game window");
    assert.deepEqual([s1.width, s1.height], [528, 1]);
    assert.equal(pw.status().frame.position.mapId, 1454);
    assert.deepEqual(pw.status().frame.questLog?.map((e) => e.id), [93739, 812]);
    console.log("visible: live hairline read with PrintWindow");

    // Another program's always-on-top window (never activated) over the line, placed from the game
    // window's client rectangle the worker reports.
    const rect = await until("the game window rectangle", () => pw.gameWindow());
    cover = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(COVER, "utf16le").toString("base64")], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, env: { ...process.env, BF_COVER_X: String(rect.x - 10), BF_COVER_Y: String(rect.y - 10) } });
    let coverOut = ""; cover.stdout.setEncoding("utf8"); cover.stdout.on("data", (c) => { coverOut += c; });
    await until("the covering window", () => coverOut.includes("covered"), 30000);
    const screenOnly = reader("screen");
    await wait(3000);
    const before = pw.status().frame?.heartbeat;
    await wait(1500);
    const s2 = pw.status();
    assert.equal(s2.signal, "live", "still live while another window covers the line");
    assert.equal(s2.strip.capture, "window");
    assert.notEqual(s2.frame.heartbeat, before, "the heartbeat keeps moving behind the cover");
    assert.notEqual(screenOnly.status().signal, "live", "a screen copy only sees the covering window");
    console.log(`covered: PrintWindow still live (heartbeat ${before} -> ${s2.frame.heartbeat}); screen-only reader says "${screenOnly.status().signal}"`);
    screenOnly.stop();
    cover.kill(); cover = null;

    tell("minimize"); await said("minimized");
    const s3 = await until("minimized", () => { const s = pw.status(); return s.signal === "minimized" && s; }).catch((e) => { console.error("signal while minimized:", JSON.stringify({ ...pw.status(), frame: undefined })); throw e; });
    assert.equal(s3.frame, null); assert.ok(s3.last?.position, "the last live state is kept");
    console.log(`minimized: signal minimized, last live ${Math.round(s3.last.ageMs / 100) / 10}s ago`);
    tell("restore"); await said("restored");
    await until("live again after restore", () => pw.status().signal === "live");
    console.log("restored: live again");
    console.log("Live capture smoke passed");
  } finally {
    clearTimeout(watchdog);
    for (const b of bridges) b.stop();
    try { cover?.kill(); } catch {}
    try { tell("quit"); } catch {}
    setTimeout(() => { try { fixture.kill(); } catch {} }, 1500).unref();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
