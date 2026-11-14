"use strict";
const { navigate } = require("./player-navigation.cjs");
// Actual isolated Electron/main/preload/renderer; only synthetic local data and native surfaces.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { build: referenceBuild, counts: referenceCounts } = require("../data/forever/pack.json");
const { defaultState } = require("../src/core/validation.cjs"), { testWindow } = require("./test-window.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-support-")), evidence = path.resolve("work/support-ui",new Date().toISOString().replace(/[:.]/g,"-")); let app, checks = 0;
  const latePath = path.join(dir, "..", path.basename(dir) + "-late.txt");
  const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
  const watchdog = setTimeout(() => { console.error("Support fixture exceeded 120 seconds"); app?.process().kill(); process.exitCode = 1; }, 120000);
  try {
    await fs.mkdir(evidence, { recursive: true }); await fs.mkdir(path.join(dir, "knowledge-v1"));
    await fs.writeFile(path.join(dir, "knowledge-v1/preferences.json"), JSON.stringify({ automatic: false, checked: {} }));
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, activeProfileId: "PRIVATE_SOURCE", profiles: [{ id: "PRIVATE_SOURCE", name: "PRIVATE_CHARACTER", className: "Mage", realm: "PRIVATE_REALM", notes: "PRIVATE_NOTES", level: 12, goals: [{ id: "PRIVATE_GOAL_ID", text: "PRIVATE_GOAL", done: false }] }], memories: [{ profileId: "PRIVATE_SOURCE", exchanges: [{ id: "820e520e-e64b-4c71-93d1-36c2ade326fd", createdAt: "2026-11-10T10:00:00.000Z", question: "PRIVATE_PROMPT", answer: "PRIVATE_SAVED_ANSWER" }] }], provider: { id: "ollama", model: "PRIVATE_MODEL", endpoint: "http://127.0.0.1:11434" } }));
    app = await electron.launch({ args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app); page.setDefaultTimeout(5000);
    await app.evaluate(({ app, ipcMain, clipboard, dialog }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      globalThis.supportFixture = { previews: 0, copies: [], saves: 0, providerChecks: 0, network: 0, hold: false, fail: false };
      const p = load("./src/core/game-sync.cjs").GameSync.prototype, status = p.status;
      p.status = function () { return { ...status.call(this), message: "PRIVATE_GAME_ERROR", root: "C:/PRIVATE_PATH", account: "PRIVATE_ACCOUNT", coverage: { partial: true, unreadableAccountCount: 1, omittedCharacterCount: 2, omittedProfileCount: 0, message: "PRIVATE_COVERAGE" } }; };
      load("./src/core/claude.cjs").status = async () => { supportFixture.providerChecks++; return { available: false, connected: false }; };
      load("./src/core/claude.cjs").clearCredentials = async () => {};
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", launchAvailable: false });
      load("./src/core/voice.cjs").VoiceService.prototype.capabilities = async () => ({ available: false, recognizers: [], voices: [] });
      load("./src/core/providers.cjs").models = async () => [];
      load("./src/core/providers.cjs").ask = async () => new Promise(resolve => supportFixture.reply = resolve);
      const updater = load("./src/core/updater.cjs").Updater.prototype, updateStatus = updater.status;
      updater.status = function () { return { ...updateStatus.call(this), message: "PRIVATE_UPDATE_ERROR", diagnostic: { code: "NETWORK", message: "PRIVATE_TRANSPORT_ERROR", url: "https://PRIVATE_URL", path: "C:/PRIVATE_PATH" } }; };
      clipboard.writeText = text => supportFixture.copies.push(text);
      dialog.showSaveDialog = async () => { supportFixture.saves++; if (supportFixture.holdSave) await new Promise(resolve => supportFixture.releaseSave = resolve); return supportFixture.cancel ? { canceled: true } : { canceled: false, filePath: supportFixture.destination }; };
      dialog.showMessageBox = async () => ({ response: 1 });
      for (const name of ["diagnosticsPreview", "copyDiagnostics", "exportDiagnostics"]) {
        const handler = ipcMain._invokeHandlers.get("backstage:" + name); if (!handler) continue;
        ipcMain.removeHandler("backstage:" + name); ipcMain.handle("backstage:" + name, async (...args) => {
          if (name === "diagnosticsPreview") { supportFixture.previews++; if (supportFixture.hold) await new Promise(resolve => supportFixture.release = resolve); if (supportFixture.fail) throw Error("PRIVATE_IPC_ERROR"); }
          const result = await handler(...args); if (name === "diagnosticsPreview") supportFixture.completed = (supportFixture.completed || 0) + 1; return result;
        });
      }
      const https = load("node:https"); const request = https.request; https.request = function (...args) { supportFixture.network++; return request.apply(this, args); };
    });
    await page.addInitScript(() => {
      let api;
      Object.defineProperty(window, "InteractionGuard", { configurable: true, get: () => api, set(value) {
        api = value; const create = api.create;
        api.create = options => { const guard = create(options), defer = guard.defer; guard.defer = (...args) => { const held = defer(...args); if (held && options.active() && document.querySelector("[data-support]")) window.supportDeferredPaints = (window.supportDeferredPaints || 0) + 1; return held; }; return guard; };
      } });
    });
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "manual")); await page.reload();
    await navigate(page, "guide");
    const prepare = () => page.getByRole("button", { name: "Prepare report", exact: true }), copy = () => page.getByRole("button", { name: "Copy report", exact: true }), save = () => page.getByRole("button", { name: "Save report", exact: true });
    let lastPresented = "";
    const prepared = async () => { await page.waitForFunction(old => !document.querySelector("[data-support-copy]")?.disabled && !!document.querySelector("[data-support-preview]")?.textContent && document.querySelector("[data-support-preview]").textContent !== old, lastPresented); lastPresented = await page.locator("[data-support-preview]").textContent(); };
    const mainWait = name => app.evaluate(async (_e, name) => { const end = Date.now() + 4000; while (!supportFixture[name]) { if (Date.now() > end) throw Error("Fixture action did not begin: " + name); await new Promise(r => setTimeout(r, 10)); } }, name);
    await check("Field Guide discovers Support & Recovery without another route", async () => {
      await page.getByRole("region", { name: "Support & Recovery", exact: true }).waitFor();
      assert.equal(await page.locator("nav[aria-label='Main navigation'] button").count(), 7);assert.equal(await page.getByRole("navigation",{name:"Settings and help",exact:true}).getByRole("button").count(),2); assert.equal(await copy().isDisabled(), true); assert.equal(await save().isDisabled(), true);
      for (const label of ["Export backup", "Import backup", "Delete all local data", "Open Quests"]) assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 1);
    });
    await check("physical Enter retains original controls and unrelated Field Guide nodes until release", async () => {
      await app.evaluate(() => supportFixture.hold = true); await prepare().focus();
      await page.evaluate(() => { window.supportDeferredPaints = 0; window.supportOriginal = document.querySelector("[data-support-prepare]"); window.supportBackup = document.querySelector('[data-command="export"]'); window.supportActive = document.querySelector("#active-character"); });
      await page.keyboard.down("Enter"); await mainWait("release");
      await page.evaluate(() => window.supportDeferredPaints = 0);
      await app.evaluate(() => { supportFixture.hold = false; supportFixture.release(); });
      await mainWait("completed");
      await page.waitForFunction(() => window.supportDeferredPaints > 0);
      const held = await page.evaluate(() => ({ prepare: supportOriginal === document.querySelector("[data-support-prepare]"), focused: document.activeElement === supportOriginal, backup: supportBackup === document.querySelector('[data-command="export"]'), active: supportActive === document.querySelector("#active-character"), painted: !!document.querySelector("[data-support-preview]").textContent }));
      assert.deepEqual(held, { prepare: true, focused: true, backup: true, active: true, painted: false });
      await page.keyboard.up("Enter"); await prepared(); assert.equal(await prepare().evaluate(n => n === window.supportOriginal), true);
    });
    let preview;
    await check("safe preview copy and exported UTF8 are byte-identical without provider or network checks", async () => {
      const before = await app.evaluate(() => ({ provider: supportFixture.providerChecks, network: supportFixture.network }));
      await prepare().press("Enter"); await prepared(); preview = await page.locator("[data-support-preview]").innerText();
      assert.doesNotMatch(preview, /PRIVATE_|<script>|C:\//); assert.match(preview, /Profile count: 1/);
      assert.ok(preview.includes(`Reference build: ${referenceBuild}`)); assert.ok(preview.includes(`Reference item names: ${referenceCounts.itemNames}`)); assert.match(preview, /Updater diagnostic code: NETWORK/);
      await copy().press("Enter"); await page.getByText("Report copied. Share it only where you choose.", { exact: true }).waitFor();
      assert.equal(await app.evaluate(() => supportFixture.copies.at(-1)), preview);
      await app.evaluate((_e, destination) => supportFixture.destination = destination, path.join(dir, "..", path.basename(dir) + "-support.txt"));
      await save().press("Enter"); await page.getByText("Report saved. Nothing was uploaded.", { exact: true }).waitFor();
      const destination = await app.evaluate(() => supportFixture.destination); assert.equal(await fs.readFile(destination, "utf8"), preview); await fs.unlink(destination);
      assert.deepEqual(await app.evaluate(() => ({ provider: supportFixture.providerChecks, network: supportFixture.network })), before);
    });
    await check("trusted main boundary and preload preserve strict request arity", async () => {
      await assert.rejects(() => page.evaluate(() => window.backstage.diagnosticsPreview("PRIVATE_REQUEST")), /Report request is invalid/);
      await assert.rejects(() => page.evaluate(() => window.backstage.copyDiagnostics("invalid", "PRIVATE_REQUEST")), /Report request is invalid/);
      const message = await app.evaluate(async ({ ipcMain }) => { try { await ipcMain._invokeHandlers.get("backstage:diagnosticsPreview")({ sender: {}, senderFrame: {} }); return "unexpected success"; } catch (error) { return error.message; } });
      assert.equal(message, "This action is unavailable.");
    });
    await check("cancel and native-path rejection have clear safe outcomes", async () => {
      await app.evaluate(() => supportFixture.cancel = true); await save().click(); await page.getByText("Save cancelled. Your reviewed report is still available.", { exact: true }).waitFor();
      await app.evaluate((_e, destination) => { supportFixture.cancel = false; supportFixture.destination = destination; }, path.join(dir, "state.txt"));
      await save().click(); await page.getByText("The report could not be saved. Prepare a report and try again.", { exact: true }).waitFor(); assert.equal(await copy().isDisabled(), true);
      await prepare().click(); await prepared();
    });
    await check("full and 984x635 layouts keep report actions and readable preview within the card", async () => {
      for (const [name, width, height] of [["full", 1440, 960], ["compact", 984, 635]]) {
        await app.evaluate(({ BrowserWindow }, size) => { const w = BrowserWindow.getAllWindows()[0]; w.setMinimumSize(0, 0); w.setContentSize(...size); }, [width, height]);
        await prepare().scrollIntoViewIfNeeded(); const metrics = await page.locator("[data-support]").evaluate(n => ({ width: innerWidth, overflow: document.documentElement.scrollWidth, pre: n.querySelector("pre").getBoundingClientRect().width, card: n.getBoundingClientRect().width, buttons: [...n.querySelectorAll("button")].map(b => { const r = b.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width }; }) }));
        assert.ok(metrics.overflow <= metrics.width); assert.ok(metrics.pre < metrics.card); for (const b of metrics.buttons) assert.ok(b.x >= 0 && b.right <= width && b.width > 40);
        await page.screenshot({ path: path.join(evidence, `support-${name}.png`), fullPage: true }); await page.screenshot({ path: path.join(evidence, `support-${name}-viewport.png`) }); await fs.writeFile(path.join(evidence, `support-${name}.json`), JSON.stringify(metrics, null, 2));
      }
    });
    await check("late preview cannot overwrite navigation or reactivate an obsolete report", async () => {
      await app.evaluate(() => { supportFixture.hold = true; supportFixture.release = null; }); await prepare().click(); await mainWait("release");
      await page.getByText("Preparing a local report…", { exact: true }).waitFor(); assert.equal(await copy().isDisabled(), true); assert.equal(await save().isDisabled(), true); assert.equal(await page.locator("[data-support-preview]").textContent(), "");
      await navigate(page,"adventure"); await app.evaluate(() => { supportFixture.hold = false; supportFixture.release(); });
      await page.waitForFunction(() => page === "adventure" && document.querySelector("#page-heading")?.textContent === "Adventure / Next step"); assert.equal(await page.locator("[data-support]").count(), 0);
      await navigate(page, "guide"); assert.equal(await copy().isDisabled(), true); assert.equal(await page.locator("[data-support-preview]").innerText(), "");
    });
    await check("preparation error is fixed text and retry works", async () => {
      await app.evaluate(() => supportFixture.fail = true); await prepare().click(); await page.getByText("The report could not be prepared. Try again.", { exact: true }).waitFor(); assert.doesNotMatch(await page.locator("[data-support]").innerText(), /PRIVATE_/);
      await app.evaluate(() => supportFixture.fail = false); await prepare().click(); await prepared();
    });
    await check("regeneration while a native save is pending writes nothing", async () => {
      await app.evaluate((_e, destination) => { supportFixture.destination = destination; supportFixture.holdSave = true; supportFixture.releaseSave = null; }, latePath); await save().click(); await mainWait("releaseSave");
      await page.evaluate(() => window.backstage.diagnosticsPreview()); await app.evaluate(() => { supportFixture.holdSave = false; supportFixture.releaseSave(); });
      await page.getByText("The report could not be saved. Prepare a report and try again.", { exact: true }).waitFor(); assert.equal(await copy().isDisabled(), true);
      await assert.rejects(() => fs.stat(latePath), { code: "ENOENT" });
    });
    await check("reset retires current report and late native save without leaking into setup", async () => {
      await prepare().click(); await prepared(); const token = await page.evaluate(() => window.backstage.diagnosticsPreview());
      await app.evaluate(() => { supportFixture.holdSave = true; supportFixture.releaseSave = null; });
      const pending = page.evaluate(id => window.backstage.exportDiagnostics(id).catch(e => e.message), token.id); await mainWait("releaseSave");
      await page.getByRole("button", { name: "Delete all local data", exact: true }).click(); await page.getByRole("button", { name: "Plan without a character", exact: true }).waitFor();
      await app.evaluate(() => supportFixture.releaseSave()); assert.match(await pending, /Prepare a new report/);
      await assert.rejects(() => page.evaluate(id => window.backstage.copyDiagnostics(id), token.id), /Prepare a new report/);
      await assert.rejects(() => fs.stat(latePath), { code: "ENOENT" });
      assert.equal(await page.locator("[data-support]").count(), 0);
    });
    console.log(`${checks} support checks passed; screenshots: ${evidence}`);
  } catch (error) { console.error(error); if (app) await (await app.firstWindow()).screenshot({ path: path.join(evidence, "support-failure.png"), fullPage: true }).catch(() => {}); process.exitCode = 1; }
  finally { clearTimeout(watchdog); await app?.close(); await fs.rm(latePath, { force: true }); await fs.rm(dir, { recursive: true, force: true }); }
})();
