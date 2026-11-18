"use strict";
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow, launch } = require("./test-window.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

(async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), "bf-route-recovery-"));
  let app;
  try {
    const repo = path.resolve(__dirname, "..");
    const alpha = { id: "Alpha", name: "Alpha", className: "Warrior", realm: "Fixture", level: 2, race: "Orc", faction: "Horde", goals: [], notes: "", locale: "enUS",
      source: { kind: "wow-addon", id: "Alpha-Fixture", updatedAt: "2026-11-12T13:00:00.000Z" }, clientBuild: "1.60.1.70888",
      location: { zone: "Durotar", mapId: 1411, x: .42, y: .68 }, quests: [{ id: 788, title: "Cutting Teeth", complete: false, objectives: [] }],
      history: { recent: [], completedIdsKnown: true, completedIds: [789, 4402, 97279] } };
    const beta = { ...alpha, id: "Beta", name: "Beta", source: { ...alpha.source, id: "Beta-Fixture" }, clientBuild: "1.60.1.70862", quests: [] };
    const initial = { ...defaultState(), onboarded: true, activeProfileId: alpha.id, profiles: [alpha, beta] };
    assert.equal(validateState(initial).activeProfileId, alpha.id);
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify(initial));
    const backup = path.join(dir, "fixture-backup.json");
    await fs.writeFile(backup, JSON.stringify(initial));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-route-recovery-fixture", version: "1.0.0", main: "fixture-main.cjs" }));
    await fs.writeFile(path.join(dir, "fixture-main.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
      load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
      const L=load('./src/core/live-bridge.cjs'); L.LiveBridge.prototype.readPreference=()=>false; L.LiveBridge.prototype.start=()=>{};
      const {ipcMain,dialog}=require('electron'), handle=ipcMain.handle.bind(ipcMain);
      globalThis.routeFixture={gates: {}, calls: {}, resetResponse: 0};
      const messageBox=dialog.showMessageBox.bind(dialog);
      dialog.showMessageBox=(win,options)=>options.title==='Delete all local data?'
        ? Promise.resolve({response:routeFixture.resetResponse}) : options.title==='Replace saved profiles?'
          ? Promise.resolve({response:1}) : messageBox(win,options);
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(backup)}]});
      ipcMain.handle=(name,fn)=>handle(name,async (...args)=>{
        routeFixture.calls[name]=(routeFixture.calls[name] || 0)+1;
        const gate=routeFixture.gates[name];
        const held=gate && !gate.claimed;
        if(held) gate.claimed=true;
        if(held && (gate.reject || gate.before)){
          await new Promise(resolve=>{gate.release=resolve;});
          if(gate.reject) throw Error('Fixture character selection rejected');
        }
        const result=await fn(...args);
        if(held && !gate.before) await new Promise(resolve=>{gate.release=resolve;});
        return result;
      });
      load('./src/main.cjs');
    `);
    app = await launch(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(7500);
    const outer = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(...w.getMinimumSize()); return w.getSize();
    });
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    await page.reload();
    await navigate(page, "guided-route");
    const press = async (el) => { await el.focus(); await page.keyboard.press("Enter"); };
    const route = page.locator("[data-gr-recovery]");
    const picker = page.locator("#active-character");
    const arm = (channel, reject = false, before = false) => app.evaluate((_, { channel, reject, before }) => {
      routeFixture.gates[`backstage:${channel}`] = { reject, before };
    }, { channel, reject, before });
    const held = (channel) => app.evaluate(async (_, channel) => {
      const gate = routeFixture.gates[`backstage:${channel}`];
      for (let i = 0; i < 100 && !gate.release; i++) await new Promise((r) => setTimeout(r, 20));
      if (!gate.release) throw Error(`Expected a held ${channel} response`);
    }, channel);
    const release = (channel) => app.evaluate((_, channel) => routeFixture.gates[`backstage:${channel}`].release(), channel);
    const skipEntries = () => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("bf-desktop-route-skips-v1:")));
    await route.getByText(/availability/i).waitFor();
    await route.locator('[data-quest-open="788"]').waitFor();

    // Dispatch the old quest and Skip controls while the picker has changed but its save is unacknowledged.
    const oldQuest = await route.locator('[data-quest-open="788"]').elementHandle();
    const oldSkip = await route.getByRole("button", { name: "Skip this step" }).elementHandle();
    await arm("saveState", true);
    await picker.focus();
    await picker.selectOption("Beta");
    await held("saveState");
    assert.equal(await picker.inputValue(), "Beta");
    const requestsBefore = await app.evaluate(() => routeFixture.calls["backstage:guidedRoute"]);
    await oldQuest.evaluate(el => el.click());
    assert.equal(await page.locator("body").getAttribute("data-page"), "guided-route", "stale saved quest must not navigate");
    await oldSkip.evaluate(el => el.click());
    assert.equal(await app.evaluate(() => routeFixture.calls["backstage:guidedRoute"]), requestsBefore, "stale Skip must not request a route write");
    assert.deepEqual(await skipEntries(), []);
    await release("saveState");
    await page.getByText("Fixture character selection rejected", { exact: true }).waitFor();
    await route.getByText(/availability/i).waitFor();
    assert.equal(await picker.inputValue(), "Alpha");
    assert.equal(await picker.evaluate(el => el === document.activeElement), true);

    // A repaint and a second picker change must not give the previous route its controls back.
    await arm("saveState");
    await picker.selectOption("Beta");
    await held("saveState");
    await navigate(page, "world-map");
    await navigate(page, "guided-route");
    assert.equal(await picker.inputValue(), "Beta");
    await picker.selectOption("Alpha");
    assert.equal(await route.count(), 0);
    await release("saveState");
    await route.getByText(/availability/i).waitFor();
    assert.equal(await picker.inputValue(), "Alpha");
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8")).activeProfileId, "Alpha");

    // A Skip admitted before the switch must not persist or steal focus when its reply arrives during it.
    await arm("guidedRoute");
    await press(route.getByRole("button", { name: "Skip this step" }));
    await held("guidedRoute");
    await arm("saveState");
    await picker.focus();
    await picker.selectOption("Beta");
    await held("saveState");
    await release("guidedRoute");
    // Round-trip through the same IPC channel after the held reply before inspecting the renderer.
    await page.evaluate(() => backstage.guidedRoute({ profileId: "Beta", skips: [] }));
    assert.deepEqual(await skipEntries(), [], "retired Skip reply must not persist");
    assert.equal(await picker.evaluate(el => el === document.activeElement), true);
    await release("saveState");
    await route.getByText(/matching reference/i).waitFor();
    await picker.selectOption("Alpha");
    await route.getByText(/availability/i).waitFor();

    await press(route.getByRole("button", { name: "Skip this step" }));
    await route.getByRole("button", { name: "Show on Map" }).waitFor();
    await page.reload();
    await navigate(page, "guided-route");
    await route.getByRole("button", { name: "Show on Map" }).waitFor();
    const oldMap = await route.getByRole("button", { name: "Show on Map" }).elementHandle();
    const oldRestore = await route.getByRole("button", { name: "Restore skipped steps" }).elementHandle();
    const savedSkips = await skipEntries();
    await arm("saveState");
    await page.locator("#active-character").selectOption("Beta");
    await held("saveState");
    await oldMap.evaluate(el => el.click());
    assert.equal(await page.locator("body").getAttribute("data-page"), "guided-route", "stale map must not navigate");
    await oldRestore.evaluate(el => el.click());
    await page.evaluate(() => backstage.guidedRoute({ profileId: "Beta", skips: [] }));
    assert.deepEqual(await skipEntries(), savedSkips, "stale Restore must not erase Alpha's skip");
    await release("saveState");
    await route.getByText(/matching reference/i).waitFor();
    assert.equal(await route.locator("[data-map-focus], [data-quest-open]").count(), 0);
    await page.locator("#active-character").selectOption("Alpha");
    await press(route.getByRole("button", { name: "Show on Map" }));
    const first = page.locator('[data-wm-goal] [data-quest-open="788"]');
    await first.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('[data-wm-goal] [data-quest-open="788"]'));
    const geometry = await first.evaluate((el) => {
      const r = el.getBoundingClientRect(), view = WorldMapView._state();
      const clip = el.closest("main").getBoundingClientRect();
      return { visible: r.top >= Math.max(0, clip.top) && r.bottom <= Math.min(innerHeight, clip.bottom) && r.left >= 0 && r.right <= innerWidth,
        viewport: [innerWidth, innerHeight], target: [view.model.mapId, view.model.profileId, view.focused.pin.questId] };
    });
    assert.deepEqual(geometry.target, [1411, "Alpha", 788]);
    assert.ok(geometry.visible, JSON.stringify(geometry));
    if (process.env.BF_ROUTE_CAPTURE) await page.screenshot({ path: process.env.BF_ROUTE_CAPTURE });
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Cutting Teeth", exact: true }).first().waitFor();
    // Retire a genuine Alpha map response when the player selects Beta before it settles.
    await navigate(page, "guided-route");
    await arm("worldMap");
    await press(route.getByRole("button", { name: "Show on Map" }));
    await page.locator("[data-world-map]").waitFor();
    await held("worldMap");
    await arm("saveState");
    await page.locator("#active-character").selectOption("Beta");
    await held("saveState");
    await release("worldMap");
    await page.evaluate(() => backstage.worldMap({ mapId: 1411 }));
    assert.equal(await first.count(), 0, "retired map reply must not reveal Alpha's goal during the switch");
    await release("saveState");
    await page.waitForFunction(() => profile()?.id === "Beta");
    await page.waitForFunction(() => WorldMapView._state().model?.profileId === "Beta");
    assert.equal(await first.count(), 0);
    await navigate(page, "guided-route");
    await page.locator("#active-character").selectOption("Alpha");
    await press(route.getByRole("button", { name: "Restore skipped steps" }));
    await route.getByText(/availability/i).waitFor();

    const skip = () => press(route.getByRole("button", { name: "Skip this step" }));
    const prefix = "bf-desktop-route-skips-v1:";
    const skipKey = (...scope) => prefix + JSON.stringify(scope);
    const alphaKey = skipKey(alpha.id, alpha.source.id, alpha.clientBuild);
    const olderAlphaKey = skipKey(alpha.id, 'Alpha-Previous"Source', beta.clientBuild);
    // Give another character a key that includes Alpha's ID in a different tuple position.
    const betaKey = skipKey(beta.id, alpha.id, alpha.clientBuild);
    const orphanKey = skipKey("Alpha-Other", alpha.source.id, alpha.clientBuild);
    const malformedKey = prefix + "not-json";
    const otherPreference = "bf-desktop-route-skips-v1-unrelated";
    const read = (key) => page.evaluate(key => localStorage.getItem(key), key);
    await skip();
    await route.getByRole("button", { name: "Show on Map" }).waitFor();
    const stored = await read(alphaKey);
    assert.ok(JSON.parse(stored).length > 0);
    await page.evaluate(({ keys, stored, otherPreference }) => {
      for (const key of keys) localStorage.setItem(key, stored);
      localStorage.setItem(otherPreference, "keep me");
    }, { keys: [olderAlphaKey, betaKey, orphanKey, malformedKey], stored, otherPreference });

    const restoreIdentity = async () => {
      await navigate(page, "guide");
      await page.locator('[data-command="import"]').click();
      await page.getByText("Backup imported. Existing API keys preserved.", { exact: true }).waitFor();
      await navigate(page, "guided-route");
      await route.getByText(/availability/i).waitFor();
      assert.equal(await picker.inputValue(), alpha.id);
      assert.equal(await route.getByRole("button", { name: "Restore skipped steps" }).count(), 0);
    };

    if (!process.argv.includes("--reset-only")) {
      await navigate(page, "characters");
      const remove = page.locator('[data-command="delete-character"]');
      await page.evaluate(() => { window.confirm = () => false; });
      const beforeDelete = await skipEntries();
      await remove.click();
      assert.deepEqual(await skipEntries(), beforeDelete, "cancelled deletion must preserve skips");
      await page.evaluate(() => { window.confirm = () => true; });
      await arm("saveState", true);
      await remove.click();
      await held("saveState");
      await release("saveState");
      await page.getByText("Fixture character selection rejected", { exact: true }).waitFor();
      assert.deepEqual(await skipEntries(), beforeDelete, "failed deletion must preserve skips");

      await arm("saveState", false, true);
      await remove.click();
      await held("saveState");
      // Admit a real Skip while the deletion awaits its commit, then deliver it after the commit.
      await navigate(page, "guided-route");
      await route.getByRole("button", { name: "Restore skipped steps" }).waitFor();
      await arm("guidedRoute");
      await skip();
      await held("guidedRoute");
      await release("saveState");
      await page.waitForFunction(() => !state.profiles.some(p => p.id === "Alpha"));
      await release("guidedRoute");
      await page.evaluate(() => backstage.guidedRoute({ profileId: "Beta", skips: [] }));
      assert.equal(await read(alphaKey), null, "a late Skip must not re-create the deleted character's key");
      await page.reload();
      assert.equal(await read(alphaKey), null, "successful deletion must remove the character's current skips");
      assert.equal(await read(olderAlphaKey), null, "successful deletion must remove older source/build variants");
      for (const key of [betaKey, orphanKey, malformedKey]) assert.equal(await read(key), stored, key);
      assert.equal(await read(otherPreference), "keep me");
      await restoreIdentity();
      await skip();
      await route.getByRole("button", { name: "Show on Map" }).waitFor();
    }

    await navigate(page, "guide");
    const reset = page.locator('[data-command="reset"]');
    const beforeReset = await skipEntries();
    await arm("resetData");
    await reset.click();
    await held("resetData");
    await release("resetData");
    await page.waitForFunction(() => stateMutationBusy === 0);
    assert.deepEqual(await skipEntries(), beforeReset, "cancelled reset must preserve skips");
    await app.evaluate(() => { routeFixture.resetResponse = 1; });
    await arm("resetData", false, true);
    await reset.click();
    await held("resetData");
    await navigate(page, "guided-route");
    await route.getByRole("button", { name: "Restore skipped steps" }).waitFor();
    await arm("guidedRoute");
    await skip();
    await held("guidedRoute");
    await release("resetData");
    await page.getByText("Local data and saved keys deleted.", { exact: true }).waitFor();
    await release("guidedRoute");
    await page.evaluate(() => backstage.guidedRoute({ profileId: null, skips: [] }));
    assert.deepEqual(await skipEntries(), [], "a late Skip must not re-create storage after reset");
    await page.reload();
    assert.deepEqual(await skipEntries(), [], "reset must remove every skip entry, including orphans");
    assert.equal(await read(otherPreference), "keep me");
    await page.locator('[data-command="setup-company"]').click();
    await page.waitForFunction(() => state.onboarded && !setupOpen);
    await restoreIdentity();
    assert.deepEqual(errors, []);
    console.log(`Desktop route recovery passed at ${outer.join("×")} outer, ${geometry.viewport.join("×")} renderer.`);
  } finally {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 4 });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
