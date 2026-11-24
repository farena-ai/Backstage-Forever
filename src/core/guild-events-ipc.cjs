"use strict";
// IPC for Plans → Guild and for the guild events and lockouts the Calendar shows. Everything is
// read from the game's saved file (through the addon's optional guild and lockout blocks) and from
// the desktop's own guild.json. The only writes: that file, a note the player types about a member,
// and a calendar file the player chooses to save. No network.
const G = require("./guild-events.cjs");

function registerGuildHandlers({ handle, getState, getGame, store, economy = null, gameData = null, packNames = () => null, dialog, getWindow,
  writeFile = (file, text) => require("node:fs/promises").writeFile(file, text, "utf8"), now = () => Math.floor(Date.now() / 1000) }) {
  // Each request first takes in what the last read of the saved file held.
  const refresh = () => { try { store.absorb(getGame()?.guildCapture?.() || []); } catch { /* The page still shows what was kept. */ } };
  let atlasRows = null;
  const atlas = () => {
    if (atlasRows) return atlasRows;
    atlasRows = { byId: new Map(), bosses: new Map() };
    try {
      for (const row of require("./dungeon-atlas.cjs").BASELINE) {
        atlasRows.byId.set(row[0], { name: row[1], instanceMap: row[9] });
        // Lower and Upper Blackrock Spire share one instance; the count is the first row's.
        if (!atlasRows.bosses.has(row[9])) atlasRows.bosses.set(row[9], row[10].length);
      }
    } catch { /* Names fall back to the short id the addon saved. */ }
    return atlasRows;
  };
  const places = { name: (id) => atlas().byId.get(id)?.name || null, instances: (id) => (atlas().byId.has(id) ? [atlas().byId.get(id).instanceMap] : []), bosses: (map) => atlas().bosses.get(map) ?? null };
  const itemFacts = (ids) => {
    let found = [];
    try { found = ids.length && gameData ? gameData.items(ids) : []; } catch {}
    let pack = null;
    try { pack = packNames(); } catch {}
    return new Map(ids.map((id, i) => [id, { name: found[i]?.name || pack?.items?.[id]?.name || null, quality: Number.isInteger(found[i]?.quality) ? found[i].quality : null }]));
  };
  function view(profileId) {
    refresh();
    const state = getState(), profiles = state?.profiles || [];
    // A character the page does not know falls back to the active one, then to any with guild data.
    const wanted = typeof profileId === "string" && store.data.characters[profileId]?.guild ? profileId : state?.activeProfileId;
    const first = G.guildView(store.data, { profileId: wanted, profiles, now: now() });
    if (first.empty) return first;
    const runs = economy?.data?.runs?.[first.profileId] || [];
    const ids = new Set();
    for (const r of runs) for (const l of r.loot || []) ids.add(l.id);
    for (const e of first.past) for (const l of e.guildLoot) ids.add(l.itemId);
    return G.guildView(store.data, { profileId: first.profileId, profiles, now: now(), runs, atlas: places, facts: itemFacts([...ids].slice(0, 2000)) });
  }
  handle("guildPage", (...args) => {
    if (args.length > 1 || (args.length && args[0] !== null && typeof args[0] !== "string")) throw Error("Invalid guild request.");
    return view(args[0] ?? null);
  });
  handle("setGuildNote", (...args) => {
    if (args.length !== 3 || args.some((a) => typeof a !== "string") || args[0].length > 100 || args[1].length > 100 || args[2].length > 2000) throw Error("Invalid guild request.");
    const current = view(args[0]);
    if (current.empty || !current.roster.some((m) => m.name === args[1])) throw Error("Invalid guild request.");
    return { name: args[1], note: store.setNote(current.realm, args[1], args[2]) };
  }, { privateOnly: true });
  /** Guild events and lockouts for the Calendar, next to cooldowns and mail. */
  const calendarEntries = () => { refresh(); return G.calendarEntries(store.data, getState()?.profiles || [], now(), { placeName: places.name }); };
  const lockouts = () => { refresh(); return G.lockoutView(store.data, getState()?.profiles || [], now()); };
  handle("exportGuildEvents", async (...args) => {
    if (args.length) throw Error("Invalid guild request.");
    const t = now(), ahead = calendarEntries().filter((e) => e.kind === "event" && e.at > t);
    if (!ahead.length) return { saved: false, reason: "empty" };
    const result = await dialog.showSaveDialog(getWindow(), { title: "Save your guild events", defaultPath: "Backstage-Forever-guild-events.ics", filters: [{ name: "Calendar file", extensions: ["ics"] }] });
    if (result.canceled || !result.filePath) return { saved: false, reason: "cancelled" };
    await writeFile(result.filePath, require("./economy.cjs").calendarIcs(ahead, t));
    return { saved: true, events: ahead.length };
  }, { privateOnly: true });
  return { view, calendarEntries, lockouts, refresh };
}
module.exports = { registerGuildHandlers };
