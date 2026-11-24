"use strict";
// Economy and history (E6, E7, E9, E11, G11). The addon keeps only a short memory (five prices
// per item, thirty daily gold samples, a hundred boss kills, sixty dungeon visits). The desktop
// keeps the long one in its own file, economy.json in the app's data folder: a price history per
// item, gold per day, every dungeon and raid run, and the calendar settings. Built only from
// what the addon really saved; nothing here is guessed and nothing leaves this computer.
const fs = require("node:fs");
const LIMITS = Object.freeze({ pricePoints: 60, priceItems: 3000, money: 730, runs: 300, notified: 300, profiles: 100, runLoot: 30, runBosses: 40, sessions: 400 });
// A play session shorter than this gives no honest hourly figure.
const SESSION_MIN = 600;
const MAX_T = 253402300799, MONEY = 1e13, ID = 2147483647;
// The addon folds the pages of one Auction House visit into one observation (15 minutes).
const SAME_VISIT = 900;
// Boss kills in the same instance less than two hours apart count as one run when nothing better is known.
const RUN_GAP = 7200;
const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const nowSec = () => Math.floor(Date.now() / 1000);

// ---- Price history (E6) -------------------------------------------------------------------
/** Two lists of [price, at] -> one, oldest first, one point per Auction House visit, bounded. */
function mergePricePoints(existing, incoming, limit = LIMITS.pricePoints) {
  const all = [...(existing || []), ...(incoming || [])]
    .filter((p) => Array.isArray(p) && p.length === 2 && int(p[0], 1, MONEY) && int(p[1], 0, MAX_T))
    .map(([price, at]) => [price, at]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const p of all) {
    const last = out[out.length - 1];
    if (last && p[1] - last[1] <= SAME_VISIT) { last[0] = Math.min(last[0], p[0]); last[1] = p[1]; }
    else out.push(p);
  }
  return out.slice(-limit);
}
/** The middle price of a list of [price, at]; null for an empty list. */
function median(points) {
  const sorted = (points || []).map((p) => p[0]).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
/**
 * What the Ledger shows for one item: its points, the usual (median) price and whether the
 * newest price is clearly below it. The mark needs three visits and a price 15% under the usual.
 */
function priceSummary(points) {
  const list = mergePricePoints(points, []);
  if (!list.length) return null;
  const usual = median(list), latest = list[list.length - 1];
  const enough = list.length >= 3;
  const below = enough && latest[0] * 100 <= usual * 85;
  return { points: list, usual, visits: list.length, latest: latest[0], latestAt: latest[1], firstAt: list[0][1],
    low: Math.min(...list.map((p) => p[0])), high: Math.max(...list.map((p) => p[0])),
    below, belowPercent: below ? Math.round((1 - latest[0] / usual) * 100) : 0 };
}
/** Every character's kept price points merged per item: Map itemId -> [[price, at]...]. */
function mergedPriceHistory(data, profileIds = null) {
  const merged = new Map();
  for (const [profileId, items] of Object.entries(data?.prices || {})) {
    if (profileIds && !profileIds.includes(profileId)) continue;
    for (const [id, points] of Object.entries(items)) {
      const itemId = Number(id);
      merged.set(itemId, merged.has(itemId) ? mergePricePoints(merged.get(itemId), points) : points);
    }
  }
  return merged;
}

// ---- Craft profit (E7) --------------------------------------------------------------------
/** What vendors charged, newest sighting per item across characters: Map itemId -> { unit, at }. */
function vendorIndex(profiles) {
  const index = new Map();
  for (const p of profiles || []) for (const e of p?.ledger?.vendor || []) {
    const seen = index.get(e.id);
    if (!seen || e.at > seen.at) index.set(e.id, { unit: Math.ceil(e.cost / e.n), at: e.at });
  }
  return index;
}
/**
 * For each recipe the character knows that makes an item: what the materials cost and what the
 * result sold for, only from prices the player saw (each with its date). A missing price makes
 * the answer "unknown"; it is never filled in.
 * prices: Map itemId -> { latest, latestAt } (auction memory); vendor: vendorIndex();
 * vendorListed: Set of item ids the bundled seller reference lists (no prices in it);
 * facts: Map itemId -> { name, quality, sellPrice } from the player's own install.
 */
function craftProfit(profile, { prices = new Map(), vendor = new Map(), vendorListed = new Set(), facts = new Map() } = {}) {
  const workshop = profile?.readiness?.workshop;
  const recipes = workshop?.recipes?.items || [];
  const professions = new Map((workshop?.professions?.items || []).map((p) => [p.skillLineId, p.name]));
  const nameOf = (id, fallback) => facts.get(id)?.name || fallback || `Item #${id}`;
  const rows = [];
  for (const r of recipes) {
    if (!r.outputItemId) continue;
    const made = r.outputMin ?? 1;
    const materials = r.reagents.map((m) => {
      const auction = prices.get(m.itemId), sold = vendor.get(m.itemId);
      const options = [auction ? { unit: auction.latest, at: auction.latestAt, source: "auction" } : null, sold ? { unit: sold.unit, at: sold.at, source: "vendor" } : null].filter(Boolean)
        .sort((a, b) => a.unit - b.unit);
      const pick = options[0] || null;
      return { itemId: m.itemId, name: nameOf(m.itemId, m.name), quality: facts.get(m.itemId)?.quality ?? null, required: m.required,
        unit: pick?.unit ?? null, at: pick?.at ?? null, source: pick?.source ?? null, cost: pick ? pick.unit * m.required : null,
        vendorListed: !pick && vendorListed.has(m.itemId) };
    });
    const missing = materials.filter((m) => m.cost === null);
    const cost = r.reagentsKnown && r.reagents.length && !missing.length ? materials.reduce((s, m) => s + m.cost, 0) : null;
    const out = prices.get(r.outputItemId);
    const sell = out ? { unit: out.latest, at: out.latestAt, total: out.latest * made } : null;
    const vendorPays = int(facts.get(r.outputItemId)?.sellPrice, 1, MONEY) ? facts.get(r.outputItemId).sellPrice * made : null;
    rows.push({ recipeId: r.id, name: r.name, profession: professions.get(r.skillLineId) || null, outputItemId: r.outputItemId,
      outputName: nameOf(r.outputItemId, r.name), quality: facts.get(r.outputItemId)?.quality ?? null, made,
      madeUpTo: r.outputMax !== undefined && r.outputMax > made ? r.outputMax : null,
      materialsKnown: r.reagentsKnown && r.reagents.length > 0, materials, cost, sell, vendorPays,
      profit: cost !== null && sell ? sell.total - cost : null,
      oldestAt: cost !== null && sell ? Math.min(sell.at, ...materials.map((m) => m.at)) : null });
  }
  rows.sort((a, b) => (a.profit === null) - (b.profit === null) || (b.profit ?? 0) - (a.profit ?? 0) || a.name.localeCompare(b.name));
  return { profileId: profile?.id ?? null, name: profile?.name ?? null, observedAt: workshop?.recipes?.observedAt ?? null, complete: workshop?.recipes?.complete === true,
    known: rows.filter((r) => r.profit !== null).length, rows };
}
/** Item ids craftProfit needs facts for. */
function craftItemIds(profiles) {
  const ids = new Set();
  for (const p of profiles || []) for (const r of p?.readiness?.workshop?.recipes?.items || []) {
    if (!r.outputItemId) continue;
    ids.add(r.outputItemId);
    for (const m of r.reagents) ids.add(m.itemId);
  }
  return [...ids].sort((a, b) => a - b);
}

// ---- Gold over time (E9) ------------------------------------------------------------------
/** Kept samples plus a ledger's daily log and newest reading: one [copper, at] per UTC day, oldest first. */
function mergeMoney(existing, ledger, limit = LIMITS.money) {
  const incoming = [...(ledger?.moneyLog || [])];
  if (int(ledger?.money, 0, MONEY) && int(ledger?.moneyAt, 0, MAX_T)) incoming.push([ledger.money, ledger.moneyAt]);
  const days = new Map();
  for (const p of [...(existing || []), ...incoming]) {
    if (!Array.isArray(p) || p.length !== 2 || !int(p[0], 0, MONEY) || !int(p[1], 0, MAX_T)) continue;
    const day = Math.floor(p[1] / 86400), seen = days.get(day);
    if (!seen || p[1] >= seen[1]) days.set(day, [p[0], p[1]]);
  }
  return [...days.values()].sort((a, b) => a[1] - b[1]).slice(-limit);
}
/** One character's gold samples with the change from each sample to the next. */
function moneyView(points) {
  const list = mergeMoney(points, null);
  if (!list.length) return null;
  const first = list[0], last = list[list.length - 1];
  const changes = list.slice(1).map((p, i) => ({ at: p[1], money: p[0], change: p[0] - list[i][0], days: Math.max(1, Math.floor(p[1] / 86400) - Math.floor(list[i][1] / 86400)) }));
  return { points: list, first: first[0], firstAt: first[1], last: last[0], lastAt: last[1], change: last[0] - first[0],
    low: Math.min(...list.map((p) => p[0])), high: Math.max(...list.map((p) => p[0])), changes: changes.reverse().slice(0, 14) };
}

// ---- Play sessions (E9) -------------------------------------------------------------------
// The addon saves, per character, when it was loaded and last saw the character, with the
// gold at both moments: [start, lastSeen, copperAtStart, copperAtLastSeen]. Clock time, not
// /played. The gold change is everything that moved the purse: loot, quests, vendors, repairs,
// training, mail and the Auction House alike. Loot value is not part of it.
/** Kept sessions plus newly saved ones: oldest first, one per start (the longer wins), never overlapping, bounded. */
function mergeSessions(existing, incoming, limit = LIMITS.sessions) {
  const byStart = new Map();
  for (const s of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!Array.isArray(s) || s.length !== 4 || !int(s[0], 1, MAX_T) || !int(s[1], s[0], MAX_T) || !int(s[2], 0, MONEY) || !int(s[3], 0, MONEY)) continue;
    const seen = byStart.get(s[0]);
    if (!seen || s[1] >= seen[1]) byStart.set(s[0], [s[0], s[1], s[2], s[3]]);
  }
  const out = [];
  for (const s of [...byStart.values()].sort((a, b) => a[0] - b[0])) if (!out.length || s[0] > out[out.length - 1][1]) out.push(s);
  return out.slice(-limit);
}
/**
 * One character's sessions for the Ledger: newest first, each with its length, gold change and
 * coin per hour (null when the session was shorter than ten minutes), plus the sum over the
 * sessions shown. null when no session was saved.
 */
function sessionView(sessions, { limit = 12 } = {}) {
  const list = mergeSessions(sessions, null);
  if (!list.length) return null;
  const rows = list.slice(-limit).reverse().map(([start, end, from, to]) => {
    const seconds = end - start, change = to - from;
    return { start, end, seconds, from, to, change, perHour: seconds >= SESSION_MIN ? Math.round((change * 3600) / seconds) : null };
  });
  const timed = rows.filter((r) => r.perHour !== null);
  const seconds = timed.reduce((n, r) => n + r.seconds, 0), change = timed.reduce((n, r) => n + r.change, 0);
  return { rows, kept: list.length, minSeconds: SESSION_MIN, total: timed.length ? { sessions: timed.length, seconds, change, perHour: Math.round((change * 3600) / seconds) } : null };
}

// ---- Run history (G11) --------------------------------------------------------------------
const bossKey = (b) => `${b.encounterId}:${b.at}`;
function cleanRun(r) {
  if (!plain(r) || typeof r.id !== "string" || r.id.length > 60 || !int(r.instanceMap, 1, ID) || !["party", "raid"].includes(r.instanceType)) return null;
  if (!int(r.startedAt, 1, MAX_T) || !int(r.endedAt, r.startedAt, MAX_T)) return null;
  const timed = r.timed === true;
  const bosses = [], seen = new Set();
  for (const b of Array.isArray(r.bosses) ? r.bosses : []) {
    if (!plain(b) || !int(b.encounterId, 1, ID) || !int(b.at, 1, MAX_T) || typeof b.name !== "string" || !b.name.trim() || b.name.length > 120 || seen.has(bossKey(b))) continue;
    seen.add(bossKey(b));
    bosses.push({ encounterId: b.encounterId, name: b.name, at: b.at });
  }
  bosses.sort((a, b) => a.at - b.at);
  const loot = [], items = new Set();
  for (const l of timed && Array.isArray(r.loot) ? r.loot : []) {
    if (!plain(l) || !int(l.id, 1, ID) || !int(l.n, 1, 100000) || items.has(l.id)) continue;
    items.add(l.id);
    loot.push({ id: l.id, n: l.n });
  }
  return { id: r.id, instanceMap: r.instanceMap, instanceType: r.instanceType,
    ...(typeof r.name === "string" && r.name.trim() && r.name.length <= 120 ? { name: r.name } : {}),
    timed, startedAt: r.startedAt, endedAt: r.endedAt, deaths: timed && int(r.deaths, 0, 10000) ? r.deaths : timed ? 0 : null,
    loot: timed ? loot.slice(0, LIMITS.runLoot) : null, bosses: bosses.slice(0, LIMITS.runBosses) };
}
/**
 * Kept runs plus one character's journal -> kept runs, newest last. A visit the addon timed
 * (walked in, walked out, deaths, loot) is one run. Boss kills no visit covers (saved by an
 * older addon) become a run with only its bosses: no entry time, deaths or loot are made up.
 */
function absorbRuns(existing, journal, limit = LIMITS.runs) {
  const runs = new Map();
  for (const r of existing || []) { const c = cleanRun(r); if (c) runs.set(c.id, c); }
  for (const v of journal?.runs || []) {
    const id = `${v.instanceMap}:${v.startedAt}`, old = runs.get(id);
    const loot = new Map((old?.loot || []).map((l) => [l.id, l.n]));
    for (const l of v.loot || []) loot.set(l.id, Math.max(loot.get(l.id) || 0, l.n));
    const next = cleanRun({ id, instanceMap: v.instanceMap, instanceType: v.instanceType, name: v.name ?? old?.name, timed: true, startedAt: v.startedAt,
      endedAt: Math.max(v.endedAt, old?.endedAt || 0), deaths: Math.max(v.deaths || 0, old?.deaths || 0),
      loot: [...loot].map(([lootId, n]) => ({ id: lootId, n })), bosses: old?.bosses || [] });
    if (next) runs.set(id, next);
  }
  const add = (run, e) => {
    if (run.bosses.some((b) => bossKey(b) === bossKey(e)) || run.bosses.length >= LIMITS.runBosses) return;
    run.bosses.push({ encounterId: e.encounterId, name: e.name, at: e.at });
    run.bosses.sort((a, b) => a.at - b.at);
  };
  const kills = [...(journal?.encounters || [])].sort((a, b) => a.at - b.at);
  for (const e of kills) {
    const same = [...runs.values()].filter((r) => r.instanceMap === e.instanceMap && r.instanceType === e.instanceType);
    // A boss dies a moment before the addon notes the kill; allow a little slack around a visit.
    const visit = same.find((r) => r.timed && e.at >= r.startedAt - 60 && e.at <= r.endedAt + 300);
    if (visit) { add(visit, e); continue; }
    let loose = same.find((r) => !r.timed && e.at >= r.startedAt - RUN_GAP && e.at <= r.endedAt + RUN_GAP);
    if (!loose) {
      loose = { id: `u:${e.instanceMap}:${e.at}`, instanceMap: e.instanceMap, instanceType: e.instanceType, timed: false, startedAt: e.at, endedAt: e.at, deaths: null, loot: null, bosses: [] };
      runs.set(loose.id, loose);
    }
    add(loose, e);
    loose.startedAt = Math.min(loose.startedAt, e.at);
    loose.endedAt = Math.max(loose.endedAt, e.at);
  }
  return [...runs.values()].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)).slice(-limit);
}
/**
 * The history list (newest first) and one line per dungeon with the personal best: the fastest
 * timed run that killed as many bosses as this character's fullest run there.
 * names: Map instanceMap -> { name, bosses } from the dungeon list; facts: Map itemId -> { name, quality }.
 */
function runHistoryView(runs, { names = new Map(), facts = new Map() } = {}) {
  const list = (runs || []).map(cleanRun).filter(Boolean);
  const known = new Map();
  for (const r of list) if (r.name && !known.has(r.instanceMap)) known.set(r.instanceMap, r.name);
  const title = (r) => names.get(r.instanceMap)?.name || known.get(r.instanceMap) || r.name || `Instance ${r.instanceMap}`;
  const groups = new Map();
  for (const r of list) {
    const key = `${r.instanceType}:${r.instanceMap}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const best = new Map(), dungeons = [];
  for (const [key, rows] of groups) {
    const most = Math.max(...rows.map((r) => r.bosses.length));
    const full = most > 0 ? rows.filter((r) => r.timed && r.bosses.length === most && r.endedAt > r.startedAt) : [];
    const fastest = full.reduce((m, r) => (!m || r.endedAt - r.startedAt < m.endedAt - m.startedAt ? r : m), null);
    if (fastest) best.set(key, fastest.id);
    const last = rows.reduce((m, r) => (r.startedAt > m.startedAt ? r : m), rows[0]);
    dungeons.push({ instanceMap: rows[0].instanceMap, instanceType: rows[0].instanceType, name: title(rows[0]), runs: rows.length,
      timedRuns: rows.filter((r) => r.timed).length, mostBosses: most, knownBosses: names.get(rows[0].instanceMap)?.bosses ?? null,
      bestSeconds: fastest ? fastest.endedAt - fastest.startedAt : null, bestAt: fastest ? fastest.startedAt : null, lastAt: last.startedAt,
      deaths: rows.some((r) => r.timed) ? rows.reduce((s, r) => s + (r.deaths || 0), 0) : null });
  }
  dungeons.sort((a, b) => b.lastAt - a.lastAt || a.name.localeCompare(b.name));
  const rows = list.sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id)).map((r) => ({
    id: r.id, instanceMap: r.instanceMap, instanceType: r.instanceType, name: title(r), timed: r.timed, startedAt: r.startedAt, endedAt: r.endedAt,
    seconds: r.timed ? r.endedAt - r.startedAt : null, bossSpanSeconds: r.bosses.length > 1 ? r.bosses[r.bosses.length - 1].at - r.bosses[0].at : null,
    deaths: r.deaths, bosses: r.bosses.map((b) => ({ name: b.name, at: b.at })), knownBosses: names.get(r.instanceMap)?.bosses ?? null,
    loot: r.loot === null ? null : r.loot.map((l) => ({ itemId: l.id, count: l.n, name: facts.get(l.id)?.name || `Item #${l.id}`, quality: facts.get(l.id)?.quality ?? null })),
    personalBest: best.get(`${r.instanceType}:${r.instanceMap}`) === r.id }));
  return { rows, dungeons, totals: { runs: rows.length, timed: rows.filter((r) => r.timed).length, bosses: rows.reduce((s, r) => s + r.bosses.length, 0) } };
}
function runItemIds(runs) {
  const ids = new Set();
  for (const r of runs || []) for (const l of r.loot || []) ids.add(l.id);
  return [...ids].sort((a, b) => a - b);
}

// ---- Cooldown calendar (E11) --------------------------------------------------------------
/**
 * Every character's profession cooldowns and the first mail to expire, as dated events.
 * Only what the addon saved: a cooldown the character never used and a mailbox never opened
 * are not on the calendar.
 */
function calendarEvents(profiles, now = nowSec()) {
  const { COOLDOWNS } = require("./ledger.cjs");
  const events = [];
  for (const p of profiles || []) {
    const l = p?.ledger;
    if (!l) continue;
    const who = { profileId: p.id, character: p.name, realm: p.realm || "", faction: p.faction || null };
    for (const c of l.cooldowns || []) {
      const info = COOLDOWNS[c.key];
      if (!info) continue;
      events.push({ key: `${p.id}:cd:${c.key}:${c.readyAt}`, kind: "cooldown", at: c.readyAt, title: `${info.name} ready`, detail: info.profession, ...who, past: c.readyAt <= now });
    }
    if (l.mail && int(l.mail.expiresAt, 1, MAX_T) && (l.mail.letters > 0 || l.mail.items.length > 0 || l.mail.money > 0)) {
      events.push({ key: `${p.id}:mail:${l.mail.expiresAt}`, kind: "mail", at: l.mail.expiresAt, title: "Mail expires",
        detail: `${l.mail.letters} letter${l.mail.letters === 1 ? "" : "s"} when the mailbox was last opened`, seenAt: l.mail.seenAt, ...who, past: l.mail.expiresAt <= now });
    }
  }
  return events.sort((a, b) => a.at - b.at || a.character.localeCompare(b.character) || a.key.localeCompare(b.key));
}
/** Local calendar day "YYYY-MM-DD" of a time in seconds. */
function localDay(at) {
  const d = new Date(at * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/**
 * Which events deserve a desktop notification now and have not had one: a cooldown that came
 * ready in the last six hours, and mail that expires within two days.
 */
function dueNotifications(events, notified, now = nowSec()) {
  const done = new Set(notified || []);
  // A guild event (guild-events.cjs) gets one notice in its last quarter of an hour; lockouts get none.
  const due = (e) => (e.kind === "cooldown" ? e.at <= now && now - e.at <= 6 * 3600 : e.kind === "mail" ? e.at > now && e.at - now <= 2 * 86400 : e.kind === "event" ? e.at > now && e.at - now <= 900 : false);
  return (events || []).filter((e) => !done.has(e.key) && due(e))
    .map((e) => (e.kind === "event" ? { key: e.key, title: `Guild event soon: ${e.title}`, body: `Starts in ${Math.max(1, Math.round((e.at - now) / 60))} minutes. ${e.detail}.` }
      : { key: e.key, title: e.kind === "cooldown" ? `${e.title}: ${e.character}` : `Mail expires soon: ${e.character}`,
        body: e.kind === "cooldown" ? `${e.detail} cooldown on ${e.character} is ready.` : `Mail on ${e.character} starts to expire in ${Math.max(1, Math.round((e.at - now) / 3600))} hours.` }));
}
const icsText = (v) => String(v).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
const icsTime = (at) => new Date(at * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
function fold(line) {
  // RFC 5545: lines are at most 75 octets; longer ones continue on a line that starts with a space.
  const out = [];
  let current = "", bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (out.length ? 74 : 75)) { out.push(current); current = ""; bytes = 0; }
    current += ch; bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}
/** A calendar file (.ics) of the events still ahead; the player saves it and opens it in any calendar. */
function calendarIcs(events, now = nowSec()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Backstage Forever//Cooldown calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Backstage Forever"];
  for (const e of (events || []).filter((x) => x.at > now)) {
    lines.push("BEGIN:VEVENT", `UID:${icsText(e.key.replace(/[^A-Za-z0-9:._-]/g, "-"))}@backstage-forever`, `DTSTAMP:${icsTime(now)}`, `DTSTART:${icsTime(e.at)}`, `DTEND:${icsTime(e.at + (Number.isSafeInteger(e.minutes) && e.minutes > 0 && e.minutes <= 1440 ? e.minutes * 60 : 900))}`,
      `SUMMARY:${icsText(`${e.title} - ${e.character}`)}`, `DESCRIPTION:${icsText(`${e.detail}. ${e.character}${e.realm ? ` (${e.realm})` : ""}. As the game last saved it.`)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---- The desktop's own store --------------------------------------------------------------
const emptyData = () => ({ version: 1, prices: {}, money: {}, runs: {}, sessions: {}, calendar: { notify: false, notified: [] } });
const profileKey = (k) => typeof k === "string" && k.length > 0 && k.length <= 100 && k !== "__proto__";
/**
 * Any earlier or damaged file -> the current shape. Unknown parts are dropped one by one; a
 * bad entry never costs the rest. A file from before the calendar or runs existed gains them empty.
 */
function migrate(raw) {
  const out = emptyData();
  if (!plain(raw)) return out;
  if (plain(raw.prices)) for (const [profileId, items] of Object.entries(raw.prices).slice(0, LIMITS.profiles)) {
    if (!profileKey(profileId) || !plain(items)) continue;
    const kept = {};
    for (const [id, points] of Object.entries(items)) {
      if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > ID || !Array.isArray(points)) continue;
      const list = mergePricePoints(points, []);
      if (list.length) kept[id] = list;
    }
    if (Object.keys(kept).length) out.prices[profileId] = trimItems(kept);
  }
  if (plain(raw.money)) for (const [profileId, points] of Object.entries(raw.money).slice(0, LIMITS.profiles)) {
    if (!profileKey(profileId) || !Array.isArray(points)) continue;
    const list = mergeMoney(points, null);
    if (list.length) out.money[profileId] = list;
  }
  if (plain(raw.runs)) for (const [profileId, runs] of Object.entries(raw.runs).slice(0, LIMITS.profiles)) {
    if (!profileKey(profileId) || !Array.isArray(runs)) continue;
    const list = absorbRuns(runs, null);
    if (list.length) out.runs[profileId] = list;
  }
  if (plain(raw.sessions)) for (const [profileId, sessions] of Object.entries(raw.sessions).slice(0, LIMITS.profiles)) {
    if (!profileKey(profileId) || !Array.isArray(sessions)) continue;
    const list = mergeSessions(sessions, null);
    if (list.length) out.sessions[profileId] = list;
  }
  if (plain(raw.calendar)) {
    out.calendar.notify = raw.calendar.notify === true;
    if (Array.isArray(raw.calendar.notified)) out.calendar.notified = raw.calendar.notified.filter((k) => typeof k === "string" && k.length <= 200).slice(-LIMITS.notified);
  }
  return out;
}
// Keep the items seen most recently when a character's price memory outgrows its bound.
function trimItems(items) {
  const ids = Object.keys(items);
  if (ids.length <= LIMITS.priceItems) return items;
  const newest = (id) => items[id][items[id].length - 1][1];
  return Object.fromEntries(ids.sort((a, b) => newest(b) - newest(a)).slice(0, LIMITS.priceItems).map((id) => [id, items[id]]));
}
/** Fold the current saved characters into the kept data; returns the next data (a new object). */
function absorb(data, profiles) {
  const next = migrate(data);
  const ids = new Set((profiles || []).map((p) => p.id));
  // A deleted character takes its history with it.
  for (const part of ["prices", "money", "runs", "sessions"]) for (const id of Object.keys(next[part])) if (!ids.has(id)) delete next[part][id];
  for (const p of profiles || []) {
    if (!profileKey(p?.id)) continue;
    if (p.ledger?.prices?.length) {
      const items = { ...(next.prices[p.id] || {}) };
      for (const e of p.ledger.prices) items[e.id] = mergePricePoints(items[e.id], e.hist);
      next.prices[p.id] = trimItems(items);
    }
    const money = mergeMoney(next.money[p.id], p.ledger);
    if (money.length) next.money[p.id] = money;
    const sessions = mergeSessions(next.sessions[p.id], p.extras?.sessions);
    if (sessions.length) next.sessions[p.id] = sessions;
    if (p.journal?.runs?.length || p.journal?.encounters?.length || next.runs[p.id]) {
      const runs = absorbRuns(next.runs[p.id], p.journal);
      if (runs.length) next.runs[p.id] = runs; else delete next.runs[p.id];
    }
  }
  return next;
}
class EconomyStore {
  constructor({ file, write = (f, text) => require("./store.cjs").atomic(f, text) } = {}) {
    Object.assign(this, { file, write, data: emptyData(), saved: "" });
    try { this.data = migrate(JSON.parse(fs.readFileSync(file, "utf8"))); this.saved = JSON.stringify(this.data); } catch { /* No file yet, or unreadable: start empty. */ }
  }
  #save() {
    const text = JSON.stringify(this.data);
    if (text === this.saved || !this.file) return false;
    try { this.write(this.file, text); this.saved = text; return true; } catch { return false; }
  }
  /** Called whenever saved characters change; writes only when something new arrived. */
  absorb(state) { this.data = absorb(this.data, state?.profiles || []); return this.#save(); }
  setNotify(on) { this.data.calendar.notify = on === true; this.#save(); return this.data.calendar.notify; }
  markNotified(keys) {
    this.data.calendar.notified = [...new Set([...this.data.calendar.notified, ...keys])].slice(-LIMITS.notified);
    this.#save();
  }
  /** Delete all local data. */
  clear() { this.data = emptyData(); this.#save(); }
}
module.exports = { LIMITS, mergePricePoints, median, priceSummary, mergedPriceHistory, vendorIndex, craftProfit, craftItemIds, mergeMoney, moneyView, mergeSessions, sessionView, SESSION_MIN,
  absorbRuns, runHistoryView, runItemIds, calendarEvents, localDay, dueNotifications, calendarIcs, migrate, absorb, EconomyStore };
