"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { GameSync } = require("../src/core/game-sync.cjs");
const { Store } = require("../src/core/store.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { CompanionContext } = require("../src/core/companion-context.cjs");
const { MemoryService } = require("../src/core/memory.cjs");
const runtime = { probe: async () => ({ state: "not-running", checkedAt: null, launchAvailable: false }) };
function gate() { let release; const promise = new Promise(resolve => release = resolve); return { promise, release }; }
async function bounded(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => timer = setTimeout(() => reject(Error("Source hook fixture timed out")), 5000))]); } finally { clearTimeout(timer); } }
async function fixture(t) {
  const temp = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(temp, "bf-source-context-")), resources = [];
  t.after(async () => { for (const sync of resources) sync.close(); const real = await fs.realpath(dir); assert.equal(path.dirname(real).toLowerCase(), temp.toLowerCase()); assert.ok(path.basename(real).startsWith("bf-source-context-")); await fs.rm(real, { recursive: true, force: true }); });
  const roots = [];
  for (const name of ["one", "two"]) { const root = path.join(dir, name); await fs.mkdir(path.join(root, "WTF"), { recursive: true }); await fs.writeFile(path.join(root, ".flavor.info"), "wowf"); roots.push(await fs.realpath(root)); }
  return { dir, roots, resources };
}
test("actual root clear and assignment synchronously retire responses before held source preparation completes", { timeout: 20000 }, async t => {
  const f = await fixture(t), store = new Store(path.join(f.dir, "state"), {});
  store.saveState({ ...defaultState(), profiles: [{ id: "p", name: "Synthetic", realm: "Test", className: "Mage", level: 12, notes: "", goals: [] }], activeProfileId: "p" });
  const context = new CompanionContext(() => store.state), memory = new MemoryService({ store, context }), events = [];
  let sync;
  sync = new GameSync({ dataDir: path.join(f.dir, "game-data"), addonDir: path.join(__dirname, "../addon/BackstageForever"), runtime, onRootChange: event => { assert.equal(sync.root, event.root); events.push(event); context.invalidate("source-root"); } }); f.resources.push(sync);
  await sync.prepare(f.roots[0]); const token = memory.begin("p");
  const validating = gate(), validateRelease = gate(), installing = gate(), installRelease = gate(), originalValidate = sync.validateRoot.bind(sync), originalInstall = sync._installAddon.bind(sync);
  let held = false, pending;
  sync.validateRoot = async root => { if (root === f.roots[1] && !held) { held = true; validating.release(); await validateRelease.promise; } return originalValidate(root); };
  sync._installAddon = async (...args) => { if (args[1] === f.roots[1]) { installing.release(); await installRelease.promise; } return originalInstall(...args); };
  try {
    pending = sync.prepare(f.roots[1]); await bounded(validating.promise);
    assert.equal(sync.root, null); assert.equal(context.isCurrent(token), false, "root clearing must invalidate before validation settles");
    assert.throws(() => memory.complete(token, "Old question", "Old-source reply"), /no longer current/); assert.equal(memory.draft("p"), null);
    const duringClear = memory.begin("p"); validateRelease.release(); await bounded(installing.promise);
    assert.equal(sync.root, f.roots[1]); assert.equal(context.isCurrent(duringClear), false, "new root must invalidate before addon preparation settles");
    assert.throws(() => memory.complete(duringClear, "Interim question", "Interim reply"), /no longer current/); assert.equal(memory.draft("p"), null);
    assert.throws(() => memory.save({ profileId: "p", responseId: token.responseId }), /no longer current/); assert.deepEqual(store.state.memories, []);
    installRelease.release(); await bounded(pending); assert.deepEqual(events.map(event => event.root), [f.roots[0], null, f.roots[1]]);
    const current = memory.begin("p"), count = events.length; await sync.refresh(); await sync.prepare(); assert.equal(events.length, count); assert.equal(context.isCurrent(current), true);
    memory.complete(current, "Current question", "Current-source answer"); assert.equal(memory.draft("p").answer, "Current-source answer");
  } finally { validateRelease.release(); installRelease.release(); if (pending) await bounded(pending); }
});
test("unavailable source notifies once; disconnect, reset, close and stale connects report only actual root transitions", { timeout: 20000 }, async t => {
  const f = await fixture(t), events = [], sync = new GameSync({ dataDir: path.join(f.dir, "game-data"), addonDir: path.join(__dirname, "../addon/BackstageForever"), runtime, onRootChange: event => events.push(event) }); f.resources.push(sync);
  await sync.prepare(f.roots[0]); assert.equal(events.length, 1);
  const away = path.join(f.dir, "moved"); await fs.rename(f.roots[0], away); await sync.refresh(); assert.equal(events.at(-1).reason, "unavailable"); const count = events.length;
  await sync.refresh(); assert.equal(events.length, count, "ordinary unavailable polling does not navigate repeatedly");
  await sync.disconnect(); assert.equal(events.at(-1).root, null); assert.equal(events.at(-1).previousRoot, f.roots[0]); const disconnected = events.length;
  await sync.reset(); sync.close(); assert.equal(events.length, disconnected);
  const reached = gate(), release = gate(), original = sync.validateRoot.bind(sync); let pending;
  sync.validateRoot = async root => { reached.release(); await release.promise; return original(root); };
  try { pending = sync.prepare(f.roots[1]); await bounded(reached.promise); await sync.disconnect(); release.release(); await bounded(pending); assert.equal(sync.root, null); assert.equal(events.length, disconnected); }
  finally { release.release(); if (pending) await bounded(pending); sync.validateRoot = original; }
  await sync.prepare(f.roots[1]); assert.equal(events.at(-1).root, f.roots[1]); await sync.reset(); assert.equal(events.at(-1).root, null);
  await sync.prepare(f.roots[1]); assert.equal(events.at(-1).root, f.roots[1]); sync.close(); assert.equal(events.at(-1).root, null);
});
