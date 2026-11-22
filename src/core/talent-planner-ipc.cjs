"use strict";
// Talent planner (roadmap C1): one handler for the Talents screen. Every click is checked here by
// talent-planner.cjs on the trees read from the player's own game files; the renderer only shows
// the answer. Saved builds live in talent-builds.cjs under the selected character.
const planner = require("./talent-planner.cjs");
const { MAX_NAME } = require("./talent-builds.cjs");

const { currentTalents } = require("./capture-extras.cjs");

const OPS = new Set(["open", "add", "remove", "resetTree", "resetAll", "save", "delete", "activate", "export", "import", "compare", "fromCurrent", "compareCurrent"]);
/**
 * The talents the character has spent in game (saved in the extras block), laid on the trees: ranks per
 * talent id, points per tree, points waiting, and a legal order for them (null when the saved
 * ranks do not fit these trees). null when this character has no saved talents or is another class.
 */
function currentView(trees, profile, className) {
  if (!profile || profile.className !== className) return null;
  const now = currentTalents(trees, profile.extras?.talents);
  if (!now) return null;
  const order = now.unmatched.length ? null : planner.orderFromRanks(trees, now.ranks);
  return { at: now.at, unspent: now.unspent, spent: now.spent, tabs: now.tabs, ranks: Object.fromEntries(now.ranks), unmatched: now.unmatched, order };
}
function registerTalentPlanner({ handle, getState, gameData, builds, onChange = () => {} }) {
  const profile = () => { const s = getState(); return s?.profiles?.find((p) => p.id === s.activeProfileId) || null; };
  const orderOf = (v) => {
    if (!Array.isArray(v) || v.length > planner.MAX_POINTS || !v.every((id) => Number.isSafeInteger(id) && id > 0)) throw Error("Invalid talent build.");
    return [...v];
  };
  const saved = (p, className, trees) => {
    const all = p ? builds.list(p.id) : { active: null, builds: [] };
    return { canSave: Boolean(p), inGame: p?.source?.kind === "wow-addon", active: all.active, builds: all.builds.filter((b) => b.className === className).map((b) => ({ id: b.id, name: b.name, order: b.order, points: b.order.length, split: planner.view(trees, b.order).tabs.map((t) => t.points) })) };
  };
  handle("talentPlanner", (input) => {
    const op = typeof input?.op === "string" && OPS.has(input.op) ? input.op : null;
    const className = typeof input?.className === "string" && Object.hasOwn(planner.CLASS_CODES, input.className) ? input.className : null;
    if (!op || !className) throw Error("Invalid talent planner request.");
    const trees = gameData.talents(className);
    if (!trees) throw Error("Talent trees are not available from your game install yet.");
    const p = profile();
    const planLevel = Number.isInteger(input.planLevel) && input.planLevel >= planner.FIRST_LEVEL && input.planLevel <= planner.MAX_LEVEL ? input.planLevel : planner.MAX_LEVEL;
    const level = Number.isInteger(input.level) && input.level >= 1 && input.level <= 100 ? input.level : null;
    let order = op === "open" && !Array.isArray(input.order) ? [] : orderOf(input.order);
    const current = currentView(trees, p, className);
    const reply = (extra = {}) => ({ ok: true, reason: null, order, view: planner.view(trees, order, { planLevel, level }), saved: saved(p, className, trees), respec: planner.RESPEC_SCHEDULE, maxName: MAX_NAME,
      current: current ? { at: current.at, unspent: current.unspent, spent: current.spent, tabs: current.tabs, ranks: current.ranks, unmatched: current.unmatched, usable: Boolean(current.order) } : null, ...extra });
    const talent = () => { if (!Number.isSafeInteger(input.talentId)) throw Error("Invalid talent."); return input.talentId; };
    const own = () => { if (!p) throw Error("Choose a character first."); return p; };
    if (op === "open") {
      // A stored order the trees no longer allow (a game patch moved a talent) is cut where it breaks.
      const check = planner.replay(trees, order);
      const cut = !check.ok;
      if (cut) order = order.slice(0, check.at);
      return reply(cut ? { ok: false, reason: "Part of this build no longer fits your talent trees. The points that still fit are shown." } : {});
    }
    if (op === "add" || op === "remove") {
      const r = op === "add" ? planner.add(trees, order, talent(), planLevel) : planner.remove(trees, order, talent());
      order = r.order;
      return reply({ ok: r.ok, reason: r.reason });
    }
    if (op === "resetTree") {
      if (typeof input.tab !== "string" || !trees.tabs.some((t) => t.name === input.tab)) throw Error("Invalid talent tree.");
      order = planner.resetTree(trees, order, input.tab);
      return reply();
    }
    if (op === "resetAll") { order = []; return reply(); }
    if (op === "export") return reply({ code: planner.encode(trees, className, order) });
    if (op === "import") {
      const r = planner.decode(trees, className, input.code);
      if (!r.ok) return reply({ ok: false, reason: r.error });
      order = r.order;
      return reply();
    }
    if (op === "fromCurrent" || op === "compareCurrent") {
      if (!current) return reply({ ok: false, reason: "Your current talents are not in this character's save yet. Log in with the current addon, then type /reload or log out." });
      if (!current.order) return reply({ ok: false, reason: "The saved talents do not fit the talent trees read from your game files, so they cannot be used here." });
      if (op === "fromCurrent") { order = current.order; return reply(); }
      if (!planner.legal(trees, order)) throw Error("This build breaks the talent rules and cannot be compared.");
      return reply({ diff: planner.diff(trees, order, current.order) });
    }
    if (op === "compare") {
      const other = orderOf(input.other);
      if (!planner.legal(trees, order) || !planner.legal(trees, other)) throw Error("One of these builds breaks the talent rules and cannot be compared.");
      return reply({ diff: planner.diff(trees, order, other) });
    }
    if (op === "save") {
      if (!order.length) throw Error("Place at least one point before you save a build.");
      if (!planner.legal(trees, order)) throw Error("This build breaks the talent rules and cannot be saved.");
      const ix = planner.index(trees), names = {};
      for (const id of new Set(order)) { const t = ix.byId.get(id); names[id] = [String(t.name).slice(0, 60), String(t.tab).slice(0, 60), t.maxRank]; }
      const id = builds.save(own().id, { id: input.id, name: input.name, className, order, names });
      if (input.activate === true) builds.activate(p.id, id);
      onChange();
      return reply({ savedId: id });
    }
    if (op === "delete") { builds.remove(own().id, input.id); onChange(); return reply(); }
    // activate: id is a saved build, or null to stop telling the game about any build.
    builds.activate(own().id, input.id === null ? null : String(input.id));
    onChange();
    return reply();
  });
}
module.exports = { registerTalentPlanner, currentView };
