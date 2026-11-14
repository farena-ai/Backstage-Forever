"use strict";
// Synthetic profiles, fake local provider responses and blocked launches only.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), syncFs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), http = require("node:http");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const { defaultState, providers } = require("../src/core/validation.cjs");
function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfMemoryShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfMemoryShortPath]::GetShortPathName($env:BF_MEMORY_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, BF_MEMORY_ALIAS_PATH: target }, encoding: "utf8", timeout: 15000 }).trim();
  assert.notEqual(alias.toLowerCase(), target.toLowerCase()); assert.match(alias, /~\d/); assert.equal(syncFs.statSync(alias).ino, syncFs.statSync(target).ino); return alias;
}
(async () => {
  const tempRoot = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(tempRoot, "forever-memory-backend-")); let app, held = null, seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 100000) { req.destroy(); return; } }
    if (!raw) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ models: [{ name: "fixture" }] })); return; }
    const body = JSON.parse(raw); seen.push({ route: req.url, body });
    if (raw.includes("FAIL_REPLY")) { res.writeHead(503); res.end("fixture-only"); return; }
    const respond = () => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "Fixture quest answer" }] }], content: [{ type: "text", text: "Fixture quest answer" }], message: { content: "Fixture quest answer" }, choices: [{ message: { content: "Fixture quest answer" } }] })); };
    if (body.hold || raw.includes("HOLD_REPLY")) held = respond; else respond();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const endpoint = `http://127.0.0.1:${server.address().port}`;
  const watchdog = setTimeout(() => { console.error("Memory fixture exceeded 100 seconds"); process.exitCode = 1; app?.process().kill(); server.closeAllConnections(); }, 100000);
  try {
    const normalData = path.join(dir, "synthetic-user-data"); await fs.mkdir(normalData); const data = process.argv.includes("--short-path") ? shortPath(normalData) : normalData;
    const backup = path.join(dir, "backup.json"), profile = id => ({ id, name: id, realm: "Synthetic", className: "Mage", level: 12, notes: "PRIVATE_NOTE_SENTINEL", goals: [{ id: "g", text: "PRIVATE_GOAL_SENTINEL", done: false }], source: { kind: "wow-addon", id: require("node:crypto").createHash("sha256").update(`BackstageForever:PRIVATE_RAW_SOURCE_${id}`).digest("hex"), updatedAt: "2026-11-09T00:00:00.000Z" } });
    const game = path.join(dir, "synthetic-client"), savedGame = path.join(game, "WTF/Account/Synthetic/SavedVariables/BackstageForever.lua");
    await fs.mkdir(path.dirname(savedGame), { recursive: true }); await fs.writeFile(path.join(game, ".flavor.info"), "wowf");
    let observedAt = 1794225600;
    const writeGame = () => fs.writeFile(savedGame, "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, observedAt, activeId: "PRIVATE_RAW_SOURCE_Alpha", characters: ["Alpha", "Beta"].map(name => ({ id: `PRIVATE_RAW_SOURCE_${name}`, name, realm: "Synthetic", className: "Mage", level: 13, updatedAt: observedAt })) })));
    await fs.writeFile(path.join(data, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, profiles: [profile("Alpha"), profile("Beta")], activeProfileId: "Alpha", provider: { id: "ollama", model: "fixture", endpoint } }));
    async function launch() {
      app = await launchElectron(electron, { args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: data }, timeout: 20000 });
      await app.evaluate(({ app, dialog }, { endpoint, backup }) => {
        const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json")); globalThis.memoryFixture = { backup, launches: 0, requests: [], retrievalPrompts: [] };
        const { GameRuntime } = load("./src/core/game-runtime.cjs"); GameRuntime.prototype.probe = async () => ({ state: "not-running", checkedAt: null, launchAvailable: false }); GameRuntime.prototype.launch = async () => { memoryFixture.launches++; throw Error("Fixture blocks launch"); };
        const original = load("./src/core/providers.cjs").ask;
        for (const method of ["profileContext", "approvedProfile"]) { const original = load("./src/core/providers.cjs")[method]; load("./src/core/providers.cjs")[method] = (...args) => { memoryFixture.retrievalPrompts.push(args.at(-1)?.prompt); return original(...args); }; }
        load("./src/core/providers.cjs").ask = input => { memoryFixture.requests.push(input); return original({ ...input, apiKey: "fixture-only" }, (_url, options) => fetch(endpoint + new URL(_url).pathname, options)); };
        const subscription = async input => { memoryFixture.requests.push(input); const result = await fetch(endpoint + "/subscription", { method: "POST", body: JSON.stringify(input) }); return (await result.json()).message.content; };
        load("./src/core/chatgpt.cjs").ChatGPTAuth.prototype.ask = subscription;
        load("./src/core/claude.cjs").ask = subscription; load("./src/core/claude.cjs").status = async () => ({ connected: false, message: "Fixture" });
        dialog.showMessageBox = async () => ({ response: 1 }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: memoryFixture.backup }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [memoryFixture.backup] });
      }, { endpoint, backup }); return testWindow(app);
    }
    let page = await launch(); page.setDefaultTimeout(10000);
    const call = (method, ...args) => page.evaluate(({ method, args }) => window.backstage[method](...args), { method, args });
    assert.equal(await page.evaluate(() => typeof window.backstage.memoryDraft), "function");
    const ask = (prompt = "Where is my quest?", memoryIds = [], provider = "ollama") => call("ask", { provider, profileId: "Alpha", shareProfile: true, prompt, memoryIds });
    await call("companionContext", { profileId: "Alpha", view: "ai" }); assert.equal(await call("memoryDraft", "Alpha"), null);
    const raw = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0], event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }, rejected = async fn => { try { await fn(); return false; } catch { return true; } }, result = {};
      for (const name of ["memoryList", "memoryDraft", "memoryPreview", "saveMemory", "deleteMemory", "clearMemory", "companionContext"]) {
        const handler = ipcMain._invokeHandlers.get("backstage:" + name); result[name] = [await rejected(() => handler(event)), await rejected(() => handler(event, null, "extra")), await rejected(() => handler({ sender: {}, senderFrame: {} }, null)), await rejected(() => handler({ sender: win.webContents, senderFrame: { url: event.senderFrame.url } }, null))];
      } return result;
    }); assert.ok(Object.values(raw).every(row => row.every(Boolean)));
    assert.equal(await ask(), "Fixture quest answer"); const draft = await call("memoryDraft", "Alpha"); assert.equal(draft.question, "Where is my quest?");
    await assert.rejects(() => call("saveMemory", { ...draft, answer: "renderer forgery" }));
    let state = await call("saveMemory", { profileId: "Alpha", responseId: draft.responseId }); const id = state.memories[0].exchanges[0].id;
    assert.equal((await call("saveMemory", { profileId: "Alpha", responseId: draft.responseId })).memories[0].exchanges.length, 1);
    await writeGame(); const observed = await call("prepareGame", game); assert.equal(observed.state.memories[0].exchanges[0].id, id); assert.equal(observed.state.profiles.find(p => p.id === "Beta").level, 13); assert.equal(observed.state.profiles.length, 2);
    const preview = await call("memoryPreview", { profileId: "Alpha", prompt: "Explain the quest route", memoryIds: [id] });
    for (const provider of providers.filter((p) => p.id !== "local")) { // the free local engine has its own smoke (test:free-ai)
      await call("saveProvider", { provider: provider.id, model: "fixture", endpoint: provider.id === "ollama" ? endpoint : provider.endpoint, authMode: "api" });
      await ask("Explain the quest route", [id], provider.id); assert.equal((await app.evaluate(() => memoryFixture.requests.at(-1))).prompt, preview.prompt);
    }
    for (const provider of ["openai", "anthropic"]) {
      await call("saveProvider", { provider, model: "fixture", authMode: "subscription" });
      await ask("Explain the quest route", [id], provider); assert.equal((await app.evaluate(() => memoryFixture.requests.at(-1))).prompt, preview.prompt);
    }
    assert.equal(seen.length, 3 + providers.filter((p) => p.id !== "local").length); assert.doesNotMatch(JSON.stringify(seen), /PRIVATE_NOTE|PRIVATE_GOAL|PRIVATE_RAW_SOURCE/);
    assert.ok((await app.evaluate(() => memoryFixture.retrievalPrompts)).every(prompt => ["Where is my quest?", "Explain the quest route"].includes(prompt)));
    await call("saveProvider", { provider: "ollama", model: "fixture", endpoint, authMode: "api" });
    await assert.rejects(() => ask("q".repeat(12000), [id]), /fewer exchanges|prompt budget/); assert.equal(await call("memoryDraft", "Alpha"), null);
    assert.equal(await ask("Where is Stormwind?"), "Fixture quest answer"); assert.equal((await app.evaluate(() => memoryFixture.requests.at(-1))).prompt, "Where is Stormwind?");
    const beforeFailure = await call("memoryDraft", "Alpha"); await assert.rejects(() => ask("Explain FAIL_REPLY quest")); assert.equal(await call("memoryDraft", "Alpha"), null); await assert.rejects(() => call("saveMemory", { profileId: "Alpha", responseId: beforeFailure.responseId }));
    await ask("Please write a cake recipe"); assert.equal(await call("memoryDraft", "Alpha"), null);
    await ask(); state = (await call("bootstrap")).state; const stale = structuredClone(state); stale.memories = "forged renderer history"; stale.profiles[0].notes = "Updated journal";
    const saved = await call("saveState", stale, state); assert.equal(saved.memories[0].exchanges[0].id, id); assert.equal(saved.profiles[0].notes, "Updated journal");
    await page.evaluate(() => { window.pendingMemoryAsk = window.backstage.ask({ provider: "ollama", profileId: "Alpha", shareProfile: false, prompt: "Explain HOLD_REPLY quest", memoryIds: [] }).then(reply => ({ reply }), error => ({ error: error.message })); });
    const waitHeld = async () => { const end = Date.now() + 5000; while (!held) { assert.ok(Date.now() < end); await new Promise(r => setTimeout(r, 10)); } }; await waitHeld();
    await call("deleteMemory", { profileId: "Alpha", id }); held(); held = null; assert.match((await page.evaluate(() => window.pendingMemoryAsk)).error, /context changed|no longer current/); assert.equal(await call("memoryDraft", "Alpha"), null);
    await ask(); const current = await call("memoryDraft", "Alpha"); state = await call("saveMemory", { profileId: "Alpha", responseId: current.responseId });
    const startPending = async (profileId = "Alpha") => {
      await app.evaluate(({ ipcMain, BrowserWindow }, profileId) => { const win = BrowserWindow.getAllWindows()[0]; globalThis.memoryPending = ipcMain._invokeHandlers.get("backstage:ask")({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, { provider: "ollama", profileId, shareProfile: false, prompt: "Explain HOLD_REPLY quest", memoryIds: [] }).then(reply => ({ reply }), error => ({ error: error.message })); }, profileId);
      await waitHeld();
    };
    const finishPending = async expected => { held(); held = null; const result = await app.evaluate(() => memoryPending); if (expected) assert.match(result.error, /context changed|no longer current|local data or authentication changed/); else assert.equal(result.reply, "Fixture quest answer"); };
    await startPending(); observedAt += 60; await writeGame(); await call("refreshGame"); await finishPending(false);
    await startPending(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur()); await finishPending(false);
    for (const action of [
      () => call("companionContext", { profileId: "Alpha", view: "ai" }),
      () => call("companionContext", { profileId: "Alpha", view: "other" }),
      () => call("saveProvider", { provider: "ollama", model: "fixture", endpoint, authMode: "api" }),
      () => call("clearMemory", "Alpha"),
      async () => { const base = (await call("bootstrap")).state; await call("saveState", { ...base, activeProfileId: "Beta" }, base); },
      async () => { await page.reload(); },
    ]) {
      await startPending(); await action(); await finishPending(true);
      const base = (await call("bootstrap")).state; if (base.activeProfileId !== "Alpha") await call("saveState", { ...base, activeProfileId: "Alpha" }, base);
      await call("companionContext", { profileId: "Alpha", view: "ai" });
    }
    const emptyGame = path.join(dir, "synthetic-empty-client"); await fs.mkdir(path.join(emptyGame, "WTF"), { recursive: true }); await fs.writeFile(path.join(emptyGame, ".flavor.info"), "wowf");
    await app.evaluate(({ app }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json")), { GameSync } = load("./src/core/game-sync.cjs"), install = GameSync.prototype._installAddon;
      GameSync.prototype._installAddon = async function (...args) { if (memoryFixture.holdPreparation) { memoryFixture.preparationRootChanged = this.root === memoryFixture.expectedRoot; await new Promise(resolve => memoryFixture.releasePreparation = resolve); } return install.apply(this, args); };
    });
    await startPending(); await app.evaluate((_electron, root) => { memoryFixture.holdPreparation = true; memoryFixture.expectedRoot = root; }, emptyGame);
    await page.evaluate(root => { window.pendingPreparation = window.backstage.prepareGame(root); }, emptyGame);
    await app.evaluate(async () => { const end = Date.now() + 5000; while (!memoryFixture.releasePreparation) { if (Date.now() > end) throw Error("Source preparation never paused"); await new Promise(r => setTimeout(r, 10)); } });
    assert.equal(await app.evaluate(() => memoryFixture.preparationRootChanged), true);
    await finishPending(true); assert.equal(await call("memoryDraft", "Alpha"), null);
    await app.evaluate(() => { memoryFixture.holdPreparation = false; memoryFixture.releasePreparation(); }); await page.evaluate(() => window.pendingPreparation);
    await ask(); const restoredDraft = await call("memoryDraft", "Alpha"); await call("saveMemory", { profileId: "Alpha", responseId: restoredDraft.responseId });
    await call("companionContext", { profileId: "Alpha", view: "ai" }); assert.equal(await call("memoryDraft", "Alpha"), null);
    await ask(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur()); assert.ok(await call("memoryDraft", "Alpha"));
    await call("exportData"); assert.equal(JSON.parse(await fs.readFile(backup, "utf8")).memories, undefined);
    await app.close(); app = null; page = await launch(); assert.equal((await call("memoryList", "Alpha")).length, 1); assert.equal(await call("memoryDraft", "Alpha"), null);
    const before = (await call("bootstrap")).state; await fs.writeFile(backup, JSON.stringify({ ...before, memories: [{ profileId: "Alpha", exchanges: [{ id: "invalid" }] }] })); await assert.rejects(() => call("importData")); assert.deepEqual((await call("bootstrap")).state, before);
    await fs.writeFile(backup, JSON.stringify(before));
    await app.evaluate(({ app }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json")), { GameSync } = load("./src/core/game-sync.cjs"), disconnect = GameSync.prototype.disconnect;
      GameSync.prototype.disconnect = async function () { if (memoryFixture.holdDisconnect) await new Promise(resolve => memoryFixture.releaseDisconnect = resolve); return disconnect.call(this); }; memoryFixture.holdDisconnect = true;
    });
    await startPending(); await page.evaluate(() => { window.pendingImport = window.backstage.importData(); });
    await app.evaluate(async () => { const end = Date.now() + 5000; while (!memoryFixture.releaseDisconnect) { if (Date.now() > end) throw Error("Import never started"); await new Promise(r => setTimeout(r, 10)); } });
    await assert.rejects(() => call("memoryList", "Alpha")); await assert.rejects(() => ask());
    await app.evaluate(() => { memoryFixture.holdDisconnect = false; memoryFixture.releaseDisconnect(); }); assert.deepEqual((await page.evaluate(() => window.pendingImport)).memories, []); await finishPending(true);
    await ask(); const toDelete = await call("memoryDraft", "Alpha"); state = await call("saveMemory", { profileId: "Alpha", responseId: toDelete.responseId });
    const switched = structuredClone(state); switched.activeProfileId = "Beta"; await call("saveState", switched, state); await assert.rejects(() => call("saveMemory", { profileId: "Alpha", responseId: toDelete.responseId }));
    const deleted = (await call("bootstrap")).state; deleted.profiles = deleted.profiles.filter(p => p.id !== "Alpha"); assert.deepEqual((await call("saveState", deleted)).memories, []);
    await app.evaluate(({ app }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json")), { GameSync } = load("./src/core/game-sync.cjs"), reset = GameSync.prototype.reset;
      GameSync.prototype.reset = async function () { await new Promise(resolve => memoryFixture.releaseReset = resolve); return reset.call(this); };
    });
    await startPending("Beta"); await page.evaluate(() => { window.pendingReset = window.backstage.resetData(); });
    await app.evaluate(async () => { const end = Date.now() + 5000; while (!memoryFixture.releaseReset) { if (Date.now() > end) throw Error("Reset never started"); await new Promise(r => setTimeout(r, 10)); } });
    for (const method of ["memoryDraft", "memoryList", "clearMemory"]) await assert.rejects(() => call(method, "Beta"));
    await assert.rejects(() => call("companionContext", { profileId: "Beta", view: "ai" })); await app.evaluate(() => memoryFixture.releaseReset());
    assert.deepEqual((await page.evaluate(() => window.pendingReset)).memories, []); await finishPending(true); assert.deepEqual((await call("bootstrap")).state.profiles, []); assert.equal(await app.evaluate(() => memoryFixture.launches), 0);
    console.log(`Memory backend source Electron ${process.argv.includes("--short-path") ? "genuine 8.3" : "normal"}: trusted arity, all seven fake provider routes, exact preview/send, main drafts/ownership, stale-response deletion, privacy, ordinary save, restart/import/prune/reset PASS`);
  } finally {
    clearTimeout(watchdog); held?.(); if (app) await app.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const real = await fs.realpath(dir); assert.equal(path.dirname(real).toLowerCase(), tempRoot.toLowerCase()); assert.ok(path.basename(real).startsWith("forever-memory-backend-")); await fs.rm(real, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
