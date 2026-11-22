"use strict";
// IPC for the Journey's extra views: the story so far, the timeline with screenshots, leveling
// races, Coach's notes, the stream overlay switch and the share card buttons. Everything is read
// from saved characters, the desktop's own journey.json and the game's Screenshots folder
// (read-only). The handlers that change something or open a dialog are private to the window.
const path = require("node:path");
const S = require("./story.cjs");
const R = require("./level-race.cjs");
const SJ = require("./screenshot-journal.cjs");
const { coachNotes } = require("./coach-notes.cjs");
const { nextStep } = require("./next-step.cjs");
const { MAP_NAMES } = require("./map-names.cjs");
const E = require("./economy.cjs");
const { overlayState } = require("./stream-overlay.cjs");
const SHARE_KINDS = require("./share-cards.cjs").KINDS;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// A sentence meant for the player: the window shows it as written (other errors get a general line).
const say = (message) => Object.assign(new Error(message), { name: "JourneyError" });
const plainly = (work) => { try { return work(); } catch (e) { throw say(e.message); } };
const isPng = (bytes) => bytes instanceof Uint8Array && bytes.length >= 8 && bytes.length <= 8 * 1024 * 1024 && PNG.every((b, i) => bytes[i] === b);

function registerJourneyExtras({ handle, getState, journey, economy = null, sessions = () => null, leveling = null, chains = () => null, badgesFor = () => ({ badges: [] }),
  getRoot = () => null, thumbs = null, overlay = null, playSummary = () => null, dialog = null, getWindow = () => null, showFile = () => {}, copyImage = () => {}, copyText = () => {},
  readFile = (file) => require("node:fs").readFileSync(file), statFile = (file) => require("node:fs").statSync(file), writeFile = (file, text) => require("node:fs/promises").writeFile(file, text, "utf8") }) {
  const mapName = (id) => MAP_NAMES[id] || `Map ${id}`;
  const none = (args, what) => { if (args.length) throw Error(`Invalid ${what} request.`); };
  const active = () => { const s = getState(); return s.profiles.find((p) => p.id === s.activeProfileId) || null; };
  let dungeonNames = null;
  const dungeons = () => {
    if (dungeonNames) return dungeonNames;
    dungeonNames = new Map();
    try { for (const row of require("./dungeon-atlas.cjs").BASELINE) if (!dungeonNames.has(row[9])) dungeonNames.set(row[9], { name: row[1], bosses: row[10].length }); } catch { /* Names fall back to what the addon saved. */ }
    return dungeonNames;
  };
  const runsOf = (p) => E.runHistoryView(economy?.data?.runs?.[p.id] || [], { names: dungeons() });
  const sessionsOf = (p) => sessions(p.id)?.sessions || [];
  const character = (p) => ({ name: p.name, realm: p.realm || "", level: Number.isInteger(p.level) ? p.level : null, className: p.className || null });
  const zonesDone = (p) => {
    try {
      const t = leveling?.tracker(p.id);
      const bands = new Map((leveling?.pack?.zones || []).map((z) => [z.mapId, z]));
      return (t?.continents || []).flatMap((c) => c.zones).filter((z) => z.mastered).map((z) => ({ mapId: z.mapId, name: z.name, done: z.done, total: z.total, min: bands.get(z.mapId)?.min ?? z.min, max: bands.get(z.mapId)?.max ?? z.max }));
    } catch { return []; }
  };

  handle("story", (...args) => {
    none(args, "story");
    const p = active();
    if (!p) return null;
    let ref = null;
    try { ref = chains(); } catch { /* Without the quest reference the story has no quest chapter. */ }
    return { ...S.story(p, { sessions: sessionsOf(p), deaths: journey.deaths(p.id), runs: runsOf(p), chains: ref, zonesDone: zonesDone(p), mapName }), character: character(p), hasQuestReference: !!ref };
  });

  // The timeline: saved events plus the game's own screenshots, read where the game left them.
  const shotsNow = () => { const dir = SJ.screenshotsDir(getRoot()); return { dir, shots: dir ? SJ.listScreenshots(dir) : [] }; };
  handle("journeyTimeline", (...args) => {
    none(args, "timeline");
    const p = active();
    if (!p) return null;
    const root = getRoot(), { dir, shots } = shotsNow();
    const view = SJ.timeline({ profile: p, shots, sessions: sessionsOf(p), deaths: journey.deaths(p.id), runs: runsOf(p).rows, mapName, firstWords: S.FIRST_WORDS });
    return { id: p.id, name: p.name, ...view, folder: { connected: !!root, found: !!dir, limit: SJ.LIMITS.shots } };
  });
  const listed = (name) => {
    if (typeof name !== "string" || !SJ.NAME.test(name)) throw Error("Invalid screenshot.");
    const { dir, shots } = shotsNow(), shot = shots.find((s) => s.name === name);
    if (!dir || !shot) throw say("That screenshot is no longer in the folder.");
    return { dir, shot };
  };
  handle("screenshotThumb", (...args) => {
    if (args.length !== 1) throw Error("Invalid screenshot.");
    const { dir, shot } = listed(args[0]);
    const bytes = thumbs ? thumbs.get(dir, shot) : null;
    return bytes ? new Uint8Array(bytes) : null;
  }, { privateOnly: true });
  handle("showScreenshot", (...args) => {
    if (args.length !== 1) throw Error("Invalid screenshot.");
    const { dir, shot } = listed(args[0]);
    showFile(path.join(dir, shot.name));
    return true;
  }, { privateOnly: true });

  // Leveling races.
  const raceView = () => {
    const state = getState(), me = active(), name = journey.data.race.name;
    const racers = [];
    if (me) racers.push({ id: `p:${me.id}`, name: name || "You", kind: "you", rows: R.rowsOf(me) });
    for (const p of state.profiles) if (p.id !== me?.id) racers.push({ id: `p:${p.id}`, name: p.name, kind: "yours", rows: R.rowsOf(p) });
    const friends = journey.data.race.friends.map((code) => R.importCode(code)).filter(Boolean);
    for (const f of friends) racers.push({ id: `f:${f.id}`, name: f.name, kind: "friend", rows: f.rows });
    let code = null, exportError = "";
    if (me) { try { code = name ? R.exportCode(me, name) : null; if (!name) exportError = "Type a display name to make your code."; } catch (e) { exportError = e.message; } }
    return { profileId: me?.id ?? null, name, code, exportError, levelsSaved: me ? R.rowsOf(me).length : 0, friends: friends.map((f) => ({ id: f.id, name: f.name, topLevel: f.rows[f.rows.length - 1][0] })),
      limits: { friends: require("./journey-store.cjs").LIMITS.friends, name: R.LIMITS.name }, board: R.board(racers) };
  };
  handle("raceBoard", (...args) => { none(args, "race"); return raceView(); });
  handle("setRaceName", (...args) => {
    if (args.length !== 1 || typeof args[0] !== "string") throw Error("Invalid race request.");
    if (args[0].trim() && !R.cleanName(args[0])) throw say("Use a name of 1 to 24 characters, without < or >.");
    plainly(() => journey.setRaceName(args[0]));
    return raceView();
  }, { privateOnly: true });
  handle("addRaceCode", (...args) => {
    if (args.length !== 1 || typeof args[0] !== "string" || args[0].length > R.LIMITS.code + 200) throw say("That is not a leveling race code.");
    const added = plainly(() => journey.addFriend(args[0].trim()));
    return { ...raceView(), added };
  }, { privateOnly: true });
  handle("removeRaceFriend", (...args) => {
    if (args.length !== 1 || typeof args[0] !== "string" || !/^[0-9a-f]{10}$/.test(args[0])) throw Error("Invalid race request.");
    journey.removeFriend(args[0]);
    return raceView();
  }, { privateOnly: true });
  handle("copyRaceCode", async (...args) => {
    none(args, "race");
    const view = raceView();
    if (!view.code) throw say(view.exportError || "There is no code to copy yet.");
    await copyText(view.code);
    return true;
  }, { privateOnly: true });
  handle("saveRaceCode", async (...args) => {
    none(args, "race");
    const view = raceView();
    if (!view.code) throw say(view.exportError || "There is no code to save yet.");
    const result = await dialog.showSaveDialog(getWindow(), { title: "Save your leveling race code", defaultPath: "Backstage-Forever-race.txt", filters: [{ name: "Text file", extensions: ["txt"] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    await writeFile(result.filePath, `${view.code}\n`);
    return { saved: true };
  }, { privateOnly: true });
  handle("openRaceCode", async (...args) => {
    none(args, "race");
    const result = await dialog.showOpenDialog(getWindow(), { title: "Open a friend's leveling race code", properties: ["openFile"], filters: [{ name: "Text file", extensions: ["txt"] }] });
    const file = result.canceled ? null : result.filePaths?.[0];
    if (!file) return { ...raceView(), added: null };
    if (statFile(file).size > R.LIMITS.code + 200) throw say("That file is too large to be a leveling race code.");
    const added = plainly(() => journey.addFriend(String(readFile(file)).trim()));
    return { ...raceView(), added };
  }, { privateOnly: true });

  // Coach's notes.
  handle("coachNotes", (...args) => {
    none(args, "notes");
    const p = active();
    if (!p) return null;
    const state = getState(), kept = journey.captures(p.id);
    let step = null;
    try { step = nextStep(leveling?.advise(p.id)); } catch { /* Tomorrow's step is left out when the advice cannot be built. */ }
    let badges = [];
    try { badges = badgesFor(p).badges; } catch { /* Badges are optional evidence. */ }
    return { ...coachNotes(p, { previous: kept.previous, current: kept.current, others: state.profiles.filter((x) => x.id !== p.id), sessions: sessionsOf(p), deaths: journey.deaths(p.id), runs: runsOf(p).rows, badges, step, mapName }), character: character(p) };
  });

  // Stream overlay: the switch, and what the page shows.
  const overlayView = () => {
    let facts = {};
    try { facts = overlayState(overlayFacts()); } catch { /* The switch still works. */ }
    return { ...overlay.status(), enabled: journey.data.overlay.enabled, facts };
  };
  handle("streamOverlay", (...args) => { none(args, "overlay"); return overlayView(); });
  handle("setStreamOverlay", async (...args) => {
    if (args.length !== 1 || typeof args[0] !== "boolean") throw Error("Invalid overlay request.");
    if (args[0]) {
      let status;
      try { status = await overlay.start(journey.data.overlay.port); } catch { throw say("The overlay could not start on this computer."); }
      journey.setOverlay({ enabled: true, port: status.port });
    } else {
      await overlay.stop();
      journey.setOverlay({ enabled: false, port: journey.data.overlay.port });
    }
    return overlayView();
  }, { privateOnly: true });
  handle("copyOverlayAddress", async (...args) => {
    none(args, "overlay");
    const status = overlay.status();
    if (!status.url) throw say("Switch the overlay on first.");
    await copyText(status.url);
    return true;
  }, { privateOnly: true });

  // Share cards: who is on the card, and the copy button.
  handle("shareCharacter", (...args) => {
    if (args.length > 1 || (args.length && args[0] !== null && typeof args[0] !== "string")) throw Error("Invalid share request.");
    const s = getState(), p = s.profiles.find((x) => x.id === (args[0] || s.activeProfileId));
    return p ? character(p) : null;
  });
  handle("copySharePicture", async (...args) => {
    if (args.length !== 1 || !isPng(args[0])) throw Error("Invalid picture.");
    try { await copyImage(Buffer.from(args[0])); } catch { throw say("The picture could not be copied. Save it instead."); }
    return true;
  }, { privateOnly: true });

  /** What the overlay page shows right now: the live character when the link is on, else the last save. */
  function overlayFacts() {
    const p = active();
    if (!p) return {};
    let advice = null;
    try { advice = leveling?.advise(p.id); } catch { /* The overlay shows what it can. */ }
    const c = advice?.character || null, step = advice ? nextStep(advice) : null;
    const xp = c?.xpPercent ?? (c?.xp && c.xp.savedLevel === c.level && c.xp.max > 0 ? (c.xp.current / c.xp.max) * 100 : null);
    const splits = require("./journal-data.cjs").splits(p, []), last = splits[splits.length - 1] || null;
    let session = null;
    try { session = playSummary(); } catch { /* No live session. */ }
    return { level: c?.level ?? p.level, xpPercent: xp, zone: c?.zone || "", splitSeconds: last?.seconds ?? null, splitLabel: last ? `Level ${last.level} to ${last.level + 1}` : "",
      deaths: session?.active ? session.deaths : null, step: step?.title || "", stepDetail: step?.detail || "", live: !!c?.live };
  }
  /** Start the overlay again at launch when the player left it switched on. */
  async function resume() {
    if (!journey.data.overlay.enabled) return false;
    try { const status = await overlay.start(journey.data.overlay.port); journey.setOverlay({ enabled: true, port: status.port }); return true; } catch { return false; }
  }
  return { overlayFacts, resume, raceView };
}
module.exports = { registerJourneyExtras, SHARE_KINDS, isPng };
