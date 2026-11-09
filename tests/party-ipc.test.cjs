"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { registerPartyHandlers, readPartyFile } = require("../src/core/party-ipc.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { CompanionContext } = require("../src/core/companion-context.cjs");
const { serializePartyPlan } = require("../src/core/party.cjs");
const content = () => ({ title: "Reviewed plan", steps: [{ text: "Inert <script>bad()</script>" }] });
function harness() {
  const h = { state: defaultState(), writes: 0, exports: [], epoch: 0, blocked: false, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: "fixture" }), showOpenDialog: async () => ({ canceled: false, filePaths: ["fixture"] }) } };
  h.context = new CompanionContext(() => h.state); h.handlers = {};
  registerPartyHandlers({ handle: (name, fn) => h.handlers[name] = fn, getState: () => h.state, saveState: state => { h.writes++; h.state = structuredClone(state); }, context: h.context, getEpoch: () => h.epoch, isBlocked: () => h.blocked, dialog: h.dialog, getWindow: () => null, readFile: async () => serializePartyPlan(content()), writeFile: (...args) => h.exports.push(args) });
  return h;
}
test("party trusted handlers enforce exact counts/keys, detached previews and explicit atomic commit", async () => {
  const h = harness(), api = h.handlers;
  for (const [name, args] of [["partyBrief", [{ profileId: null, role: "tank" }]], ["partyPreview", [{ journeyId: "missing" }]], ["exportPartyPlan", [content()]], ["importPartyPlan", []], ["commitPartyPlan", [content()]], ["createPartyJourney", [{ profileId: null, role: "damage" }]]]) {
    await assert.rejects(async () => api[name](...args, "extra"));
    if (args.length) await assert.rejects(async () => api[name]());
  }
  assert.equal(h.writes, 0); assert.equal(h.exports.length, 0);
  assert.equal(api.partyBrief({ profileId: null, role: "tank" }).role, "tank");
  assert.throws(() => api.partyBrief({ profileId: null, role: "tank", notes: "private" }));
  const preview = await api.importPartyPlan(); assert.deepEqual(preview, content()); assert.equal(h.writes, 0);
  preview.steps[0].text = "edited"; const result = api.commitPartyPlan(preview); assert.equal(h.writes, 1);
  assert.equal(result.company.journeys[0].steps[0].completion, "pending");
  assert.equal(result.state.journeys[0].steps[0].profileId, null);
  result.state.journeys.length = 0; assert.equal(h.state.journeys.length, 1);
  const publicPreview = api.partyPreview({ journeyId: result.journeyId }); assert.equal(publicPreview.title, "Shared adventure plan");
  assert.equal(await api.exportPartyPlan(publicPreview), true); assert.deepEqual(JSON.parse(h.exports[0][1]).steps, publicPreview.steps);
  api.createPartyJourney({ profileId: null, role: "healer" }); assert.equal(h.writes, 2);
  for (const value of [{ ...content(), source: "secret" }, { title: "x", steps: [{ text: "x", done: true }] }]) { await assert.rejects(() => api.exportPartyPlan(value)); assert.throws(() => api.commitPartyPlan(value)); }
});
test("cancelled/replaced/reset/context-stale dialogs cannot read/export or mutate", async () => {
  for (const name of ["exportPartyPlan", "importPartyPlan"]) {
    for (const invalidate of [h => h.epoch++, h => h.blocked = true, h => h.context.invalidate("import"), h => h.context.notify({ profileId: null, view: "other" })]) {
      const h = harness(); let release;
      h.dialog[name === "exportPartyPlan" ? "showSaveDialog" : "showOpenDialog"] = () => new Promise(resolve => release = resolve);
      const pending = h.handlers[name](...(name === "exportPartyPlan" ? [content()] : [])); invalidate(h);
      release({ canceled: false, filePath: "fixture", filePaths: ["fixture"] });
      assert.equal(await pending, null); assert.equal(h.writes, 0); assert.equal(h.exports.length, 0);
    }
    const h = harness(); h.dialog.showOpenDialog = h.dialog.showSaveDialog = async () => ({ canceled: true });
    assert.equal(await h.handlers[name](...(name === "exportPartyPlan" ? [content()] : [])), null);
  }
});
test("late read after context change and newer picker is discarded; errors stay generic", async () => {
  let state = defaultState(), release, reads = 0; const handlers = {}, context = new CompanionContext(() => state);
  registerPartyHandlers({ handle: (name, fn) => handlers[name] = fn, getState: () => state, saveState: s => state = s, context, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["fixture"] }) }, getWindow: () => null, readFile: () => { reads++; return new Promise(resolve => release = resolve); } });
  const first = handlers.importPartyPlan(); await new Promise(resolve => setImmediate(resolve));
  context.invalidate("reset"); release(serializePartyPlan(content())); assert.equal(await first, null); assert.equal(reads, 1);
  const second = handlers.importPartyPlan(); await new Promise(resolve => setImmediate(resolve));
  const stale = release; const third = handlers.importPartyPlan(); await new Promise(resolve => setImmediate(resolve));
  stale(serializePartyPlan(content())); assert.equal(await second, null); release(serializePartyPlan(content())); assert.deepEqual(await third, content());
});
test("current capacity and failed save/read leave existing state intact", async () => {
  const h = harness(), api = h.handlers;
  const preview = await api.importPartyPlan();
  h.state.journeys = Array.from({ length: 20 }, (_, n) => ({ id: `j${n}`, title: "Full", createdAt: "2026-11-09T00:00:00.000Z", steps: [] }));
  const before = structuredClone(h.state);
  assert.throws(() => api.commitPartyPlan(preview), /20 journeys/); assert.equal(h.writes, 0); assert.deepEqual(h.state, before);
  const handlers = {}; let writes = 0;
  registerPartyHandlers({ handle: (name, fn) => handlers[name] = fn, getState: () => h.state, saveState: () => writes++, context: h.context, dialog: h.dialog, getWindow: () => null, readFile: async () => { throw Error("PRIVATE_PATH"); }, writeFile: () => { throw Error("PRIVATE_PATH"); } });
  await assert.rejects(() => handlers.exportPartyPlan(content()), e => /^Party plan/.test(e.message) && !e.message.includes("PRIVATE_PATH"));
  await assert.rejects(() => handlers.importPartyPlan(), e => /^Party plan/.test(e.message) && !e.message.includes("PRIVATE_PATH"));
  assert.equal(writes, 0); assert.deepEqual(h.state, before);
});
test("bounded real file read rejects oversized, invalid and nonregular synthetic files", async () => {
  const root = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(root, "forever-party-unit-"));
  try {
    const file = path.join(dir, "fixture.json"); await fs.writeFile(file, serializePartyPlan(content())); assert.deepEqual(await readPartyFile(file), Buffer.from(serializePartyPlan(content())));
    await fs.writeFile(file, Buffer.alloc(65537, 32)); await assert.rejects(() => readPartyFile(file));
    await assert.rejects(() => readPartyFile(dir));
  } finally { const real = await fs.realpath(dir); assert.equal(path.dirname(real).toLowerCase(), root.toLowerCase()); assert.ok(path.basename(real).startsWith("forever-party-unit-")); await fs.rm(real, { recursive: true, force: true }); }
});
