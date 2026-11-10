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
function startup(f, { kind, dialog, shell, helperThrows = false }) {
  let ready;
  let quitCount = 0;
  let helperAttempts = 0;
  const listeners = new Map();
  const app = {
    isPackaged: true,
    getPath(name) { assert.equal(name, "userData"); return f.dir; },
    requestSingleInstanceLock() { return true; },
    on(name, fn) { listeners.set(name, fn); },
    whenReady() { return { then(fn) { ready = Promise.resolve().then(fn); return ready; } }; },
    quit() { quitCount++; listeners.get("before-quit")?.({ preventDefault() { assert.fail("startup failure must quit"); } }); },
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
  return { ready, quitCount: () => quitCount, helperAttempts: () => helperAttempts };
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
