"use strict";
// Isolated real Electron/main/preload/renderer with synthetic journals only.
const { _electron: electron } = require("playwright"), fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { defaultState } = require("../src/core/validation.cjs"), { testWindow } = require("./test-window.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-recovery-ui-")), evidence = path.resolve("work/recovery-ui"); let app, checks = 0;
  const check = async (name, fn) => { await fn(); console.log("PASS " + name); checks++; };
  const watchdog = setTimeout(() => { console.error("Recovery fixture exceeded 180 seconds"); app?.process().kill(); process.exitCode = 1; }, 180000);
  try {
    await fs.mkdir(evidence, { recursive: true }); await fs.mkdir(path.join(dir, "knowledge-v1")); await fs.writeFile(path.join(dir, "knowledge-v1/preferences.json"), JSON.stringify({ automatic: false, checked: {} }));
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, activeProfileId: "p", profiles: [{ id: "p", name: "Synthetic Mage", realm: "Fixture", className: "Mage", level: 10, notes: "ORIGINAL_PRIVATE_NOTES", goals: [] }], memories: [{ profileId: "p", exchanges: [{ id: "820e520e-e64b-4c71-93d1-36c2ade326fd", createdAt: new Date().toISOString(), question: "PRIVATE_MEMORY", answer: "PRIVATE_ANSWER" }] }] }));
    const credentials = '{"openai":"c3ludGhldGlj"}'; await fs.writeFile(path.join(dir, "credentials.json"), credentials);
    app = await electron.launch({ args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app); page.setDefaultTimeout(6000);
    await app.evaluate(({ app, ipcMain, dialog }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      globalThis.recoveryFixture = { response: 1, dialogs: [], holds: {}, completed: {} };
      load("./src/core/claude.cjs").clearCredentials = async () => {};
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", launchAvailable: false });
      load("./src/core/voice.cjs").VoiceService.prototype.capabilities = async () => ({ available: false, recognizers: [], voices: [] });
      const GameSync = load("./src/core/game-sync.cjs").GameSync, gameStatus = GameSync.prototype.status;
      GameSync.prototype.status = function () { recoveryFixture.game = this; return gameStatus.call(this); };
      const Recovery = load("./src/core/recovery-checkpoints.cjs"), createPoint = Recovery.RecoveryCheckpoints.prototype.create;
      Recovery.RecoveryCheckpoints.prototype.create = function (...args) { const limit = this.maxPointBytes; if (recoveryFixture.limit) this.maxPointBytes = 64; try { return createPoint.apply(this, args); } finally { this.maxPointBytes = limit; } };
      dialog.showMessageBox = async (_win, options) => { recoveryFixture.dialogs.push(options); if (recoveryFixture.holdDialog && options.title === "Restore this recovery point?") await new Promise(r => recoveryFixture.releaseDialog = r); return { response: recoveryFixture.response }; };
      for (const name of ["recoveryList", "checkpointNow", "previewCheckpoint", "restoreCheckpoint", "adventureBrief", "gameStatus"]) {
        const original = ipcMain._invokeHandlers.get("backstage:" + name); if (!original) continue;
        ipcMain.removeHandler("backstage:" + name); ipcMain.handle("backstage:" + name, async (...args) => { if (recoveryFixture.postCommit && recoveryFixture.failRead === name) { recoveryFixture.failedRead = true; throw Error("PRIVATE_POST_COMMIT_DETAIL"); } if (recoveryFixture.holds[name]) await new Promise(r => recoveryFixture.release = r); const result = await original(...args); if (name === "restoreCheckpoint" && result) recoveryFixture.postCommit = true; recoveryFixture.completed[name] = (recoveryFixture.completed[name] || 0) + 1; return result; });
      }
    });
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "manual")); await page.reload();
    await page.getByRole("button", { name: "Field Guide", exact: true }).click();
    const create = () => page.getByRole("button", { name: "Create point now", exact: true }), preview = () => page.getByRole("button", { name: "Preview selected point", exact: true }), restore = () => page.getByRole("button", { name: "Restore selected point", exact: true });
    const mainWait = name => app.evaluate(async (_e, name) => { const end = Date.now() + 5000; while (!recoveryFixture[name]) { if (Date.now() > end) throw Error("Fixture did not begin " + name); await new Promise(r => setTimeout(r, 10)); } }, name);
    let selected;
    await check("startup automatically protects a valid journal and recovery is discoverable in Guide", async () => {
      assert.equal(await page.evaluate(() => typeof window.backstage.recoveryList), "function");
      await page.getByRole("region", { name: "Automatic local protection", exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector("[data-recovery-select]")?.options.length === 1);
      const result = await page.evaluate(() => window.backstage.recoveryList()); assert.equal(result.status.automatic, true); assert.equal(result.status.count, 1); selected = result.points[0];
      assert.equal(selected.profileCount, 1); assert.equal(selected.reason, "startup");
      assert.doesNotMatch(await fs.readFile(path.join(dir, "recovery", selected.id + ".json"), "utf8"), /PRIVATE_MEMORY|PRIVATE_ANSWER|memories|c3lud/);
    });
    await check("strict preload arity rejects extra arguments and arbitrary paths", async () => {
      await assert.rejects(() => page.evaluate(() => window.backstage.recoveryList("extra")), /invalid/);
      await assert.rejects(() => page.evaluate(() => window.backstage.previewCheckpoint("../state")), /invalid/);
    });
    await check("held Enter retains controls, focus and nearby Support while result arrives", async () => {
      await app.evaluate(() => { recoveryFixture.holds.checkpointNow = true; recoveryFixture.release = null; });
      await create().focus(); await page.evaluate(() => { window.originalRecoveryButton = document.querySelector("[data-recovery-create]"); window.originalSupport = document.querySelector("[data-support-prepare]"); });
      await page.keyboard.down("Enter"); await mainWait("release"); await app.evaluate(() => { recoveryFixture.holds.checkpointNow = false; recoveryFixture.release(); });
      await page.waitForTimeout(100); assert.equal(await page.evaluate(() => originalRecoveryButton === document.activeElement && originalRecoveryButton === document.querySelector("[data-recovery-create]") && originalSupport === document.querySelector("[data-support-prepare]")), true);
      await page.keyboard.up("Enter"); await page.getByText("Recovery point saved locally.", { exact: true }).waitFor();
    });
    await check("native cancel preserves state and explicit restore clears memory but retains credentials", async () => {
      await page.evaluate(async () => { const b = await window.backstage.bootstrap(); b.state.profiles[0].notes = "LATEST_PRIVATE_NOTES"; await window.backstage.saveState(b.state); });
      await preview().click(); await restore().waitFor({ state: "visible" }); await page.waitForFunction(() => !document.querySelector("[data-recovery-restore]").disabled);
      await app.evaluate(() => recoveryFixture.response = 0); await restore().click(); await page.getByText("Restore cancelled. Your journal is unchanged.", { exact: true }).waitFor();
      assert.match(await fs.readFile(path.join(dir, "state.json"), "utf8"), /LATEST_PRIVATE_NOTES/);
      await app.evaluate(() => recoveryFixture.response = 1); await restore().click(); await page.getByText("Journal restored. Game observation is disconnected; existing API keys are preserved.", { exact: true }).waitFor();
      const data = JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8")); assert.equal(data.profiles[0].notes, "ORIGINAL_PRIVATE_NOTES"); assert.deepEqual(data.memories, []); assert.equal(await fs.readFile(path.join(dir, "credentials.json"), "utf8"), credentials);
      assert.equal((await page.evaluate(() => window.backstage.gameStatus())).connected, false);
    });
    await check("committed restore truthfully survives history, brief and source-status failures with display-only retry", async () => {
      for (const failure of ["recoveryList", "adventureBrief", "gameStatus"]) {
        await page.evaluate(async () => { const b = await window.backstage.bootstrap(); b.state.profiles[0].notes = "POST_COMMIT_LATEST"; b.state.memories = [{profileId:"p",exchanges:[{id:"820e520e-e64b-4c71-93d1-36c2ade326fd",createdAt:new Date().toISOString(),question:"POST_COMMIT_PRIVATE_MEMORY",answer:"POST_COMMIT_PRIVATE_ANSWER"}]}]; await window.backstage.saveState(b.state); });
        await page.getByRole("button", { name: "Refresh recovery history", exact: true }).click();
        await page.waitForFunction(() => !document.querySelector("[data-recovery-preview]").disabled);
        await page.locator("[data-recovery-select]").selectOption(selected.id); await preview().click();
        await page.waitForFunction(() => !document.querySelector("[data-recovery-restore]").disabled);
        const before = await app.evaluate(() => recoveryFixture.completed.restoreCheckpoint || 0);
        await app.evaluate((_e, failure) => { recoveryFixture.postCommit = false; recoveryFixture.failedRead = false; recoveryFixture.failRead = failure; }, failure);
        if (failure === "recoveryList") {
          await restore().focus();
          await page.evaluate(() => { window.heldRestore = document.querySelector("[data-recovery-restore]"); window.heldSupport = document.querySelector("[data-support-prepare]"); });
          await page.keyboard.down("Enter"); await mainWait("failedRead"); await page.waitForTimeout(100);
          assert.equal(await page.evaluate(() => heldRestore === document.activeElement && heldRestore === document.querySelector("[data-recovery-restore]") && heldSupport === document.querySelector("[data-support-prepare]")), true, "Post-commit failure must preserve the held physical controls");
          await page.keyboard.up("Enter");
        } else await restore().click();
        await page.waitForFunction(() => /Journal restored.*unavailable/.test(document.querySelector("[data-recovery-status]").textContent));
        const text = await page.locator("[data-recovery-status]").innerText();
        assert.match(text, /Refresh recovery history/); assert.doesNotMatch(text, /not replaced|PRIVATE_POST_COMMIT_DETAIL/);
        assert.equal(await restore().isDisabled(), true, "Old preview must be retired after commit");
        const data = JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8")); assert.equal(data.profiles[0].notes, "ORIGINAL_PRIVATE_NOTES"); assert.deepEqual(data.memories, []);
        assert.equal(await fs.readFile(path.join(dir, "credentials.json"), "utf8"), credentials);
        await page.screenshot({ path: path.join(evidence, `recovery-postcommit-${failure}.png`), fullPage: true });
        await app.evaluate(() => recoveryFixture.failRead = null);
        await page.getByRole("button", { name: "Refresh recovery history", exact: true }).click();
        await page.getByText("Local recovery history is ready. Recent edits may be newer than the latest point.", { exact: true }).waitFor();
        assert.equal(await app.evaluate(() => recoveryFixture.completed.restoreCheckpoint || 0), before + 1, "Display retry must not replace journal again");
        assert.equal(await restore().isDisabled(), true); assert.equal((await page.evaluate(() => window.backstage.gameStatus())).connected, false);
        assert.equal((await page.evaluate(() => window.backstage.bootstrap())).state.activeProfileId, "p");
      }
    });
    if (process.argv.includes("--postcommit-only")) { console.log(`${checks} focused recovery checks passed; screenshots: ${evidence}`); return; }
    await check("native restore held across navigation cannot replace the journal", async () => {
      const p = await page.evaluate(async () => { const list = await window.backstage.recoveryList(); return window.backstage.previewCheckpoint(list.points[0].id); });
      await app.evaluate(() => { recoveryFixture.holdDialog = true; recoveryFixture.releaseDialog = null; });
      const pending = page.evaluate(p => window.backstage.restoreCheckpoint({ id: p.id, sha256: p.sha256 }).catch(e => e.message), p); await mainWait("releaseDialog");
      await page.getByRole("button", { name: "Adventure", exact: true }).click(); await app.evaluate(() => { recoveryFixture.holdDialog = false; recoveryFixture.releaseDialog(); }); assert.match(await pending, /Preview/);
      await page.getByRole("button", { name: "Field Guide", exact: true }).click();
    });
    await check("empty-memory Clear is reachable and purges damaged originals; failure stays visible", async () => {
      const original = path.join(dir, "recovery", "damaged-original.bin"), alias = path.join(dir, "memory-original-hardlink");
      await fs.writeFile(original, "PRIVATE_HIDDEN_MEMORY");
      await page.getByRole("button", { name: "AI Companion", exact: true }).click();
      const clear = page.getByRole("button", { name: "Clear this character’s memory", exact: true }); await clear.waitFor(); assert.equal(await clear.isEnabled(), true);
      await fs.link(original, alias); const before = await fs.readFile(path.join(dir, "state.json"));
      await page.evaluate(() => { window.confirm = message => { window.memoryClearConfirmation = message; return true; }; }); await clear.click(); await page.locator("[data-memory] [role='alert']").waitFor();
      assert.match(await page.locator("[data-memory] [role='alert']").innerText(), /Recovery/); assert.equal(await fs.readFile(original, "utf8"), "PRIVATE_HIDDEN_MEMORY"); assert.deepEqual(await fs.readFile(path.join(dir, "state.json")), before);
      await fs.unlink(alias); await page.evaluate(() => { window.confirm = message => { window.memoryClearConfirmation = message; return true; }; }); await clear.click();
      await page.waitForFunction(() => !document.querySelector("[data-memory-clear]")?.disabled && !document.querySelector("[data-memory] [role='alert']")); await assert.rejects(() => fs.stat(original), { code: "ENOENT" });
      await page.getByRole("button", { name: "Field Guide", exact: true }).click();
    });
    await check("full and compact layouts show bounded dated options and keep keyboard controls usable", async () => {
      for (const [name, width, height] of [["full", 1440, 960], ["compact", 984, 635]]) {
        await app.evaluate(({ BrowserWindow }, size) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(0, 0); w.setContentSize(...size); }, [width, height]);
        await create().scrollIntoViewIfNeeded(); await create().focus(); await page.keyboard.press("Tab");
        const metrics = await page.locator("[data-recovery]").evaluate(n => ({ width: innerWidth, overflow: document.documentElement.scrollWidth, buttons: [...n.querySelectorAll("button")].map(b => { const r = b.getBoundingClientRect(); return { x: r.x, right: r.right }; }) })); assert.ok(metrics.overflow <= width); for (const b of metrics.buttons) assert.ok(b.x >= 0 && b.right <= width);
        assert.ok(await page.locator("[data-recovery]").evaluate(n => n.getBoundingClientRect().width > document.querySelector(".content").getBoundingClientRect().width * .8), "recovery must use the guide width, not a narrow half column");
        await page.screenshot({ path: path.join(evidence, `recovery-${name}.png`), fullPage: true }); await page.screenshot({ path: path.join(evidence, `recovery-${name}-viewport.png`) });
      }
    });
    await check("real synthetic source refresh is retired by restore and stale ordinary saves cannot reattach source", async () => {
      const gameRoot = path.join(dir, "synthetic-game"); await fs.mkdir(path.join(gameRoot, "WTF"), { recursive: true }); await fs.writeFile(path.join(gameRoot, ".flavor.info"), "wowf");
      const account = path.join(gameRoot, "WTF", "Account", "Synthetic", "SavedVariables", "BackstageForever.lua"); await fs.mkdir(path.dirname(account), { recursive: true });
      const saved = level => "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, observedAt: 1794225600 + level, activeId: "source-p", characters: [{ id: "source-p", name: "Synthetic Mage", realm: "Fixture", className: "Mage", level, updatedAt: 1794225600 + level, captureVersion: require("../package.json").version }] }));
      await fs.writeFile(account, saved(20)); const observed = await page.evaluate(root => window.backstage.connectGame(root), gameRoot); assert.equal(observed.gameStatus.connected, true); assert.ok(observed.state.profiles.some(p => p.source));
      await fs.writeFile(account, saved(21));
      await app.evaluate((_e, file) => {
        const fsp = process.getBuiltinModule("node:fs/promises"), original = fsp.open;
        recoveryFixture.originalOpen = original;
        fsp.open = async function (name, ...args) { if (String(name) === file) await new Promise(r => recoveryFixture.releaseSource = r); return original.call(this, name, ...args); };
      }, account);
      const refresh = page.evaluate(() => window.backstage.refreshGame()); await mainWait("releaseSource");
      const restored = await page.evaluate(async id => { const p = await window.backstage.previewCheckpoint(id); return window.backstage.restoreCheckpoint({ id: p.id, sha256: p.sha256 }); }, selected.id);
      assert.equal(restored.profiles[0].source, undefined);
      await app.evaluate(() => { process.getBuiltinModule("node:fs/promises").open = recoveryFixture.originalOpen; recoveryFixture.releaseSource(); }); await refresh;
      assert.equal((await page.evaluate(() => window.backstage.gameStatus())).connected, false);
      await assert.rejects(() => page.evaluate(state => window.backstage.saveState(state, state), observed.state));
      const final = (await page.evaluate(() => window.backstage.bootstrap())).state; assert.equal(final.profiles.length, 1); assert.equal(final.profiles[0].source, undefined); assert.equal(final.profiles[0].level, 10);
      await page.reload(); await page.getByRole("button", { name: "Field Guide", exact: true }).click();
    });
    await check("size failure is visible, ordinary journal saves succeed and manual retry recovers", async () => {
      await app.evaluate(() => recoveryFixture.limit = true);
      await page.evaluate(async () => { const b = await window.backstage.bootstrap(); b.state.profiles[0].notes = "LIMIT_PRIVATE_NOTES"; await window.backstage.saveState(b.state); });
      await create().click(); await page.getByText("Recovery limit reached. No journal content was trimmed. A point must fit within 64 MiB.", { exact: true }).waitFor();
      assert.match(await fs.readFile(path.join(dir, "state.json"), "utf8"), /LIMIT_PRIVATE_NOTES/);
      await app.evaluate(() => recoveryFixture.limit = false); await create().click(); await page.getByText("Recovery point saved locally.", { exact: true }).waitFor();
    });
    await check("late history reply cannot overwrite navigation or reactivate obsolete preview", async () => {
      await app.evaluate(() => { recoveryFixture.holds.recoveryList = true; recoveryFixture.release = null; }); await page.getByRole("button", { name: "Refresh recovery history", exact: true }).click(); await mainWait("release");
      await page.getByRole("button", { name: "Adventure", exact: true }).click(); await app.evaluate(() => { recoveryFixture.holds.recoveryList = false; recoveryFixture.release(); });
      assert.equal(await page.locator("[data-recovery]").count(), 0); await page.getByRole("button", { name: "Field Guide", exact: true }).click(); await page.waitForFunction(() => !document.querySelector("[data-recovery-create]").disabled); assert.equal(await restore().isDisabled(), true);
    });
    await check("real unavailable storage shows fixed retry guidance and restored storage recovers", async () => {
      const owned = path.join(dir, "recovery"), held = path.join(dir, "recovery-held"); assert.equal(path.dirname(owned), dir); assert.equal(path.dirname(held), dir);
      await fs.rename(owned, held); await fs.writeFile(owned, "blocked storage");
      await page.getByRole("button", { name: "Refresh recovery history", exact: true }).click(); await page.getByText("Recovery is unavailable. Your journal was not replaced. Check local storage and try again.", { exact: true }).waitFor();
      await fs.unlink(owned); await fs.rename(held, owned); await page.getByRole("button", { name: "Refresh recovery history", exact: true }).click(); await page.getByText("Local recovery history is ready. Recent edits may be newer than the latest point.", { exact: true }).waitFor();
    });
    await check("explicit character deletion clears every point and damaged original before committing", async () => {
      await fs.writeFile(path.join(dir, "recovery", "damaged-original.bin"), "PRIVATE_OLD_MEMORY");
      await page.evaluate(async () => { const b = await window.backstage.bootstrap(); await window.backstage.saveState({ ...b.state, profiles: [], activeProfileId: null }, b.state); });
      assert.equal((await page.evaluate(() => window.backstage.recoveryList())).status.count, 0); await assert.rejects(() => fs.stat(path.join(dir, "recovery", "damaged-original.bin")), { code: "ENOENT" });
      await page.reload(); await page.getByRole("button", { name: "Field Guide", exact: true }).click();
    });
    await check("history clear keeps automatic preference; future points remain deliberate when off", async () => {
      await page.locator("[data-recovery-automatic]").uncheck(); await page.waitForFunction(() => !document.querySelector("[data-recovery-automatic]").disabled);
      await page.getByRole("button", { name: "Clear recovery history", exact: true }).click(); await page.getByText("Recovery history cleared. Future protection follows your automatic choice.", { exact: true }).waitFor();
      const result = await page.evaluate(() => window.backstage.recoveryList()); assert.equal(result.points.length, 0); assert.equal(result.status.automatic, false);
      await create().click(); await page.getByText("Recovery point saved locally.", { exact: true }).waitFor(); assert.equal((await page.evaluate(() => window.backstage.recoveryList())).status.count, 1);
    });
    await check("reset purges recovery and preference without recapturing, and preserves unrelated files", async () => {
      await fs.writeFile(path.join(dir, "recovery", "sentinel.txt"), "keep"); await fs.writeFile(path.join(dir, "recovery", "damaged-original.bin"), "PRIVATE_DAMAGED_MEMORY");
      const p = await page.evaluate(async () => { const list = await window.backstage.recoveryList(); return window.backstage.previewCheckpoint(list.points[0].id); });
      await app.evaluate(() => { recoveryFixture.holdDialog = true; recoveryFixture.releaseDialog = null; }); const pending = page.evaluate(p => window.backstage.restoreCheckpoint({ id: p.id, sha256: p.sha256 }).catch(e => e.message), p); await mainWait("releaseDialog");
      await page.getByRole("button", { name: "Delete all local data", exact: true }).click(); await page.getByRole("button", { name: "Plan without a character", exact: true }).waitFor();
      await app.evaluate(() => { recoveryFixture.holdDialog = false; recoveryFixture.releaseDialog(); }); assert.match(await pending, /Preview/);
      assert.deepEqual(await fs.readdir(path.join(dir, "recovery")), ["sentinel.txt"]); await assert.rejects(() => fs.stat(path.join(dir, "recovery-preferences.json")), { code: "ENOENT" });
    });
    console.log(`${checks} recovery checks passed; screenshots: ${evidence}`);
  } catch (error) { console.error(error); if (app) await (await app.firstWindow()).screenshot({ path: path.join(evidence, "recovery-failure.png"), fullPage: true }).catch(() => {}); process.exitCode = 1; }
  finally { clearTimeout(watchdog); await app?.close(); assert.ok(path.basename(dir).startsWith("bf-recovery-ui-")); assert.equal(path.dirname(await fs.realpath(dir)), await fs.realpath(os.tmpdir())); await fs.rm(dir, { recursive: true, force: true }); }
})();
