"use strict";

const { liveKeyFor } = require("./live-bridge.cjs");

function matchingLiveFrame(profile, status) {
  if (profile?.source?.kind !== "wow-addon" || !status?.enabled || status.signal !== "live") return null;
  const expected = liveKeyFor(profile.source.id);
  const frame = status.frame;
  return expected !== null && frame?.characterHash === expected ? frame : null;
}

function characterContext(profile, liveFrame, share, checkedAt = Date.now()) {
  if (!profile || !share) return { kind: "none" };
  const timestamp = profile.source?.kind === "wow-addon" ? Date.parse(profile.source.updatedAt) : NaN;
  const savedAt = Number.isFinite(timestamp) ? timestamp : null;
  return { kind: liveFrame ? "live" : savedAt !== null ? "saved" : "manual", savedAt, checkedAt };
}

module.exports = { matchingLiveFrame, characterContext };
