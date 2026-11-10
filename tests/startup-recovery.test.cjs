"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { defaultState } = require("../src/core/validation.cjs");
const helperFile = path.resolve(__dirname, "../src/core/startup-recovery.cjs");
const mainFile = path.resolve(__dirname, "../src/main.cjs");
const privateError = "synthetic-private-token " + "private journal text ".repeat(300);

function fixture(t, kind = "state") {
  const temp = fs.realpathSync(os.tmpdir());
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(temp, "bf-startup-")));
  fs.mkdirSync(path.join(dir, "private"));
  const files = new Map([
    ["state.json", Buffer.from(kind === "state" ? "{invalid-synthetic-state" : JSON.stringify(defaultState()))],
    ["credentials.json", Buffer.from(kind === "keys" ? "{invalid-synthetic-keys" : '{"openai":"c3ludGhldGljLXNlbnRpbmVs"}')],
    ["private/sentinel.bin", Buffer.from([0, 255, 13, 10, 27, 42])],
  ]);
  for (const [name, bytes] of files) fs.writeFileSync(path.join(dir, name), bytes);
  t.after(() => {
    const resolved = fs.realpathSync(dir);
    assert.equal(path.dirname(resolved), temp);
    assert.ok(path.basename(resolved).startsWith("bf-startup-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return {
    dir,
    unchanged() {
      for (const [name, bytes] of files)
        assert.deepEqual(fs.readFileSync(path.join(dir, name)), bytes, name + " must be preserved");
      assert.deepEqual(fs.readdirSync(dir).sort(), ["credentials.json", "private", "state.json"]);
      assert.deepEqual(fs.readdirSync(path.join(dir, "private")), ["sentinel.bin"]);
    },
  };
}

function loadHelper() {
  const helper = fs.existsSync(helperFile) ? require(helperFile).showStartupFailure : undefined;
  assert.equal(typeof helper, "function", "startup failure needs an actionable preserved-data helper");
  return helper;
}

function assertSafeDialog(options, dir) {
  assert.equal(options.type, "error");
  assert.deepEqual(Array.from(options.buttons), ["Quit", "Open data folder"]);
  assert.equal(options.defaultId, 0);
  assert.equal(options.cancelId, 0);
  assert.equal(options.noLink, true);
  assert.ok(options.detail.includes(dir), "show the exact app-owned data directory");
  assert.match(options.message, /startup|start/i);
  assert.match(options.detail, /copy.*entire.*folder/i);
  const text = JSON.stringify(options);
  assert.doesNotMatch(text, /corrupt|saved data could not be read|move the data folder/i);
  assert.doesNotMatch(text, /synthetic-private-token|private journal text|c3ludGhldGlj/);
  assert.ok(text.length < dir.length + 1500, "copy remains bounded independently of the exception");
}

for (const response of [0, undefined, -1, 2]) {
  test(`Quit/default/cancel response ${response} preserves every sentinel without opening a folder`, async (t) => {
    const f = fixture(t);
    let calls = 0;
    await loadHelper()({
      dataDir: f.dir,
      dialog: { async showMessageBox(options) { calls++; assertSafeDialog(options, f.dir); return { response }; } },
      shell: { async openPath() { assert.fail("only explicit Open may open the directory"); } },
    });
    assert.equal(calls, 1);
    f.unchanged();
  });
}

test("Open data folder uses only the injected exact directory and awaits completion", async (t) => {
  const f = fixture(t, "keys");
  let finishOpen;
  let opened;
  let settled = false;
  const pending = loadHelper()({
    dataDir: f.dir,
    dialog: { async showMessageBox(options) { assertSafeDialog(options, f.dir); return { response: 1 }; } },
    shell: { openPath(dir) { opened = dir; return new Promise((resolve) => { finishOpen = resolve; }); } },
  }).then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opened, f.dir);
  assert.equal(settled, false);
  finishOpen("");
  await pending;
  f.unchanged();
});

for (const rejects of [false, true]) {
  test(`folder open ${rejects ? "rejection" : "error string"} shows fixed safe guidance`, async (t) => {
    const f = fixture(t, "keys");
    const dialogs = [];
    await loadHelper()({
      dataDir: f.dir,
      dialog: { async showMessageBox(options) { dialogs.push(options); return { response: 1 }; } },
      shell: { async openPath(dir) { assert.equal(dir, f.dir); if (rejects) throw Error(privateError); return privateError; } },
    });
    assert.equal(dialogs.length, 2);
    assertSafeDialog(dialogs[0], f.dir);
    assert.deepEqual(dialogs[1].buttons, ["Quit"]);
    assert.equal(dialogs[1].defaultId, 0);
    assert.equal(dialogs[1].cancelId, 0);
    assert.match(dialogs[1].message, /could not open/i);
    assert.ok(dialogs[1].detail.includes(f.dir));
    assert.doesNotMatch(JSON.stringify(dialogs[1]), /synthetic-private-token|private journal text/);
    f.unchanged();
  });
}

test("native dialog rejection settles safely and leaves files intact", async (t) => {
  const f = fixture(t);
  await loadHelper()({
    dataDir: f.dir,
    dialog: { async showMessageBox() { throw Error(privateError); } },
    shell: { async openPath() { assert.fail("a failed dialog grants no Open permission"); } },
  });
  f.unchanged();
});

test("failed open followed by failed native dialog still settles safely", async (t) => {
  const f = fixture(t);
  let calls = 0;
  await loadHelper()({
    dataDir: f.dir,
    dialog: { async showMessageBox() { if (++calls === 2) throw Error(privateError); return { response: 1 }; } },
    shell: { async openPath() { throw Error(privateError); } },
  });
  assert.equal(calls, 2);
  f.unchanged();
});

// Execute the real main startup callback with only native Electron surfaces and
// one unrelated initializer injected; Store and the recovery helper remain real.
function startup(f, { kind, dialog, shell, helperThrows = false, restartThrows = false }) {
  let ready;
  let quitCount = 0;
  let helperAttempts = 0;
  let relaunchCount = 0;
  const listeners = new Map();
  const app = {
    isPackaged: true,
    getPath(name) { assert.equal(name, "userData"); return f.dir; },
    requestSingleInstanceLock() { return true; },
    on(name, fn) { listeners.set(name, fn); },
    whenReady() { return { then(fn) { ready = Promise.resolve().then(fn); return ready; } }; },
    quit() { quitCount++; listeners.get("before-quit")?.({ preventDefault() { assert.fail("startup failure must quit"); } }); },
    relaunch() { relaunchCount++; if (restartThrows) throw Error(privateError); },
  };
  const realRequire = createRequire(mainFile);
  const native = { app, dialog, shell };
  const script = new vm.Script(fs.readFileSync(mainFile, "utf8"), { filename: mainFile });
  script.runInNewContext({
    require(name) {
      if (name === "electron") return native;
      if (kind === "initializer" && name === "./core/companion-context.cjs")
        return { CompanionContext: class { constructor() { throw Error(privateError); } } };
      if (helperThrows && name === "./core/startup-recovery.cjs")
        return { async showStartupFailure() { helperAttempts++; throw Error(privateError); } };
      return realRequire(name);
    },
    __dirname: path.dirname(mainFile),
    process: { platform: process.platform, env: {} },
  });
  return { ready, quitCount: () => quitCount, helperAttempts: () => helperAttempts, relaunchCount: () => relaunchCount };
}

for (const kind of ["state", "keys", "initializer"]) {
  test(`real main startup ${kind} failure awaits recovery then quits with bytes unchanged`, async (t) => {
    const f = fixture(t, kind);
    let finishDialog;
    let options;
    let legacyError;
    const main = startup(f, {
      kind,
      dialog: {
        showMessageBox(value) { options = value; return new Promise((resolve) => { finishDialog = resolve; }); },
        showErrorBox(_title, message) { legacyError = message; },
      },
      shell: { async openPath() { assert.fail("Quit must not open a folder"); } },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(legacyError, undefined, "a broad startup catch must not diagnose saved-data failure");
    assertSafeDialog(options, f.dir);
    assert.equal(main.quitCount(), 0, "do not quit before the recovery choice settles");
    finishDialog({ response: 0 });
    await main.ready;
    assert.equal(main.quitCount(), 1);
    f.unchanged();
  });
}

for (const helperThrows of [false, true]) {
  test(`real main quits even when ${helperThrows ? "recovery helper" : "native dialog"} rejects`, async (t) => {
    const f = fixture(t);
    const main = startup(f, {
      kind: "state", helperThrows,
      dialog: { async showMessageBox() { throw Error(privateError); }, showErrorBox() {} },
      shell: { async openPath() { assert.fail("rejected dialog must not open"); } },
    });
    await main.ready;
    assert.equal(main.quitCount(), 1);
    if (helperThrows) assert.equal(main.helperAttempts(), 1);
    f.unchanged();
  });
}
test("later unrelated initializer failure with NONEMPTY valid journal never creates recovery files", async t => {
  const f = fixture(t, "initializer");
  const state = { ...defaultState(), onboarded: true, profiles: [{ id: "p", name: "Synthetic", realm: "Fixture", className: "Mage", level: 10, notes: "private", goals: [] }] };
  const file = path.join(f.dir, "state.json"), bytes = Buffer.from(JSON.stringify(state)); fs.writeFileSync(file, bytes);
  const entries = fs.readdirSync(f.dir); const main = startup(f, { kind: "initializer", dialog: { async showMessageBox(options) { assertSafeDialog(options, f.dir); return { response: 0 }; } }, shell: {} });
  await main.ready; assert.equal(main.quitCount(), 1); assert.deepEqual(fs.readFileSync(file), bytes); assert.deepEqual(fs.readdirSync(f.dir), entries);
});

test("journal fault alone offers explicit restore/restart and retains exact damaged bytes", async t => {
  const f = fixture(t), { RecoveryCheckpoints } = require("../src/core/recovery-checkpoints.cjs"), { StoreStartupError } = require("../src/core/store.cjs");
  assert.equal(typeof StoreStartupError, "function"); const manager = new RecoveryCheckpoints(f.dir);
  manager.create(defaultState(), "manual"); const original = fs.readFileSync(path.join(f.dir, "state.json")); let restarted = 0, offered;
  fs.writeFileSync(path.join(f.dir, "game-connection.private.json"), '{"root":"synthetic"}');
  await loadHelper()({ dataDir: f.dir, error: new StoreStartupError("journal"), recovery: manager, restart: () => { restarted++; }, shell: {}, dialog: { async showMessageBox(options) { offered = options; return { response: 2 }; } } });
  assert.equal(restarted, 1); assert.deepEqual(offered.buttons, ["Quit", "Open data folder", "Restore and restart"]); assert.equal(offered.defaultId, 0); assert.match(offered.detail, /damaged.*memory/i);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, "recovery", "damaged-original.bin")), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, "state.json"))).memories, []);
  assert.equal(fs.readFileSync(path.join(f.dir, "credentials.json"), "utf8"), '{"openai":"c3ludGhldGljLXNlbnRpbmVs"}');
  assert.equal(fs.existsSync(path.join(f.dir, "game-connection.private.json")), false);
  manager.clear(); assert.equal(fs.existsSync(path.join(f.dir, "recovery", "damaged-original.bin")), false);
});
for (const kind of ["credentials", "unrelated"]) test(`valid point does not authorize startup restore for ${kind}`, async t => {
  const f = fixture(t), { RecoveryCheckpoints } = require("../src/core/recovery-checkpoints.cjs"), { StoreStartupError } = require("../src/core/store.cjs");
  new RecoveryCheckpoints(f.dir).create(defaultState(), "manual");
  await loadHelper()({ dataDir: f.dir, error: kind === "unrelated" ? Error("private") : new StoreStartupError(kind), restart: () => assert.fail(), shell: {}, dialog: { async showMessageBox(options) { assertSafeDialog(options, f.dir); return { response: 2 }; } } });
  assert.equal(fs.readFileSync(path.join(f.dir, "state.json"), "utf8"), "{invalid-synthetic-state");
});
for (const mutation of ["point", "journal", "preservation", "restart"]) test(`startup ${mutation} failure preserves original and gives fixed safe guidance`, async t => {
  const f = fixture(t), { RecoveryCheckpoints } = require("../src/core/recovery-checkpoints.cjs"), { StoreStartupError } = require("../src/core/store.cjs");
  const manager = new RecoveryCheckpoints(f.dir), point = manager.create(defaultState(), "manual"), dialogs = [];
  await loadHelper()({ dataDir: f.dir, error: new StoreStartupError("journal"), recovery: manager, restart: () => { if (mutation === "restart") throw Error(privateError); assert.fail(); }, shell: {}, dialog: { async showMessageBox(options) {
    dialogs.push(options); if (dialogs.length === 1) {
      if (mutation === "point") fs.writeFileSync(path.join(f.dir, "recovery", point.id + ".json"), "bad");
      if (mutation === "journal") fs.writeFileSync(path.join(f.dir, "state.json"), "changed journal");
      if (mutation === "preservation") fs.mkdirSync(path.join(f.dir, "recovery", "damaged-original.bin"));
    } return { response: 2 };
  } } });
  assert.equal(dialogs.length, 2); assert.doesNotMatch(JSON.stringify(dialogs), /synthetic-private-token/);
  if (mutation === "restart") { assert.match(dialogs[1].message, /restart.*manually/i); assert.equal(fs.readFileSync(path.join(f.dir, "recovery", "damaged-original.bin"), "utf8"), "{invalid-synthetic-state"); }
  else assert.equal(fs.readFileSync(path.join(f.dir, "state.json"), "utf8"), mutation === "journal" ? "changed journal" : "{invalid-synthetic-state");
});
for (const restartThrows of [false, true]) test(`real main startup restore ${restartThrows ? "failed" : "successful"} relaunch always quits`, async t => {
  const f = fixture(t), { RecoveryCheckpoints } = require("../src/core/recovery-checkpoints.cjs"); new RecoveryCheckpoints(f.dir).create(defaultState(), "manual"); const dialogs = [];
  const main = startup(f, { kind: "state", restartThrows, dialog: { async showMessageBox(options) { dialogs.push(options); return { response: 2 }; } }, shell: {} });
  await main.ready; assert.equal(main.relaunchCount(), 1); assert.equal(main.quitCount(), 1); assert.equal(dialogs.length, restartThrows ? 2 : 1);
  assert.equal(fs.readFileSync(path.join(f.dir, "recovery", "damaged-original.bin"), "utf8"), "{invalid-synthetic-state");
});
test("real Windows replacement lock retains exact damaged bytes and preserved original after failed startup restore", { skip: process.platform !== "win32" }, async t => {
  const f = fixture(t), { RecoveryCheckpoints } = require("../src/core/recovery-checkpoints.cjs"), { spawn } = require("node:child_process");
  const manager = new RecoveryCheckpoints(f.dir), p = manager.create(defaultState(), "manual"), token = manager.prepareStartupRestore(p.id);
  const script = '$a=[System.IO.File]::Open($env:BF_LOCK_JOURNAL,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); [Console]::WriteLine("LOCKED"); [Console]::ReadLine() | Out-Null; $a.Dispose()';
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, BF_LOCK_JOURNAL: path.join(f.dir, "state.json") } });
  try {
    await new Promise((resolve, reject) => { child.stdout.once("data", data => data.toString().includes("LOCKED") ? resolve() : reject(Error("Lock helper failed"))); child.once("error", reject); child.once("exit", code => reject(Error("Lock helper exited " + code))); });
    assert.throws(() => manager.restoreDamaged(token)); assert.equal(fs.readFileSync(path.join(f.dir, "state.json"), "utf8"), "{invalid-synthetic-state"); assert.equal(fs.readFileSync(path.join(f.dir, "recovery", "damaged-original.bin"), "utf8"), "{invalid-synthetic-state");
  } finally { child.stdin.end("release\n"); await new Promise(resolve => child.once("exit", resolve)); }
});
