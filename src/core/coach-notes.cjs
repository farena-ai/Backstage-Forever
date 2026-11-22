"use strict";
// Coach's notes after a session (A4). One screen from the evidence saved between the capture
// before the newest one and the newest one: what went well, one thing to change, and the first
// step for next time. Pure. Every sentence names something that was saved; when too little was
// saved the notes say so. No praise is made up.
const MAX_T = 253402300799;
const sec = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_T;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const duration = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; };
const defaultDay = (at) => new Date(at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
// What to change for each death review tip the addon reports (the same codes the death screen uses).
const TIP_WORDS = Object.freeze({ 1: "several enemies at once", 2: "an elite enemy", 3: "an enemy well above your level", 4: "one spell doing most of the damage", 5: "starting a fight without full health" });
const TIP_CHANGE = Object.freeze({
  1: "Pull one enemy at a time and fight at the edge of a group.",
  2: "Leave elites until you have a group or a few more levels.",
  3: "Quest in a zone closer to your level first.",
  4: "Interrupt that spell or step away from it.",
  5: "Eat and drink to full before each fight.",
});

/** Splits for the levels in `levels` that beat another of the player's own characters on the same level. */
function beatenSplits(profile, others, gained) {
  const pairs = (p) => { const l = (p?.journal?.levels || []).filter((e) => Number.isFinite(e.played)), out = new Map(); for (let i = 1; i < l.length; i++) if (l[i].level === l[i - 1].level + 1 && l[i].played > l[i - 1].played) out.set(l[i - 1].level, l[i].played - l[i - 1].played); return out; };
  const mine = pairs(profile), rest = (others || []).map(pairs), out = [];
  for (const level of gained) {
    const seconds = mine.get(level - 1);
    if (!seconds) continue;
    const theirs = rest.map((m) => m.get(level - 1)).filter(Number.isFinite);
    if (theirs.length && seconds < Math.min(...theirs)) out.push({ level: level - 1, seconds, previousSeconds: Math.min(...theirs) });
  }
  return out;
}

/**
 * profile: the saved character; previous / current: captures kept by the journey store;
 * others: the player's other characters; sessions: session history rows; deaths: journey store
 * rows ({ at ms, mapId?, tip?, killer? }); runs: runHistoryView(...).rows; badges: badgesFor(profile).badges;
 * step: nextStep(advice) or null; mapName(id); day(seconds).
 */
function coachNotes(profile, { previous = null, current = null, others = [], sessions = [], deaths = [], runs = [], badges = [], step = null, mapName = (id) => `Map ${id}`, day = defaultDay } = {}) {
  if (!profile) return null;
  const tomorrow = step ? { title: step.title, detail: step.detail || "" } : null;
  const base = { id: profile.id, name: profile.name, className: profile.className || null, tomorrow, noStepReason: step ? "" : "No next step can be worked out from the saved data. Open Now after your next save." };
  const to = Date.parse(current?.savedAt || profile.source?.updatedAt || "") / 1000;
  if (!Number.isFinite(to)) return { ...base, status: "no-save", from: null, to: null, wentWell: [], change: null, message: "This character has no save from the game yet. Log in with the addon on, then type /reload or log out." };
  if (!previous) return { ...base, status: "first-save", from: null, to, wentWell: [], change: null, message: "Coach's notes compare two saves, and this is the first one the app has kept for this character. They start with your next save." };
  const from = Date.parse(previous.savedAt) / 1000;
  const within = (at) => sec(at) && at > from && at <= to + 60;
  const withinMs = (ms) => within(Math.floor(ms / 1000));

  // What went well: only counted, dated evidence.
  const wentWell = [];
  const ups = (profile.journal?.levels || []).filter((e) => within(e.at)).map((e) => e.level).sort((a, b) => a - b);
  const levelGain = Number.isInteger(previous.level) && Number.isInteger(current?.level) ? current.level - previous.level : null;
  if (ups.length) wentWell.push({ kind: "levels", text: ups.length === 1 ? `You reached level ${ups[0]}.` : `You gained ${ups.length} levels and reached level ${ups[ups.length - 1]}.` });
  else if (levelGain > 0) wentWell.push({ kind: "levels", text: `You went from level ${previous.level} to level ${current.level}.` });
  const handIns = new Set((profile.history?.recent || []).filter((e) => within(e.completedAt)).map((e) => e.id)).size;
  const questGain = Number.isInteger(previous.quests) && Number.isInteger(current?.quests) ? current.quests - previous.quests : null;
  const quests = Math.max(handIns, questGain || 0);
  if (quests > 0) wentWell.push({ kind: "quests", text: `You handed in ${plural(quests, "quest")}.` });
  const bests = beatenSplits(profile, others, ups);
  if (bests.length) {
    const b = bests.sort((x, y) => (y.previousSeconds - y.seconds) - (x.previousSeconds - x.seconds))[0];
    wentWell.push({ kind: "best", text: `A personal best: level ${b.level} to ${b.level + 1} in ${duration(b.seconds)} of play, ${duration(b.previousSeconds - b.seconds)} faster than your other characters.`, card: { kind: "best", data: { level: b.level, seconds: b.seconds, previousSeconds: b.previousSeconds } } });
  }
  const myRuns = (runs || []).filter((r) => within(r.startedAt));
  const bestRun = myRuns.find((r) => r.personalBest && r.timed && (runs || []).filter((x) => x.instanceMap === r.instanceMap && x.timed && x.bosses.length === r.bosses.length).length > 1);
  if (bestRun) wentWell.push({ kind: "best", text: `Your fastest full run of ${bestRun.name}: ${duration(bestRun.seconds)}.`, card: { kind: "best", data: { name: bestRun.name, seconds: bestRun.seconds, at: bestRun.startedAt } } });
  const bosses = myRuns.reduce((t, r) => t + r.bosses.filter((b) => within(b.at)).length, 0);
  if (bosses) wentWell.push({ kind: "bosses", text: `You defeated ${plural(bosses, "dungeon boss", "dungeon bosses")}${myRuns.length === 1 ? ` in ${myRuns[0].name}` : ""}.` });
  const earned = (badges || []).filter((b) => b.earned && within(b.at));
  if (earned.length) wentWell.push({ kind: "badges", text: earned.length === 1 ? `You earned the badge “${earned[0].name}”.` : `You earned ${earned.length} badges, among them “${earned[0].name}”.` });
  if (Number.isInteger(previous.money) && Number.isInteger(current?.money) && current.money - previous.money >= 10000) {
    wentWell.push({ kind: "gold", text: `You are ${Math.floor((current.money - previous.money) / 10000)} gold richer.` });
  }

  // One thing to change: the strongest repeated problem, else a trainer visit that is due.
  const died = (deaths || []).filter((d) => withinMs(d.at));
  const mySessions = (sessions || []).filter((s) => withinMs(s.endedAt) || withinMs(s.startedAt));
  const sessionDeaths = mySessions.reduce((t, s) => t + (s.deaths || 0), 0);
  const count = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (k !== null && k !== undefined) m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1])[0] || null; };
  const cause = count(died, (d) => d.tip || null), place = count(died, (d) => d.mapId || null), killer = count(died, (d) => d.killer || null);
  const worstRun = myRuns.filter((r) => r.timed && r.deaths >= 2).sort((a, b) => b.deaths - a.deaths)[0] || null;
  let change = null;
  if (killer && killer[1] >= 2) change = { kind: "death-killer", text: `${killer[0]} killed you ${killer[1]} times.`, advice: cause && TIP_CHANGE[cause[0]] ? TIP_CHANGE[cause[0]] : "Come back a level or two higher, or bring a friend." };
  else if (cause && cause[1] >= 2 && TIP_WORDS[cause[0]]) change = { kind: "death-cause", text: `${cause[1]} of your ${plural(died.length, "death")} had the same cause: ${TIP_WORDS[cause[0]]}.`, advice: TIP_CHANGE[cause[0]] };
  else if (place && place[1] >= 2) change = { kind: "death-place", text: `You died ${place[1]} times in ${mapName(place[0])}.`, advice: "Check that the zone fits your level on Now, and pull one enemy at a time there." };
  else if (worstRun) change = { kind: "run-deaths", text: `You died ${worstRun.deaths} times inside ${worstRun.name}.`, advice: "Read the boss notes in Dungeons & raids before the next run, and let the tank pull first." };
  else {
    // Trainer ranks that became available since the trainer window was last opened: certainly not bought yet.
    const seen = profile.ledger?.training, level = Number.isInteger(profile.level) ? profile.level : null;
    if (seen && sec(seen.seenAt) && level && Array.isArray(seen.services)) {
      const levelThen = (profile.journal?.levels || []).filter((e) => e.at > 0 && e.at <= seen.seenAt).reduce((m, e) => Math.max(m, e.level), 0);
      const due = levelThen ? seen.services.filter((s) => s.level > levelThen && s.level <= level) : [];
      if (due.length) change = { kind: "trainer", text: `Your trainer has ${plural(due.length, "rank")} you could not learn at your last visit on ${day(seen.seenAt)}: ${due.slice(0, 3).map((s) => `${s.name}${s.rank ? ` (${s.rank})` : ""}`).join(", ")}${due.length > 3 ? " and more" : ""}.`, advice: "Visit your class trainer before you head out again." };
    }
    if (!change && (died.length >= 2 || sessionDeaths >= 2)) change = { kind: "deaths", text: `You died ${Math.max(died.length, sessionDeaths)} times, with no repeated cause or place in what was saved.`, advice: "Start each fight at full health and look around before you pull." };
  }

  const evidence = wentWell.length + (change ? 1 : 0) + mySessions.length + died.length;
  const facts = { sessions: mySessions.length, minutes: mySessions.reduce((t, s) => t + (s.minutes || 0), 0), deaths: Math.max(died.length, sessionDeaths), levels: ups.length || Math.max(0, levelGain || 0), quests };
  if (!evidence) return { ...base, status: "too-little", from, to, facts, wentWell: [], change: null, message: `Too little was saved between ${day(from)} and ${day(to)} to say anything useful: no level, no quest handed in, no play session and no death.` };
  return { ...base, status: "ok", from, to, facts, wentWell, change, message: "",
    nothingWell: wentWell.length ? "" : "Nothing in the saved data counts as going well this time: no level, no quest handed in, no badge.",
    nothingToChange: change ? "" : "Nothing in the saved data points at something to change." };
}

module.exports = { coachNotes, beatenSplits, TIP_WORDS, TIP_CHANGE };
