"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { atomic } = require("./store.cjs");
const { releaseIdentity, history } = require("./whats-new-catalog.cjs");
const { recordSuccessfulRun, pendingRecap, acknowledge } = require("./whats-new-state.cjs");
const catalog = require("../../data/whats-new-catalog.json");
const STATE_LIMIT = 4096;
const INVALID = Symbol("invalid dispatch state");

function read(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error("Not a regular state file");
    if (stat.size > STATE_LIMIT) return INVALID;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const fd = fs.openSync(file, "r");
  try {
    const bytes = Buffer.alloc(STATE_LIMIT + 1);
    const length = fs.readSync(fd, bytes, 0, bytes.length);
    if (length > STATE_LIMIT) return INVALID;
    try { return JSON.parse(bytes.toString("utf8", 0, length)) ?? INVALID; }
    catch { return INVALID; }
  } finally { fs.closeSync(fd); }
}

function adapt(releases) {
  return releases.map(({ version, changes }) => {
    const sections = [];
    for (const change of changes) {
      const label = change.kind === "history" ? change.section : undefined;
      let section = sections.at(-1);
      if (section?.kind !== change.kind || section.label !== label) {
        section = { kind: change.kind, label, entries: [] };
        sections.push(section);
      }
      // Split only a short heading at a natural boundary; retain all reviewed text.
      const match = change.kind !== "history" && /^(.{3,65}?)([.:]) (.+)$/s.exec(change.text);
      section.entries.push({ id: change.id, title: match ? match[1] + match[2] : change.text,
        summary: match ? match[3] : "", platforms: change.platforms,
        highlight: Boolean(match && ["new", "improved"].includes(change.kind)), actionId: change.action });
    }
    return { version, sections };
  });
}

class FieldDispatchStore {
  #state;
  #presented;
  constructor({ dir, running, installed, freshInstall = false, write = atomic }) {
    this.file = path.join(dir, "field-dispatch.json");
    this.running = releaseIdentity(running);
    this.installed = installed;
    this.freshInstall = freshInstall;
    this.write = write;
  }
  start() {
    if (!this.installed) return "source";
    if (this.#state) return "same";
    try {
      const result = recordSuccessfulRun(read(this.file), this.running, { freshInstall: this.freshInstall });
      if (result.changed) this.write(this.file, JSON.stringify(result.state));
      this.#state = result.state;
      return result.reason;
    } catch { return "unavailable"; }
  }
  manual() {
    return { status: "current", toVersion: this.running?.version, releases: adapt(history(this.running)),
      historyIncomplete: catalog.missing.some(r => r.channel === this.running?.channel) };
  }
  offer() {
    if (this.#presented) return null;
    const pending = pendingRecap(this.#state);
    if (!pending) return null;
    const manual = this.manual();
    return { id: pending.id, model: { ...manual, status: "updated", fromVersion: pending.from.version,
      rangeVersions: pending.releases.map(r => r.version), recapReleases: adapt(pending.releases.slice().reverse()),
      historyIncomplete: manual.historyIncomplete || pending.gaps.length > 0 } };
  }
  presented(id) {
    if (!this.#state?.pending || this.#presented || id !== this.#state.pending.id) return false;
    this.#presented = id;
    return true;
  }
  acknowledge(id) {
    if (typeof id !== "string" || id !== this.#presented) return false;
    const result = acknowledge(this.#state, id);
    if (!result.changed) return false;
    this.write(this.file, JSON.stringify(result.state));
    this.#state = result.state;
    return true;
  }
  reset() {
    if (this.installed) fs.rmSync(this.file, { force: true });
    this.#state = null;
    this.freshInstall = true;
  }
}
module.exports = { FieldDispatchStore };
