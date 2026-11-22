"use strict";
// The last answers to questions asked from the game, kept per saved character in a small file of
// the app's own (ask-answers.json in the app data folder), so /bf answers still has them after
// the app restarts. The desktop -> game hand-off reads them from here. Never sent anywhere.
// Removed with the character (prune) and with "Delete all local data" (clear).
const fs = require("node:fs"), path = require("node:path");
const { atomic } = require("./store.cjs");
const MAX_ANSWERS = 5, MAX_PROFILES = 100, MAX_QUESTION = 1000, MAX_ANSWER = 100000, MAX_FILE = 8 * 1024 * 1024;
const profileKey = (v) => typeof v === "string" && v.length > 0 && v.length <= 100 && v !== "__proto__";
function cleanEntry(e) {
  if (!e || typeof e !== "object" || typeof e.question !== "string" || e.question.length > MAX_QUESTION || typeof e.answer !== "string" || !e.answer.trim() || e.answer.length > MAX_ANSWER) return null;
  if (!Number.isFinite(e.at) || e.at < 0 || e.at > 253402300799000) return null;
  return { question: e.question, answer: e.answer, at: e.at };
}
/** Any earlier or damaged content -> Map profileId -> [{ question, answer, at }], newest first; bad entries are dropped one by one. */
function normalize(raw) {
  const out = new Map();
  const profiles = raw && raw.schemaVersion === 1 && raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles) ? raw.profiles : {};
  for (const [id, list] of Object.entries(profiles)) {
    if (out.size >= MAX_PROFILES) break;
    if (!profileKey(id) || !Array.isArray(list)) continue;
    const kept = list.map(cleanEntry).filter(Boolean).slice(0, MAX_ANSWERS);
    if (kept.length) out.set(id, kept);
  }
  return out;
}
class AskAnswers {
  constructor(dir, { write = atomic } = {}) {
    this.file = path.join(dir, "ask-answers.json");
    this.write = write;
  }
  /** What the file holds, or an empty Map when there is none or it cannot be read. */
  load() {
    try {
      if (fs.statSync(this.file).size > MAX_FILE) return new Map();
      return normalize(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch { return new Map(); }
  }
  /** Writes the answers (Map profileId -> list). Returns false when the write failed; answering goes on. */
  save(answered) {
    try {
      const kept = normalize({ schemaVersion: 1, profiles: Object.fromEntries(answered) });
      if (!kept.size) { fs.rmSync(this.file, { force: true }); return true; }
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.write(this.file, JSON.stringify({ schemaVersion: 1, profiles: Object.fromEntries(kept) }) + "\n");
      return true;
    } catch { return false; }
  }
  clear() { try { fs.rmSync(this.file, { force: true }); } catch {} }
}
module.exports = { AskAnswers, normalize, MAX_ANSWERS, MAX_PROFILES };
