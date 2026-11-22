"use strict";
// Leveling races with friends (S4). A character's level times travel as one short text code:
// the display name the player typed, and for each level the /played seconds when it was reached
// and the day. Nothing else: no realm, no class, no account. A friend pastes the code; the board
// compares level by level. There is no server: the code is copied or saved by hand.
const crypto = require("node:crypto");
const PREFIX = "BFRACE1";
const LIMITS = Object.freeze({ code: 4000, name: 24, levels: 60, maxLevel: 60, played: 1e9, day: 2932896 });
const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const sum = (body) => crypto.createHash("sha256").update(`${PREFIX}:${body}`).digest("hex").slice(0, 10);

/** The display name as it will travel, or null when it cannot be used. */
function cleanName(name) {
  if (typeof name !== "string" || /[\x00-\x1f\x7f<>]/.test(name)) return null;
  const n = name.replace(/\s+/g, " ").trim();
  return n.length >= 1 && n.length <= LIMITS.name ? n : null;
}
/** Rows [level, played seconds when reached, UTC day or 0], from a saved journal. Only levels with a /played time. */
function rowsOf(profile) {
  const rows = [];
  let last = -1, lastLevel = 0;
  for (const e of [...(profile?.journal?.levels || [])].sort((a, b) => a.level - b.level)) {
    if (!int(e.level, 1, LIMITS.maxLevel) || !int(e.played, 0, LIMITS.played) || e.level <= lastLevel || e.played < last) continue;
    rows.push([e.level, e.played, int(e.at, 1, 253402300799) ? Math.floor(e.at / 86400) : 0]);
    last = e.played; lastLevel = e.level;
  }
  return rows.slice(0, LIMITS.levels);
}
function validRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > LIMITS.levels) return false;
  let level = 0, played = -1, day = 0;
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 3 || !int(r[0], 1, LIMITS.maxLevel) || !int(r[1], 0, LIMITS.played) || !int(r[2], 0, LIMITS.day)) return false;
    if (r[0] <= level || r[1] < played || (r[2] && r[2] < day)) return false;
    level = r[0]; played = r[1]; if (r[2]) day = r[2];
  }
  return true;
}

/** A race code for one character under the name the player typed. Throws a plain sentence when it cannot be made. */
function exportCode(profile, name) {
  const n = cleanName(name);
  if (!n) throw Error("Type a display name of 1 to 24 characters first.");
  const l = rowsOf(profile);
  if (l.length < 2) throw Error("This character has fewer than two levels with a saved /played time, so there is nothing to race yet.");
  const body = Buffer.from(JSON.stringify({ v: 1, n, l }), "utf8").toString("base64url");
  return `${PREFIX}.${body}.${sum(body)}`;
}
/**
 * A pasted code -> { id, name, rows } or null. Strict: exact shape, exact keys, known version,
 * matching check digits, levels rising, times never falling. Anything else is refused whole.
 */
function importCode(code) {
  if (typeof code !== "string") return null;
  const text = code.trim();
  if (text.length > LIMITS.code || !/^BFRACE1\.[A-Za-z0-9_-]{8,3960}\.[0-9a-f]{10}$/.test(text)) return null;
  const [, body, check] = text.split(".");
  if (sum(body) !== check) return null;
  let data;
  try {
    const json = Buffer.from(body, "base64url");
    if (json.toString("base64url") !== body) return null;
    data = JSON.parse(json.toString("utf8"));
  } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== 3 || !["v", "n", "l"].every((k) => keys.includes(k)) || data.v !== 1) return null;
  if (cleanName(data.n) !== data.n || !validRows(data.l)) return null;
  return { id: check, name: data.n, rows: data.l.map((r) => [...r]) };
}

/**
 * The board. racers: [{ id, name, kind: "you" | "yours" | "friend", rows }]. For every level
 * anyone reached: each racer's /played time on reaching it, who was fastest, and how far
 * behind or ahead of "you" each one is. A level a racer has no time for is left empty.
 */
function board(racers) {
  const list = (racers || []).filter((r) => r && Array.isArray(r.rows) && r.rows.length)
    .map((r) => ({ id: String(r.id), name: String(r.name), kind: r.kind, at: new Map(r.rows.map(([level, played]) => [level, played])), top: r.rows[r.rows.length - 1][0] }));
  const you = list.find((r) => r.kind === "you") || null;
  const levels = [...new Set(list.flatMap((r) => [...r.at.keys()]))].sort((a, b) => a - b);
  const rows = [];
  for (const level of levels) {
    const cells = list.map((r) => (r.at.has(level) ? r.at.get(level) : null));
    const known = cells.filter((c) => c !== null);
    if (known.length < 1) continue;
    const best = Math.min(...known), mine = you && you.at.has(level) ? you.at.get(level) : null;
    rows.push({ level, cells: cells.map((seconds) => ({ seconds, fastest: seconds !== null && known.length > 1 && seconds === best, gap: seconds !== null && mine !== null ? seconds - mine : null })) });
  }
  const columns = list.map((r, i) => {
    const wins = rows.filter((row) => row.cells[i].fastest).length;
    return { id: r.id, name: r.name, kind: r.kind, topLevel: r.top, wins };
  });
  // Where "you" stand against each other racer at the highest level both have a time for.
  const standings = you ? list.filter((r) => r !== you).map((r) => {
    const shared = levels.filter((l) => you.at.has(l) && r.at.has(l));
    if (!shared.length) return { id: r.id, name: r.name, level: null, gap: null };
    const level = shared[shared.length - 1];
    return { id: r.id, name: r.name, level, gap: you.at.get(level) - r.at.get(level) };
  }) : [];
  return { columns, rows, standings };
}

module.exports = { PREFIX, LIMITS, cleanName, rowsOf, exportCode, importCode, board };
