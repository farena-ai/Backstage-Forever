"use strict";
// Every save, dialog, game root and side-effect hook in this fixture is synthetic.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), syncFs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfPreparationShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfPreparationShortPath]::GetShortPathName($env:BF_PREPARATION_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, BF_PREPARATION_ALIAS_PATH: target }, encoding: "utf8", timeout: 15000 }).trim();
  assert.notEqual(alias.toLowerCase(), target.toLowerCase(), "A genuine distinct Windows 8.3 alias is required");
  assert.match(alias, /~\d/); assert.equal(syncFs.statSync(alias).ino, syncFs.statSync(target).ino);
  return alias;
}
(async () => {
  const tempRoot = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(tempRoot, "forever-preparation-backend-"));
  let app;
  const watchdog = setTimeout(() => { console.error("Preparation fixture exceeded 100 seconds"); process.exitCode = 1; app?.process().kill(); }, 100000);
  try {
    const normalData = path.join(dir, "synthetic-user-data"); await fs.mkdir(normalData);
    const data = process.argv.includes("--short-path") ? shortPath(normalData) : normalData;
    const game = path.join(dir, "synthetic-client"), saved = path.join(game, "WTF/Account/Synthetic/SavedVariables/BackstageForever.lua"), backup = path.join(dir, "backup.json");
    await fs.mkdir(path.dirname(saved), { recursive: true }); await fs.writeFile(path.join(game, ".flavor.info"), "wowf");
    const manual = id => ({ id, name: id, realm: "Synthetic Realm", className: "Mage", level: 12, notes: "PRIVATE_NOTE_SENTINEL", goals: [{ id: "g", text: "PRIVATE_GOAL_SENTINEL", done: false }] });
    await fs.writeFile(path.join(data, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, profiles: [manual("Alpha"), manual("Beta")], activeProfileId: "Alpha" }));
    const launch = async () => {
      app = await launchElectron(electron, { args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: data }, timeout: 20000 });
      await app.evaluate(({ app, dialog }) => {
        const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
        globalThis.preparationFixture = { confirm: 1, inference: 0, launches: 0 };
        const { GameRuntime } = load("./src/core/game-runtime.cjs");
        GameRuntime.prototype.probe = async () => ({ state: "not-running", checkedAt: null, launchAvailable: false });
        GameRuntime.prototype.launch = async () => { preparationFixture.launches++; throw Error("Fixture blocks real launch"); };
        load("./src/core/claude.cjs").status = async () => ({ installed: false, loggedIn: false });
        load("./src/core/providers.cjs").ask = async () => { preparationFixture.inference++; throw Error("Fixture blocks inference"); };
        dialog.showMessageBox = async () => ({ response: preparationFixture.confirm });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: preparationFixture.backup });
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [preparationFixture.backup] });
      });
      const page = await testWindow(app); page.setDefaultTimeout(10000); return page;
    };
    let page = await launch();
    const brief = (profileId = "Alpha", options = { recipeId: 100, crafts: 2 }) => page.evaluate(({ profileId, options }) => window.backstage.preparationBrief(profileId, options), { profileId, options });
    const create = (profileId = "Alpha", options = { recipeId: 100, crafts: 2 }) => page.evaluate(({ profileId, options }) => window.backstage.createPreparationJourney(profileId, options), { profileId, options });
    assert.equal((await brief(null, {})).character.id, null); assert.equal((await brief()).status, "unavailable"); await assert.rejects(() => create());
    const raw = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0], event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
      const rejected = async fn => { try { await fn(); return false; } catch { return true; } }, checks = {};
      for (const name of ["preparationBrief", "createPreparationJourney"]) {
        const handler = ipcMain._invokeHandlers.get(`backstage:${name}`);
        checks[name] = [await rejected(() => handler(event, "Alpha")), await rejected(() => handler(event, "Alpha", {}, {})), await rejected(() => handler(event, "Alpha", undefined)), await rejected(() => handler({ sender: {}, senderFrame: { url: "file:///wrong" } }, "Alpha", {})), await rejected(() => handler({ sender: win.webContents, senderFrame: { url: win.webContents.mainFrame.url } }, "Alpha", {})), await rejected(() => handler(event, "Alpha", { recipeId: 100, materials: [{ itemId: 200, count: 999 }] }))];
      }
      return checks;
    });
    assert.deepEqual(raw, { preparationBrief: Array(6).fill(true), createPreparationJourney: Array(6).fill(true) });
    await assert.rejects(() => page.evaluate(() => window.backstage.createPreparationJourney("Alpha", {}, "extra")));
    let clock = 1794225600;
    const col = items => ({ observedAt: clock, complete: true, items });
    const workshop = count => ({ professions: col([{ skillLineId: 171, professionId: 1, name: "Alchemy", rank: 20, maxRank: 75 }]), recipes: col([{ id: 100, skillLineId: 171, name: "WORKSHOP_PRIVATE_POTION", reagentsKnown: true, reagents: [{ itemId: 200, required: 3, name: "WORKSHOP_PRIVATE_HERB" }, { itemId: 2320, required: 1, name: "Synthetic thread requirement" }] }]), materials: { ...col([{ itemId: 200, count }]), scope: "bags-0-4" } });
    const characters = ["Alpha", "Beta"].map((name, i) => ({ id: `Synthetic-${name}`, name, realm: "Synthetic Realm", className: "Mage", faction: "Horde", level: 12, updatedAt: clock, clientBuild: "1.60.1.70862", captureVersion: require("../package.json").version, readiness: { bags: { free: 4, total: 16 }, workshop: workshop(i ? 99 : 2) } }));
    const write = () => fs.writeFile(saved, "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, observedAt: clock, activeId: characters[0].id, characters })));
    await write(); let snapshot = await page.evaluate(root => window.backstage.prepareGame(root), game);
    assert.equal(snapshot.state.profiles[0].readiness.workshop.recipes.observedAt, new Date(clock * 1000).toISOString());
    let model = await brief(); assert.equal(model.shoppingRows[0].missing, 4); assert.equal(model.otherCharacters[0].materials[0].count, 99); assert.doesNotMatch(JSON.stringify(model), /PRIVATE_NOTE|PRIVATE_GOAL|Synthetic-Alpha/);
    assert.equal(model.shoppingRows[0].historicalSellers.status, "historical-suggestions");
    assert.equal(model.shoppingRows[1].historicalSellers.status, "historical-suggestions");
    assert.ok(model.shoppingRows[1].historicalSellers.suggestions.length <= 3);
    assert.equal(model.sellerReference.source.sourceCommit, "164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1");
    assert.match(model.sellerReference.limitation, /current stock, price and access are unverified/);
    const stale = structuredClone(snapshot.state);
    let result = await create(); assert.equal(result.state.journeys.length, 1); const first = result.journeyId;
    assert.ok(result.state.journeys[0].steps.every(s => !s.done && s.quest === undefined && s.observed === undefined)); assert.doesNotMatch(JSON.stringify(result.state.journeys), /PRIVATE_NOTE|PRIVATE_GOAL|sourceHash/);
    // Updated saved counts own the next checklist despite an older renderer draft.
    clock += 60; characters[0].updatedAt = clock; characters[0].readiness.workshop.materials.observedAt = clock; characters[0].readiness.workshop.materials.items[0].count = 5; await write(); snapshot = await page.evaluate(() => window.backstage.refreshGame());
    model = await brief(); assert.equal(model.shoppingRows[0].missing, 1);
    result = await create(); assert.match(result.state.journeys[1].steps[0].text, /shortfall: 1/); assert.equal(result.state.journeys[0].id, first); assert.ok(result.state.journeys[0].steps.every(s => !s.done && !s.observed));
    stale.profiles[0].notes = "Saved draft"; stale.profiles[0].readiness.workshop.materials.items[0].count = 999; stale.journeys = [];
    let edited = await page.evaluate(({ state, base }) => window.backstage.saveState(state, base), { state: stale, base: snapshot.state });
    assert.equal(edited.journeys.length, 2); assert.equal(edited.profiles[0].readiness.workshop.materials.items[0].count, 5);
    clock += 60; characters[0].updatedAt = clock; characters[0].readiness.workshop.materials.observedAt = clock; characters[0].readiness.workshop.materials.complete = false; await write(); await page.evaluate(() => window.backstage.refreshGame());
    model = await brief(); assert.equal(model.shoppingRows[0].missing, null); assert.equal(model.shoppingRows[0].quantityKind, "lower-bound"); result = await create(); assert.match(result.state.journeys[2].steps[0].text, /carried supply is incomplete or unknown/); assert.match(result.state.journeys[2].steps[1].text, /total required: 6/);
    // Replaced recipe ownership is evaluated from latest state, never from a passed recipe object.
    clock += 60; characters[0].updatedAt = clock; characters[0].readiness.workshop.professions = { ...col([]) }; await write(); await page.evaluate(() => window.backstage.refreshGame()); await assert.rejects(() => create()); assert.equal((await brief()).planning.checklistAvailable, false);
    clock += 60; characters[0].updatedAt = clock; characters[0].readiness.workshop = workshop(5); await write(); snapshot = await page.evaluate(() => window.backstage.refreshGame());
    const switched = structuredClone(snapshot.state); switched.activeProfileId = "Beta"; edited = await page.evaluate(({ state, base }) => window.backstage.saveState(state, base), { state: switched, base: snapshot.state });
    await assert.rejects(() => create("Alpha")); assert.equal(edited.followGameCharacter, false); result = await create("Beta"); assert.match(result.state.journeys.at(-1).steps[0].text, /Manually verify/);
    const context = await page.evaluate(() => window.backstage.contextPreview("Alpha", true, "Explain my plan")); assert.doesNotMatch(JSON.stringify(context), /PRIVATE_|WORKSHOP_|Saved draft|sourceHash|workshop/);
    assert.deepEqual(await app.evaluate(() => ({ inference: preparationFixture.inference, launches: preparationFixture.launches })), { inference: 0, launches: 0 });
    await app.close(); app = null; page = await launch(); assert.equal((await brief("Beta")).shoppingRows[0].missing, 0); const restored = (await page.evaluate(() => window.backstage.bootstrap())).state; assert.equal(restored.journeys.length, 4); assert.ok(restored.journeys.every(j => j.steps.every(s => !s.done && !s.quest && !s.observed)));
    await app.evaluate((_e, file) => preparationFixture.backup = file, backup); assert.equal(await page.evaluate(() => window.backstage.exportData()), true);
    const exported = JSON.parse(await fs.readFile(backup, "utf8")); assert.ok(JSON.stringify(exported).includes("WORKSHOP_PRIVATE_POTION"));
    const reimported = await page.evaluate(() => window.backstage.importData()); assert.equal(reimported.journeys.length, 4); assert.equal((await brief("Beta")).shoppingRows[0].missing, 0);
    // Explicit import replaces evidence and plans; stale selections fail after import and restart.
    await fs.writeFile(backup, JSON.stringify({ ...defaultState(), onboarded: true, profiles: [manual("Manual")], activeProfileId: "Manual" }));
    const imported = await page.evaluate(() => window.backstage.importData()); assert.equal(imported.profiles[0].id, "Manual"); assert.deepEqual(imported.journeys, []); await assert.rejects(() => create()); await assert.rejects(() => create("Manual"));
    await app.close(); app = null; page = await launch(); assert.equal((await brief("Manual", {})).status, "unavailable"); assert.deepEqual((await page.evaluate(() => window.backstage.bootstrap())).state.journeys, []);
    await app.evaluate(({ app }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json")), { GameSync } = load("./src/core/game-sync.cjs"), reset = GameSync.prototype.reset;
      GameSync.prototype.reset = async function () { await new Promise(resolve => preparationFixture.releaseReset = resolve); return reset.call(this); };
    });
    await page.evaluate(() => { window.preparationReset = window.backstage.resetData(); });
    await app.evaluate(async () => { const end = Date.now() + 5000; while (!preparationFixture.releaseReset) { if (Date.now() > end) throw Error("Reset did not start"); await new Promise(r => setTimeout(r, 10)); } });
    await assert.rejects(() => brief("Manual", {})); await assert.rejects(() => create("Manual")); await app.evaluate(() => preparationFixture.releaseReset()); assert.deepEqual((await page.evaluate(() => window.preparationReset)).profiles, []); await assert.rejects(() => create());
    assert.deepEqual(await app.evaluate(() => ({ inference: preparationFixture.inference, launches: preparationFixture.launches })), { inference: 0, launches: 0 });
    console.log(`Preparation backend source Electron ${process.argv.includes("--short-path") ? "genuine 8.3" : "normal"}: strict trusted IPC, synthetic GameSync dates, exact/partial shortfalls, separate alts, latest manual plans, renderer-forgery rejection, selection/privacy/import/restart/reset, no inference/launch PASS`);
  } finally {
    clearTimeout(watchdog); if (app) await app.close().catch(() => {}); const resolved = await fs.realpath(dir);
    assert.equal(path.dirname(resolved).toLowerCase(), tempRoot.toLowerCase()); assert.ok(path.basename(resolved).startsWith("forever-preparation-backend-")); await fs.rm(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
