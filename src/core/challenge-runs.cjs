"use strict";
// Challenge runs (roadmap C12): rules a player sets for one character, and an honest journal of
// how the run stands. The app says a rule is broken only when it holds a record that shows it:
//  - one life: a death the live link recorded, a death counted inside a saved dungeon run, or the
//    journal's "first death" when that falls inside the run;
//  - no auction house (and the auction part of self-found): auction prices saved from a page the
//    player opened during the run. The app sees the page was opened, never what was bought or sold;
//  - no dungeons below a level: a saved dungeon or raid visit during the run, at a level the
//    journal's level dates put below the chosen one.
// Everything else (mail, trade, the player's own rule) has no record at all and is shown as
// "self-declared". A rule with no record against it is "nothing recorded against it", never
// "verified": the addon does not run all the time and the app cannot know what it missed.
// Pure; the store at the bottom keeps the rules in challenge-runs.json.
const fs = require("node:fs");
const MILESTONES = Object.freeze([10, 20, 30, 40, 50, 60]);
const LIMITS = Object.freeze({ custom: 120, profiles: 100, dungeonLevel: 60 });
const MAX_MS = 253402300799000;
const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const RULES = Object.freeze([
  { id: "oneLife", name: "One life", what: "The run ends at the first death." },
  { id: "noAuction", name: "No auction house", what: "Nothing bought or sold at auction." },
  { id: "selfFound", name: "Self-found", what: "No mail, no trade and no auction house: only what this character finds, makes or buys from vendors." },
  { id: "noDungeonsBelow", name: "No dungeons below a level", what: "No dungeon or raid before the level you choose." },
  { id: "custom", name: "Your own rule", what: "One rule in your own words." },
].map(Object.freeze));

/** Plain text on one line, or "" when it cannot be used. */
function cleanText(v) {
  if (typeof v !== "string" || /[\x00-\x1f\x7f]/.test(v) || /[^\S ]/.test(v)) return "";
  const t = v.replace(/\s+/g, " ").trim();
  return t.length <= LIMITS.custom ? t : "";
}
/** Stored or typed rules -> the clean shape, or null when no rule is switched on. */
function cleanRules(r) {
  if (!plain(r)) return null;
  const out = { oneLife: r.oneLife === true, noAuction: r.noAuction === true, selfFound: r.selfFound === true,
    noDungeonsBelow: int(r.noDungeonsBelow, 2, LIMITS.dungeonLevel) ? r.noDungeonsBelow : 0, custom: cleanText(r.custom) };
  return out.oneLife || out.noAuction || out.selfFound || out.noDungeonsBelow || out.custom ? out : null;
}
function cleanRun(run) {
  if (!plain(run) || !int(run.startedAt, 1, MAX_MS)) return null;
  const rules = cleanRules(run.rules);
  if (!rules) return null;
  return { startedAt: run.startedAt, startLevel: int(run.startLevel, 1, 100) ? run.startLevel : 1, rules, ...(int(run.endedAt, run.startedAt, MAX_MS) ? { endedAt: run.endedAt } : {}) };
}
const day = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The level the journal's dates give at a moment (seconds), or null when they cannot say. */
function levelAt(profile, atSeconds) {
  let best = null;
  for (const e of profile?.journal?.levels || []) if (int(e.level, 1, 100) && int(e.at, 1, MAX_MS / 1000) && e.at <= atSeconds && (best === null || e.level > best)) best = e.level;
  return best;
}
/**
 * How a run stands. run: cleanRun(); profile: the saved character; deaths: [{ at (ms), mapId? }]
 * from the journey store; mapName: id -> zone name. Returns null without a run.
 */
function evaluate(run, profile, { deaths = [], mapName = (id) => `Map ${id}`, now = Date.now() } = {}) {
  const r = cleanRun(run);
  if (!r || !profile) return null;
  const from = r.startedAt, to = r.endedAt || Infinity, inRun = (ms) => ms >= from && ms <= to;
  const runs = (profile.journal?.runs || []).filter((x) => int(x.startedAt, 1, MAX_MS / 1000) && inRun(x.startedAt * 1000));
  // One life.
  const died = [];
  for (const d of deaths) if (int(d?.at, 1, MAX_MS) && inRun(d.at)) died.push({ at: d.at, text: `A death was recorded on ${day(d.at)}${int(d.mapId, 1, 2147483647) ? ` in ${mapName(d.mapId)}` : ""}.` });
  for (const x of runs) if (int(x.deaths, 1, 10000)) died.push({ at: x.startedAt * 1000, text: `${x.deaths === 1 ? "A death was" : `${x.deaths} deaths were`} counted in a dungeon run on ${day(x.startedAt * 1000)}.` });
  const first = (profile.journal?.firsts || []).find((f) => f.key === "death");
  if (first && int(first.at, 1, MAX_MS / 1000) && inRun(first.at * 1000)) died.push({ at: first.at * 1000, text: `The journal saved this character's first death on ${day(first.at * 1000)}.` });
  died.sort((a, b) => a.at - b.at);
  // Auction pages.
  let auction = null;
  for (const p of profile.ledger?.prices || []) for (const h of p.hist || []) if (Array.isArray(h) && int(h[1], 1, MAX_MS / 1000) && inRun(h[1] * 1000) && (auction === null || h[1] * 1000 < auction)) auction = h[1] * 1000;
  // With price saving switched off (or no Ledger in the save) an opened auction house leaves no record.
  const pricesSaved = plain(profile.ledger) && profile.ledger.pricesOn !== false;
  const auctionText = auction ? `Auction prices were saved on ${day(auction)}, so the auction house was opened. The app cannot see whether anything was bought or sold.` : null;
  // Dungeons below the chosen level.
  let early = null, unknownVisits = 0;
  if (r.rules.noDungeonsBelow) for (const x of [...runs].sort((a, b) => a.startedAt - b.startedAt)) {
    const lv = levelAt(profile, x.startedAt);
    if (lv === null) unknownVisits++;
    else if (lv < r.rules.noDungeonsBelow && !early) early = { at: x.startedAt * 1000, text: `${typeof x.name === "string" && x.name ? x.name : "A dungeon"} was entered on ${day(x.startedAt * 1000)} at level ${lv}.` };
  }
  const rules = [];
  const add = (id, name, status, basis, evidence = null, at = null) => rules.push({ id, name, status, basis, evidence, at });
  if (r.rules.oneLife) add("oneLife", "One life", died.length ? "broken" : "clear",
    "Checked against deaths the live link recorded, deaths counted in saved dungeon runs and the journal's first death. A death while the addon or the live link was off is not known.", died[0]?.text || null, died[0]?.at || null);
  if (r.rules.noAuction) add("noAuction", "No auction house", auction ? "broken" : pricesSaved ? "clear" : "declared",
    pricesSaved ? "Checked against auction prices saved from pages you opened. Buying and selling themselves are never seen." : "Auction prices are not being saved for this character, so the app has no record to check. This rule is your word.", auctionText, auction);
  if (r.rules.selfFound) add("selfFound", "Self-found", auction ? "broken" : "declared",
    "Mail and trade leave no record the app can check, so this rule is your word. Only an opened auction house would show.", auctionText, auction);
  if (r.rules.noDungeonsBelow) add("noDungeonsBelow", `No dungeons below level ${r.rules.noDungeonsBelow}`, early ? "broken" : "clear",
    `Checked against saved dungeon and raid visits and the journal's level dates.${unknownVisits ? ` ${unknownVisits} saved visit${unknownVisits === 1 ? " has" : "s have"} no level date to compare.` : ""} A visit while the addon was off is not known.`, early?.text || null, early?.at || null);
  if (r.rules.custom) add("custom", r.rules.custom, "declared", "Your own rule. The app has no record to check it against, so it is your word.");
  const broken = rules.filter((x) => x.status === "broken"), brokenAt = broken.length ? Math.min(...broken.map((x) => x.at)) : null;
  const level = int(profile.level, 1, 100) ? profile.level : null;
  const dates = new Map((profile.journal?.levels || []).filter((e) => int(e.at, 1, MAX_MS / 1000)).map((e) => [e.level, e.at * 1000]));
  const milestones = MILESTONES.map((n) => {
    const reached = level !== null && level >= n, at = dates.get(n) ?? null;
    let standing = "ahead";
    if (reached) {
      if (n <= r.startLevel || (at !== null && at < from)) standing = "before";
      else if (brokenAt === null) standing = "kept";
      else if (at === null) standing = "unknown";
      else standing = at < brokenAt ? "kept" : "after";
    }
    return { level: n, reached, at, standing };
  });
  const declared = rules.filter((x) => x.status === "declared").length;
  return { startedAt: r.startedAt, endedAt: r.endedAt || null, startLevel: r.startLevel, level, rules, broken: broken.length > 0, brokenAt, declared,
    kept: milestones.filter((m) => m.standing === "kept").length, milestones, days: Math.max(0, Math.floor(((r.endedAt || now) - r.startedAt) / 86400000)),
    // One sentence that never says more than the records do.
    verdict: broken.length ? `A record shows ${broken.length === 1 ? "one rule" : `${broken.length} rules`} broken.`
      : declared === rules.length ? "Every rule here is self-declared: the app has no record to check them against."
      : `Nothing recorded against your rules${declared ? `; ${declared} of ${rules.length} are self-declared` : ""}. That is not proof: the app only knows what was saved.` };
}
/** The facts for the share card (share-cards.cjs, kind "challenge"). */
function cardData(view) {
  if (!view) return null;
  const word = { broken: "a record shows it broken", clear: "nothing recorded against it", declared: "self-declared" };
  return { level: view.level, kept: view.kept, total: MILESTONES.length, days: view.days, broken: view.broken, startedAt: Math.floor(view.startedAt / 1000),
    rules: view.rules.map((r) => `${r.name}: ${word[r.status]}.`) };
}

/** challenge-runs.json in the app's data folder: one run per character. */
class ChallengeStore {
  constructor({ file = null, write = (f, t) => require("./store.cjs").atomic(f, t) } = {}) {
    Object.assign(this, { file, write, data: {} });
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (plain(raw) && raw.version === 1 && plain(raw.characters)) for (const [id, run] of Object.entries(raw.characters).slice(0, LIMITS.profiles)) { const c = this.#key(id) ? cleanRun(run) : null; if (c) this.data[id] = c; }
    } catch { /* No file yet, or unreadable: start empty. */ }
  }
  #key(id) { return typeof id === "string" && id.length > 0 && id.length <= 100 && !["__proto__", "constructor", "prototype"].includes(id); }
  #save() { if (this.file) this.write(this.file, JSON.stringify({ version: 1, characters: this.data })); }
  get(profileId) { const r = this.data[profileId]; return r ? structuredClone(r) : null; }
  /** Start (or start again) from now with these rules. */
  start(profileId, rules, { level = 1, now = Date.now() } = {}) {
    const clean = cleanRules(rules);
    if (!this.#key(profileId)) throw Error("Unknown character.");
    if (!clean) throw Error("Tick at least one rule first.");
    if (plain(rules) && typeof rules.custom === "string" && rules.custom.trim() && !clean.custom) throw Error(`Write your own rule in at most ${LIMITS.custom} characters, on one line.`);
    if (!this.data[profileId] && Object.keys(this.data).length >= LIMITS.profiles) throw Error("Too many characters have a challenge run.");
    this.data[profileId] = cleanRun({ startedAt: now, startLevel: int(level, 1, 100) ? level : 1, rules: clean });
    this.#save();
    return this.get(profileId);
  }
  /** Stop counting: the run is kept as it stood. */
  end(profileId, now = Date.now()) {
    const r = this.data[profileId];
    if (!r || r.endedAt) return this.get(profileId);
    r.endedAt = Math.max(now, r.startedAt); this.#save();
    return this.get(profileId);
  }
  remove(profileId) { if (!this.data[profileId]) return false; delete this.data[profileId]; this.#save(); return true; }
  absorb(state) {
    const ids = new Set((state?.profiles || []).map((p) => p.id));
    let changed = false;
    for (const id of Object.keys(this.data)) if (!ids.has(id)) { delete this.data[id]; changed = true; }
    if (changed) try { this.#save(); } catch { /* Kept in memory. */ }
    return changed;
  }
  clear() { this.data = {}; try { this.#save(); } catch { /* Nothing to keep. */ } }
}
module.exports = { MILESTONES, LIMITS, RULES, cleanRules, cleanRun, levelAt, evaluate, cardData, ChallengeStore };
