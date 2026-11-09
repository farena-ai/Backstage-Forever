"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { defaultState, validateState } = require("../src/core/validation.cjs");
const { Store } = require("../src/core/store.cjs");
const { mergeOrdinaryState } = require("../src/core/company-ipc.cjs");
const id = "7a155d79-e58f-4e24-9e15-b5ff7a322bdd";
const exchange = () => ({ id, createdAt: "2026-11-09T12:00:00.000Z", question: "Where is my quest?", answer: "Check the map." });
const state = () => ({ ...defaultState(), profiles: ["p", "q"].map(id => ({ id, name: id, realm: "Test", className: "Mage", level: 10, notes: "PRIVATE_NOTES", goals: [] })), activeProfileId: "p" });
function fixture(t) {
  const root = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(root, "bf-memory-"));
  t.after(() => { const real = fs.realpathSync(dir); assert.equal(path.dirname(real).toLowerCase(), root.toLowerCase()); assert.ok(path.basename(real).startsWith("bf-memory-")); fs.rmSync(real, { recursive: true, force: true }); });
  const store = new Store(dir, { isEncryptionAvailable: () => true, encryptString: x => Buffer.from(x), decryptString: x => x.toString() });
  store.saveState(state()); return { dir, store };
}
test("optional memory schema normalizes legacy data and strictly validates bounded owned exchanges", () => {
  const s = state(); delete s.memories; assert.deepEqual(validateState(s).memories, []);
  s.memories = [{ profileId: "p", exchanges: [exchange()] }]; assert.deepEqual(validateState(s).memories, s.memories);
  const reject = edit => { const bad = structuredClone(s); edit(bad); assert.throws(() => validateState(bad)); };
  for (const key of ["id", "createdAt", "question", "answer"]) reject(b => delete b.memories[0].exchanges[0][key]);
  for (const [key, value] of [["id", "not-uuid"], ["createdAt", "2026-02-30T00:00:00.000Z"], ["createdAt", "2026-11-09"], ["question", " "], ["answer", "\0"], ["question", "q".repeat(1001)], ["answer", "a".repeat(2001)], ["extra", true]]) reject(b => b.memories[0].exchanges[0][key] = value);
  reject(b => b.memories.push(structuredClone(b.memories[0])));
  reject(b => b.memories[0].profileId = "missing");
  reject(b => b.memories.push({ profileId: "q", exchanges: [exchange()] }));
  reject(b => b.memories[0].exchanges = Array(21).fill(exchange()));
  reject(b => b.memories = Array(101).fill(b.memories[0]));
});
test("ordinary saves preserve latest owned memory before validation; deletion prunes; export/import/reset are private and atomic", t => {
  const { store, dir } = fixture(t), memories = [{ profileId: "p", exchanges: [exchange()] }];
  assert.equal(typeof store.saveMemories, "function"); store.saveMemories(memories);
  const stale = state(); stale.memories = "renderer forgery";
  assert.deepEqual(store.saveState(stale).memories, memories);
  assert.deepEqual(mergeOrdinaryState(store.state, stale).memories, memories);
  assert.deepEqual(new Store(dir, store.safe).state.memories, memories);
  const exported = store.exportData(); assert.equal(JSON.parse(exported).memories, undefined);
  const before = structuredClone(store.state), disk = fs.readFileSync(store.file, "utf8");
  assert.throws(() => store.importData(JSON.stringify({ ...before, memories: [{ profileId: "p", exchanges: [{ ...exchange(), extra: true }] }] })));
  assert.deepEqual(store.state, before); assert.equal(fs.readFileSync(store.file, "utf8"), disk);
  assert.deepEqual(store.importData(JSON.stringify(before)).memories, []);
  store.saveMemories(memories); const deleted = { ...state(), profiles: [state().profiles[1]], activeProfileId: "q" };
  assert.deepEqual(store.saveState(deleted).memories, []);
  store.saveState(state()); store.saveMemories(memories); assert.deepEqual(store.reset().memories, []);
});
test("preview is exact, detached, explicit, character-owned, untrusted and bounded", () => {
  const modulePath = path.join(__dirname, "../src/core/memory.cjs"); assert.ok(fs.existsSync(modulePath), "memory builder exists");
  const { buildMemoryPrompt } = require(modulePath); const s = state(); s.memories = [{ profileId: "p", exchanges: [exchange()] }];
  assert.deepEqual(buildMemoryPrompt(s, { profileId: "p", prompt: "Original", memoryIds: [] }), { prompt: "Original", excerpts: [] });
  const result = buildMemoryPrompt(s, { profileId: "p", prompt: "Original", memoryIds: [id] });
  assert.ok(result.prompt.endsWith("Original")); assert.match(result.prompt, /untrusted/i); assert.doesNotMatch(result.prompt, /PRIVATE_NOTES/);
  assert.deepEqual(result.excerpts, [exchange()]); result.excerpts[0].answer = "modified"; assert.equal(s.memories[0].exchanges[0].answer, "Check the map.");
  for (const request of [{ profileId: "q", memoryIds: [id] }, { memoryIds: [id, id] }, { memoryIds: ["not-a-uuid"] }, { memoryIds: Array(6).fill(id) }, { prompt: "x".repeat(12000), memoryIds: [id] }]) assert.throws(() => buildMemoryPrompt(s, { profileId: "p", prompt: "Original", ...request }));
});
test("saved-game isolated validation and ordinary profile deletion preserve then prune owned memory", () => {
  const { mergeSnapshot } = require("../src/core/profile-sync.cjs"), s = state(); s.memories = [{ profileId: "p", exchanges: [exchange()] }];
  const observed = mergeSnapshot(s, { observedAt: "2026-11-09T12:00:00.000Z", activeId: "game", characters: [{ id: "game", name: "p", realm: "Test", className: "Mage", level: 12, updatedAt: "2026-11-09T12:00:00.000Z" }] });
  assert.deepEqual(observed.memories, s.memories);
  const edited = structuredClone(s); edited.profiles.shift(); edited.activeProfileId = "q";
  assert.deepEqual(mergeOrdinaryState(s, edited, s).memories, []);
});
test("context generations preserve observations and blur but invalidate explicit repeated navigation and owned selection", () => {
  const modulePath = path.join(__dirname, "../src/core/companion-context.cjs"); assert.ok(fs.existsSync(modulePath), "context controller exists");
  const { CompanionContext } = require(modulePath); let s = state(); const c = new CompanionContext(() => s); let notifications = 0;
  const unsubscribe = c.subscribe(() => notifications++);
  c.notify({ profileId: "p", view: "ai" }); const first = c.snapshot(); assert.ok(c.isCurrent(first));
  s.profiles[0].level++; c.sync(); assert.ok(c.isCurrent(first));
  s.profiles.push({ ...s.profiles[1], id: "new-observed-alt" }); c.sync(); assert.ok(c.isCurrent(first), "observing another character without selecting it is not navigation");
  c.notify({ profileId: "p", view: "ai" }); assert.ok(!c.isCurrent(first));
  assert.throws(() => c.notify({ profileId: "q", view: "ai" })); assert.throws(() => c.notify({ profileId: "p", view: "ai", extra: true }));
  const second = c.snapshot(); s.activeProfileId = "q"; c.sync(); assert.ok(!c.isCurrent(second));
  assert.equal(c.snapshot().profileId, "q"); unsubscribe(); const n = notifications; c.invalidate("test"); assert.equal(notifications, n);
});
test("server drafts bind the reviewed bounded current response and save exactly once; new asks, mutation and navigation retire them", t => {
  const modulePath = path.join(__dirname, "../src/core/memory.cjs"); assert.ok(fs.existsSync(modulePath), "memory controller exists");
  const { store } = fixture(t), { MemoryService } = require(modulePath), { CompanionContext } = require("../src/core/companion-context.cjs");
  const context = new CompanionContext(() => store.state), memory = new MemoryService({ store, context });
  context.notify({ profileId: "p", view: "ai" }); const token = memory.begin("p"); memory.complete(token, "q".repeat(1100), "a".repeat(2100));
  const draft = memory.draft("p"); assert.equal(draft.question.length, 1000); assert.equal(draft.answer.length, 2000); assert.match(draft.responseId, /^[a-f0-9-]{36}$/);
  assert.throws(() => memory.save({ profileId: "p", responseId: draft.responseId, answer: "forged" }));
  const saved = memory.save({ profileId: "p", responseId: draft.responseId }); assert.equal(saved.memories[0].exchanges[0].question, draft.question);
  assert.ok(!context.isCurrent(token), "saving advances the memory mutation generation");
  assert.deepEqual(memory.save({ profileId: "p", responseId: draft.responseId }), saved);
  const late = memory.begin("p"); assert.equal(memory.draft("p"), null); memory.remove({ profileId: "p", id: saved.memories[0].exchanges[0].id });
  assert.throws(() => memory.complete(late, "late", "late")); assert.equal(memory.draft("p"), null);
  const nav = memory.begin("p"); context.notify({ profileId: "p", view: "other" }); assert.throws(() => memory.complete(nav, "old", "old"));
  const next = memory.begin("p"); memory.complete(next, "current", "answer"); const stale = memory.draft("p"); context.invalidate("import"); assert.throws(() => memory.save({ profileId: "p", responseId: stale.responseId }));
  assert.equal(memory.draft("q"), null);
  store.reset(); assert.equal(memory.draft(null), null);
});
