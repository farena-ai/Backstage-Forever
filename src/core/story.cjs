"use strict";
// The story so far (W8): a chapter page for one character, written only from what was saved.
// Where it leveled (from the quests it picked up, the sessions the live link saw and the times
// it gained levels), the quest stories it finished, its firsts, where it died and the dungeons
// it ran. Short plain sentences. A fact that was not saved is named as missing, never guessed.
const FIRST_WORDS = Object.freeze({ dungeon: "First dungeon", flight: "First flight", mount: "First time on a mount", death: "First death", rested: "First rested bonus", group: "First group", hearth: "First hearthstone home" });
const FIRST_ORDER = ["dungeon", "death", "mount", "flight", "group", "hearth", "rested"];
const LIMITS = Object.freeze({ zones: 40, chains: 12, undatedChains: 8, deathZones: 12, dungeons: 20, firsts: 7 });
const MAX_T = 253402300799;
const sec = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_T;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const defaultDay = (at) => new Date(at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const duration = (s) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; };

/** The level a character had at a time (seconds), from the dated level-ups; null when the journal cannot tell. */
function levelAt(levels, at) {
  let level = null;
  for (const e of levels) { if (e.at <= at) level = e.level; else break; }
  return level;
}
/** Dated level-ups, oldest first (entries without a time are left out). */
function datedLevels(profile) {
  return (profile?.journal?.levels || []).filter((e) => sec(e.at) && Number.isInteger(e.level)).map((e) => ({ level: e.level, at: e.at, played: Number.isFinite(e.played) ? e.played : null })).sort((a, b) => a.at - b.at || a.level - b.level);
}

/**
 * Zones in the order the character first worked in them. Evidence: quests accepted there (place
 * and time saved by the addon) and play sessions seen over the live link. Level ranges come from
 * the level the character had at those times; a session through several zones gives dates only.
 */
function zoneChapters(profile, sessions = []) {
  const levels = datedLevels(profile), zones = new Map();
  const touch = (mapId, at, level, quest) => {
    if (!Number.isSafeInteger(mapId) || mapId <= 0 || !sec(at)) return;
    let z = zones.get(mapId);
    if (!z) zones.set(mapId, (z = { mapId, firstAt: at, lastAt: at, minLevel: null, maxLevel: null, quests: 0, sessions: 0 }));
    z.firstAt = Math.min(z.firstAt, at); z.lastAt = Math.max(z.lastAt, at);
    if (Number.isInteger(level)) { z.minLevel = z.minLevel === null ? level : Math.min(z.minLevel, level); z.maxLevel = z.maxLevel === null ? level : Math.max(z.maxLevel, level); }
    if (quest) z.quests++;
  };
  for (const g of profile?.journal?.givers || []) touch(g.m, g.at, levelAt(levels, g.at), true);
  for (const s of sessions || []) {
    const start = Math.floor(s.startedAt / 1000), end = Math.floor(s.endedAt / 1000), list = Array.isArray(s.zones) ? s.zones : [];
    for (const mapId of list) {
      const alone = list.length === 1;
      touch(mapId, start, alone && Number.isInteger(s.startLevel) ? s.startLevel : null, false);
      touch(mapId, end, alone && Number.isInteger(s.level) ? s.level : null, false);
      const z = zones.get(mapId); if (z) z.sessions++;
    }
  }
  return [...zones.values()].sort((a, b) => a.firstAt - b.firstAt || a.mapId - b.mapId).slice(0, LIMITS.zones);
}

/** The last quest of a story of two or more quests -> { questId, name, steps, first }, else null. ref: { quests, prev } maps. */
function chainFor(ref, questId) {
  const q = ref?.quests?.get(questId);
  if (!q || q.next || !ref.prev?.has(questId)) return null;
  const chain = [q];
  for (let id = ref.prev.get(questId), guard = 0; id && guard < 40; id = ref.prev.get(id), guard++) { const p = ref.quests.get(id); if (!p || chain.includes(p)) break; chain.unshift(p); }
  return chain.length < 2 ? null : { questId, name: q.title, steps: chain.length, first: chain[0].title };
}
/** Finished quest stories: dated ones from the saved hand-ins, the rest from the list of finished quests. */
function finishedChains(profile, ref) {
  const savedAt = Date.parse(profile?.source?.updatedAt || "") / 1000, dated = new Map();
  for (const e of profile?.history?.recent || []) {
    if (!sec(e.completedAt) || (Number.isFinite(savedAt) && e.completedAt > savedAt)) continue;
    const c = chainFor(ref, e.id);
    if (c && (!dated.has(e.id) || e.completedAt < dated.get(e.id).at)) dated.set(e.id, { ...c, at: e.completedAt });
  }
  const undated = [], names = new Set([...dated.values()].map((c) => c.name));
  if (profile?.history?.completedIdsKnown === true) for (const id of profile.history.completedIds || []) {
    if (dated.has(id)) continue;
    const c = chainFor(ref, id);
    // Several stories share a name (one per faction or step); a name is told once.
    if (c && !names.has(c.name)) { names.add(c.name); undated.push({ ...c, at: null }); }
  }
  undated.sort((a, b) => b.steps - a.steps || a.name.localeCompare(b.name));
  return { dated: [...dated.values()].sort((a, b) => a.at - b.at), undated };
}

/**
 * profile: the saved character. extras (all optional): sessions (session history rows), deaths
 * (journey store rows: { at ms, mapId?, tip?, killer? }), runs (runHistoryView result), chains
 * ({ quests, prev } maps of the quest reference), zonesDone ([{ mapId, name, done, total, min, max }]),
 * mapName(id), day(seconds) for dates.
 */
function story(profile, { sessions = [], deaths = [], runs = null, chains = null, zonesDone = [], mapName = (id) => `Map ${id}`, day = defaultDay } = {}) {
  if (!profile) return null;
  const levels = datedLevels(profile), chapters = [], notSaved = [], cards = [];
  const span = (a, b) => (day(a) === day(b) ? `on ${day(a)}` : `from ${day(a)} to ${day(b)}`);
  const atLevel = (at) => { const l = levelAt(levels, at); return l ? ` at level ${l}` : ""; };

  // Chapter: where it leveled.
  const zones = zoneChapters(profile, sessions);
  const zoneLines = zones.map((z) => {
    const range = z.minLevel === null ? "" : z.minLevel === z.maxLevel ? ` at level ${z.minLevel}` : `, levels ${z.minLevel} to ${z.maxLevel}`;
    const what = z.quests ? `${plural(z.quests, "quest")} picked up` : plural(z.sessions, "play session");
    return `${mapName(z.mapId)}${range}: ${what} ${span(z.firstAt, z.lastAt)}.`;
  });
  const visited = (profile.journal?.zones || []).length;
  if (zoneLines.length) {
    if (visited > zones.length) zoneLines.push(`${plural(visited - zones.length, "more zone")} visited, with no saved date.`);
    chapters.push({ key: "zones", title: "Where the road led", sentences: zoneLines });
  } else notSaved.push(visited ? `${plural(visited, "zone")} visited, but when and at what level was not saved.` : "No zone has a saved date yet. Pick up quests with the addon on and they appear here.");

  // Chapter: levels.
  if (levels.length) {
    const first = levels[0], last = levels[levels.length - 1], lines = [];
    lines.push(levels.length === 1 ? `Level ${first.level} was reached on ${day(first.at)}.` : `From level ${first.level} on ${day(first.at)} to level ${last.level} on ${day(last.at)}.`);
    const played = Number.isFinite(profile.journal?.played) ? profile.journal.played : null;
    if (played) lines.push(`${duration(played)} played in all.`);
    let fastest = null;
    for (let i = 1; i < levels.length; i++) {
      const a = levels[i - 1], b = levels[i];
      if (b.level === a.level + 1 && a.played !== null && b.played !== null && b.played > a.played && (!fastest || b.played - a.played < fastest.seconds)) fastest = { level: a.level, seconds: b.played - a.played, at: b.at };
    }
    if (fastest && levels.length > 2) { lines.push(`The quickest level was ${fastest.level} to ${fastest.level + 1}: ${duration(fastest.seconds)} of play.`); }
    chapters.push({ key: "levels", title: "Levels", sentences: lines });
    cards.push({ kind: "level", label: `Level ${last.level}`, data: { level: last.level, at: last.at, played, seconds: levels.length > 1 && levels[levels.length - 2].level === last.level - 1 && last.played !== null && levels[levels.length - 2].played !== null ? last.played - levels[levels.length - 2].played : null } });
  } else notSaved.push("No level has a saved date yet. Gain a level with the addon on.");

  // Chapter: firsts.
  const firsts = new Map((profile.journal?.firsts || []).filter((f) => FIRST_WORDS[f.key] && sec(f.at)).map((f) => [f.key, f.at]));
  const firstLines = FIRST_ORDER.filter((k) => firsts.has(k)).slice(0, LIMITS.firsts).map((k) => `${FIRST_WORDS[k]}: ${day(firsts.get(k))}${atLevel(firsts.get(k))}.`);
  if (firstLines.length) chapters.push({ key: "firsts", title: "Firsts", sentences: firstLines });

  // Chapter: quest stories.
  const found = chains ? finishedChains(profile, chains) : { dated: [], undated: [] };
  const chainLines = found.dated.slice(-LIMITS.chains).map((c) => `Finished “${c.name}”, a story of ${c.steps} quests, on ${day(c.at)}.`);
  if (found.undated.length) {
    const shown = found.undated.slice(0, LIMITS.undatedChains);
    chainLines.push(`Also finished, date not saved: ${shown.map((c) => `“${c.name}”`).join(", ")}${found.undated.length > shown.length ? ` and ${found.undated.length - shown.length} more` : ""}.`);
  }
  if (chainLines.length) chapters.push({ key: "chains", title: "Quest stories finished", sentences: chainLines });
  for (const c of [...found.dated].reverse().slice(0, 3)) cards.push({ kind: "chain", label: c.name, data: { name: c.name, steps: c.steps, first: c.first, at: c.at } });
  const mastered = (zonesDone || []).slice(0, 12);
  if (mastered.length) chapters.push({ key: "zones-done", title: "Zones finished", sentences: mastered.map((z) => `${z.name}: ${z.done} of ${z.total} known quests done.`) });
  for (const z of mastered.slice(0, 3)) cards.push({ kind: "zone", label: z.name, data: z });

  // Chapter: dungeons.
  const dungeonLines = (runs?.dungeons || []).slice(0, LIMITS.dungeons).map((d) => {
    const bits = [plural(d.runs, "run"), d.mostBosses ? `up to ${plural(d.mostBosses, "boss", "bosses")} defeated${d.knownBosses ? ` of ${d.knownBosses}` : ""}` : "no boss kill saved",
      d.bestSeconds ? `fastest full run ${duration(d.bestSeconds)}` : ""].filter(Boolean);
    return `${d.name}: ${bits.join(", ")}. Last visit ${day(d.lastAt)}.`;
  });
  if (dungeonLines.length) chapters.push({ key: "dungeons", title: "Dungeons and raids", sentences: dungeonLines });
  const lastRun = runs?.rows?.[0];
  if (lastRun) cards.push({ kind: "run", label: lastRun.name, data: { name: lastRun.name, instanceType: lastRun.instanceType, bosses: lastRun.bosses.length, knownBosses: lastRun.knownBosses, timed: lastRun.timed, seconds: lastRun.seconds, deaths: lastRun.deaths, personalBest: lastRun.personalBest, at: lastRun.startedAt } });

  // Chapter: deaths.
  const deathLines = [], byZone = new Map();
  for (const d of deaths || []) {
    const key = Number.isSafeInteger(d.mapId) ? d.mapId : 0, z = byZone.get(key) || { mapId: key, count: 0, lastAt: 0 };
    z.count++; z.lastAt = Math.max(z.lastAt, Math.floor(d.at / 1000)); byZone.set(key, z);
  }
  for (const z of [...byZone.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, LIMITS.deathZones)) {
    deathLines.push(z.mapId ? `Died ${z.count === 1 ? "once" : `${z.count} times`} in ${mapName(z.mapId)}, last on ${day(z.lastAt)}.` : `Died ${z.count === 1 ? "once" : `${z.count} times`} where the place could not be read, last on ${day(z.lastAt)}.`);
  }
  for (const r of (runs?.rows || []).filter((x) => x.timed && x.deaths > 0).slice(0, 6)) deathLines.push(`${plural(r.deaths, "death")} inside ${r.name} on ${day(r.startedAt)}.`);
  const sessionDeaths = (sessions || []).reduce((t, s) => t + (s.deaths || 0), 0), placed = (deaths || []).length;
  if (sessionDeaths > placed) deathLines.push(`Play sessions counted ${plural(sessionDeaths, "death")} in all; for ${sessionDeaths - placed} of them the place was not saved.`);
  if (deathLines.length) chapters.push({ key: "deaths", title: "Deaths", sentences: deathLines });
  else if (firsts.has("death")) notSaved.push("Deaths are placed on the map from now on, while the live link is on. Earlier deaths have no saved place.");

  const runCount = runs?.totals?.runs || 0, deathCount = Math.max(placed, sessionDeaths);
  const level = Number.isInteger(profile.level) ? profile.level : levels.length ? levels[levels.length - 1].level : null;
  const summaryLines = [zones.length ? `Leveled through ${zones.slice(0, 4).map((z) => mapName(z.mapId)).join(", ")}${zones.length > 4 ? ` and ${plural(zones.length - 4, "more zone")}` : ""}.` : "",
    levels.length > 1 ? `Level ${levels[0].level} on ${day(levels[0].at)}, level ${levels[levels.length - 1].level} on ${day(levels[levels.length - 1].at)}.` : "",
    found.dated.length + found.undated.length ? `${plural(found.dated.length + found.undated.length, "quest story", "quest stories")} finished.` : "",
    runCount ? `${plural(runCount, "dungeon run")} on record.` : "", firsts.has("dungeon") ? `First dungeon on ${day(firsts.get("dungeon"))}.` : ""].filter(Boolean);
  const stats = [level ? ["Level", String(level)] : null, zones.length ? ["Zones", String(zones.length)] : null, runCount ? ["Dungeon runs", String(runCount)] : null, deathCount ? ["Deaths", String(deathCount)] : null].filter(Boolean);
  if (summaryLines.length) cards.unshift({ kind: "story", label: "The story so far", data: { title: "The story so far", lines: summaryLines, stats } });
  return { id: profile.id, name: profile.name, className: profile.className || null, level, enough: chapters.length > 0, chapters, notSaved, cards };
}

module.exports = { story, zoneChapters, finishedChains, chainFor, levelAt, datedLevels, FIRST_WORDS, LIMITS };
