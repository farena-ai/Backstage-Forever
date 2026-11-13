"use strict";
const MAX_REPORT_BYTES = 8192;
const choice = (value, allowed) => typeof value === "string" && allowed.includes(value) ? value : "unknown";
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000 ? value : "unknown";
const bool = value => typeof value === "boolean" ? value : "unknown";
const version = value => typeof value === "string" && /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value) ? value : "unknown";
const build = value => typeof value === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/.test(value) ? value : "unknown";
function buildDiagnostics(input, { now = Date.now } = {}) {
  const s = input && typeof input === "object" ? input : {}, p = s.provider, g = s.game, r = s.reference, u = s.updater;
  // Construct facts explicitly. Private state is never serialized or recursively redacted.
  const report = {
    schema: 1, generatedAt: new Date(now()).toISOString(),
    version: version(s.version), channel: choice(s.channel, ["preview", "stable"]),
    platform: choice(s.platform, ["win32", "darwin", "linux"]), arch: choice(s.arch, ["x64", "arm64", "ia32"]),
    secureStorage: bool(s.secureStorage), profileCount: count(s.profileCount),
    provider: { id: choice(p?.id, ["ollama", "ollama-cloud", "openai", "anthropic", "xai", "local", "gemini", "groq"]), accessMode: choice(p?.authMode, ["api", "subscription"]), keyPresent: bool(p?.keyPresent) },
    game: { phase: choice(g?.phase, ["disconnected", "waiting", "folder-unavailable", "needs-addon", "needs-reload", "invalid-export", "stale", "synced", "error"]), companion: choice(g?.companionState, ["unavailable", "not-prepared", "saved", "update-next-launch", "prepared"]), partial: bool(g?.coverage?.partial), unreadableAccountCount: count(g?.coverage?.unreadableAccountCount), omittedCharacterCount: count(g?.coverage?.omittedCharacterCount), omittedProfileCount: count(g?.coverage?.omittedProfileCount) },
    reference: { phase: choice(r?.phase, ["offline", "refreshing", "mismatch", "ready", "reference", "error", "idle"]), build: build(r?.packBuild), quests: count(r?.counts?.quests), items: count(r?.counts?.items), npcs: count(r?.counts?.npcs) },
    updater: { phase: choice(u?.phase, ["idle", "unsupported", "disabled", "error", "checking", "current", "downloading", "ready"]), code: choice(u?.diagnostic?.code, ["NETWORK", "TIMEOUT", "HTTP", "REDIRECT", "URL", "BODY_ABORT", "SIZE", "HASH", "SIGNATURE", "MANIFEST", "DISCOVERY", "PATH", "PERMISSION", "DISK", "CACHE", "CANCELLED"]), currentVersion: version(u?.currentVersion), availableVersion: version(u?.availableVersion), readyVersion: version(u?.readyVersion) },
    recovery: { phase: choice(s.recovery?.phase, ["ready", "unavailable", "limit"]), automatic: bool(s.recovery?.automatic), count: count(s.recovery?.count) },
  };
  const text = [
    "Backstage Forever — local support report",
    `Report schema: ${report.schema}`,
    `Prepared (UTC): ${report.generatedAt}`,
    `App version: ${report.version}`,
    `Release channel: ${report.channel}`,
    `Platform: ${report.platform}`,
    `Architecture: ${report.arch}`,
    `Secure credential storage available: ${report.secureStorage}`,
    `Profile count: ${report.profileCount}`,
    "",
    `Selected provider: ${report.provider.id}`,
    `Configured access mode (not verified access): ${report.provider.accessMode}`,
    `Selected provider key present: ${report.provider.keyPresent}`,
    "",
    `Game connection: ${report.game.phase}`,
    `Companion setup: ${report.game.companion}`,
    `Partial game coverage: ${report.game.partial}`,
    `Unreadable account count: ${report.game.unreadableAccountCount}`,
    `Omitted character count: ${report.game.omittedCharacterCount}`,
    `Omitted profile count: ${report.game.omittedProfileCount}`,
    "",
    `Reference status: ${report.reference.phase}`,
    `Reference build: ${report.reference.build}`,
    `Reference quests: ${report.reference.quests}`,
    `Reference item names: ${report.reference.items}`,
    `Reference NPCs: ${report.reference.npcs}`,
    "",
    `Updater phase: ${report.updater.phase}`,
    `Updater diagnostic code: ${report.updater.code}`,
    `Installed version: ${report.updater.currentVersion}`,
    `Available version: ${report.updater.availableVersion}`,
    `Ready version: ${report.updater.readyVersion}`,
    "",
    `Checkpoint phase: ${report.recovery.phase}`,
    `Automatic local protection: ${report.recovery.automatic}`,
    `Checkpoint count: ${report.recovery.count}`,
    ""
  ].join("\n");
  if (Buffer.byteLength(text, "utf8") > MAX_REPORT_BYTES) throw Error("Report limit exceeded.");
  return { report, text };
}
module.exports = { buildDiagnostics, MAX_REPORT_BYTES };
