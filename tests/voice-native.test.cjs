"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), { spawn } = require("node:child_process"), { randomUUID } = require("node:crypto");
const windows = process.platform === "win32";
async function nativeFixture(options = {}) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-voice-native-fake-"));
  const source = await fs.readFile(path.join(__dirname, "../src/native/voice-helper.cs"), "utf8"), stub = await fs.readFile(path.join(__dirname, "fixtures/voice-speech-stub.cs"), "utf8");
  await fs.writeFile(path.join(root, "test-helper.cs"), source + "\n" + stub);
  await fs.writeFile(path.join(root, "test-helper.ps1"), "$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false,$true)\n[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)\nAdd-Type -Path (Join-Path $PSScriptRoot 'test-helper.cs') -ReferencedAssemblies 'System.Web.Extensions'\nexit [BackstageVoiceHelper]::Run()\n");
  const log = path.join(root, "operations.txt"), child = spawn(path.join(process.env.WINDIR, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(root, "test-helper.ps1")], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, BF_VOICE_STUB_LOG: log, BF_VOICE_STUB_BLOCK: options.block ? "1" : "0", BF_VOICE_STUB_COMPLETE: options.complete ? "1" : "0", BF_VOICE_STUB_DISPOSE_BLOCK: options.disposeBlock ? "1" : "0" } });
  const events = []; let output = "", errors = "", timedOut = false;
  child.stdout.on("data", chunk => { output += chunk; let index; while ((index = output.indexOf("\n")) >= 0) { events.push(JSON.parse(output.slice(0, index))); output = output.slice(index + 1); } }); child.stderr.on("data", chunk => errors += String(chunk)); child.stdin.on("error", () => {});
  const timeout = setTimeout(() => { timedOut = true; child.kill(); }, options.timeout || 11000);
  const exit = new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => { clearTimeout(timeout); resolve({ code, timedOut, events, errors }); }); });
  const id = randomUUID();
  return { id, child, exit, events, send: value => child.stdin.write(JSON.stringify({ v: 1, id, ...value }) + "\n"), async operations() { try { return await fs.readFile(log, "utf8"); } catch { return ""; } }, async waitEvent(name) { const end = Date.now() + 5000; while (!events.some(e => e.event === name)) { assert.ok(Date.now() < end, "Expected native fake event " + name + ": " + errors); await new Promise(r => setTimeout(r, 10)); } }, async close() { child.kill(); await exit; await fs.rm(root, { recursive: true, force: true }); } };
}
test("fixed native code enumerates fake engines without selecting audio", { skip: !windows }, async () => {
  const f = await nativeFixture(); try { f.send({ command: "capabilities" }); const result = await f.exit; assert.equal(result.code, 0, result.errors); assert.equal(result.events[0].event, "capabilities"); assert.doesNotMatch(await f.operations(), /attach|recognize|speak|select/); } finally { await f.close(); }
});
test("fixed native code hard-cancels and disposes fake input/output on cancel and EOF", { skip: !windows }, async () => {
  for (const command of ["listen", "speak"]) for (const eof of [false, true]) {
    const f = await nativeFixture(); try { f.send(command === "listen" ? { command, culture: "en-US" } : { command, voiceId: "Microsoft Test Voice", text: "Plain text <speak> $(ignored)" }); await f.waitEvent("started"); if (eof) f.child.stdin.end(); else f.send({ command: "cancel" }); const result = await f.exit; assert.equal(result.timedOut, false); const operations = await f.operations(); assert.match(operations, command === "listen" ? /cancel-fake-input\ndispose-fake-input/ : /cancel-fake-output\ndispose-fake-output/); assert.equal(result.events.filter(e => e.event === "completed").length, 0); } finally { await f.close(); }
  }
});
test("fixed native code completes once after fake disposal and rejects malformed/flooded stdin", { skip: !windows }, async () => {
  const good = await nativeFixture({ complete: true }); try { good.send({ command: "listen", culture: "en-US" }); const result = await good.exit; assert.equal(result.code, 0, result.errors); assert.equal(result.events.filter(e => e.event === "completed").length, 1); assert.match(await good.operations(), /dispose-fake-input/); } finally { await good.close(); }
  for (const kind of ["unknown", "duplicate", "long", "bad-version"]) {
    const f = await nativeFixture(); try { const raw = kind === "unknown" ? JSON.stringify({ v: 1, id: f.id, command: "capabilities", extra: true }) : kind === "duplicate" ? `{"v":1,"v":1,"id":"${f.id}","command":"capabilities"}` : kind === "bad-version" ? JSON.stringify({ v: 2, id: f.id, command: "capabilities" }) : "x".repeat(32769); f.child.stdin.write(raw + "\n"); const result = await f.exit; assert.equal(result.code, 1); assert.equal(result.events.length, 0); assert.equal(await f.operations(), ""); } finally { await f.close(); }
  }
});
test("native startup has an independent bounded watchdog even if fake enumeration blocks", { skip: !windows }, async () => {
  const f = await nativeFixture({ block: true }); try { f.send({ command: "capabilities" }); const result = await f.exit; assert.equal(result.timedOut, false, "Native helper must exit before the external 11-second test backstop"); assert.notEqual(result.code, 0); assert.equal(await f.operations(), ""); } finally { await f.close(); }
});
test("native cancellation kills its own worker if fake disposal hangs", { skip: !windows }, async () => {
  const f = await nativeFixture({ disposeBlock: true, timeout: 3500 }); try { f.send({ command: "listen", culture: "en-US" }); await f.waitEvent("started"); f.send({ command: "cancel" }); const result = await f.exit; assert.equal(result.timedOut, false); assert.match(await f.operations(), /cancel-fake-input\ndispose-fake-input/); } finally { await f.close(); }
});
