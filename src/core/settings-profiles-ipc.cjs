"use strict";
// Addon settings profiles under Settings: list the profiles each character kept in game, send one
// to another character through the hand-off file, or take a waiting one back. The game offers a
// sent profile at the next login or /reload and applies it only on /bf profile accept.
const { profilesView, inspect, keyOf } = require("./settings-profiles.cjs");
function registerSettingsProfiles({ handle, getGame, getState, sends, onChange = () => {}, now = () => Date.now() }) {
  const blocks = () => { try { return getGame()?.settingsProfiles() || []; } catch { return []; } };
  const characters = () => (getState()?.profiles || []).filter((p) => p?.source?.kind === "wow-addon" && typeof p.name === "string" && typeof p.realm === "string" && p.realm);
  // The game says which sent profile it has dealt with; that send is finished.
  const settle = (list = blocks()) => {
    const done = {};
    for (const b of list) if (b?.profiles?.done) done[keyOf(b)] = b.profiles.done;
    return sends.settle(done);
  };
  const view = () => { settle(); return profilesView(blocks(), characters(), sends.all()); };
  const text = (v, max) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
  handle("settingsProfiles", (...args) => {
    if (args.length) throw Error("Invalid profile request.");
    return view();
  });
  handle("sendSettingsProfile", (...args) => {
    const [sourceId, name, targetId] = args;
    if (args.length !== 3 || !text(sourceId, 200) || !text(name, 20) || !text(targetId, 200)) throw Error("Invalid profile request.");
    const source = blocks().find((b) => b.id === sourceId), profile = source?.profiles.profiles.find((p) => p.name === name);
    if (!profile) throw Error("That profile is no longer in the saved file. Type /reload in game and try again.");
    const target = characters().find((c) => c.id === targetId);
    if (!target) throw Error("Choose a character to send it to.");
    if (keyOf(target) === keyOf(source)) throw Error("That profile already belongs to this character. Type /bf profile load there.");
    const seen = inspect(profile.code);
    if (!seen.ok) throw Error("This profile is damaged and cannot be sent. Save it again in game.");
    if (seen.hasData) throw Error("This profile cannot be sent to the game.");
    sends.set(keyOf(target), { name: profile.name, from: keyOf(source), code: profile.code, at: now() });
    onChange();
    return view();
  });
  handle("cancelSettingsProfile", (...args) => {
    if (args.length !== 1 || !text(args[0], 130)) throw Error("Invalid profile request.");
    if (sends.get(args[0])) { sends.set(args[0], null); onChange(); }
    return view();
  });
  return { view, settle };
}
module.exports = { registerSettingsProfiles };
