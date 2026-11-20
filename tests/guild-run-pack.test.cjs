"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const guild = require("../src/core/guild-run-pack.cjs");

function draft(overrides = {}) {
  return {
    eventId: "8af96521-0f7f-43b1-82e2-246e5c911cff", revision: 1, status: "scheduled",
    title: "Blackrock Depths practice", destination: "Blackrock Depths", meetingPoint: "Meet at the entrance",
    start: { utc: "2026-11-01T05:30:00.000Z", timeZone: "America/New_York" },
    duties: [{ role: "tank", text: "Mark the first target" }, { role: "healer", text: "Call mana breaks" }],
    prep: [{ id: "repair", text: "Repair before leaving" }, { id: "bags", text: "Free five bag slots" }],
    ...overrides,
  };
}

function pack(overrides) { return guild.previewGuildRunPack(draft(overrides), "Europe/Paris").pack; }

test("projects only explicitly shareable fields and round-trips the reviewed pack offline", () => {
  const event = draft({ privateNotes: "PRIVATE_NOTES", roster: ["PRIVATE_ROSTER"], rsvp: "PRIVATE_RSVP", profileId: "PRIVATE_PROFILE" });
  event.start.sourcePath = "PRIVATE_PATH";
  event.duties[0].officerNote = "PRIVATE_OFFICER";
  event.prep[0].done = true;
  event.prep[0].owner = "PRIVATE_OWNER";
  const preview = guild.previewGuildRunPack(event, "Europe/Paris");
  assert.deepEqual(preview.pack, { format: "backstage-forever-guild-run", version: 1, ...draft() });
  const wire = guild.serializeGuildRunPack(preview.pack);
  event.title = "Not in the reviewed copy";
  assert.deepEqual(guild.parseGuildRunPack(Buffer.from(wire)), preview.pack);
  assert.match(preview.text, /tank: Mark the first target/);
  assert.match(preview.text, /Repair before leaving/);
  assert.match(preview.text, /Blackrock Depths/);
  assert.match(preview.text, /not live sync/i);
  assert.match(preview.text, /cannot retract/i);
  assert.doesNotMatch(wire + preview.text, /PRIVATE_|Not in the reviewed copy/);
  assert.throws(() => guild.serializeGuildRunPack({ ...preview.pack, privateNotes: "local" }), /invalid/i);
});

test("requires an explicit offset for ambiguous wall time and rejects DST gaps", () => {
  const start = (local, offset) => guild.resolveGuildRunStart({ local, offset, timeZone: "America/New_York" });
  const first = start("2026-11-01T01:30", "-04:00");
  const second = start("2026-11-01T01:30", "-05:00");
  assert.deepEqual(first, draft().start);
  assert.equal(second.utc, "2026-11-01T06:30:00.000Z");
  assert.throws(() => start("2026-11-01T01:30", undefined), /invalid/i);
  assert.throws(() => start("2026-11-01T01:30", "-06:00"), /invalid/i);
  assert.throws(() => start("2026-03-08T02:30", "-05:00"), /invalid/i);
  assert.throws(() => start("2026-02-30T14:00", "-05:00"), /invalid/i);
  const firstPreview = guild.previewGuildRunPack(draft({ start: first }), "Europe/Paris");
  const secondPreview = guild.previewGuildRunPack(draft({ start: second }), "Europe/Paris");
  assert.match(firstPreview.viewerTime, /06:30.*GMT\+01:00.*Europe\/Paris/);
  assert.match(secondPreview.viewerTime, /07:30.*GMT\+01:00.*Europe\/Paris/);
  assert.equal(firstPreview.text, guild.previewGuildRunPack(draft({ start: first }), "UTC").text);
  assert.doesNotMatch(firstPreview.text, /Europe\/Paris|Viewer time/);
});

test("imports once by event ID and revision; stale and conflicting copies cannot overwrite it", () => {
  const original = pack();
  const copy = guild.parseGuildRunPack(guild.serializeGuildRunPack(original));
  const saved = guild.applyGuildRunPack(null, copy);
  assert.equal(saved.outcome, "imported");
  assert.deepEqual(saved.record, { pack: original, completedPrepIds: [] });
  assert.deepEqual(guild.applyGuildRunPack(saved.record, original), { outcome: "duplicate", record: saved.record });
  assert.deepEqual(guild.applyGuildRunPack(saved.record, pack({ title: "Competing edit" })), { outcome: "conflict", record: saved.record });

  const revised = pack({ revision: 3, title: "Rescheduled practice", start: { ...draft().start, utc: "2026-11-01T06:30:00.000Z" } });
  const updated = guild.applyGuildRunPack(saved.record, revised);
  assert.equal(updated.outcome, "updated");
  assert.deepEqual(updated.record.pack, revised);
  assert.deepEqual(guild.applyGuildRunPack(updated.record, pack({ revision: 2 })), { outcome: "stale", record: updated.record });
  assert.throws(() => guild.applyGuildRunPack(updated.record, pack({ eventId: "fcb9c3aa-9036-480b-86ce-e31c5e707efa" })), /invalid/i);
});

test("keeps private completion only for unchanged actions after a restart and revision", () => {
  const original = pack();
  const record = guild.applyGuildRunPack(null, original).record;
  const first = guild.setGuildRunPrepDone(record, "repair", true);
  const complete = guild.setGuildRunPrepDone(first, "bags", true);
  assert.deepEqual(record.completedPrepIds, []);
  assert.deepEqual(guild.setGuildRunPrepDone(complete, "bags", false).completedPrepIds, ["repair"]);
  assert.throws(() => guild.setGuildRunPrepDone(complete, "unknown", true), /invalid/i);
  assert.throws(() => guild.serializeGuildRunPack(complete), /invalid/i);

  const restarted = JSON.parse(JSON.stringify(complete));
  assert.deepEqual(guild.applyGuildRunPack(restarted, original).record, complete);
  const revised = pack({ revision: 2, prep: [{ id: "bags", text: "Free eight bag slots" }, original.prep[0], { id: "food", text: "Bring food" }] });
  assert.deepEqual(guild.applyGuildRunPack(restarted, revised).record.completedPrepIds, ["repair"]);
  assert.deepEqual(guild.applyGuildRunPack(restarted, pack({ revision: 2, prep: [] })).record.completedPrepIds, []);
});

test("cancellation works as a first import and cannot be reverted by a scheduled copy", () => {
  const original = pack();
  const record = guild.setGuildRunPrepDone(guild.applyGuildRunPack(null, original).record, "repair", true);
  const cancellation = guild.previewGuildRunPack(draft({ revision: 2, status: "cancelled", duties: [], prep: [] }), "UTC");
  const imported = guild.applyGuildRunPack(null, cancellation.pack);
  const result = guild.applyGuildRunPack(record, cancellation.pack);
  assert.equal(imported.outcome, "imported");
  assert.equal(result.outcome, "updated");
  assert.equal(result.record.pack.status, "cancelled");
  assert.deepEqual(imported.record.completedPrepIds, []);
  assert.deepEqual(result.record.completedPrepIds, []);
  assert.match(cancellation.text, /CANCELLED.*revision 2/);
  assert.match(cancellation.text, /Former start/);
  assert.doesNotMatch(cancellation.text, /Prep:|Mark the first target/);
  assert.throws(() => guild.setGuildRunPrepDone(result.record, "repair", false), /invalid/i);
  assert.equal(guild.applyGuildRunPack(result.record, original).outcome, "stale");
  assert.equal(guild.applyGuildRunPack(result.record, cancellation.pack).outcome, "duplicate");
  assert.deepEqual(guild.applyGuildRunPack(result.record, pack({ revision: 3 })), { outcome: "conflict", record: result.record });
});

test("cancellations cannot carry hidden duties or prep in a preview, wire copy or applied revision", () => {
  const original = pack();
  const record = guild.setGuildRunPrepDone(guild.applyGuildRunPack(null, original).record, "repair", true);
  const cancelled = { ...original, revision: 2, status: "cancelled", duties: [], prep: [] };
  for (const hidden of [{ duties: original.duties }, { prep: original.prep }]) {
    const invalid = { ...cancelled, ...hidden };
    assert.throws(() => guild.previewGuildRunPack(invalid, "UTC"), /invalid/i);
    assert.throws(() => guild.serializeGuildRunPack(invalid), /invalid/i);
    assert.throws(() => guild.parseGuildRunPack(JSON.stringify(invalid)), /invalid/i);
    assert.throws(() => guild.applyGuildRunPack(null, invalid), /invalid/i);
    assert.throws(() => guild.applyGuildRunPack(record, invalid), /invalid/i);
    assert.deepEqual(record.completedPrepIds, ["repair"]);
  }
});

test("rejects malformed or ambiguous imported copies without echoing their contents", () => {
  const original = pack();
  const wire = guild.serializeGuildRunPack(original);
  const fixtures = [
    ["wrong format", JSON.stringify({ ...original, format: "backstage-forever-party" })],
    ["unsupported version", JSON.stringify({ ...original, version: 2 })],
    ["invalid revision", JSON.stringify({ ...original, revision: 1.5 })],
    ["bad UTC date", wire.replace("2026-11-01", "2026-11-31")],
    ["unknown zone", wire.replace("America/New_York", "Private/Zone")],
    ["extra nested fields", JSON.stringify({ ...original, prep: [{ ...original.prep[0], done: true }] })],
    ["duplicate action IDs", JSON.stringify({ ...original, prep: [original.prep[0], original.prep[0]] })],
    ["escaped duplicate key", wire.replace('"role": "tank"', '"r\\u006fle": "all", "role": "tank"')],
    ["unknown key", wire.replace('"title":', '"__proto__": {"privateNote": "PRIVATE"}, "title":')],
    ["line injection", JSON.stringify({ ...original, title: "Practice\nCANCELLED" })],
    ["trailing input", wire + " PRIVATE"],
    ["invalid UTF-8", Buffer.from(wire.replace("Blackrock", "Xlackrock")).map(byte => byte === 88 ? 255 : byte)],
    ["oversized raw bytes", wire + " ".repeat(guild.MAX_GUILD_RUN_BYTES)],
  ];
  for (const [description, raw] of fixtures) {
    assert.throws(() => guild.parseGuildRunPack(raw), { message: "Guild Run Pack is invalid. Check its format and event fields." }, description);
  }
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(original).reverse()));
  assert.equal(guild.applyGuildRunPack(guild.applyGuildRunPack(null, original).record, guild.parseGuildRunPack(reordered)).outcome, "duplicate");
});

test("bounds preview and export by encoded bytes, not just character counts", () => {
  const text = "界".repeat(240);
  const large = draft({
    duties: Array.from({ length: 16 }, () => ({ role: "all", text })),
    prep: Array.from({ length: 32 }, (_, i) => ({ id: `action-${i}`, text })),
  });
  assert.throws(() => guild.previewGuildRunPack(large, "UTC"), /invalid/i);
  assert.throws(() => guild.serializeGuildRunPack({ ...pack(), ...large }), /invalid/i);
  assert.throws(() => guild.previewGuildRunPack(draft({ prep: Array(2) }), "UTC"), /invalid/i);
});
