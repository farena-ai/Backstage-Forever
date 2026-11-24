"use strict";
// IPC for Adventure → Travel (the travel planner) and the "At the trainer" facts on Talents.
const buildCompat = require("./build-compat.cjs");
const { loadTransportPack } = require("./transport-data.cjs");
const { loadTrainerPack, trainerPlan, CLASSES } = require("./trainer-data.cjs");
const planner = require("./travel-planner.cjs");
const { transportRides } = require("./transport-rides.cjs");

/** How bundled reference data stands against the character's game build (same-patch rule). */
function buildStanding(pack, profile) {
  const relation = buildCompat.relation(pack.build, profile?.clientBuild);
  if (relation === "mismatch") return { usable: false, relation, note: `This data is from game patch ${buildCompat.parts(pack.build).patch}; your character was saved on another patch. It stays off until an update checks the new patch.` };
  if (relation === "carried") return { usable: true, relation, note: buildCompat.carriedNote(pack.build, profile.clientBuild) };
  if (relation === "match") return { usable: true, relation, note: null };
  return { usable: true, relation, note: "Reference data: your character's game build is not known, so this was not checked against it." };
}
// The player's game files add names, missing places and missing prices to the bundled graph. The
// names a character saw on a flight map in game come first; they are in the game's own language.
function withGame(transport, game, facts) {
  const extra = planner.withGameFiles(transport, game);
  facts.names = { ...extra.names, ...facts.names };
  return extra;
}
function travelView(state, { transport = loadTransportPack(), now = Math.floor(Date.now() / 1000), game = null, reference = null } = {}) {
  const profile = state.profiles.find((p) => p.id === state.activeProfileId) || null;
  const standing = buildStanding(transport, profile);
  if (!standing.usable) return { available: false, reason: standing.note, places: [] };
  const facts = planner.characterFacts(profile, state.profiles);
  const seen = Object.keys(facts.names).length, extra = withGame(transport, game, facts), rides = transportRides(transport, game, reference);
  transport = extra.pack;
  const known = facts.knownNodes ? facts.knownNodes.length : null;
  return {
    available: true, note: standing.note,
    places: planner.destinations(transport, { names: facts.names, faction: facts.faction }).map(({ id, kind, label, sub, search }) => ({ id, kind, label, sub, search })),
    character: profile ? {
      name: profile.name, faction: facts.faction, hasPosition: !!facts.position, zone: facts.zone, knownFlightPoints: known, namedFlightPoints: seen,
      hearth: facts.hearth ? { name: facts.hearth.name, placed: Number.isSafeInteger(facts.hearth.mapId), readyIn: Number.isFinite(facts.hearth.readyAt) ? Math.max(0, facts.hearth.readyAt - now) : null } : null,
    } : null,
    counts: transport.counts, builds: transport.builds, gameFiles: extra.filled,
    transports: { known: rides.known, read: rides.transports.filter((t) => t.source === "game-files").length, gameFiles: rides.gameFiles, tram: rides.transports.some((t) => t.source === "reference") },
    attribution: "Flight data from Efficient Games (https://efficient.games), CC BY 4.0.",
  };
}
function travelPlan(state, input, { transport = loadTransportPack(), now = Math.floor(Date.now() / 1000), game = null, reference = null } = {}) {
  if (!input || typeof input !== "object" || typeof input.to !== "string" || input.to.length > 40 || (input.from !== undefined && (typeof input.from !== "string" || input.from.length > 40))) throw Error("Invalid travel request.");
  const profile = state.profiles.find((p) => p.id === state.activeProfileId) || null;
  const standing = buildStanding(transport, profile);
  if (!standing.usable) return { status: "unavailable", options: [], notes: [standing.note] };
  const facts = planner.characterFacts(profile, state.profiles);
  const rides = transportRides(transport, game, reference);
  transport = withGame(transport, game, facts).pack;
  const to = planner.parsePlace(input.to);
  const from = !input.from || input.from === "saved" ? (facts.position ? { ...facts.position, label: `${facts.zone || "Your saved position"} (where you last saved)` } : null) : planner.parsePlace(input.from);
  if (!to) throw Error("Choose a destination.");
  if (!from) return { status: "no-start", options: [], notes: ["The app does not know where this character is. Choose a starting place, or log in with the addon and type /reload."] };
  const result = planner.planTrip(transport, { from, to, character: facts, now, rides });
  if (standing.note) result.notes.push(standing.note);
  return result;
}
/** "At the trainer" for a class and level; money only for the active character's own class. */
function trainerView(state, className, level, { trainers = loadTrainerPack(), spellLevels = null } = {}) {
  if (!CLASSES.includes(className)) return { available: false, reason: "No trainer data for this class." };
  const profile = state.profiles.find((p) => p.id === state.activeProfileId) || null;
  const standing = buildStanding(trainers, profile);
  if (!standing.usable) return { available: false, reason: standing.note };
  const own = profile?.className === className && profile.level === level;
  const money = own && Number.isSafeInteger(profile.ledger?.money) ? profile.ledger.money : null;
  const plan = trainerPlan(trainers, className, level, { money, faction: profile?.faction, spellLevels });
  if (plan.available && standing.note) plan.notes.push(standing.note);
  return plan;
}
function registerTravelPlannerHandlers({ handle, getState, gameData = null, reference = null }) {
  // Read from the player's own game files; null when no game folder is connected or readable.
  // The stops of boats and zeppelins ride along when the path table could be read too.
  const game = () => {
    let flights = null, paths = null;
    try { flights = gameData?.flights() || null; } catch {}
    try { paths = gameData?.transportPaths?.() || null; } catch {}
    return flights ? { ...flights, paths } : null;
  };
  const spellLevels = () => { try { return gameData?.spellLevels() || null; } catch { return null; } };
  handle("travelPlaces", (...args) => { if (args.length) throw Error("Invalid travel request."); return travelView(getState(), { game: game(), reference }); });
  handle("travelPlan", (...args) => { if (args.length !== 1) throw Error("Invalid travel request."); return travelPlan(getState(), args[0], { game: game(), reference }); });
  // B2: the rides for the desktop -> game hand-off. Null until the game files gave the stops, or
  // when the transport data is from another patch than the saved characters.
  const rides = () => {
    const files = game(), state = getState(), transport = loadTransportPack();
    const profile = state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0] || null;
    if (!files?.paths || !buildStanding(transport, profile).usable) return null;
    return transportRides(transport, files, reference);
  };
  return { rides, trainerView: (className, level) => trainerView(getState(), className, level, { spellLevels: spellLevels() }) };
}
module.exports = { registerTravelPlannerHandlers, travelView, travelPlan, trainerView, buildStanding };
