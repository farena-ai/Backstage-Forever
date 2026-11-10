"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { buildDiagnostics, MAX_REPORT_BYTES } = require("../src/core/diagnostics.cjs");
const now = () => Date.UTC(2026, 10, 10, 12);
const canary = "PRIVATE_CANARY_<script>SECRET</script>_C:/private/token";
test("fixed report projects local safe facts and uses the injected clock", () => {
  const result = buildDiagnostics({ version: "0.12.3", channel: "preview", platform: "win32", arch: "x64", secureStorage: true, profileCount: 4, provider: { id: "openai", authMode: "subscription", keyPresent: true }, game: { phase: "synced", companionState: "saved", coverage: { partial: true, unreadableAccountCount: 2 } }, reference: { phase: "ready", packBuild: "1.60.1.70862", counts: { quests: 123 } }, updater: { phase: "error", diagnostic: { code: "NETWORK" } } }, { now });
  assert.equal(result.report.generatedAt, "2026-11-10T12:00:00.000Z");
  assert.equal(result.report.provider.id, "openai"); assert.equal(result.report.provider.accessMode, "subscription");
  assert.equal(result.report.game.unreadableAccountCount, 2);
  assert.match(result.text, /Profile count: 4/); assert.match(result.text, /Checkpoint phase: unknown/);
  assert.ok(Buffer.byteLength(result.text) <= MAX_REPORT_BYTES);
  assert.equal(result.text, buildDiagnostics({ version: "0.12.3", channel: "preview", platform: "win32", arch: "x64", secureStorage: true, profileCount: 4, provider: { id: "openai", authMode: "subscription", keyPresent: true }, game: { phase: "synced", companionState: "saved", coverage: { partial: true, unreadableAccountCount: 2 } }, reference: { phase: "ready", packBuild: "1.60.1.70862", counts: { quests: 123 } }, updater: { phase: "error", diagnostic: { code: "NETWORK" } } }, { now }).text);
});
test("private state and every malformed allowlisted field stay out of object and text", () => {
  const input = { version: canary, channel: canary, platform: canary, arch: canary, secureStorage: canary, profileCount: -1, generatedAt: canary, profiles: [{ name: canary, notes: canary, source: { id: canary } }], provider: { id: canary, authMode: canary, keyPresent: canary, model: canary, endpoint: canary, account: canary }, game: { phase: canary, companionState: canary, message: canary, root: canary, runtime: { state: canary }, coverage: { partial: canary, unreadableAccountCount: canary } }, reference: { phase: canary, packBuild: canary, sourceUrl: canary, counts: { quests: canary } }, updater: { phase: canary, currentVersion: canary, diagnostic: { code: canary, message: canary } }, recovery: { status: canary, count: canary }, memories: canary, error: canary };
  const { report, text } = buildDiagnostics(input, { now });
  assert.doesNotMatch(JSON.stringify(report) + text, /PRIVATE_CANARY|script|private\/token/);
  assert.equal(report.provider.id, "unknown"); assert.equal(report.provider.keyPresent, "unknown"); assert.equal(report.profileCount, "unknown");
  assert.equal(report.recovery.phase, "unknown");
});
test("bounded primitive grammar rejects coercion, oversized counts and versions", () => {
  for (const value of [NaN, Infinity, -1, 1.5, 1000001, "5", {}, []]) assert.equal(buildDiagnostics({ profileCount: value }, { now }).report.profileCount, "unknown");
  for (const value of ["1.2.3\nsecret", "01.2.3", "9".repeat(200), {}, null]) assert.equal(buildDiagnostics({ version: value }, { now }).report.version, "unknown");
  assert.equal(buildDiagnostics(null, { now }).report.platform, "unknown");
  assert.equal(buildDiagnostics({ recovery: { phase: "ready", automatic: true, count: 3 } }, { now }).report.recovery.count, 3);
});
test("text is exact fixed-order readable projection with no source metadata", () => {
  const { report, text } = buildDiagnostics({}, { now });
  assert.equal(Object.keys(report).join(","), "schema,generatedAt,version,channel,platform,arch,secureStorage,profileCount,provider,game,reference,updater,recovery");
  assert.equal(text.split("\n")[0], "Backstage Forever — local support report");
  assert.ok(text.endsWith("\n")); assert.doesNotMatch(text, /undefined|null|\[object Object\]/);
});
test("real four-part reference builds remain useful while malformed suffixes are excluded", () => {
  assert.equal(buildDiagnostics({ reference: { packBuild: "1.60.1.70862" } }, { now }).report.reference.build, "1.60.1.70862");
  for (const value of ["6005", "1.60.1.70862\nPRIVATE", "1.60.1.70862-secret", "1234.1.1.1", "1.1.1.123456789", {}]) assert.equal(buildDiagnostics({ reference: { packBuild: value } }, { now }).report.reference.build, "unknown");
});
test("current waiting and offline states remain diagnostic facts", () => {
  const { report } = buildDiagnostics({ game: { phase: "waiting" }, reference: { phase: "offline" } }, { now });
  assert.equal(report.game.phase, "waiting"); assert.equal(report.reference.phase, "offline");
});
test("recovery projects only fixed phase, automatic and count; never dates or identity", () => {
  const { report, text } = buildDiagnostics({ recovery: { phase: "limit", automatic: false, count: 3, latestAt: canary, id: canary, path: canary } }, { now });
  assert.equal(report.recovery.phase, "limit"); assert.equal(report.recovery.automatic, false); assert.equal(report.recovery.count, 3); assert.doesNotMatch(JSON.stringify(report) + text, /PRIVATE_CANARY/);
});
