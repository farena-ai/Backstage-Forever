"use strict";
// IPC for two more Journey views: challenge runs (C12) and the Discord status switch (S6).
// Both read saved characters and the desktop's own small files; handlers that change something
// are private to the window.
const C = require("./challenge-runs.cjs");
const { MAP_NAMES } = require("./map-names.cjs");
const say = (message) => Object.assign(new Error(message), { name: "JourneyError" });
const plainly = (work) => { try { return work(); } catch (e) { throw say(e.message); } };

function registerJourneyMore({ handle, getState, challenges, journey, presence, presenceFacts = () => null }) {
  const mapName = (id) => MAP_NAMES[id] || `Map ${id}`;
  const active = () => { const s = getState(); return s.profiles.find((p) => p.id === s.activeProfileId) || null; };
  const none = (args, what) => { if (args.length) throw Error(`Invalid ${what} request.`); };

  function challengeView() {
    const p = active();
    if (!p) return null;
    const run = challenges.get(p.id);
    const view = run ? C.evaluate(run, p, { deaths: journey?.deaths(p.id) || [], mapName }) : null;
    return { profileId: p.id, name: p.name, level: Number.isInteger(p.level) ? p.level : null, saved: p.source?.kind === "wow-addon", options: C.RULES, limits: { custom: C.LIMITS.custom, dungeonLevel: C.LIMITS.dungeonLevel },
      rules: run?.rules || null, run: view, card: C.cardData(view), character: { name: p.name, realm: p.realm || "", level: Number.isInteger(p.level) ? p.level : null, className: p.className || null } };
  }
  handle("challengeRun", (...args) => { none(args, "challenge"); return challengeView(); });
  handle("startChallengeRun", (...args) => {
    const [rules] = args, p = active();
    if (args.length !== 1 || !rules || typeof rules !== "object" || Array.isArray(rules) || JSON.stringify(rules).length > 1000) throw Error("Invalid challenge request.");
    if (!p) throw say("Choose a character first.");
    plainly(() => challenges.start(p.id, rules, { level: p.level }));
    return challengeView();
  }, { privateOnly: true });
  handle("endChallengeRun", (...args) => {
    const p = active();
    if (args.length !== 1 || !["end", "remove"].includes(args[0])) throw Error("Invalid challenge request.");
    if (!p) throw say("Choose a character first.");
    if (args[0] === "end") challenges.end(p.id); else challenges.remove(p.id);
    return challengeView();
  }, { privateOnly: true });

  const presenceView = () => { try { presence.update(presenceFacts()); } catch { /* The switch still works. */ } return presence.status(); };
  handle("discordPresence", (...args) => { none(args, "Discord"); return presenceView(); });
  handle("setDiscordPresence", (...args) => {
    const [patch] = args;
    if (args.length !== 1 || !patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !["enabled", "appId", "level", "className", "zone"].includes(k)) || (typeof patch.appId === "string" && patch.appId.length > 40)) throw Error("Invalid Discord setting.");
    plainly(() => presence.configure(patch));
    return presenceView();
  }, { privateOnly: true });
  return { challengeView, presenceView };
}
module.exports = { registerJourneyMore };
