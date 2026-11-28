const test = require("node:test");
const assert = require("node:assert/strict");
const { identityHash, rememberLiveKey } = require("../src/core/live-bridge.cjs");
const { matchingLiveFrame, characterContext } = require("../src/core/character-freshness.cjs");
const view = require("../src/renderer/character-freshness.js");

const now = Date.parse("2026-11-28T14:15:00Z");
const updatedAt = "2026-11-28T14:00:00Z";
const character = { id: "selected", source: { kind: "wow-addon", id: "freshness-fixture", updatedAt } };
const guid = "Player-4373-0000002A";
const frame = { characterHash: identityHash(guid), position: { mapId: 1454 }, receivedAt: now };
const live = { enabled: true, signal: "live", frame };

test("live context requires a fresh signal and a confirmed match for the active character", () => {
  assert.equal(matchingLiveFrame(character, live), null);
  rememberLiveKey(character.source.id, guid);
  assert.equal(matchingLiveFrame(character, live), frame);
  assert.equal(matchingLiveFrame(character, { ...live, signal: "minimized" }), null);
  assert.equal(matchingLiveFrame(character, { ...live, frame: { ...frame, characterHash: 125 } }), null);
  assert.equal(matchingLiveFrame(character, { ...live, frame: { ...frame, characterHash: null } }), null);
  assert.equal(matchingLiveFrame({ id: "manual" }, live), null);
});

test("an answer carries a fixed evidence timestamp and only the context allowed for that question", () => {
  assert.deepEqual(characterContext(character, frame, true, now), { kind: "live", savedAt: Date.parse(updatedAt), checkedAt: now });
  assert.deepEqual(characterContext(character, null, true, now), { kind: "saved", savedAt: Date.parse(updatedAt), checkedAt: now });
  assert.deepEqual(characterContext(character, frame, false, now), { kind: "none" });
  assert.equal(characterContext({ id: "manual" }, null, true, now).kind, "manual");
  assert.equal(characterContext(null, frame, true, now).kind, "none");
  assert.equal(view.answer({ kind: "saved", savedAt: Date.parse(updatedAt), checkedAt: now }), "Character data at reply · Last saved 15 min ago");
});

test("the user sees one recovery action for an old save and specific guidance for the failure", () => {
  const saved = Date.parse(updatedAt);
  assert.deepEqual(view.header({ kind: "saved", savedAt: saved, checkedAt: now - 60_000 }), { text: "Last saved 14 min ago", repair: false });
  assert.deepEqual(view.header({ kind: "saved", savedAt: saved, checkedAt: now }), { text: "Last saved 15 min ago", repair: true });
  assert.deepEqual(view.header({ kind: "live", savedAt: saved, checkedAt: now }), { text: "Live", repair: false });
  assert.match(view.recovery({ signal: "minimized" }), /Restore the WoW window/);
  assert.match(view.recovery({ signal: "off" }), /\/reload/);
  assert.match(view.recovery({ signal: "no-signal" }), /\/bf live on/);
});
