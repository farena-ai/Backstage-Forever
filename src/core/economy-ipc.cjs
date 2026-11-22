"use strict";
// IPC for the economy and history pages: price history, craft profit and gold over time ride
// along with the Ledger view; the cooldown calendar and the run history have their own requests.
// Everything is read from saved characters and the desktop's own economy.json. Read-only except
// the notification switch and the calendar file the player chooses to save.
const E = require("./economy.cjs");

function registerEconomyHandlers({ handle, getState, economy, gameData, packNames = () => null, dialog, getWindow, notify = null, writeFile = (file, text) => require("node:fs/promises").writeFile(file, text, "utf8"), now = () => Math.floor(Date.now() / 1000) }) {
  const itemFacts = (ids) => {
    let found = [];
    try { found = ids.length ? gameData.items(ids) : []; } catch {}
    let pack = null;
    try { pack = packNames(); } catch {}
    return new Map(ids.map((id, i) => [id, { name: found[i]?.name || pack?.items?.[id]?.name || null, quality: Number.isInteger(found[i]?.quality) ? found[i].quality : null,
      sellPrice: Number.isSafeInteger(found[i]?.sellPrice) ? found[i].sellPrice : null }]));
  };
  // The bundled seller reference lists what vendors sell but not what they charge.
  let vendorListed = null;
  const listed = () => {
    if (vendorListed) return vendorListed;
    vendorListed = new Set();
    try { for (const v of require("./vendor-facts.cjs").loadVendorPack().vendors) for (const row of v.listings) vendorListed.add(row.itemId); } catch { /* Reference unavailable. */ }
    return vendorListed;
  };
  let dungeonNames = null;
  const dungeons = () => {
    if (dungeonNames) return dungeonNames;
    dungeonNames = new Map();
    try { for (const row of require("./dungeon-atlas.cjs").BASELINE) if (!dungeonNames.has(row[9])) dungeonNames.set(row[9], { name: row[1], bosses: row[10].length }); } catch { /* Names fall back to what the addon saved. */ }
    return dungeonNames;
  };
  /** Extra parts of the Ledger view: history per price row, craft profit and gold over time. */
  function ledgerExtras(state, view) {
    const profiles = state?.profiles || [];
    const history = E.mergedPriceHistory(economy.data, profiles.map((p) => p.id));
    for (const row of view.prices) {
      const s = E.priceSummary(history.get(row.itemId));
      if (!s) { Object.assign(row, { usual: null, visits: 0, below: false, belowPercent: 0, spark: [] }); continue; }
      if (s.low < row.low) { row.low = s.low; row.lowAt = s.points.find((p) => p[0] === s.low)[1]; }
      Object.assign(row, { usual: s.usual, visits: s.visits, below: s.below, belowPercent: s.belowPercent, firstAt: s.firstAt, spark: s.points.slice(-24) });
    }
    const L = require("./ledger.cjs");
    const prices = L.priceIndex(profiles), vendor = E.vendorIndex(profiles), facts = itemFacts(E.craftItemIds(profiles));
    const crafts = profiles.filter((p) => p.readiness?.workshop?.recipes?.items?.length)
      .map((p) => E.craftProfit(p, { prices, vendor, vendorListed: listed(), facts }));
    const money = profiles.map((p) => ({ profileId: p.id, name: p.name, view: E.moneyView(economy.data.money[p.id]) })).filter((m) => m.view)
      .map((m) => ({ profileId: m.profileId, name: m.name, ...m.view, sessions: E.sessionView(economy.data.sessions?.[m.profileId]) }));
    return { crafts, money, vendorPricesSeen: vendor.size };
  }
  const events = () => E.calendarEvents(getState().profiles, now());
  const calendarView = () => ({ now: now(), events: events(), notify: economy.data.calendar.notify, canNotify: !!notify });
  handle("economyCalendar", (...args) => {
    if (args.length) throw Error("Invalid calendar request.");
    return calendarView();
  });
  handle("setCalendarNotify", (...args) => {
    if (args.length !== 1 || typeof args[0] !== "boolean") throw Error("Invalid calendar request.");
    economy.setNotify(args[0]);
    // What is already due when the switch is turned on is not news.
    if (args[0]) economy.markNotified(E.dueNotifications(events(), economy.data.calendar.notified, now()).map((n) => n.key));
    return calendarView();
  }, { privateOnly: true });
  handle("exportCalendar", async (...args) => {
    if (args.length) throw Error("Invalid calendar request.");
    const t = now(), ahead = events().filter((e) => e.at > t);
    if (!ahead.length) return { saved: false, reason: "empty" };
    const result = await dialog.showSaveDialog(getWindow(), { title: "Save your cooldown calendar", defaultPath: "Backstage-Forever-calendar.ics", filters: [{ name: "Calendar file", extensions: ["ics"] }] });
    if (result.canceled || !result.filePath) return { saved: false, reason: "cancelled" };
    await writeFile(result.filePath, E.calendarIcs(ahead, t));
    return { saved: true, events: ahead.length };
  }, { privateOnly: true });
  handle("runHistory", (...args) => {
    if (args.length > 1 || (args.length && args[0] !== null && typeof args[0] !== "string")) throw Error("Invalid run history request.");
    const state = getState();
    const characters = state.profiles.map((p) => ({ profileId: p.id, name: p.name, runs: (economy.data.runs[p.id] || []).length }));
    const profileId = state.profiles.some((p) => p.id === args[0]) ? args[0] : state.activeProfileId;
    const profile = state.profiles.find((p) => p.id === profileId) || null;
    const runs = profile ? economy.data.runs[profile.id] || [] : [];
    return { profileId: profile?.id ?? null, name: profile?.name ?? null, characters, ...E.runHistoryView(runs, { names: dungeons(), facts: itemFacts(E.runItemIds(runs)) }) };
  });
  /** Once a minute while the app is open: show what came due, once each. Off unless the player turned it on. */
  function tick() {
    if (!notify || !economy.data.calendar.notify) return 0;
    const due = E.dueNotifications(events(), economy.data.calendar.notified, now());
    if (!due.length) return 0;
    economy.markNotified(due.map((n) => n.key));
    for (const n of due.slice(0, 5)) { try { notify(n.title, n.body); } catch { /* A blocked notification is not an error. */ } }
    return due.length;
  }
  return { ledgerExtras, tick };
}
module.exports = { registerEconomyHandlers };
