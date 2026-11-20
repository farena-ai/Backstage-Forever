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
  const copies = [];
  function connect() {
    const handlers = new Map();
    const service = registerGuildRunHandlers({ handle: (name, fn) => handlers.set(name, fn), dataDir: dir,
      context: { snapshot: () => version, isCurrent: value => version === value },
      dialog: { showSaveDialog: () => held ? new Promise(r => release = r) : { canceled: cancelled, filePath: savePath },
        showOpenDialog: () => ({ canceled: cancelled, filePaths: [destination] }) }, getWindow: () => null,
      clipboard: { writeText: text => copies.push(text) }, viewerZone: () => "America/Los_Angeles" });
    return { call: (op, ...args) => handlers.get("guildRun")(op, ...args), reset: service.reset };
  }
  return { ...connect(), connect, dir, destination, copies, changeContext: () => version++, hold: () => held = true,
    release: () => release({ canceled: false, filePath: savePath }), target: value => savePath = value,
    cancel: value => cancelled = value };
}

function author(f, fields = draft, base = null) {
  const review = f.call("preview", { draft: fields, base });
  f.call("save", review.token);
  return review;
}

const facts = { attendance: ["Confirmed player"], progression: ["Cleared the first wing"],
  assignments: ["Tank handles the first pull"], followUps: ["Review the second pull"], privateNote: "PRIVATE_OFFICER_NOTE" };

test("officer debrief copies only saved manual facts, exactly as reviewed", async t => {
  const f = fixture(t), { token, pack, text } = author(f);
  await f.call("export", token, "json");
  const portable = fs.readFileSync(f.destination);
  const board = f.call("boardChange", token, 0, { type: "entry", id: null, name: "UNCONFIRMED_YES", role: "tank", rsvp: "yes", slot: "assigned" });
  const localBytes = fs.readFileSync(path.join(f.dir, "guild-runs.json"));
  assert.deepEqual(f.call("debrief", token).facts.attendance, []);
  assert.throws(() => f.call("nextRunPreview", token, 0), /confirmed/i);
  assert.throws(() => f.call("nextRunCopy", token, token), /current/i);
  const saved = f.call("debriefSave", token, 0, facts);
  const reopened = f.connect(), reopenedToken = reopened.call("organized", pack.eventId).token;
  assert.deepEqual(reopened.call("debrief", reopenedToken), saved);
  const preview = reopened.call("nextRunPreview", reopenedToken, saved.revision);
  const expected = "Next-run handoff: Synthetic run\n\nConfirmed attendance\n- Confirmed player\n\nProgression\n- Cleared the first wing\n\nAssignments\n- Tank handles the first pull\n\nFollow-ups\n- Review the second pull";
  assert.equal(preview.text, expected);
  assert.deepEqual(f.copies, []);
  assert.equal(reopened.call("nextRunCopy", reopenedToken, preview.token), true);
  assert.deepEqual(f.copies, [expected]);
  assert.deepEqual(f.call("board", token), board);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, "guild-runs.json")), localBytes);
  await f.call("export", token, "json");
  assert.deepEqual(fs.readFileSync(f.destination), portable);
  await f.call("export", token, "text");
  assert.equal(fs.readFileSync(f.destination, "utf8"), text);
});

test("officer debrief rejects stale approvals, unreviewed copies and received ownership", async t => {
  const f = fixture(t), run = author(f), { token, pack: { eventId, revision } } = run;
  for (const input of [{ ...facts, loot: ["Not allowed"] }, { ...facts, attendance: ["a\nb"] },
    { ...facts, progression: Array(17).fill("Too many") }]) assert.throws(() => f.call("debriefSave", token, 0, input), /invalid/i);
  f.call("debriefSave", token, 0, facts);
  let preview = f.call("nextRunPreview", token, 1);
  const other = f.connect(), seen = other.call("organized", eventId);
  other.call("debriefSave", seen.token, 1, { ...facts, progression: ["Correction"] });
  assert.throws(() => f.call("nextRunCopy", token, preview.token), /current/i);
  assert.throws(() => f.call("debriefSave", token, 1, facts), /changed/i);
  preview = f.call("nextRunPreview", token, 2);
  f.call("nextRunDiscard", token);
  assert.throws(() => f.call("nextRunCopy", token, preview.token), /current/i);
  preview = f.call("nextRunPreview", token, 2);
  await f.call("export", token, "json");
  const incoming = await other.call("import");
  assert.throws(() => other.call("debrief", incoming.token), /current/i);
  assert.throws(() => other.call("nextRunCopy", incoming.token, preview.token), /current/i);
  other.call("accept", incoming.token);
  const next = author(other, { ...draft, title: "Revised run" }, { eventId, revision });
  assert.equal(other.call("debrief", next.token).revision, 2);
  assert.throws(() => f.call("nextRunCopy", token, preview.token), /current/i);
  const cancel = other.call("cancelRun", { eventId, revision: 2 });
  other.call("save", cancel.token);
  assert.equal(other.call("debrief", cancel.token).readOnly, true);
  assert.throws(() => other.call("nextRunPreview", cancel.token, 2), /cancelled/i);
  assert.throws(() => other.call("debriefSave", cancel.token, 2, facts), /cancelled/i);
  const different = author(f, { ...draft, title: "Different run" });
  assert.deepEqual(f.call("debrief", different.token).facts.attendance, []);
  const newRecord = f.call("debriefSave", different.token, 0, facts);
  const newPreview = f.call("nextRunPreview", different.token, newRecord.revision);
  f.changeContext();
  assert.throws(() => f.call("nextRunCopy", different.token, newPreview.token), /current/i);
  assert.deepEqual(f.copies, []);
});

test("failed debrief promotion preserves committed bytes and can be retried", t => {
  const f = fixture(t), { token } = author(f);
  const file = path.join(f.dir, "guild-officer-debrief.json");
  const saved = f.call("debriefSave", token, 0, facts);
  const preview = f.call("nextRunPreview", token, saved.revision);
  const original = fs.readFileSync(file), rename = fs.renameSync;
  const fault = t.mock.method(fs, "renameSync", (from, to) => {
    if (to === file) throw Object.assign(new Error("fixture promotion failure"), { code: "EPERM" });
    return rename(from, to);
  });
  const edited = { ...facts, followUps: ["Revised follow-up"] };
  try {
    assert.throws(() => f.call("debriefSave", token, saved.revision, edited), /could not be saved/);
    assert.equal(fault.mock.callCount(), 1);
    assert.deepEqual(fs.readFileSync(file), original);
    assert.deepEqual(fs.readdirSync(f.dir).sort(), ["guild-officer-debrief.json", "guild-runs.json"]);
    assert.equal(f.call("nextRunCopy", token, preview.token), true);
  } finally { fault.mock.restore(); }
  assert.deepEqual(f.call("debriefSave", token, saved.revision, edited).facts, edited);
  assert.throws(() => f.call("nextRunCopy", token, preview.token), /current/i);
  fs.writeFileSync(file, '{"unexpected":"private"}');
  assert.throws(() => f.call("debriefSave", token, 2, edited), /could not be opened/);
  assert.equal(fs.readFileSync(file, "utf8"), '{"unexpected":"private"}');
});

test("manual organizer coverage persists without touching either portable format", async t => {
  const f = fixture(t), run = author(f);
  const boardFile = path.join(f.dir, "guild-organizer.json");
  const packFile = path.join(f.dir, "guild-runs.json"), packBytes = fs.readFileSync(packFile);
  await f.call("export", run.token, "json");
  const portable = fs.readFileSync(f.destination);
  let board = f.call("board", run.token);
  assert.equal(board.revision, 0);
  assert.equal(fs.existsSync(boardFile), false);
  const update = change => (board = f.call("boardChange", run.token, board.revision, change));
  update({ type: "targets", targets: { tank: 1, healer: 1, damage: 0 } });
  const put = (id, name, role, rsvp, slot) => update({ type: "entry", id, name, role, rsvp, slot });
  put(null, "PRIVATE_TANK", "tank", "yes", "bench");
  put(null, "PRIVATE_HEALER", "healer", "maybe", "assigned");
  put(null, "PRIVATE_BACKUP", "healer", "yes", "backup");
  assert.deepEqual(board.coverage.healer, { target: 1, yes: 0, maybe: 1, gap: 1 });
  assert.deepEqual(board.coverage.tank, { target: 1, yes: 0, maybe: 0, gap: 1 });
  put(board.entries[0].id, "PRIVATE_TANK", "tank", "yes", "assigned");
  assert.deepEqual(board.coverage.tank, { target: 1, yes: 1, maybe: 0, gap: 0 });
  assert.equal(board.history.at(-1).before.slot, "bench");
  assert.equal(board.history.at(-1).after.slot, "assigned");
  const other = f.connect(), review = other.call("organized", run.pack.eventId);
  assert.deepEqual(other.call("board", review.token), board);
  assert.deepEqual(fs.readFileSync(packFile), packBytes);
  await f.call("export", run.token, "json");
  assert.deepEqual(fs.readFileSync(f.destination), portable);
  await f.call("export", run.token, "text");
  assert.equal(fs.readFileSync(f.destination, "utf8"), run.text);
});

test("board writes require the current authored review, board revision and a scheduled run", async t => {
  const f = fixture(t), run = author(f), { eventId, revision } = run.pack;
  const other = f.connect(), seen = other.call("organized", eventId);
  const add = { type: "entry", id: null, name: "Manual RSVP", role: "tank", rsvp: "no", slot: "assigned" };
  assert.throws(() => f.call("boardChange", run.token, 0, { ...add, attendance: true }), /invalid/);
  const saved = f.call("boardChange", run.token, 0, add);
  assert.equal(saved.coverage.tank.yes, 0);
  assert.throws(() => other.call("boardChange", seen.token, 0, add), /board changed/);
  const second = author(other, { ...draft, title: "Other event" });
  assert.equal(other.call("board", second.token).revision, 0);
  assert.throws(() => other.call("boardChange", second.token, 0, { type: "remove", id: saved.entries[0].id }), /invalid/);
  await f.call("export", run.token, "json");
  const incoming = await other.call("import");
  other.call("accept", incoming.token);
  assert.throws(() => other.call("board", incoming.token), /current/i);
  const next = author(other, { ...draft, title: "Updated title" }, { eventId, revision });
  assert.deepEqual(other.call("board", next.token), saved);
  assert.throws(() => f.call("boardChange", run.token, saved.revision, add), /current/i);
  f.changeContext();
  assert.throws(() => other.call("boardChange", next.token, saved.revision, add), /current/i);
  const cancel = f.call("cancelRun", { eventId, revision: 2 });
  f.call("save", cancel.token);
  assert.deepEqual(f.call("board", cancel.token), { ...saved, readOnly: true });
  assert.throws(() => f.call("boardChange", cancel.token, saved.revision, add), /read-only/);
  f.reset();
  assert.throws(() => f.call("board", cancel.token), /current/i);
  assert.deepEqual(fs.readdirSync(f.dir), []);
});

test("failed organizer promotion preserves committed bytes and permits retry", t => {
  const f = fixture(t), run = author(f);
  const boardFile = path.join(f.dir, "guild-organizer.json");
  const change = { type: "targets", targets: { tank: 1, healer: 1, damage: 3 } };
  const saved = f.call("boardChange", run.token, 0, change);
  const original = fs.readFileSync(boardFile);
  const rename = fs.renameSync;
  const fault = t.mock.method(fs, "renameSync", (from, to) => {
    if (to === boardFile) throw Object.assign(new Error("fixture promotion failure"), { code: "EPERM" });
    return rename(from, to);
  });
  const edit = { ...change, targets: { ...change.targets, damage: 4 } };
  try {
    assert.throws(() => f.call("boardChange", run.token, saved.revision, edit), /could not be saved/);
    assert.equal(fault.mock.callCount(), 1);
    assert.deepEqual(fs.readFileSync(boardFile), original);
    assert.deepEqual(fs.readdirSync(f.dir).sort(), ["guild-organizer.json", "guild-runs.json"]);
    assert.deepEqual(f.call("board", run.token), saved);
  } finally { fault.mock.restore(); }
  assert.equal(f.call("boardChange", run.token, saved.revision, edit).targets.damage, 4);
  fs.writeFileSync(boardFile, '{"unexpected":"private"}');
  assert.throws(() => f.call("boardChange", run.token, 2, change), /could not be opened/);
  assert.equal(fs.readFileSync(boardFile, "utf8"), '{"unexpected":"private"}');
});

test("officer corrections append to the local authored event without changing either Run Pack format", async t => {
  const f = fixture(t), run = author(f), { eventId, revision } = run.pack;
  const decision = { corrects: null, by: "Officer One", decision: "PRIVATE_MANUAL_DECISION", reason: "PRIVATE_TRIAL_NOTE" };
  const packFile = path.join(f.dir, "guild-runs.json"), packBytes = fs.readFileSync(packFile);
  await f.call("export", run.token, "json");
  const portable = fs.readFileSync(f.destination);
  assert.deepEqual(f.call("officerLog", run.token), { readOnly: false, revision: 0, rows: [] });
  const first = f.call("officerAppend", run.token, 0, decision);
  const corrected = { ...decision, corrects: first.rows[0].id, by: "Officer Two", decision: "PRIVATE_CORRECTED", reason: "PRIVATE_EXPLANATION" };
  assert.throws(() => f.call("officerAppend", run.token, 0, corrected), /changed/);
  assert.throws(() => f.call("officerAppend", run.token, 1, { ...corrected, awarded: true }), /invalid/);
  const second = f.call("officerAppend", run.token, 1, corrected);
  assert.equal(second.revision, 2);
  assert.deepEqual(second.rows[0], first.rows[0]);
  for (const [field, value] of Object.entries(corrected)) assert.equal(second.rows[1][field], value);
  assert.throws(() => f.call("officerAppend", run.token, 2, corrected), /invalid/);
  assert.deepEqual(fs.readFileSync(packFile), packBytes);
  await f.call("export", run.token, "json");
  assert.deepEqual(fs.readFileSync(f.destination), portable);
  const incoming = await f.call("import");
  assert.throws(() => f.call("officerLog", incoming.token), /current/);
  f.call("accept", incoming.token);
  assert.equal(f.call("received", eventId).pack.eventId, eventId);
  assert.throws(() => f.call("officerLog", eventId), /current/);
  assert.throws(() => f.call("officerAppend", run.token, 2, decision), /current/);
  const other = f.connect(), next = author(other, { ...draft, title: "Revised" }, { eventId, revision });
  assert.deepEqual(other.call("officerLog", next.token), second);
  await other.call("export", next.token, "text");
  assert.equal(fs.readFileSync(f.destination, "utf8"), next.text);
  const cancel = other.call("cancelRun", { eventId, revision: 2 });
  other.call("save", cancel.token);
  assert.deepEqual(other.call("officerLog", cancel.token), { ...second, readOnly: true });
  assert.throws(() => other.call("officerAppend", cancel.token, 2, decision), /read-only/);
});

const welcome = { guild: "Synthetic Guild", greeting: "New players are welcome!", recruiting: "Casual dungeon groups", contact: "Ask for a volunteer mentor" };

test("failed officer log promotion leaves every committed row and the previous revision intact", t => {
  const f = fixture(t), run = author(f);
  const file = path.join(f.dir, "guild-officer-log.json");
  const input = { corrects: null, by: "Officer One", decision: "PRIVATE_DECISION", reason: "" };
  const first = f.call("officerAppend", run.token, 0, input), bytes = fs.readFileSync(file);
  const correction = { ...input, corrects: first.rows[0].id, decision: "PRIVATE_CORRECTED", reason: "New facts" };
  const rename = fs.renameSync, fault = t.mock.method(fs, "renameSync", (from, to) => {
    if (to === file) throw Object.assign(new Error("fixture promotion failure"), { code: "EPERM" });
    return rename(from, to);
  });
  try {
    assert.throws(() => f.call("officerAppend", run.token, first.revision, correction), /could not be saved/);
    assert.equal(fault.mock.callCount(), 1);
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.deepEqual(fs.readdirSync(f.dir).sort(), ["guild-officer-log.json", "guild-runs.json"]);
    assert.deepEqual(f.call("officerLog", run.token), first);
  } finally { fault.mock.restore(); }
  assert.equal(f.call("officerAppend", run.token, first.revision, correction).revision, 2);
});

test("welcome export requires a separate review of exactly the allowlisted text", async t => {
  const f = fixture(t), run = author(f);
  const store = path.join(f.dir, "guild-runs.json"), bytes = fs.readFileSync(store);
  f.call("officerAppend", run.token, 0, { corrects: null, by: "PRIVATE_OFFICER", decision: "PRIVATE_DECISION", reason: "PRIVATE_TRIAL" });
  await assert.rejects(async () => f.call("welcomeExport", run.token), /current/);
  assert.throws(() => f.call("welcomePreview", run.token, { ...welcome, notes: "PRIVATE_TRIAL" }), /invalid/);
  assert.throws(() => f.call("welcomePreview", run.token, { ...welcome, guild: "Injected\nOfficer record" }), /invalid/);
  const first = f.call("welcomePreview", run.token, welcome);
  assert.equal(fs.existsSync(f.destination), false);
  const second = f.call("welcomePreview", run.token, { ...welcome, contact: "Message the guild greeter" });
  assert.deepEqual(Object.keys(second).sort(), ["text", "token"]);
  await assert.rejects(async () => f.call("welcomeExport", first.token), /current/);
  await assert.rejects(async () => f.call("welcomeExport", second.token, "unexpected"), /invalid/);
  await assert.rejects(async () => f.call("export", second.token, "text"), /current/);
  assert.throws(() => f.call("officerLog", second.token), /current/);
  assert.equal(second.text, "Welcome to Synthetic Guild\n\nNew players are welcome!\n\nRecruiting: Casual dungeon groups\nContact: Message the guild greeter\n");
  f.target(store);
  await assert.rejects(f.call("welcomeExport", second.token), /outside/);
  assert.deepEqual(fs.readFileSync(store), bytes);
  f.target(f.destination);
  assert.equal(await f.call("welcomeExport", second.token), true);
  assert.deepEqual(fs.readFileSync(f.destination), Buffer.from(second.text));
  assert.deepEqual(fs.readFileSync(store), bytes);
  assert.equal(f.call("welcomeClose", second.token), undefined);
  await assert.rejects(async () => f.call("welcomeExport", second.token), /current/);
  assert.equal(f.call("officerLog", run.token).revision, 1);
});

test("welcome picker cannot publish after review, context, run revision or reset changes", async t => {
  const f = fixture(t), run = author(f);
  const approve = token => f.call("welcomePreview", token, welcome).token;
  f.hold();
  for (const retire of [token => f.call("welcomeClose", token), () => f.changeContext()]) {
    const token = approve(f.call("organized", run.pack.eventId).token), pending = f.call("welcomeExport", token);
    retire(token); f.release();
    assert.equal(await pending, null);
    assert.equal(fs.existsSync(f.destination), false);
  }
  const current = f.call("organized", run.pack.eventId), pending = f.call("welcomeExport", approve(current.token));
  const other = f.connect(), revised = author(other, { ...draft, title: "Revision changed" }, { eventId: run.pack.eventId, revision: 1 });
  f.release();
  assert.equal(await pending, null);
  const revision = f.call("organized", revised.pack.eventId), after = f.call("welcomeExport", approve(revision.token));
  f.reset(); f.release();
  assert.equal(await after, null);
  assert.equal(fs.existsSync(f.destination), false);
});

test("newcomer template offers only generic, editable event wording without creating a run", t => {
  const f = fixture(t);
  const template = f.call("template", "newcomer-mentor");
  assert.equal(template.title, "Newcomer dungeon run");
  assert.equal(template.timeZone, "America/Los_Angeles");
  assert.deepEqual(Object.keys(template).sort(), ["duties", "prep", "timeZone", "title"]);
  assert.match(template.duties[0].text, /volunteer.*mentor/i);
  assert.ok(template.prep.length > 0);
  assert.throws(() => f.call("template", "other"), /invalid/i);
  assert.throws(() => f.call("template", "newcomer-mentor", { journal: "PRIVATE" }), /invalid/i);
  assert.deepEqual(f.call("list"), { organized: [], received: [] });
  assert.deepEqual(fs.readdirSync(f.dir), []);
});

test("author preview is read-only and export writes exactly the saved review, never caller-supplied data", async t => {
  const f = fixture(t);
  const review = f.call("preview", { draft, base: null });
  assert.deepEqual(f.call("list"), { organized: [], received: [] });
  assert.equal(review.pack.start.utc, "2026-11-01T06:30:00.000Z");
  assert.match(review.viewerTime, /31\/10\/2026.*23:30:00.*America\/Los_Angeles/);
  assert.throws(() => f.call("preview", { draft: { ...draft, note: "PRIVATE" }, base: null }), /invalid/);
  assert.throws(() => f.call("preview", { draft: { ...draft, local: "2026-03-08T02:30" }, base: null }), /invalid/);
  await assert.rejects(async () => f.call("export", review.token, "json"), /Save/);
  assert.equal(fs.existsSync(f.destination), false);
  assert.throws(() => f.call("save", { ...review.pack }), /review/i);
  f.call("save", review.token);
  assert.equal(await f.call("export", review.token, "json"), true);
  assert.deepEqual(parseGuildRunPack(fs.readFileSync(f.destination)), review.pack);
  assert.equal(await f.call("export", review.token, "text"), true);
  const text = fs.readFileSync(f.destination, "utf8");
  assert.equal(text, review.text);
  assert.match(text, /America\/New_York.*2026-11-01T06:30:00\.000Z/);
  assert.doesNotMatch(text, /Viewer time|America\/Los_Angeles/);
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
  const cancellationBytes = fs.readFileSync(f.destination);
  const beforeCancellation = fs.readFileSync(path.join(f.dir, "guild-runs.json"));
  for (const hidden of [{ prep: r2.pack.prep }, { duties: r2.pack.duties }]) {
    fs.writeFileSync(f.destination, JSON.stringify({ ...cancelled.pack, ...hidden }));
    await assert.rejects(f.call("import"), /Guild Run Pack is invalid/);
    assert.deepEqual(fs.readFileSync(path.join(f.dir, "guild-runs.json")), beforeCancellation);
  }
  fs.writeFileSync(f.destination, cancellationBytes);
  incoming = await f.call("import");
  f.call("accept", incoming.token);
  assert.throws(() => f.call("check", { eventId, revision: 3, actionId: prep[0].id, done: false }), /invalid/);
  assert.match(f.call("received", eventId).text, /CANCELLED/);
  assert.deepEqual(f.connect().call("received", eventId).completedPrepIds, []);
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

test("reset removes only the Guild Run store and its interrupted atomic writes", async t => {
  const f = fixture(t);
  const review = author(f);
  const bytes = fs.readFileSync(path.join(f.dir, "guild-runs.json"));
  const owned = ["guild-runs.json.b6a14782-91f9-4fe3-83e2-19fcd39f48fd.tmp",
    "guild-runs.json.c6a14782-91f9-4fe3-83e2-19fcd39f48fd.tmp"];
  const unrelated = ["state.json.b6a14782-91f9-4fe3-83e2-19fcd39f48fd.tmp", "guild-runs.json.not-a-uuid.tmp",
    "guild-runs.json.b6a14782-91f9-1fe3-83e2-19fcd39f48fd.tmp", owned[0] + ".bak"];
  for (const name of [...owned, ...unrelated]) fs.writeFileSync(path.join(f.dir, name), bytes);
  f.hold();
  const pending = f.call("export", review.token, "json");
  f.reset();
  f.release();
  assert.equal(await pending, null);
  assert.equal(fs.existsSync(f.destination), false);
  const queued = f.call("preview", { draft, base: null });
  f.reset();
  assert.throws(() => f.call("save", queued.token), /current/i);
  assert.deepEqual(fs.readdirSync(f.dir).sort(), unrelated.sort());
  assert.deepEqual(f.connect().call("list"), { organized: [], received: [] });
  for (const name of unrelated) assert.deepEqual(fs.readFileSync(path.join(f.dir, name)), bytes);
});

test("failed orphan removal does not report reset success and can be retried", t => {
  const f = fixture(t);
  author(f);
  const store = path.join(f.dir, "guild-runs.json"), bytes = fs.readFileSync(store);
  const orphan = `${store}.b6a14782-91f9-4fe3-83e2-19fcd39f48fd.tmp`;
  fs.writeFileSync(orphan, bytes);
  const queued = f.call("preview", { draft, base: null });
  const rm = fs.rmSync;
  const fault = t.mock.method(fs, "rmSync", (file, options) => {
    if (file === orphan) throw Object.assign(new Error(`Cannot unlink ${file}`), { code: "EPERM" });
    return rm(file, options);
  });
  try {
    assert.throws(() => f.reset(), { message: "Guild Run Pack local runs could not be deleted. Try again." });
    assert.equal(fault.mock.callCount(), 1);
    assert.deepEqual(fs.readFileSync(store), bytes);
    assert.deepEqual(fs.readFileSync(orphan), bytes);
    assert.throws(() => f.call("save", queued.token), /current/i);
  } finally { fault.mock.restore(); }
  f.reset();
  assert.deepEqual(fs.readdirSync(f.dir), []);
});
