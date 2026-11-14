"use strict";
// Ledger (0.35): what each character carries (bags, bank, mail), their gold, reputations,
// profession cooldowns and the auction prices the player saw on pages they opened in game.
// The addon block is validated strictly and bounded; an invalid block is dropped without
// touching the rest of the character. Everything here stays on this computer: it is never part
// of community sharing (community.cjs) or the AI context (providers.cjs).
const LIMITS = Object.freeze({ items: 400, factions: 120, cooldowns: 16, prices: 1500, history: 5 });
const MAX_T = 253402300799, MONEY = 1e13, ID = 2147483647;
const COOLDOWNS = Object.freeze({
  transmute: { name: "Transmute", profession: "Alchemy" },
  mooncloth: { name: "Mooncloth", profession: "Tailoring" },
  "salt-shaker": { name: "Salt Shaker", profession: "Leatherworking" },
});
const STANDINGS = Object.freeze(["", "Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"]);
// Faction ids of each side's cities and battleground factions; everything else is shared.
const SIDES = Object.freeze({
  Alliance: Object.freeze([72, 47, 69, 54, 730, 890, 509, 471]),
  Horde: Object.freeze([76, 68, 81, 530, 729, 889, 510]),
});
const fail = () => { throw Error("Invalid ledger."); };
const int = (v, lo, hi) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : fail());
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : fail());
const text = (v) => (typeof v === "string" && v.length >= 1 && v.length <= 100 && !/[\x00-\x1f\x7f]/.test(v) ? v : fail());
const absent = (v) => v === undefined || v === null;
// Lua writes an empty list as {} when nothing marked it as an array.
const list = (v, n) => {
  if (absent(v)) return [];
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return [];
  if (!Array.isArray(v) || v.length > n) fail();
  return v;
};
function items(v) {
  const out = [], seen = new Set();
  for (const e of list(v, LIMITS.items)) {
    obj(e);
    const id = int(e.id, 1, ID);
    if (seen.has(id)) fail();
    seen.add(id);
    out.push({ id, n: int(e.n, 1, 1e6), ...(absent(e.q) ? {} : { q: int(e.q, 0, 7) }), ...(absent(e.name) ? {} : { name: text(e.name) }) });
  }
  return out;
}
function place(v, mail) {
  obj(v);
  const out = { seenAt: int(v.seenAt, 0, MAX_T), complete: v.complete === true, items: items(v.items) };
  if (mail) {
    out.letters = int(v.letters ?? 0, 0, 10000);
    out.money = int(v.money ?? 0, 0, MONEY);
    if (!absent(v.expiresAt)) out.expiresAt = int(v.expiresAt, 0, MAX_T);
  }
  return out;
}
function reputations(v) {
  obj(v);
  const factions = [], seen = new Set();
  for (const f of list(v.factions, LIMITS.factions)) {
    obj(f);
    const id = int(f.id, 1, 100000);
    if (seen.has(id)) fail();
    seen.add(id);
    const min = int(f.min, -100000, 100000), max = int(f.max, -100000, 100000);
    if (max <= min) fail();
    factions.push({ id, name: text(f.name), standing: int(f.standing, 1, 8), min, max, value: int(f.value, -100000, 100000) });
  }
  return { seenAt: int(v.seenAt, 0, MAX_T), factions };
}
function cooldowns(v) {
  const out = [], seen = new Set();
  for (const c of list(v, LIMITS.cooldowns)) {
    obj(c);
    if (!Object.hasOwn(COOLDOWNS, c.key) || seen.has(c.key)) fail();
    seen.add(c.key);
    out.push({ key: c.key, ...(absent(c.spellId) ? {} : { spellId: int(c.spellId, 1, ID) }), ...(absent(c.itemId) ? {} : { itemId: int(c.itemId, 1, ID) }), readyAt: int(c.readyAt, 0, MAX_T) });
  }
  return out;
}
function prices(v) {
  const out = [], seen = new Set();
  for (const p of list(v, LIMITS.prices)) {
    obj(p);
    const id = int(p.id, 1, ID);
    if (seen.has(id)) fail();
    seen.add(id);
    const hist = list(p.hist, LIMITS.history).map((h) => (Array.isArray(h) && h.length === 2 ? [int(h[0], 1, MONEY), int(h[1], 0, MAX_T)] : fail()));
    if (!hist.length) fail();
    out.push({ id, ...(absent(p.name) ? {} : { name: text(p.name) }), ...(absent(p.q) ? {} : { q: int(p.q, 0, 7) }), hist });
  }
  return out;
}
/** Addon ledger block -> bounded copy with only known fields; throws when anything is invalid. */
function normalizeLedgerCapture(l) {
  obj(l);
  if (!absent(l.schemaVersion) && l.schemaVersion !== 1) fail();
  const out = { schemaVersion: 1 };
  if (!absent(l.money)) { out.money = int(l.money, 0, MONEY); if (!absent(l.moneyAt)) out.moneyAt = int(l.moneyAt, 0, MAX_T); }
  for (const key of ["bags", "bank", "mail"]) if (!absent(l[key])) out[key] = place(l[key], key === "mail");
  if (!absent(l.reputations)) out.reputations = reputations(l.reputations);
  out.cooldowns = cooldowns(l.cooldowns);
  out.prices = prices(l.prices);
  if (typeof l.pricesOn === "boolean") out.pricesOn = l.pricesOn;
  return out;
}
// Stored profiles are re-validated with the same rules.
const validateLedger = (l) => { if (l !== undefined) normalizeLedgerCapture(l); };

const withLedger = (profiles) => (profiles || []).filter((p) => p && p.ledger);
/** Every item id any character's ledger mentions (for one name lookup). */
function itemIds(profiles) {
  const ids = new Set();
  for (const p of withLedger(profiles)) {
    for (const key of ["bags", "bank", "mail"]) for (const e of p.ledger[key]?.items || []) ids.add(e.id);
    for (const e of p.ledger.prices || []) ids.add(e.id);
  }
  return [...ids].sort((a, b) => a - b);
}
function who(p) {
  return { profileId: p.id, name: p.name, realm: p.realm || "", faction: p.faction || null, className: p.className || null };
}
/** Gold per character (only characters whose gold the addon saw) and the total. */
function goldTotals(profiles) {
  const characters = withLedger(profiles).filter((p) => Number.isSafeInteger(p.ledger.money))
    .map((p) => ({ ...who(p), money: p.ledger.money, moneyAt: p.ledger.moneyAt ?? null }))
    .sort((a, b) => b.money - a.money || a.name.localeCompare(b.name));
  return { total: characters.reduce((s, c) => s + c.money, 0), characters };
}
/**
 * One row per item across every character: total count and, per character, how many sit in
 * bags, bank and mail, with when the bank and mailbox were last seen.
 * facts: Map itemId -> { name, quality } from the game install / reference pack (optional).
 */
function inventoryIndex(profiles, facts = new Map()) {
  const rows = new Map();
  for (const p of withLedger(profiles)) {
    const l = p.ledger;
    for (const key of ["bags", "bank", "mail"]) for (const e of l[key]?.items || []) {
      let row = rows.get(e.id);
      if (!row) { row = { itemId: e.id, name: e.name || null, quality: e.q ?? null, total: 0, holders: [] }; rows.set(e.id, row); }
      if (!row.name && e.name) row.name = e.name;
      if (row.quality === null && e.q !== undefined) row.quality = e.q;
      let h = row.holders.find((x) => x.profileId === p.id);
      if (!h) {
        h = { ...who(p), bags: 0, bank: 0, mail: 0, bagsSeenAt: l.bags?.seenAt ?? null, bankSeenAt: l.bank?.seenAt ?? null, mailSeenAt: l.mail?.seenAt ?? null };
        row.holders.push(h);
      }
      h[key] += e.n;
      row.total += e.n;
    }
  }
  for (const row of rows.values()) {
    const f = facts.get(row.itemId);
    if (f?.name) row.name = f.name;
    if (Number.isInteger(f?.quality)) row.quality = f.quality;
    if (!row.name) row.name = `Item #${row.itemId}`;
    row.holders.sort((a, b) => (b.bags + b.bank + b.mail) - (a.bags + a.bank + a.mail) || a.name.localeCompare(b.name));
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.itemId - b.itemId);
}
/** Rows whose name contains every word of the query (or whose id is the query). */
function searchInventory(rows, query, limit = 200) {
  const q = String(query || "").toLowerCase().trim().slice(0, 100);
  if (!q) return rows.slice(0, limit);
  const words = q.split(/\s+/);
  return rows.filter((r) => String(r.itemId) === q || words.every((w) => r.name.toLowerCase().includes(w))).slice(0, limit);
}
/** Price memory merged across characters: newest observation and the lowest of the remembered ones. */
function priceIndex(profiles, facts = new Map()) {
  const index = new Map();
  for (const p of withLedger(profiles)) for (const e of p.ledger.prices || []) {
    let row = index.get(e.id);
    if (!row) { row = { itemId: e.id, name: e.name || null, quality: e.q ?? null, observations: [] }; index.set(e.id, row); }
    if (!row.name && e.name) row.name = e.name;
    if (row.quality === null && e.q !== undefined) row.quality = e.q;
    for (const [price, at] of e.hist) row.observations.push({ price, at });
  }
  for (const row of index.values()) {
    const f = facts.get(row.itemId);
    if (f?.name) row.name = f.name;
    if (Number.isInteger(f?.quality)) row.quality = f.quality;
    if (!row.name) row.name = `Item #${row.itemId}`;
    const seen = new Set();
    row.observations = row.observations.sort((a, b) => b.at - a.at || a.price - b.price)
      .filter((o) => { const k = `${o.at}:${o.price}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
    const low = row.observations.reduce((m, o) => (!m || o.price < m.price ? o : m), null);
    Object.assign(row, { latest: row.observations[0].price, latestAt: row.observations[0].at, low: low.price, lowAt: low.at });
  }
  return index;
}
/** The remembered price of one item, with its age in seconds; null when never seen. */
function priceFor(index, itemId, now = Math.floor(Date.now() / 1000)) {
  const row = index.get(itemId);
  if (!row) return null;
  return { itemId, latest: row.latest, latestAt: row.latestAt, low: row.low, lowAt: row.lowAt, age: Math.max(0, now - row.latestAt), observations: row.observations.length };
}
/** Estimated auction value of carried items that have a remembered price (latest price). */
function inventoryValue(rows, index) {
  const valued = [];
  for (const r of rows) {
    const p = index.get(r.itemId);
    if (p) valued.push({ itemId: r.itemId, name: r.name, quality: r.quality, count: r.total, unit: p.latest, value: p.latest * r.total, seenAt: p.latestAt });
  }
  valued.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { total: valued.reduce((s, v) => s + v.value, 0), items: valued };
}
/** Profession cooldowns: ready now, or ready in so many seconds. */
function cooldownStatus(profile, now = Math.floor(Date.now() / 1000)) {
  return (profile?.ledger?.cooldowns || []).map((c) => {
    const seconds = Math.max(0, c.readyAt - now);
    return { key: c.key, ...COOLDOWNS[c.key], ...(c.spellId ? { spellId: c.spellId } : {}), ...(c.itemId ? { itemId: c.itemId } : {}), readyAt: c.readyAt, ready: seconds === 0, seconds };
  }).sort((a, b) => a.seconds - b.seconds || a.name.localeCompare(b.name));
}
const sideOf = (id) => (SIDES.Alliance.includes(id) ? "Alliance" : SIDES.Horde.includes(id) ? "Horde" : null);
/** Reputation bars with standing names; the character's own side first, then shared factions. */
function reputationView(profile) {
  const r = profile?.ledger?.reputations;
  if (!r) return null;
  const mine = profile.faction === "Alliance" || profile.faction === "Horde" ? profile.faction : null;
  const order = (f) => (f.side && f.side === mine ? 0 : f.side ? 2 : 1);
  const factions = r.factions.map((f) => {
    const need = f.max - f.min, current = Math.min(need, Math.max(0, f.value - f.min));
    return { id: f.id, name: f.name, standing: f.standing, standingName: STANDINGS[f.standing], current, need, progress: need ? current / need : 0, side: sideOf(f.id), value: f.value };
  }).sort((a, b) => order(a) - order(b) || b.standing - a.standing || b.progress - a.progress || a.name.localeCompare(b.name));
  return { seenAt: r.seenAt, factions };
}
/** Everything the Ledger pages show, for every character with a ledger. */
function ledgerView(state, { facts = new Map(), now = Math.floor(Date.now() / 1000) } = {}) {
  const profiles = state?.profiles || [];
  const rows = inventoryIndex(profiles, facts), index = priceIndex(profiles, facts);
  const characters = profiles.map((p) => {
    const l = p.ledger;
    return { ...who(p), level: p.level ?? null, hasLedger: Boolean(l), money: l?.money ?? null, moneyAt: l?.moneyAt ?? null,
      bagsSeenAt: l?.bags?.seenAt ?? null, bankSeenAt: l?.bank?.seenAt ?? null, mailSeenAt: l?.mail?.seenAt ?? null,
      mail: l?.mail ? { letters: l.mail.letters, money: l.mail.money, expiresAt: l.mail.expiresAt ?? null } : null,
      pricesOn: l?.pricesOn ?? null, reputations: reputationView(p), cooldowns: l ? cooldownStatus(p, now) : [] };
  });
  const prices = [...index.values()].sort((a, b) => b.latestAt - a.latestAt || a.name.localeCompare(b.name))
    .map((r) => ({ itemId: r.itemId, name: r.name, quality: r.quality, latest: r.latest, latestAt: r.latestAt, low: r.low, lowAt: r.lowAt, observations: r.observations.length }));
  return { now, activeProfileId: state?.activeProfileId ?? null, characters, gold: goldTotals(profiles), items: rows, prices, value: inventoryValue(rows, index) };
}
module.exports = { normalizeLedgerCapture, validateLedger, itemIds, goldTotals, inventoryIndex, searchInventory, priceIndex, priceFor, inventoryValue, cooldownStatus, reputationView, ledgerView, LIMITS, COOLDOWNS, STANDINGS, SIDES };
