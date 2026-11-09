"use strict";
// Real Electron/main/preload/context; every listening/speaking worker is fake.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), syncFs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfVoiceShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfVoiceShortPath]::GetShortPathName($env:BF_VOICE_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync(path.join(process.env.WINDIR, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, BF_VOICE_ALIAS_PATH: target }, encoding: "utf8", timeout: 15000 }).trim();
  assert.notEqual(alias.toLowerCase(), target.toLowerCase()); assert.match(alias, /~\d/); assert.equal(syncFs.statSync(alias).ino, syncFs.statSync(target).ino); return alias;
}
async function probeCapabilities(voice) {
  const workerFactory = voice.worker; let terminal = null;
  voice.worker = function (...args) {
    const worker = workerFactory.apply(this, args);
    void worker.result.then(result => { if (worker.done && ["capabilities", "unavailable"].includes(result.event?.event)) terminal = result.event.event; });
    return worker;
  };
  try {
    const result = await voice.capabilities();
    assert.ok(terminal, "Native capability boot is unproven: no validated terminal and confirmed disposal (bootstrap, compilation or worker failure).");
    return { result, terminal };
  } finally { voice.worker = workerFactory; }
}
async function main() {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "forever-voice-backend-")); let app;
  const watchdog = setTimeout(() => { console.error("Voice fixture exceeded 80 seconds"); process.exitCode = 1; app?.process().kill(); }, 80000);
  try {
    const normal = path.join(root, "synthetic-user-data"); await fs.mkdir(normal); const data = process.argv.includes("--short-path") ? shortPath(normal) : normal;
    if (process.argv.includes("--capabilities-only")) {
      const { VoiceService } = require("../src/core/voice.cjs"), { CompanionContext } = require("../src/core/companion-context.cjs"), state = defaultState();
      const voice = new VoiceService({ context: new CompanionContext(() => state), getState: () => state, inputAllowed: () => false, dataDir: data });
      try {
        const { result, terminal } = await probeCapabilities(voice); assert.ok(["available", "unavailable"].includes(result.status));
        assert.ok(result.recognition.cultures.length <= 32 && result.synthesis.voices.length <= 32);
        console.log("CAPABILITIES ONLY: " + JSON.stringify(result));
        const runtime = path.join(normal, "runtime/voice");
        for (const name of ["voice-helper.ps1", "voice-helper.cs"]) assert.deepEqual(await fs.readFile(path.join(runtime, name)), await fs.readFile(path.join(__dirname, "../src/native", name)));
        assert.equal(voice.workers.size, 0); console.log(`PASS: fixed Windows helper validated ${terminal} terminal and confirmed disposal prove boot/compile; exact prepared runtime bytes; no input/output audio selected.`);
      } finally { voice.close(); }
      return;
    }
    await fs.writeFile(path.join(data, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: ["Alpha", "Beta"].map(id => ({ id, name: id, realm: "Synthetic", className: "Mage", level: 12, goals: [], notes: "" })) }));
    app = await electron.launch({ args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: data }, timeout: 20000 });
    const page = await testWindow(app); page.setDefaultTimeout(8000);
    assert.equal(await page.evaluate(() => typeof window.backstage.voiceStart), "function");
    await app.evaluate(({ app, dialog }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      const { EventEmitter } = load("node:events"), { PassThrough } = load("node:stream"), { VoiceService } = load("./src/core/voice.cjs");
      globalThis.voiceFixture = { children: [], commands: [], launches: 0, holdPrepare: false, holdProbe: false, ignoreCancel: false };
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch = async () => { voiceFixture.launches++; throw Error("Fixture blocks game launch"); };
      const original = VoiceService.prototype.worker;
      VoiceService.prototype.prepareBounded = async function () { voiceFixture.service = this; if (voiceFixture.holdPrepare) await new Promise(resolve => voiceFixture.releasePreparation = resolve); return "C:\\synthetic\\voice-helper.ps1"; };
      VoiceService.prototype.worker = function (...args) {
        this.spawn = () => {
          const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.killed = false;
          child.on("exit", code => queueMicrotask(() => child.emit("close", code)));
          child.kill = () => { child.killed = true; child.killCalls = (child.killCalls || 0) + 1; if (child.killMode === "false") return false; if (child.killMode === "throw") throw Error("Fixture kill denied"); if (child.killMode === "unclosed") return true; child.emit("exit", null); return true; };
          child.send = event => child.stdout.write(JSON.stringify({ v: 1, id: child.id, ...event }) + "\n");
          child.capabilities = () => { child.send({ event: "capabilities", recognizers: [{ id: "MS-1033-80-DESK", name: "Microsoft English", culture: "en-US" }], voices: [{ id: "Microsoft David Desktop", name: "Microsoft David Desktop", culture: "en-US" }] }); child.emit("exit", 0); };
          child.stdin.on("data", line => { const request = JSON.parse(String(line)); child.id = request.id; voiceFixture.commands.push(request); if (request.command === "capabilities" && !voiceFixture.holdProbe) queueMicrotask(child.capabilities); if (["listen", "speak"].includes(request.command)) queueMicrotask(() => child.send({ event: "started" })); if (request.command === "cancel" && !voiceFixture.ignoreCancel) queueMicrotask(() => child.emit("exit", 0)); });
          voiceFixture.children.push(child); return child;
        };
        return original.apply(this, args);
      };
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    const call = (method, ...args) => page.evaluate(({ method, args }) => window.backstage[method](...args), { method, args });
    const focus = () => app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); });
    const waitPhase = async (id, phase) => { const end = Date.now() + 6000; while (true) { const s = await call("voiceStatus", id); if (s.phase === phase) return s; assert.ok(Date.now() < end, JSON.stringify(s)); await new Promise(r => setTimeout(r, 15)); } };
    await call("companionContext", { profileId: "Alpha", view: "ai" }); await focus();
    assert.equal((await call("voiceCapabilities")).recognition.available, true);
    const guards = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0], event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }, rejected = async fn => { try { await fn(); return false; } catch { return true; } }, results = [];
      for (const name of ["voiceCapabilities", "voiceStart", "voiceStatus", "voiceStop", "voiceSpeak", "voiceCancel"]) { const fn = ipcMain._invokeHandlers.get("backstage:" + name); results.push(await rejected(() => fn({ sender: {}, senderFrame: {} })), await rejected(() => fn({ sender: win.webContents, senderFrame: { url: event.senderFrame.url } })), await rejected(() => fn(event, null, "extra"))); } return results;
    }); assert.ok(guards.every(Boolean));
    await assert.rejects(() => call("voiceStart", { profileId: null, culture: "en-US" }));
    let s = await call("voiceStart", { profileId: "Alpha", culture: "en-US" }); await waitPhase(s.sessionId, "listening");
    await app.evaluate(() => voiceFixture.children.at(-1).send({ event: "hypothesis", text: "Where is the quest" }));
    assert.equal((await call("voiceStop", s.sessionId)).incomplete, true); assert.equal((await call("voiceStatus", s.sessionId)).draft, "Where is the quest");
    await app.evaluate(() => { voiceFixture.holdPrepare = true; }); s = await call("voiceStart", { profileId: "Alpha", culture: "en-US" });
    await call("voiceStop", s.sessionId); const before = await app.evaluate(() => voiceFixture.commands.filter(c => c.command === "listen").length);
    await app.evaluate(() => { voiceFixture.holdPrepare = false; voiceFixture.releasePreparation?.(); }); await new Promise(r => setTimeout(r, 40)); assert.equal(await app.evaluate(() => voiceFixture.commands.filter(c => c.command === "listen").length), before);
    s = await call("voiceSpeak", { profileId: "Alpha", text: "Explicit reviewed answer", voiceId: "Microsoft David Desktop" }); await waitPhase(s.sessionId, "speaking");
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.emit("blur"); win.hide(); }); assert.equal((await call("voiceStatus", s.sessionId)).phase, "speaking"); await assert.rejects(() => call("voiceStart", { profileId: "Alpha", culture: "en-US" })); await call("voiceStop", s.sessionId);
    await focus(); s = await call("voiceStart", { profileId: "Alpha", culture: "en-US" }); await waitPhase(s.sessionId, "listening"); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("blur")); assert.equal((await call("voiceStatus", s.sessionId)).phase, "stopped");
    for (const mutate of [() => call("companionContext", { profileId: "Alpha", view: "ai" }), () => call("clearMemory", "Alpha"), () => call("saveProvider", { provider: "ollama", model: "fixture", endpoint: "http://localhost:11434", authMode: "api" }), async () => { const base = (await call("bootstrap")).state; await call("saveState", { ...base, activeProfileId: "Beta" }, base); }, () => page.reload()]) {
      await focus(); await call("companionContext", { profileId: "Alpha", view: "ai" }); s = await call("voiceStart", { profileId: "Alpha", culture: "en-US" }); await waitPhase(s.sessionId, "listening"); await app.evaluate(() => voiceFixture.children.at(-1).send({ event: "hypothesis", text: "Old private draft" })); await mutate(); assert.equal((await call("voiceStatus", s.sessionId)).draft, ""); const base = (await call("bootstrap")).state; if (base.activeProfileId !== "Alpha") await call("saveState", { ...base, activeProfileId: "Alpha" }, base);
    }
    await call("companionContext", { profileId: "Alpha", view: "other" }); s = await call("voiceSpeak", { profileId: "Alpha", text: "Reviewed public plan", voiceId: "Microsoft David Desktop" }); await waitPhase(s.sessionId, "speaking");
    await call("resetData"); assert.equal((await call("voiceStatus", s.sessionId)).phase, "idle"); await call("companionContext", { profileId: null, view: "ai" }); await focus(); s = await call("voiceStart", { profileId: null, culture: "en-US" }); await waitPhase(s.sessionId, "listening");
    await app.evaluate(() => voiceFixture.children.at(-1).stdout.write("x".repeat(32769))); await waitPhase(s.sessionId, "error");
    for (const killMode of ["false", "throw", "unclosed"]) {
      s = await call("voiceSpeak", { profileId: null, text: "Synthetic reviewed reading", voiceId: "Microsoft David Desktop" }); await waitPhase(s.sessionId, "speaking");
      const inputCount = await app.evaluate((_electron, killMode) => { voiceFixture.old = voiceFixture.children.at(-1); voiceFixture.old.killMode = killMode; voiceFixture.ignoreCancel = true; return voiceFixture.commands.filter(c => c.command === "listen").length; }, killMode);
      const replacement = await call("voiceStart", { profileId: null, culture: "en-US" }); await waitPhase(replacement.sessionId, "unavailable");
      const ownership = await app.evaluate(() => {
        const child = voiceFixture.old; child.stdin.emit("error", Error("Late EPIPE fixture")); child.stderr.emit("error", Error("Late stderr fixture"));
        return { owned: [...voiceFixture.service.workers].some(worker => worker.child === child), protected: child.stdin.listenerCount("error"), inputCount: voiceFixture.commands.filter(c => c.command === "listen").length };
      }); assert.equal(ownership.owned, true); assert.equal(ownership.protected, 1); assert.equal(ownership.inputCount, inputCount);
      await app.evaluate(() => { voiceFixture.old.emit("close", null); voiceFixture.ignoreCancel = false; });
      assert.equal((await call("voiceStatus", replacement.sessionId)).phase, "unavailable"); assert.equal(await app.evaluate(() => voiceFixture.service.workers.size), 0);
    }
    assert.equal(await app.evaluate(() => voiceFixture.launches), 0);
    console.log("PASS: actual trusted Electron voice IPC, fake-worker lifecycle, startup release, blur/input-only cancellation, explicit speech, context/profile/provider/memory/reset/reload invalidation, null-profile fallback, protocol bounds and retained ownership/error protection with replacement audio blocked after unconfirmed termination; no real audio or game launch.");
  } finally { clearTimeout(watchdog); if (app) await app.close().catch(() => app.process().kill()); await fs.rm(root, { recursive: true, force: true }); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { probeCapabilities };
