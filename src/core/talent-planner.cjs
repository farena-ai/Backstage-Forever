"use strict";
// Talent planner rules (roadmap C1). Pure: no files, no clock, no game access.
//
// A build is one ordered list of talent ids, one entry per point, in the order the points are
// taken. The first point is taken at level 10, the next at 11 and so on, so the list is also the
// level-up order. Every rule is checked by replaying that list on the player's own trees
// (game-data.cjs): 5 points in the tree per row above, the prerequisite talent at its required
// rank, the talent's highest rank, and one point per level from 10.
const FIRST_LEVEL = 10, MAX_LEVEL = 60, MAX_POINTS = MAX_LEVEL - FIRST_LEVEL + 1;
const CLASS_CODES = Object.freeze({ Warrior: "WAR", Paladin: "PAL", Hunter: "HUN", Rogue: "ROG", Priest: "PRI", Shaman: "SHA", Mage: "MAG", Warlock: "WLK", Druid: "DRU" });
const CODE_CLASS = Object.freeze(Object.fromEntries(Object.entries(CLASS_CODES).map(([k, v]) => [v, k])));

const pointsAt = (level) => Math.max(0, Math.min(MAX_POINTS, (Number.isInteger(level) ? level : 0) - FIRST_LEVEL + 1));
const levelOfPick = (index) => FIRST_LEVEL + index;
const talentId = (v) => Number.isSafeInteger(v) && v > 0;

// Every talent of a class in one fixed order (trees in game order, then row, then column).
function index(trees) {
  const list = [], byId = new Map();
  for (const [tabIndex, tab] of (Array.isArray(trees?.tabs) ? trees.tabs : []).entries()) {
    const talents = [...(Array.isArray(tab?.talents) ? tab.talents : [])].sort((a, b) => a.row - b.row || a.column - b.column || a.id - b.id);
    for (const t of talents) {
      if (!talentId(t?.id) || byId.has(t.id) || !Number.isInteger(t.row) || t.row < 0 || !Number.isInteger(t.maxRank) || t.maxRank < 1) continue;
      const entry = { id: t.id, tab: String(tab.name ?? ""), tabIndex, row: t.row, column: t.column, maxRank: t.maxRank, name: t.name || "Unknown talent",
        prerequisites: (Array.isArray(t.prerequisites) ? t.prerequisites : []).filter((p) => talentId(p?.talentId)).map((p) => ({ talentId: p.talentId, rank: Number.isInteger(p.rank) && p.rank > 0 ? p.rank : 1 })), index: list.length };
      list.push(entry); byId.set(t.id, entry);
    }
  }
  return { list, byId, tabs: (Array.isArray(trees?.tabs) ? trees.tabs : []).map((t) => String(t.name ?? "")) };
}
const blank = () => ({ ranks: new Map(), tabs: new Map(), total: 0 });
// Why this point cannot be taken right now, or null when it can.
function blocked(ix, state, id, level = MAX_LEVEL) {
  const t = ix.byId.get(id);
  if (!t) return "This talent is not in your trees.";
  const rank = state.ranks.get(id) || 0;
  if (rank >= t.maxRank) return `${t.name} is already at its highest rank.`;
  if (state.total >= pointsAt(level)) return pointsAt(level) ? `No points left: level ${level} gives ${pointsAt(level)}.` : "Talent points start at level 10.";
  const inTree = state.tabs.get(t.tab) || 0;
  if (inTree < t.row * 5) return `Spend ${t.row * 5} points in ${t.tab} first (${inTree} so far).`;
  for (const p of t.prerequisites) {
    if ((state.ranks.get(p.talentId) || 0) < p.rank) {
      const need = ix.byId.get(p.talentId);
      return `Needs ${need ? need.name : "another talent"} at rank ${p.rank} first.`;
    }
  }
  return null;
}
function take(ix, state, id) {
  const t = ix.byId.get(id);
  state.ranks.set(id, (state.ranks.get(id) || 0) + 1);
  state.tabs.set(t.tab, (state.tabs.get(t.tab) || 0) + 1);
  state.total++;
}
// Replays an order strictly. ok is false at the first point that breaks a rule.
function replay(trees, order, level = MAX_LEVEL, ix = index(trees)) {
  const state = blank();
  if (!Array.isArray(order)) return { ok: false, error: "This is not a talent build.", at: 0, ...state };
  for (const [i, id] of order.entries()) {
    const why = talentId(id) ? blocked(ix, state, id, level) : "This is not a talent build.";
    if (why) return { ok: false, error: why, at: i, ...state };
    take(ix, state, id);
  }
  return { ok: true, error: null, at: order.length, ...state };
}
const legal = (trees, order, level = MAX_LEVEL) => replay(trees, order, level).ok;

function add(trees, order, id, level = MAX_LEVEL) {
  const ix = index(trees), now = replay(trees, order, MAX_LEVEL, ix);
  if (!now.ok) return { ok: false, order, reason: "This build breaks the talent rules. Reset it and start again." };
  const why = blocked(ix, now, id, level);
  return why ? { ok: false, order, reason: why } : { ok: true, order: [...order, id], reason: null };
}
// Points placed later may have leaned on the removed one. Keep the order where it still works and
// move a point back only as far as it must go; refuse when no order of the rest is legal.
function settle(ix, pending) {
  const state = blank(), out = [];
  const rest = [...pending];
  while (rest.length) {
    const at = rest.findIndex((id) => blocked(ix, state, id, MAX_LEVEL) === null);
    if (at < 0) return null;
    take(ix, state, rest[at]); out.push(rest[at]); rest.splice(at, 1);
  }
  return out;
}
function remove(trees, order, id) {
  const ix = index(trees), t = ix.byId.get(id);
  const at = Array.isArray(order) ? order.lastIndexOf(id) : -1;
  if (!t || at < 0) return { ok: false, order, reason: "No point to take back here." };
  if (!replay(trees, order, MAX_LEVEL, ix).ok) return { ok: false, order, reason: "This build breaks the talent rules. Reset it and start again." };
  const rest = order.filter((_, i) => i !== at), settled = settle(ix, rest);
  if (settled) return { ok: true, order: settled, reason: null };
  const state = replay(trees, order, MAX_LEVEL, ix), left = (state.ranks.get(id) || 0) - 1;
  const leaning = ix.list.find((x) => (state.ranks.get(x.id) || 0) > 0 && x.prerequisites.some((p) => p.talentId === id && p.rank > left));
  return { ok: false, order, reason: leaning ? `${leaning.name} needs ${t.name} at this rank. Take that point back first.` : `Talents further down ${t.tab} need these points. Take those back first.` };
}
function resetTree(trees, order, tabName) {
  const ix = index(trees);
  return (Array.isArray(order) ? order : []).filter((id) => ix.byId.get(id)?.tab !== tabName);
}
// A legal order for a set of ranks (used when only the ranks are known), or null when the ranks
// cannot be reached by any order.
function orderFromRanks(trees, ranks) {
  const ix = index(trees), pending = [];
  const entries = ranks instanceof Map ? [...ranks] : Object.entries(ranks && typeof ranks === "object" ? ranks : {}).map(([k, v]) => [Number(k), v]);
  for (const t of ix.list) {
    const hit = entries.find(([id]) => id === t.id);
    if (!hit) continue;
    if (!Number.isInteger(hit[1]) || hit[1] < 0 || hit[1] > t.maxRank) return null;
    for (let i = 0; i < hit[1]; i++) pending.push(t.id);
  }
  if (entries.some(([id, rank]) => rank > 0 && !ix.byId.has(id)) || pending.length > MAX_POINTS) return null;
  return settle(ix, pending);
}

// Everything the screen needs for one build: each talent's rank and what a click would do, points
// per tree, and the level-up order.
function view(trees, order, { planLevel = MAX_LEVEL, level = null } = {}) {
  const ix = index(trees), state = replay(trees, order, MAX_LEVEL, ix);
  const safe = state.ok ? order : order.slice(0, state.at);
  const talents = {};
  for (const t of ix.list) {
    const rank = state.ranks.get(t.id) || 0;
    const addWhy = blocked(ix, state, t.id, planLevel);
    const removal = rank > 0 ? remove(trees, safe, t.id) : { ok: false, reason: "No point to take back here." };
    talents[t.id] = { rank, maxRank: t.maxRank, canAdd: addWhy === null, addWhy, canRemove: removal.ok, removeWhy: removal.ok ? null : removal.reason };
  }
  const seen = new Map();
  const steps = safe.map((id, i) => {
    const t = ix.byId.get(id), rank = (seen.get(id) || 0) + 1;
    seen.set(id, rank);
    return { level: levelOfPick(i), talentId: id, name: t.name, tab: t.tab, rank, maxRank: t.maxRank };
  });
  const have = Number.isInteger(level) ? pointsAt(level) : null;
  return { ok: state.ok, error: state.error, order: safe, talents, total: state.total, budget: pointsAt(planLevel), left: Math.max(0, pointsAt(planLevel) - state.total),
    planLevel, level, dueNow: have === null ? 0 : Math.min(have, safe.length), endLevel: safe.length ? levelOfPick(safe.length - 1) : null,
    tabs: ix.tabs.map((name) => ({ name, points: state.tabs.get(name) || 0 })), steps };
}
// Rows that differ between two builds, tree by tree, plus each tree's points.
function diff(trees, a, b) {
  const ix = index(trees), ra = replay(trees, a, MAX_LEVEL, ix), rb = replay(trees, b, MAX_LEVEL, ix);
  const rows = ix.list.map((t) => ({ talentId: t.id, name: t.name, tab: t.tab, maxRank: t.maxRank, a: ra.ranks.get(t.id) || 0, b: rb.ranks.get(t.id) || 0 })).filter((r) => r.a !== r.b);
  return { rows, same: rows.length === 0, tabs: ix.tabs.map((name) => ({ name, a: ra.tabs.get(name) || 0, b: rb.tabs.get(name) || 0 })), totalA: ra.total, totalB: rb.total };
}

// Classic respec schedule, in gold: 1, then 5, then 5 more each time, never above 50. Reference
// only: nothing in the player's game files states what WoW Forever charges.
const respecCost = (times) => (!Number.isInteger(times) || times < 1 ? null : times === 1 ? 1 : Math.min(50, (times - 1) * 5));
const RESPEC_SCHEDULE = Object.freeze(Array.from({ length: 11 }, (_, i) => respecCost(i + 1)));

// --- Share code ------------------------------------------------------------------------------
// BF1-<class>-<trees>-<points>-<check>. <trees> is a short mark of the trees the code was made on,
// <points> lists runs of points in order (two characters for the talent, one digit for how many
// in a row) and <check> catches a mistyped or cut-off code. Letters and digits only.
function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
const mark = (n) => (n % 1679616).toString(36).padStart(4, "0");
const treeMark = (ix) => mark(fnv(ix.list.map((t) => `${t.id}:${t.tabIndex}:${t.row}:${t.column}:${t.maxRank}`).join("|")));
function encode(trees, className, order) {
  const cls = CLASS_CODES[className], ix = index(trees);
  if (!cls || !ix.list.length || ix.list.length > 1296) throw Error("Talent trees are not available for a share code.");
  if (!Array.isArray(order) || !order.length) throw Error("Place at least one point before you share a build.");
  if (!replay(trees, order, MAX_LEVEL, ix).ok) throw Error("This build breaks the talent rules and cannot be shared.");
  let points = "";
  for (let i = 0; i < order.length;) {
    let run = 1;
    while (run < 9 && order[i + run] === order[i]) run++;
    points += ix.byId.get(order[i]).index.toString(36).padStart(2, "0") + run;
    i += run;
  }
  const head = `BF1-${cls}-${treeMark(ix)}-${points}`;
  return `${head}-${mark(fnv(head.toLowerCase()))}`;
}
function decode(trees, className, code) {
  const fail = (error) => ({ ok: false, error, order: null });
  if (typeof code !== "string" || code.length > 400) return fail("That is not a Backstage Forever talent code.");
  const text = code.replace(/\s+/g, "").toLowerCase();
  const m = /^bf1-([a-z]{3})-([0-9a-z]{4})-((?:[0-9a-z]{2}[1-9])+)-([0-9a-z]{4})$/.exec(text);
  if (!m) return fail("That is not a Backstage Forever talent code.");
  if (mark(fnv(text.slice(0, text.lastIndexOf("-")))) !== m[4]) return fail("This code is damaged: a character is missing or changed. Copy it again.");
  const codeClass = CODE_CLASS[m[1].toUpperCase()];
  if (!codeClass) return fail("That is not a Backstage Forever talent code.");
  if (codeClass !== className) return fail(`This code is for a ${codeClass}, not a ${className || "character without a class"}.`);
  const ix = index(trees);
  if (!ix.list.length) return fail("Talent trees are not available, so the code cannot be checked.");
  if (treeMark(ix) !== m[2]) return fail("This code was made on different talent trees (another game version). It cannot be loaded here.");
  const order = [];
  for (let i = 0; i < m[3].length; i += 3) {
    const t = ix.list[parseInt(m[3].slice(i, i + 2), 36)];
    if (!t) return fail("This code names a talent your trees do not have.");
    for (let n = Number(m[3][i + 2]); n > 0; n--) order.push(t.id);
  }
  if (order.length > MAX_POINTS) return fail(`This code holds more than ${MAX_POINTS} points.`);
  const check = replay(trees, order, MAX_LEVEL, ix);
  if (!check.ok) return fail("This code holds a build that breaks the talent rules. Nothing was loaded.");
  return { ok: true, error: null, order };
}

module.exports = { FIRST_LEVEL, MAX_LEVEL, MAX_POINTS, CLASS_CODES, RESPEC_SCHEDULE, pointsAt, levelOfPick, index, blocked, replay, legal, add, remove, resetTree, orderFromRanks, view, diff, respecCost, encode, decode };
