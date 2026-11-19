"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), { spawn } = require("node:child_process"), { randomUUID } = require("node:crypto");
const windows = process.platform === "win32";
async function nativeFixture(options = {}) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-voice-native-fake-"));
  const readyLine = /^BF_VOICE_FIXTURE_READY\r?\n/m;
  const log = path.join(root, "operations.txt");
  const helper = path.join(root, "test-helper.ps1");
  let child, closed, exited = false;
  async function close() {
    try {
      if (child && !exited) child.kill();
      if (closed) await closed;
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  try {
    const source = await fs.readFile(path.join(__dirname, "../src/native/voice-helper.cs"), "utf8"), stub = await fs.readFile(path.join(__dirname, "fixtures/voice-speech-stub.cs"), "utf8");
    await fs.writeFile(path.join(root, "test-helper.cs"), source + "\n" + stub);
    await fs.writeFile(helper, [
      "$ErrorActionPreference='Stop'",
      "$ProgressPreference='SilentlyContinue'",
      "[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false,$true)",
      "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)",
      "Add-Type -Path (Join-Path $PSScriptRoot 'test-helper.cs') -ReferencedAssemblies 'System.Web.Extensions'",
      // Make the old spawn-relative watchdog tests fail regardless of machine load.
      ...(options.slowEntry ? ["Start-Sleep -Milliseconds 3750"] : []),
      "[Console]::Error.WriteLine('BF_VOICE_FIXTURE_READY')",
      "[Console]::Error.Flush()",
      "exit [BackstageVoiceHelper]::Run()",
      "",
    ].join("\n"));
    child = spawn(path.join(process.env.WINDIR, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", helper], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, BF_VOICE_STUB_LOG: log, BF_VOICE_STUB_BLOCK: options.block ? "1" : "0", BF_VOICE_STUB_COMPLETE: options.complete ? "1" : "0", BF_VOICE_STUB_DISPOSE_BLOCK: options.disposeBlock ? "1" : "0" } });
    const events = [];
    let output = "", errors = "", timedOut, timer, childError, protocolError, isReady = false, resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    function armBackstop(phase, ms) {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = phase; child.kill(); }, ms);
    }
    function checkFixture() {
      if (childError) throw childError;
      if (protocolError) throw protocolError;
      assert.equal(timedOut, undefined, `Native fixture hit its external ${timedOut} backstop: ${errors}`);
      assert.equal(errors.replace(readyLine, "").trim(), "", "Unexpected native fixture stderr");
    }
    child.stdout.setEncoding("utf8").on("data", chunk => {
      output += chunk;
      let index;
      while ((index = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, index);
        output = output.slice(index + 1);
        try { events.push(JSON.parse(line)); }
        catch (error) { protocolError ??= new Error(`Invalid native fixture JSON: ${line}`, { cause: error }); }
      }
    });
    child.stderr.setEncoding("utf8").on("data", chunk => {
      errors += chunk;
      if (!isReady && !timedOut && readyLine.test(errors)) {
        isReady = true;
        armBackstop("11-second worker", 11000);
        resolveReady(true);
      }
    });
    child.stdin.on("error", () => {});
    child.on("error", error => { childError = error; });
    closed = new Promise(resolve => child.once("close", (code, signal) => {
      clearTimeout(timer);
      exited = true;
      resolveReady(false);
      resolve({ code, signal, events, errors });
    }));
    // Bound PowerShell startup and Add-Type independently of worker execution.
    armBackstop("30-second pre-entry", 30000);
    if (!await ready) {
      const result = await closed;
      checkFixture();
      assert.fail(`Native fixture exited before worker entry (code ${result.code}, signal ${result.signal})`);
    }
    const id = randomUUID();
    const send = value => child.stdin.write(JSON.stringify({ v: 1, id, ...value }) + "\n");
    return {
      id, child, send, close,
      get exit() { return closed.then(result => { checkFixture(); assert.equal(output, "", "Incomplete native fixture JSON"); return result; }); },
      cancelWithin(ms) {
        checkFixture();
        assert.ok(!exited, "Native fixture exited before cancel");
        armBackstop(`${ms} ms cancellation`, ms);
        send({ command: "cancel" });
      },
      async operations() {
        try { return await fs.readFile(log, "utf8"); }
        catch (error) { if (error.code === "ENOENT") return ""; throw error; }
      },
      async waitEvent(name) {
        const end = performance.now() + 5000;
        while (!events.some(e => e.event === name)) {
          checkFixture();
          assert.ok(!exited && performance.now() < end, `Expected native fake event ${name} before worker exit or timeout`);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

function assertWorkerSelfKilled(result) {
  // .NET Process.Kill uses the Windows exit status 0xFFFFFFFF, not a normal
  // return from Run() or the signal reported when Node kills the child.
  assert.equal(result.signal, null);
  assert.ok(result.code === 0xFFFFFFFF || result.code === -1, `Expected worker self-kill, got exit code ${result.code}`);
  assert.ok(!result.events.some(event => event.event === "completed"));
}
test("fixed native code enumerates fake engines without selecting audio", { skip: !windows }, async () => {
  const f = await nativeFixture(); try { f.send({ command: "capabilities" }); const result = await f.exit; assert.equal(result.code, 0, result.errors); assert.equal(result.events[0].event, "capabilities"); assert.doesNotMatch(await f.operations(), /attach|recognize|speak|select/); } finally { await f.close(); }
});
test("fixed native code hard-cancels and disposes fake input/output on cancel and EOF", { skip: !windows }, async () => {
  for (const command of ["listen", "speak"]) for (const eof of [false, true]) {
    const f = await nativeFixture(); try { f.send(command === "listen" ? { command, culture: "en-US" } : { command, voiceId: "Microsoft Test Voice", text: "Plain text <speak> $(ignored)" }); await f.waitEvent("started"); if (eof) f.child.stdin.end(); else f.send({ command: "cancel" }); const result = await f.exit; const operations = await f.operations(); assert.match(operations, command === "listen" ? /cancel-fake-input\ndispose-fake-input/ : /cancel-fake-output\ndispose-fake-output/); assert.equal(result.events.filter(e => e.event === "completed").length, 0); } finally { await f.close(); }
  }
});
test("fixed native code completes once after fake disposal and rejects malformed/flooded stdin", { skip: !windows }, async () => {
  const good = await nativeFixture({ complete: true }); try { good.send({ command: "listen", culture: "en-US" }); const result = await good.exit; assert.equal(result.code, 0, result.errors); assert.equal(result.events.filter(e => e.event === "completed").length, 1); assert.match(await good.operations(), /dispose-fake-input/); } finally { await good.close(); }
  for (const kind of ["unknown", "duplicate", "long", "bad-version"]) {
    const f = await nativeFixture(); try { const raw = kind === "unknown" ? JSON.stringify({ v: 1, id: f.id, command: "capabilities", extra: true }) : kind === "duplicate" ? `{"v":1,"v":1,"id":"${f.id}","command":"capabilities"}` : kind === "bad-version" ? JSON.stringify({ v: 2, id: f.id, command: "capabilities" }) : "x".repeat(32769); f.child.stdin.write(raw + "\n"); const result = await f.exit; assert.equal(result.code, 1); assert.equal(result.events.length, 0); assert.equal(await f.operations(), ""); } finally { await f.close(); }
  }
});
test("native startup has an independent bounded watchdog even if fake enumeration blocks", { skip: !windows }, async () => {
  const f = await nativeFixture({ block: true, slowEntry: true });
  try {
    f.send({ command: "capabilities" });
    const result = await f.exit;
    assertWorkerSelfKilled(result);
    assert.deepEqual(result.events, []);
    assert.equal(await f.operations(), "block-fake-enumeration\n");
  } finally { await f.close(); }
});
test("native cancellation kills its own worker if fake disposal hangs", { skip: !windows }, async () => {
  const f = await nativeFixture({ disposeBlock: true, slowEntry: true });
  try {
    f.send({ command: "listen", culture: "en-US" });
    await f.waitEvent("started");
    f.cancelWithin(3500);
    assertWorkerSelfKilled(await f.exit);
    assert.match(await f.operations(), /cancel-fake-input\ndispose-fake-input/);
  } finally { await f.close(); }
});
