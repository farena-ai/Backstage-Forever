"use strict";
// Runtime configuration. Everything comes from environment variables so the
// systemd unit can load a mode-600 env file (--env-file) holding the salt.
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

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
    },
    ...overrides,
  };
  return config;
}

module.exports = { loadConfig, loadEnvFileIfPresent, DEFAULT_ENV_FILE, DEFAULT_DB };
