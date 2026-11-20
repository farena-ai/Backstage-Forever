"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { launch, testWindow } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

const candidate = path.join(__dirname, "..");
const releaseSha = "30fc20f644ba98de3b8e42a1cd0f5d76962719f0";
const profile = { id: "rollback-same-id", name: "Rollback witness", realm: "Fixture", className: "Mage", faction: "Alliance", level: 14, notes: "Private fixture", goals: [] };
const legacy = Buffer.from(JSON.stringify({
  revision: 1, requests: [{ id: "386487ad-f0a0-4c55-9408-f26338418a96", item: "Retired private request", quantity: 20 }],
  commitments: [], capabilities: [], history: [{ type: "request", at: "2026-11-20T00:00:00.000Z", before: null,
    after: { id: "386487ad-f0a0-4c55-9408-f26338418a96", item: "Retired private request", quantity: 20 }, reason: null }],
}));

async function scenario(mode, release) {
  const scratch = await fs.mkdtemp(path.join(process.env.BF_SMOKE_TMPDIR || os.tmpdir(), "bf-supply-reset-"));
  const dir = path.join(scratch, "profile"), journal = path.join(dir, "state.json"), backup = path.join(scratch, "backup.json");
  const file = path.join(dir, "supply-desk.json"), stage = `${file}.386487ad-f0a0-4c55-9408-f26338418a96.tmp`;
  const other = `${file}.other.tmp`, credentials = path.join(dir, "credentials.json"), guild = path.join(dir, "guild-runs.json");
  let app, page;
  const ipc = (name, ...args) => page.evaluate(([name, args]) => window.backstage[name](...args), [name, args]);
  async function close() { await app.close(); app = null; }
  async function open(root) {
    app = await launch(electron, { args: [root], timeout: 22000, env: { ...process.env, BF_TEST_INACTIVE: "1", BF_USER_DATA: dir } });
    await app.evaluate(({ app, dialog }, backup) => {
      const fs = process.getBuiltinModule("node:fs"), path = process.getBuiltinModule("node:path");
      const load = process.getBuiltinModule("node:module").createRequire(path.join(app.getAppPath(), "package.json"));
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", checkedAt: null, launchAvailable: false });
      load("./src/core/claude.cjs").status = async () => ({ installed: false, loggedIn: false });
      globalThis.supplyResetFixture = { confirm: false, denyRemoval: null, denyPromotion: null, attempts: 0 };
      const f = supplyResetFixture, rm = fs.rmSync, rename = fs.renameSync;
      const denied = () => Object.assign(new Error("Fixture I/O denial"), { code: "EPERM" });
      fs.rmSync = (file, ...args) => {
        if (file === f.denyRemoval) { f.attempts++; throw denied(); }
        return rm(file, ...args);
      };
      fs.renameSync = (from, to) => {
        if (to === f.denyPromotion) { f.attempts++; throw denied(); }
        return rename(from, to);
      };
      dialog.showMessageBox = async (_window, options) => ({ response: options.title === "Replace saved profiles?" || (options.title === "Delete all local data?" && f.confirm) ? 1 : 0 });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
    }, backup);
    page = await testWindow(app);
    await page.waitForFunction(() => typeof window.backstage?.resetData === "function");
  }
  const configure = opts => app.evaluate((_, opts) => Object.assign(supplyResetFixture, opts), opts);
  const attempts = () => app.evaluate(() => supplyResetFixture.attempts);
  const read = () => ipc("supplyDesk", "read");
  const change = ({ token, revision }) => ipc("supplyDesk", "change", { token, revision, edit: { type: "request", item: "Live session request", quantity: 3 } });
  const absent = file => assert.rejects(fs.stat(file), { code: "ENOENT" });
  const assertEmpty = async () => {
    const { token, ...desk } = await read();
    assert.deepEqual(desk, { revision: 0, requests: [], commitments: [], capabilities: [], history: [] });
    assert.deepEqual(await ipc("supplyDesk", "reference"), { requests: [] });
    return token;
  };
  try {
    await fs.mkdir(dir);
    await fs.writeFile(journal, JSON.stringify(validateState({ ...defaultState(), onboarded: true, profiles: [profile], activeProfileId: profile.id, followGameCharacter: false })));
    await fs.writeFile(other, "unrelated bytes");
    if (mode === "rollback") {
      await fs.writeFile(file, legacy);
      await fs.writeFile(stage, legacy);
      await open(release);
      await ipc("exportData");
      const exported = await fs.readFile(backup);
      await configure({ confirm: true });
      assert.deepEqual((await ipc("resetData")).profiles, []);
      assert.equal((await ipc("importData")).activeProfileId, profile.id);
      const sameIdentity = JSON.parse(await fs.readFile(journal, "utf8"));
      assert.equal(sameIdentity.activeProfileId, profile.id);
      assert.equal(sameIdentity.profiles[0].notes, profile.notes);
      await close();
      assert.deepEqual(await fs.readFile(file), legacy);
      assert.deepEqual(await fs.readFile(stage), legacy);
      await open(candidate);
      await assertEmpty();
      await configure({ confirm: true });
      assert.deepEqual((await ipc("resetData")).profiles, []);
      await absent(file);
      await absent(stage);
      assert.deepEqual(await fs.readFile(backup), exported);
    } else {
      await fs.writeFile(credentials, '{"openai":"c3ludGhldGlj"}');
      await open(candidate);
      const fresh = await read();
      const live = await change(fresh);
      const run = await ipc("guildRun", "preview", { base: null, draft: {
        title: "Authored rollback witness", destination: "Deadmines", meetingPoint: "Entrance", local: "2026-11-22T18:00",
        timeZone: "UTC", offset: "+00:00", duties: [{ role: "all", text: "Be at the entrance" }], prep: ["Bring water"],
      } });
      await ipc("guildRun", "save", run.token);
      const authored = await fs.readFile(guild);
      assert.match(authored.toString(), /Authored rollback witness/);
      // Recreate two leftovers from the superseded writer, independent of the live desk.
      await fs.writeFile(file, legacy);
      await fs.writeFile(stage, legacy);
      const prior = await fs.readFile(journal);
      assert.equal(await ipc("resetData"), null);
      assert.deepEqual(await fs.readFile(journal), prior);
      assert.deepEqual(await fs.readFile(file), legacy);
      assert.deepEqual(await fs.readFile(stage), legacy);
      if (mode === "guild-lock") {
        await configure({ confirm: true, denyRemoval: guild });
        await assert.rejects(ipc("resetData"));
        assert.equal(await attempts(), 1);
        assert.deepEqual(await fs.readFile(guild), authored);
        assert.deepEqual(await fs.readFile(journal), prior);
        assert.deepEqual(await fs.readFile(file), legacy);
        assert.deepEqual(await fs.readFile(stage), legacy);
        assert.deepEqual(await read(), live);
        await configure({ denyRemoval: null });
      } else if (mode === "promotion") {
        await configure({ confirm: true, denyPromotion: journal });
        await assert.rejects(ipc("resetData"));
        assert.equal(await attempts(), 1);
        assert.deepEqual(await fs.readFile(journal), prior);
        assert.deepEqual(await fs.readFile(file), legacy);
        assert.deepEqual(await fs.readFile(stage), legacy);
        assert.deepEqual(await read(), live);
        assert.ok(!(await fs.readdir(dir)).some(name => name.startsWith("state.json.") && name.endsWith(".tmp")));
        await configure({ denyPromotion: null });
      } else {
        const locked = mode === "stage-lock" ? stage : file;
        const unlocked = locked === file ? stage : file;
        await configure({ confirm: true, denyRemoval: locked });
        const result = await ipc("resetData").catch(async error => {
          // A rejected reset must not have lost the authored run (the old ordering did).
          assert.deepEqual(await fs.readFile(guild).catch(() => null), authored, "Rejected reset deleted the Guild Run Pack store");
          throw error;
        });
        assert.deepEqual(result.profiles, []);
        assert.equal(await attempts(), 1);
        await absent(guild);
        assert.deepEqual(JSON.parse(await fs.readFile(journal, "utf8")).profiles, []);
        assert.equal(await fs.readFile(credentials, "utf8"), "{}");
        assert.deepEqual(await fs.readFile(locked), legacy);
        await absent(unlocked);
        assert.notEqual(await assertEmpty(), fresh.token);
        await assert.rejects(change(fresh), /no longer current/);
        await close();
        await open(candidate);
        await assertEmpty();
        assert.deepEqual(await fs.readFile(locked), legacy);
        await configure({ confirm: true });
      }
      assert.deepEqual((await ipc("resetData")).profiles, []);
      await absent(file);
      await absent(stage);
      assert.notEqual(await assertEmpty(), fresh.token);
      await assert.rejects(change(fresh), /no longer current/);
    }
    assert.equal(await fs.readFile(other, "utf8"), "unrelated bytes");
    console.log(`Supply Desk ${mode} Electron smoke passed.`);
  } finally { await app?.close(); await fs.rm(scratch, { recursive: true, force: true }); }
}

(async () => {
  const [mode, checkout] = process.argv.slice(2);
  if (mode === "rollback") {
    assert.ok(checkout, "Pass a clean checkout of v1.15.0");
    const release = path.resolve(checkout);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: release, encoding: "utf8" }).trim(), releaseSha);
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: release, encoding: "utf8" }).trim(), "");
    await scenario(mode, release);
  } else {
    const modes = ["canonical-lock", "stage-lock", "promotion", "guild-lock"];
    assert.ok(!mode || modes.includes(mode), `Expected ${modes.join(", ")}, or rollback <checkout>`);
    for (const test of mode ? [mode] : modes) await scenario(test);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
