"use strict";

// Share cards (S9): one description of a picture for every kind of moment worth showing:
// a level-up, a badge, the badge case, a dungeon run, a personal best, a finished quest story,
// a finished zone and the story so far. Pure: the renderer paints what this returns, and Node
// tests check it. A character's name and realm are on a card only when the player ticked them.
(function () {
const KINDS = Object.freeze(["level", "badge", "badges", "run", "best", "chain", "zone", "story"]);
const LIMITS = Object.freeze({ title: 60, kicker: 40, line: 110, lines: 7, stats: 4, statLabel: 22, statValue: 16, grid: 120, who: 60 });
const FOOTER = "Backstage Forever";

const clean = (v, max) => String(v ?? "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
// Like clean, but a line that had to be shortened says so with an ellipsis.
const cut = (v, max) => { const all = clean(v, 4000); return all.length > max ? `${all.slice(0, max - 1).trimEnd()}…` : all; };
const whole = (v, lo, hi) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : null);
const artKey = (v) => (typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v) ? v : null);
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Seconds as "1h 05m" or "42m"; null when unknown. */
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  if (m === 60) return `${h + 1}h 00m`;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
/** A day in plain words from a time in seconds; "" when unknown. */
function day(at) {
  if (!Number.isFinite(at) || at <= 0) return "";
  return new Date(at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** The identity line: empty unless the player ticked the name, the realm or both. */
function identity(character, options) {
  const name = options?.name === true ? clean(character?.name, 30) : "";
  const realm = options?.realm === true ? clean(character?.realm, 40) : "";
  return [name, realm].filter(Boolean).join(" · ").slice(0, LIMITS.who);
}
const classLine = (c) => [whole(c?.level, 1, 100) ? `Level ${c.level}` : "", clean(c?.className, 20)].filter(Boolean).join(" ");

const BUILD = {
  level(d) {
    const level = whole(d.level, 1, 100);
    if (!level) return null;
    const split = duration(d.seconds);
    return { kicker: "Level up", title: `Level ${level}`, art: `level-${Math.min(60, Math.max(10, Math.floor(level / 10) * 10))}`,
      lines: [split ? `Level ${level - 1} to ${level} took ${split} of play.` : "", d.personalBest ? "The fastest this level has gone on any of my characters." : "", day(d.at) ? `Reached on ${day(d.at)}.` : ""],
      stats: [["Level", String(level)], split ? ["This level", split] : null, duration(d.played) ? ["Played in all", duration(d.played)] : null] };
  },
  badge(d) {
    const name = clean(d.name, LIMITS.title);
    if (!name) return null;
    return { kicker: "Badge earned", title: name, art: artKey(d.art) || artKey(d.id), lines: [cut(d.how, LIMITS.line), day(d.at) ? `Earned on ${day(d.at)}.` : ""],
      stats: [whole(d.earned, 0, 9999) !== null && whole(d.total, 1, 9999) ? ["Badges", `${d.earned} of ${d.total}`] : null] };
  },
  badges(d) {
    const earned = whole(d.earned, 0, 9999), total = whole(d.total, 1, 9999);
    if (earned === null || !total) return null;
    const grid = (Array.isArray(d.badges) ? d.badges : []).slice(0, LIMITS.grid).map((b) => ({ name: clean(b?.name, 30), art: artKey(b?.art) || artKey(b?.id) })).filter((b) => b.name);
    return { kicker: "Badge case", title: `${earned} of ${total} badges`, art: null, grid,
      lines: [grid.length ? "" : "The first badges come quickly."], stats: [] };
  },
  run(d) {
    const name = clean(d.name, LIMITS.title);
    if (!name) return null;
    const bosses = whole(d.bosses, 0, 99), known = whole(d.knownBosses, 1, 99), time = d.timed ? duration(d.seconds) : null, deaths = d.timed ? whole(d.deaths, 0, 9999) : null;
    return { kicker: d.instanceType === "raid" ? "Raid run" : "Dungeon run", title: name, art: "first-dungeon",
      lines: [bosses ? `${plural(bosses, "boss", "bosses")} defeated${known && known >= bosses ? ` of ${known}` : ""}.` : "No boss kill was saved for this run.",
        time ? `In and out in ${time}.` : "This run was saved without a time.", d.personalBest && time ? "My fastest full run here." : "", day(d.at) ? day(d.at) : ""],
      stats: [bosses !== null ? ["Bosses", known && known >= bosses ? `${bosses} / ${known}` : String(bosses)] : null, time ? ["Time", time] : null, deaths !== null ? ["Deaths", String(deaths)] : null] };
  },
  best(d) {
    const time = duration(d.seconds);
    if (!time) return null;
    const level = whole(d.level, 1, 100), name = clean(d.name, LIMITS.title);
    if (!level && !name) return null;
    const before = duration(d.previousSeconds);
    return { kicker: "Personal best", title: level ? `Level ${level} to ${level + 1}` : name, art: "speed",
      lines: [level ? `My fastest time through level ${level}: ${time} of play.` : `My fastest full run of ${name}: ${time}.`, before ? `The time to beat was ${before}.` : "", day(d.at) ? day(d.at) : ""],
      stats: [["Time", time], before ? ["Before", before] : null] };
  },
  chain(d) {
    const name = clean(d.name, LIMITS.title), steps = whole(d.steps, 2, 99);
    if (!name || !steps) return null;
    const first = clean(d.first, 60);
    return { kicker: "Quest story finished", title: name, art: "quests-25",
      lines: [`A story of ${steps} quests${first && first !== name ? ` that began with “${first}”` : ""}.`, day(d.at) ? `Finished on ${day(d.at)}.` : ""], stats: [["Quests", String(steps)]] };
  },
  zone(d) {
    const name = clean(d.name, LIMITS.title), done = whole(d.done, 1, 9999), total = whole(d.total, 1, 9999);
    if (!name || !done || !total || done > total) return null;
    const min = whole(d.min, 1, 100), max = whole(d.max, 1, 100);
    return { kicker: "Zone finished", title: name, art: "explorer-15",
      lines: [`${done} of ${total} known quests done.`, min && max ? `A zone for levels ${min} to ${max}.` : ""], stats: [["Quests", `${done} / ${total}`]] };
  },
  story(d) {
    const lines = (Array.isArray(d.lines) ? d.lines : []).map((l) => cut(l, LIMITS.line)).filter(Boolean);
    if (!lines.length) return null;
    return { kicker: "The story so far", title: clean(d.title, LIMITS.title) || "My journey", art: "explorer-30", lines,
      stats: (Array.isArray(d.stats) ? d.stats : []).map((s) => (Array.isArray(s) ? s : null)) };
  },
};

/**
 * A card to paint, or null when the facts do not make one. kind: one of KINDS; data: the facts
 * for that kind; character: { name, realm, level, className }; options: { name, realm } ticks.
 */
function shareCard(kind, data, character = null, options = null) {
  if (!KINDS.includes(kind) || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const built = BUILD[kind](data);
  if (!built) return null;
  const who = identity(character, options);
  const stats = (built.stats || []).filter((s) => Array.isArray(s) && s.length === 2 && clean(s[0], 1) && clean(s[1], 1))
    .slice(0, LIMITS.stats).map(([label, value]) => ({ label: clean(label, LIMITS.statLabel), value: clean(value, LIMITS.statValue) }));
  return { kind, kicker: clean(built.kicker, LIMITS.kicker), title: clean(built.title, LIMITS.title), art: artKey(built.art),
    lines: (built.lines || []).map((l) => cut(l, LIMITS.line)).filter(Boolean).slice(0, LIMITS.lines), stats,
    grid: built.grid || null, who, sub: who ? classLine(character) : "", footer: FOOTER, fileName: `Backstage-Forever-${kind}.png` };
}

/**
 * Break a line into rows no wider than max, measured by the caller's own ruler, at most
 * `rows` rows; the last row ends in "…" when text was left over. Pure, so it can be tested.
 */
function wrap(text, max, measure, rows = 3) {
  const words = clean(text, 400).split(" ").filter(Boolean), out = [];
  let row = "";
  for (let i = 0; i < words.length; i++) {
    const next = row ? `${row} ${words[i]}` : words[i];
    if (!row || measure(next) <= max) { row = next; continue; }
    if (out.length === rows - 1) { row = `${row}…`; while (row.length > 2 && measure(row) > max) row = `${row.slice(0, -2)}…`; out.push(row); return out; }
    out.push(row); row = words[i];
  }
  if (row) { while (row.length > 2 && measure(row) > max) row = `${row.slice(0, -2)}…`; out.push(row); }
  return out;
}

const model = { KINDS, LIMITS, shareCard, identity, duration, day, wrap };
if (typeof module !== "undefined") module.exports = model;
else window.ShareCardModel = model;
})();
