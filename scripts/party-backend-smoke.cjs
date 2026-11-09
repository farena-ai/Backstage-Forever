"use strict";
// Real trusted Electron handlers; dialogs and all side effects use synthetic fixtures.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), syncFs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { serializePartyPlan } = require("../src/core/party.cjs");
function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfPartyShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfPartyShortPath]::GetShortPathName($env:BF_PARTY_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, BF_PARTY_ALIAS_PATH: target }, encoding: "utf8", timeout: 15000 }).trim();
  assert.notEqual(alias.toLowerCase(), target.toLowerCase()); assert.match(alias, /~\d/); assert.equal(syncFs.statSync(alias).ino, syncFs.statSync(target).ino); return alias;
}
(async () => {
  const tempRoot = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(tempRoot, "forever-party-backend-")); let app;
  const watchdog = setTimeout(() => { console.error("Party fixture exceeded 100 seconds"); process.exitCode = 1; app?.process().kill(); }, 100000);
  try {
    const normalData = path.join(dir, "synthetic-user-data"); await fs.mkdir(normalData); const data = process.argv.includes("--short-path") ? shortPath(normalData) : normalData;
    const shared = path.join(dir, "shared.json"), backup = path.join(dir, "backup.json");
    const p = id => ({ id, name: `PRIVATE_NAME_${id}`, realm: "PRIVATE_REALM", className: "Mage", level: 12, notes: "PRIVATE_NOTE", goals: [{ id: "g", text: "PRIVATE_GOAL", done: false }], source: { kind: "wow-addon", id: `PRIVATE_SOURCE_${id}`, updatedAt: "2026-11-09T00:00:00.000Z" }, readiness: { equipment: [], bags: { free: 2, total: 20 } } });
    const initial = { ...defaultState(), onboarded: true, profiles: [p("Alpha"), p("Beta")], activeProfileId: "Alpha", followGameCharacter: false };
    await fs.writeFile(path.join(data, "state.json"), JSON.stringify(initial));
    async function launch() {
      app = await electron.launch({ args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: data }, timeout: 20000 });
      await app.evaluate(({ app, dialog }, { shared, backup }) => {
        const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
        globalThis.partyFixture = { shared, backup, open: shared, save: shared, launches: 0, inference: 0, canceled: false, hold: false };
        const { GameRuntime } = load("./src/core/game-runtime.cjs"); GameRuntime.prototype.probe = async () => ({ state: "not-running", checkedAt: null, launchAvailable: false }); GameRuntime.prototype.launch = async () => { partyFixture.launches++; throw Error("Fixture blocks launch"); };
        load("./src/core/providers.cjs").ask = async () => { partyFixture.inference++; throw Error("Fixture blocks inference"); };
        load("./src/core/claude.cjs").status = async () => ({ installed: false, loggedIn: false });
        dialog.showMessageBox = async () => ({ response: 1 });
        const respond = save => ({ canceled: partyFixture.canceled, ...(save ? { filePath: partyFixture.save } : { filePaths: [partyFixture.open] }) });
        dialog.showSaveDialog = async () => partyFixture.hold ? new Promise(resolve => partyFixture.release = () => resolve(respond(true))) : respond(true);
        dialog.showOpenDialog = async () => partyFixture.hold ? new Promise(resolve => partyFixture.release = () => resolve(respond(false))) : respond(false);
      }, { shared, backup });
      const page = await testWindow(app); page.setDefaultTimeout(10000); return page;
    }
    let page = await launch();
    const call = (method, ...args) => page.evaluate(({ method, args }) => window.backstage[method](...args), { method, args });
    const contents = { title: "Reviewed shared plan", steps: [{ text: "<script>window.PARTY_EXECUTED=true</script> $() https://example.invalid" }] };
    const raw = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0], event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
      const rejected = async fn => { try { await fn(); return false; } catch { return true; } };
      const results = [];
      for (const [name, args] of [["partyBrief", [{ profileId: "Alpha", role: "tank" }]], ["partyPreview", [{ journeyId: "missing" }]], ["createPartyJourney", [{ profileId: "Alpha", role: "tank" }]], ["exportPartyPlan", [{ title: "x", steps: [{ text: "x" }] }]], ["importPartyPlan", []], ["commitPartyPlan", [{ title: "x", steps: [{ text: "x" }] }]]]) {
        const handler = ipcMain._invokeHandlers.get("backstage:" + name);
        results.push(await rejected(() => handler(event, ...args, "extra")));
        if (args.length) results.push(await rejected(() => handler(event)));
        results.push(await rejected(() => handler({ sender: {}, senderFrame: { url: "file:///wrong" } }, ...args)));
        results.push(await rejected(() => handler({ sender: win.webContents, senderFrame: { url: win.webContents.mainFrame.url } }, ...args)));
      }
      return results;
    }); assert.ok(raw.every(Boolean));
    for (const method of ["partyBrief", "partyPreview", "createPartyJourney", "exportPartyPlan", "commitPartyPlan"]) await assert.rejects(() => call(method, {}, "extra"));
    await assert.rejects(() => call("importPartyPlan", "extra"));
    await assert.rejects(() => call("exportPartyPlan", { title: "Sparse", steps: Array(1) }));
    const brief = await call("partyBrief", { profileId: "Alpha", role: "tank" }); assert.equal(brief.role, "tank"); assert.deepEqual(brief.equipment, { known: true, items: [] }); assert.doesNotMatch(JSON.stringify(brief), /PRIVATE_/);
    await assert.rejects(() => call("createPartyJourney", { profileId: "Beta", role: "damage" }));
    let result = await call("createPartyJourney", { profileId: "Alpha", role: "tank" }); const checklist = result.journeyId;
    assert.ok(result.state.journeys[0].steps.every(s => s.profileId === "Alpha" && !s.done && !s.quest && !s.observed)); assert.equal(result.state.followGameCharacter, false);
    await call("journeyAction", { type: "rename", journeyId: checklist, title: "PRIVATE_NAME custom title" });
    const selected = await call("partyPreview", { journeyId: checklist }); assert.equal(selected.title, "Shared adventure plan"); assert.doesNotMatch(JSON.stringify(selected), /PRIVATE_|profileId|done|source/);
    selected.title = "Reviewed title"; selected.steps[0].text = "Owner edited all selected text";
    assert.equal(await call("exportPartyPlan", selected), true); assert.deepEqual(JSON.parse(await fs.readFile(shared, "utf8")), { format: "backstage-forever-party", version: 1, ...selected });
    let before = (await call("bootstrap")).state; const imported = await call("importPartyPlan"); assert.deepEqual(imported, selected); assert.deepEqual((await call("bootstrap")).state, before);
    imported.steps.push(contents.steps[0]); result = await call("commitPartyPlan", imported); const added = result.state.journeys.find(j => j.id === result.journeyId);
    assert.ok(added.steps.every(s => s.profileId === null && !s.done && !s.quest && !s.observed)); assert.ok(added.steps.every(s => !before.journeys.flatMap(j => j.steps).some(old => old.id === s.id))); assert.equal(await page.evaluate(() => window.PARTY_EXECUTED), undefined);
    // Stale ordinary forms cannot erase newly main-owned imported plans or captured facts.
    const ordinaryBase = structuredClone(before); before.profiles[0].notes = "PRIVATE_CHANGED_NOTE"; before.journeys = [];
    const ordinary = await call("saveState", before, ordinaryBase); assert.equal(ordinary.journeys.length, 2); assert.equal(ordinary.profiles[0].notes, "PRIVATE_CHANGED_NOTE");
    const publicContext = await call("contextPreview", "Alpha", true, "Explain preparation"); assert.doesNotMatch(JSON.stringify(publicContext), /PRIVATE_(?:NOTE|CHANGED_NOTE|GOAL|SOURCE)|Owner edited|script>|sourceHash/);
    assert.equal(await call("memoryDraft", "Alpha"), null); assert.equal((await call("voiceStatus", "12345678-1234-4123-8123-123456789012")).phase, "idle");
    // Real file parsing uses no extension or filename trust and no mutation on invalid data.
    for (const raw of [Buffer.alloc(65537, 32), Buffer.from([255]), '{"format":"backstage-forever-party","version":1,"title":"x","steps":[{"text":"a","te\\u0078t":"b"}]}', JSON.stringify({ format: "backstage-forever-party", version: 1, ...contents, observed: {} })]) { await fs.writeFile(shared, raw); await assert.rejects(() => call("importPartyPlan")); assert.equal((await call("bootstrap")).state.journeys.length, 2); }
    await fs.writeFile(shared, serializePartyPlan(contents));
    await app.evaluate(() => partyFixture.canceled = true); assert.equal(await call("importPartyPlan"), null); assert.equal(await call("exportPartyPlan", contents), null); await app.evaluate(() => partyFixture.canceled = false);
    async function hold(method, args = []) {
      await app.evaluate(() => { partyFixture.hold = true; partyFixture.release = null; });
      await page.evaluate(({ method, args }) => { window.pendingParty = window.backstage[method](...args); }, { method, args });
      await app.evaluate(async () => { const end = Date.now() + 5000; while (!partyFixture.release) { if (Date.now() > end) throw Error("Dialog did not start"); await new Promise(r => setTimeout(r, 10)); } });
    }
    async function release() { await app.evaluate(() => { partyFixture.hold = false; partyFixture.release(); }); return page.evaluate(() => window.pendingParty); }
    for (const method of ["importPartyPlan", "exportPartyPlan"]) {
      await hold(method, method === "exportPartyPlan" ? [contents] : []);
      await call("companionContext", { profileId: "Alpha", view: "other" }); assert.equal(await release(), null);
    }
    await hold("importPartyPlan"); const switchBase = (await call("bootstrap")).state, switchState = structuredClone(switchBase); switchState.activeProfileId = "Beta"; await call("saveState", switchState, switchBase); assert.equal(await release(), null);
    await assert.rejects(() => call("partyBrief", { profileId: "Alpha", role: "healer" }));
    await app.close(); app = null; page = await launch(); assert.equal((await call("bootstrap")).state.journeys.length, 2);
    // A confirmed backup replacement invalidates an older pending party picker.
    await hold("importPartyPlan");
    const full = { ...defaultState(), onboarded: true, journeys: Array.from({ length: 20 }, (_, n) => ({ id: `j${n}`, title: "Full", createdAt: "2026-11-09T00:00:00.000Z", steps: [] })) };
    await fs.writeFile(backup, JSON.stringify(full));
    await app.evaluate(() => { partyFixture.hold = false; partyFixture.open = partyFixture.backup; }); await call("importData"); assert.equal(await release(), null);
    await assert.rejects(() => call("commitPartyPlan", contents), /20 journeys/); assert.equal((await call("bootstrap")).state.journeys.length, 20);
    await app.evaluate(() => { partyFixture.open = partyFixture.shared; });
    await hold("importPartyPlan");
    await app.evaluate(({ app }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json")), { GameSync } = load("./src/core/game-sync.cjs"), reset = GameSync.prototype.reset;
      GameSync.prototype.reset = async function () { await new Promise(resolve => partyFixture.releaseReset = resolve); return reset.call(this); };
    });
    await page.evaluate(() => { window.partyReset = window.backstage.resetData(); });
    await app.evaluate(async () => { const end = Date.now() + 5000; while (!partyFixture.releaseReset) { if (Date.now() > end) throw Error("Reset did not start"); await new Promise(r => setTimeout(r, 10)); } });
    await assert.rejects(() => call("commitPartyPlan", contents)); await assert.rejects(() => call("importPartyPlan"));
    await app.evaluate(() => partyFixture.releaseReset()); await page.evaluate(() => window.partyReset); assert.equal(await release(), null); assert.deepEqual((await call("bootstrap")).state.journeys, []);
    assert.deepEqual(await app.evaluate(() => ({ launches: partyFixture.launches, inference: partyFixture.inference })), { launches: 0, inference: 0 });
    console.log(`Party backend source Electron ${process.argv.includes("--short-path") ? "genuine 8.3" : "normal"}: trusted exact IPC, public facts/roles, preview/edit/export/import/manual commit, bounded invalid files, cancellation/context/selection/import/reset races, caps, ordinary ownership/privacy, restart and zero launch/inference PASS`);
  } finally {
    clearTimeout(watchdog); await app?.close().catch(() => {}); const real = await fs.realpath(dir); assert.equal(path.dirname(real).toLowerCase(), tempRoot.toLowerCase()); assert.ok(path.basename(real).startsWith("forever-party-backend-")); await fs.rm(real, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
