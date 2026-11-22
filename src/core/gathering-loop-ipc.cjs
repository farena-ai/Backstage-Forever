"use strict";
// IPC for the gathering loop on the World Map (roadmap E4): the loop for a zone and profession,
// and the one loop per character the player sends to the game (/bf loop walks it there).
const { MAP_NAMES } = require("./map-names.cjs");
const L = require("./gathering-loop.cjs");

/** Size of a zone map in yards from the transport pack's fitted corners (world y runs east-west). */
function mapSize(transport, mapId) {
  const m = transport?.maps?.[mapId] || transport?.maps?.[String(mapId)];
  if (!m) return null;
  const width = Math.abs(m.y0 - m.y1), height = Math.abs(m.x0 - m.x1);
  return width >= 100 && height >= 100 && width < 100000 && height < 100000 ? { width, height } : null;
}
function loopView({ profile = null, community = null, worldPack = null, acquisitionPack = null, transport = null, chosen = null } = {}, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("Invalid gathering loop request.");
  const extra = input.extra !== false;
  if (input.profession !== undefined && !Object.hasOwn(L.PROFESSIONS, input.profession)) throw Error("Invalid gathering loop request.");
  if (input.mapId !== undefined && !(Number.isSafeInteger(input.mapId) && input.mapId > 0)) throw Error("Invalid gathering loop request.");
  const professions = Object.entries(L.PROFESSIONS).map(([id, p]) => ({ id, label: p.label, skill: L.professionSkill(profile, id) }));
  // Default to a profession the character has; herbalism when neither is known.
  const profession = input.profession || professions.find((p) => p.skill !== null)?.id || "herbalism";
  const skill = professions.find((p) => p.id === profession).skill;
  const byMap = L.collectSpots({ profile, community, worldPack, acquisitionPack, profession, extra });
  const zones = [...byMap].map(([mapId, spots]) => ({ mapId, name: MAP_NAMES[mapId] || `Map ${mapId}`, spots: spots.length, yours: spots.filter((s) => s.source === "yours").length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const mapId = input.mapId || profile?.location?.mapId || zones[0]?.mapId || null;
  const here = profile?.location?.mapId === mapId ? profile.location : null;
  const loop = mapId ? L.buildLoop(byMap.get(mapId) || [], { skill, size: mapSize(transport, mapId), start: here }) : null;
  const same = chosen && loop?.status === "ok" && chosen.mapId === mapId && chosen.profession === profession && chosen.stops.length === loop.stops.length && chosen.stops.every((s, i) => s[0] === loop.stops[i].x && s[1] === loop.stops[i].y);
  return {
    mapId, mapName: mapId ? MAP_NAMES[mapId] || `Map ${mapId}` : null, profession, professions, skill, extra, zones, loop,
    inGame: { canSend: profile?.source?.kind === "wow-addon", sent: Boolean(same), chosen: chosen ? { mapId: chosen.mapId, mapName: MAP_NAMES[chosen.mapId] || `Map ${chosen.mapId}`, profession: chosen.profession, stops: chosen.stops.length } : null },
  };
}
function registerGatheringLoop({ handle, getState, loops, getCommunity = () => null, worldPack = null, acquisitionPack = null, getTransport = () => null, onChange = () => {} }) {
  const context = () => {
    const state = getState(), profile = state.profiles.find((p) => p.id === state.activeProfileId) || null;
    let community = null, transport = null;
    try { community = getCommunity(); } catch {}
    try { transport = getTransport(); } catch {}
    return { profile, community, worldPack, acquisitionPack, transport, chosen: profile ? loops.get(profile.id) : null };
  };
  handle("gatheringLoop", (input) => loopView(context(), input || {}));
  handle("gatheringLoopUse", (input) => {
    const ctx = context();
    if (!ctx.profile) throw Error("Choose a character first.");
    if (input === null) { loops.set(ctx.profile.id, null); onChange(); return loopView(context(), {}); }
    const view = loopView(ctx, input);
    if (view.loop?.status !== "ok") throw Error("There is no loop to send for this zone yet.");
    loops.set(ctx.profile.id, { mapId: view.mapId, profession: view.profession, stops: view.loop.stops.map((s) => [s.x, s.y]) });
    onChange();
    return loopView(context(), input);
  });
}
module.exports = { registerGatheringLoop, loopView, mapSize };
