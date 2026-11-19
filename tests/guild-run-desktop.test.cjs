"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { registerGuildRunHandlers } = require("../src/core/guild-run-ipc.cjs");
const { parseGuildRunPack } = require("../src/core/guild-run-pack.cjs");

const draft = { title: "Synthetic run", destination: "Deadmines", meetingPoint: "Entrance",
  local: "2026-11-01T01:30", offset: "-05:00", timeZone: "America/New_York",
  duties: [{ role: "healer", text: "Bring water" }], prep: ["Repair gear", "Bring a potion"] };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || require("node:os").tmpdir(), "bf-guild-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "local"); fs.mkdirSync(dir);
  const destination = path.join(root, "pack.json");
  let version = 0, release, held = false;
  let savePath = destination, cancelled = false;
  function connect() {
    const handlers = new Map();
    const service = registerGuildRunHandlers({ handle: (name, fn) => handlers.set(name, fn), dataDir: dir,
      context: { snapshot: () => version, isCurrent: value => version === value },
      dialog: { showSaveDialog: () => held ? new Promise(r => release = r) : { canceled: cancelled, filePath: savePath },
        showOpenDialog: () => ({ canceled: cancelled, filePaths: [destination] }) }, getWindow: () => null,
      viewerZone: () => "America/Los_Angeles" });
    return { call: (op, ...args) => handlers.get("guildRun")(op, ...args), reset: service.reset };
  }
  return { ...connect(), connect, dir, destination, changeContext: () => version++, hold: () => held = true,
    release: () => release({ canceled: false, filePath: savePath }), target: value => savePath = value,
    cancel: value => cancelled = value };
}

function author(f, fields = draft, base = null) {
  const review = f.call("preview", { draft: fields, base });
  f.call("save", review.token);
  return review;
}

test("author preview is read-only and export writes exactly the saved review, never caller-supplied data", async t => {
  const f = fixture(t);
  const review = f.call("preview", { draft, base: null });
  assert.deepEqual(f.call("list"), { organized: [], received: [] });
  assert.equal(review.pack.start.utc, "2026-11-01T06:30:00.000Z");
  assert.match(review.text, /31\/10\/2026.*23:30:00.*America\/Los_Angeles/);
  assert.throws(() => f.call("preview", { draft: { ...draft, note: "PRIVATE" }, base: null }), /invalid/);
  assert.throws(() => f.call("preview", { draft: { ...draft, local: "2026-03-08T02:30" }, base: null }), /invalid/);
  await assert.rejects(async () => f.call("export", review.token, "json"), /Save/);
  assert.equal(fs.existsSync(f.destination), false);
  assert.throws(() => f.call("save", { ...review.pack }), /review/i);
  f.call("save", review.token);
  assert.equal(await f.call("export", review.token, "json"), true);
  assert.deepEqual(parseGuildRunPack(fs.readFileSync(f.destination)), review.pack);
  assert.equal(await f.call("export", review.token, "text"), true);
  assert.equal(fs.readFileSync(f.destination, "utf8"), review.text);
  const restarted = f.connect();
  assert.deepEqual(restarted.call("organized", review.pack.eventId).pack, review.pack);
});

test("import requires confirmation; revisions retain only unchanged private checks and cancellation retires them", async t => {
  const f = fixture(t);
  const r1 = author(f);
  await f.call("export", r1.token, "json");
  let incoming = await f.call("import");
  assert.deepEqual(f.call("list").received, []);
  assert.equal(incoming.outcome, "imported");
  f.call("accept", incoming.token);
  const { eventId, revision, prep } = r1.pack;
  for (const { id } of prep) f.call("check", { eventId, revision, actionId: id, done: true });
  const bytes = fs.readFileSync(path.join(f.dir, "guild-runs.json"));
  incoming = await f.call("import");
  assert.equal(incoming.outcome, "duplicate");
  assert.throws(() => f.call("accept", incoming.token), /review/i);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, "guild-runs.json")), bytes);
  const r2 = author(f, { ...draft, prep: ["Bring a different potion", "Repair gear"] }, { eventId, revision });
  assert.equal(r2.pack.eventId, eventId);
  assert.equal(r2.pack.revision, 2);
  await f.call("export", r2.token, "json");
  assert.doesNotMatch(fs.readFileSync(f.destination, "utf8"), /completedPrepIds/);
  incoming = await f.call("import");
  f.call("accept", incoming.token);
  assert.deepEqual(f.connect().call("received", eventId).completedPrepIds, [prep[0].id]);
  assert.throws(() => f.call("check", { eventId, revision, actionId: prep[0].id, done: false }), /current/i);
  const cancelled = f.call("cancelRun", { eventId, revision: 2 });
  f.call("save", cancelled.token);
  await f.call("export", cancelled.token, "json");
  incoming = await f.call("import");
  f.call("accept", incoming.token);
  assert.throws(() => f.call("check", { eventId, revision: 3, actionId: prep[0].id, done: false }), /invalid/);
  assert.match(f.call("received", eventId).text, /CANCELLED/);
});

test("cancelled, stale and app-owned file exports do not write; reset retires pending reviews", async t => {
  const f = fixture(t);
  const review = author(f);
  const owned = path.join(f.dir, "state.json");
  fs.writeFileSync(owned, "unchanged");
  f.target(owned);
  await assert.rejects(f.call("export", review.token, "json"), /outside/);
  assert.equal(fs.readFileSync(owned, "utf8"), "unchanged");
  f.target(f.destination);
  f.cancel(true);
  assert.equal(await f.call("export", review.token, "json"), null);
  f.cancel(false);
  f.hold();
  const pending = f.call("export", review.token, "json");
  f.changeContext();
  f.release();
  assert.equal(await pending, null);
  assert.equal(fs.existsSync(f.destination), false);
  const fresh = f.call("organized", review.pack.eventId);
  f.reset();
  assert.deepEqual(f.connect().call("list"), { organized: [], received: [] });
  await assert.rejects(f.call("export", fresh.token, "json"), /review/i);
});

test("cancelled, malformed and oversized imports preserve an open organizer review and local bytes", async t => {
  const f = fixture(t), review = author(f);
  const storeFile = path.join(f.dir, "guild-runs.json"), before = fs.readFileSync(storeFile);
  f.cancel(true);
  assert.equal(await f.call("import"), null);
  f.cancel(false);
  fs.writeFileSync(f.destination, '{"private":"PRIVATE_CANARY"}');
  await assert.rejects(f.call("import"), error => /invalid/.test(error.message) && !error.message.includes("PRIVATE_CANARY"));
  fs.writeFileSync(f.destination, Buffer.alloc(32 * 1024 + 1));
  await assert.rejects(f.call("import"), /up to 32 KiB/);
  assert.deepEqual(fs.readFileSync(storeFile), before);
  assert.equal(await f.call("export", review.token, "json"), true);
});
