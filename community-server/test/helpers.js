"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SALT = "test-salt-0123456789abcdef0123456789abcdef";

function uuid() { return crypto.randomUUID(); }

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-community-test-"));
  return { file: path.join(dir, "community.db"), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function submit(installId, observations, extra = {}) {
  return { schema: 1, installId, build: "1.15.8.66000", appVersion: "0.31.0", observations, ...extra };
}

function testConfig(overrides = {}) {
  const { loadConfig } = require("../lib/config");
  return loadConfig({}, { salt: SALT, packRebuildMs: 0, ...overrides });
}

module.exports = { SALT, uuid, tempDb, submit, testConfig };
