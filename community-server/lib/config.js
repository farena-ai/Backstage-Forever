"use strict";
// Runtime configuration. Everything comes from environment variables so the
// systemd unit can load a mode-600 env file (--env-file) holding the salt.
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { parseEmailList, parseDiscordWebhook } = require("./notify");
const { parseRepo, parseToken } = require("./downloads");

const DEFAULT_ENV_FILE = path.join(os.homedir(), "bf-community", "secrets", "bf-community.env");
const DEFAULT_DB = path.join(os.homedir(), "bf-community", "data", "community.db");

function intEnv(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer ${min}..${max}`);
  return n;
}

// Loads the env file into process.env for tools (admin.js) that are run by hand
// without --env-file. Existing variables win. Never prints values.
function loadEnvFileIfPresent(file = process.env.BF_COMMUNITY_ENV_FILE || DEFAULT_ENV_FILE) {
  if (!fs.existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

const DAY = 86_400_000;

function origin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("BF_DESK_PUBLIC_ORIGIN is not a valid URL"); }
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) throw new Error("BF_DESK_PUBLIC_ORIGIN must be an origin such as https://example.com");
  return url.origin;
}

function sendmailPath(value) {
  if (value === undefined || value === "") return "/usr/sbin/sendmail";
  if (!path.isAbsolute(value)) throw new Error("BF_DESK_SENDMAIL must be an absolute path");
  return value;
}

function backupDir(env) {
  const raw = env.BF_DESK_BACKUP_DIR;
  if (raw === "off" || raw === "") return null;
  if (raw) return raw;
  const dbPath = env.BF_COMMUNITY_DB || DEFAULT_DB;
  return dbPath === ":memory:" ? null : path.join(path.dirname(path.dirname(dbPath)), "backups", "nightly");
}

function loadConfig(env = process.env, overrides = {}) {
  const salt = overrides.salt ?? env.BF_COMMUNITY_SALT;
  if (typeof salt !== "string" || salt.length < 32)
    throw new Error("BF_COMMUNITY_SALT is missing or shorter than 32 characters");
  const config = {
    host: env.BF_COMMUNITY_HOST || "127.0.0.1",
    port: intEnv(env, "BF_COMMUNITY_PORT", 5081, 0, 65535),
    dbPath: env.BF_COMMUNITY_DB || DEFAULT_DB,
    salt,
    // k-anonymity: a fact is published only once this many distinct installs agree.
    minInstalls: intEnv(env, "BF_COMMUNITY_MIN_INSTALLS", 3, 2, 1000),
    // The pack is rebuilt at most this often (ms) after new data arrives.
    packRebuildMs: intEnv(env, "BF_COMMUNITY_PACK_REBUILD_MS", 5 * 60 * 1000, 0, 24 * 3600 * 1000),
    maxReports: intEnv(env, "BF_COMMUNITY_MAX_REPORTS", 10000, 1, 1e7),
    // Trust X-Forwarded-For only from a loopback peer (the Apache proxy).
    trustProxy: (env.BF_COMMUNITY_TRUST_PROXY ?? "1") !== "0",
    limits: {
      perIp: { limit: intEnv(env, "BF_COMMUNITY_RL_IP_PER_MIN", 120, 1, 1e6), windowMs: 60_000 },
      submitPerInstall: { limit: intEnv(env, "BF_COMMUNITY_RL_SUBMIT_PER_HOUR", 30, 1, 1e6), windowMs: 3_600_000 },
      submitGlobal: { limit: intEnv(env, "BF_COMMUNITY_RL_SUBMIT_GLOBAL_PER_MIN", 300, 1, 1e7), windowMs: 60_000 },
      reportPerInstall: { limit: intEnv(env, "BF_COMMUNITY_RL_REPORT_PER_HOUR", 5, 1, 1e6), windowMs: 3_600_000 },
      reportGlobal: { limit: intEnv(env, "BF_COMMUNITY_RL_REPORT_GLOBAL_PER_HOUR", 60, 1, 1e7), windowMs: 3_600_000 },
      forgetPerInstall: { limit: 3, windowMs: 3_600_000 },
      minePerInstall: { limit: 12, windowMs: 3_600_000 },
      // Backstage Desk (CLIENT-CONTRACT.md sections D1 to D8). "Day" is a 24 hour window.
      heartbeatPerInstall: { limit: 6, windowMs: DAY },
      ticketPerInstall: { limit: 5, windowMs: DAY },
      ticketGlobal: { limit: intEnv(env, "BF_DESK_RL_TICKET_GLOBAL_PER_DAY", 200, 1, 1e6), windowMs: DAY },
      ticketReadPerKey: { limit: 120, windowMs: 3_600_000 },
      ticketReplyPerTicket: { limit: 20, windowMs: DAY },
      ticketDeletePerKey: { limit: 10, windowMs: 3_600_000 },
      errorPerInstall: { limit: 10, windowMs: DAY },
      errorGlobal: { limit: intEnv(env, "BF_DESK_RL_ERROR_GLOBAL_PER_HOUR", 2000, 1, 1e7), windowMs: 3_600_000 },
      loginPerIp: { limit: 10, windowMs: 15 * 60_000 },
    },
    // Open (not closed) tickets the inbox will hold before answering 503 report_inbox_full.
    maxOpenTickets: intEnv(env, "BF_DESK_MAX_OPEN_TICKETS", 5000, 1, 1e7),
    maxErrorGroups: intEnv(env, "BF_DESK_MAX_ERROR_GROUPS", 5000, 1, 1e6),
    // The admin area. The public origin is what browsers see; it is used for
    // the Origin check on forms and for links in notification e-mails.
    adminEnabled: (env.BF_DESK_ADMIN ?? "1") !== "0",
    publicOrigin: origin(env.BF_DESK_PUBLIC_ORIGIN || "https://bf.backstagecoding.com"),
    // scrypt cost as a power of two (17 = 128 MB and roughly half a second per sign-in).
    auth: { scryptN: 2 ** intEnv(env, "BF_DESK_SCRYPT_LOG2N", 17, 14, 20) },
    // Nightly database copies (kept 14). Empty or "off" disables them.
    backupDir: backupDir(env),
    backupKeep: intEnv(env, "BF_DESK_BACKUP_KEEP", 14, 1, 365),
    // Download counts of the public GitHub releases, asked for at most once an hour.
    downloads: {
      enabled: !["off", "0"].includes(String(env.BF_DESK_DOWNLOADS ?? "on").toLowerCase()),
      repo: parseRepo(env.BF_DESK_GITHUB_REPO),
      token: parseToken(env.BF_DESK_GITHUB_TOKEN),
    },
    // Admin notifications: both channels are off unless set in the env file.
    notify: {
      email: parseEmailList(env.BF_DESK_NOTIFY_EMAIL, "BF_DESK_NOTIFY_EMAIL"),
      from: parseEmailList(env.BF_DESK_NOTIFY_FROM, "BF_DESK_NOTIFY_FROM")[0] || null,
      replyTo: parseEmailList(env.BF_DESK_NOTIFY_REPLY_TO, "BF_DESK_NOTIFY_REPLY_TO")[0] || null,
      maxPerHour: intEnv(env, "BF_DESK_NOTIFY_MAX_PER_HOUR", 30, 1, 10000),
      sendmail: sendmailPath(env.BF_DESK_SENDMAIL),
      discord: parseDiscordWebhook(env.BF_DESK_DISCORD_WEBHOOK),
    },
  };
  // Overrides (tests, tools) replace single settings; grouped ones are merged key by key.
  for (const [k, v] of Object.entries(overrides))
    config[k] = ["limits", "auth", "notify", "downloads"].includes(k) && v && typeof v === "object" ? { ...config[k], ...v } : v;
  return config;
}

module.exports = { loadConfig, loadEnvFileIfPresent, DEFAULT_ENV_FILE, DEFAULT_DB };
