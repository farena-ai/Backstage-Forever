"use strict";
// The desktop side's one door to game-guild-feed.cjs (owned by the addon side). That module is an
// EventEmitter reporting what the game said ("link", "event", "signup", "party", "listing") and it
// exports setHandoff({ guild, lfg, plan }) for what the game should read at its next /reload.
// The desktop only listens and calls setHandoff. When the module is not there (an older build, or a
// test), a silent stand-in is used so every screen still works; nothing reaches the game then.
const { EventEmitter } = require("node:events");

/** Whatever the module exports -> { feed, setHandoff, real }. */
function resolveFeed(mod) {
  const isEmitter = (v) => v && typeof v.on === "function" && typeof v.emit === "function";
  const feed = isEmitter(mod) ? mod : [mod?.feed, mod?.gameGuildFeed, mod?.emitter, mod?.default].find(isEmitter) || Object.values(mod && typeof mod === "object" ? mod : {}).find(isEmitter) || null;
  const handoff = typeof mod?.setHandoff === "function" ? mod.setHandoff.bind(mod) : typeof feed?.setHandoff === "function" ? feed.setHandoff.bind(feed) : null;
  return { feed, setHandoff: handoff };
}
let found = { feed: null, setHandoff: null };
try { found = resolveFeed(require("./game-guild-feed.cjs")); } catch { found = { feed: null, setHandoff: null }; }
const real = Boolean(found.feed);
const feed = found.feed || new EventEmitter();
feed.setMaxListeners?.(30);
const last = { data: null, at: 0, count: 0 };
/** Hands the newest guild, board and plan data to the game side. Returns false when there is no game side. */
function setHandoff(data) {
  last.data = data; last.at = Date.now(); last.count++;
  if (!found.setHandoff) return false;
  found.setHandoff(data);
  return true;
}
module.exports = { feed, setHandoff, real, hasHandoff: Boolean(found.setHandoff), resolveFeed, last };
