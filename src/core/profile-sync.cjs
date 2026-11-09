"use strict";
const { createHash } = require("node:crypto");
const { validateState, object, str } = require("./validation.cjs");

function timestamp(value) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw Error("Invalid snapshot timestamp");
  return value;
}

/** Merge a validated saved export without sharing mutable data with either input. */
function mergeSnapshot(state, snapshot, { allowActiveSelection = true, onOmitted = () => {} } = {}) {
  const next = validateState(state);
  object(snapshot, ["characters", "activeId", "observedAt"]);
  timestamp(snapshot.observedAt);
  if (!Array.isArray(snapshot.characters) || snapshot.characters.length > 100)
    throw Error("Invalid snapshot roster");
  const sources = new Map();
  let latestKnown = "";
  for (const profile of next.profiles) {
    if (!profile.source) continue;
    if (sources.has(profile.source.id))
      throw Error("Duplicate source identity");
    sources.set(profile.source.id, profile);
    if (profile.source.updatedAt > latestKnown)
      latestKnown = profile.source.updatedAt;
  }
  const seen = new Set();
  const records = snapshot.characters.map((record) => {
    object(record, [
      "id",
      "name",
      "realm",
      "className",
      "level",
      "race",
      "faction",
      "location",
      "updatedAt",
      "quests",
      "progress",
      "history",
      "readiness",
      "clientBuild",
      "locale",
      "captureVersion",
    ]);
    str(record.id, 200, false);
    timestamp(record.updatedAt);
    if (seen.has(record.id)) throw Error("Duplicate snapshot identity");
    seen.add(record.id);
    const profile = {
      id: "snapshot",
      name: record.name,
      realm: record.realm,
      className: record.className,
      level: record.level,
      notes: "",
      goals: [],
      source: { kind: "wow-addon", id: record.id, updatedAt: record.updatedAt },
    };
    for (const key of [
      "race",
      "faction",
      "location",
      "quests",
      "progress",
      "history",
      "readiness",
      "clientBuild",
      "locale",
      "captureVersion",
    ])
      if (record[key] !== undefined) profile[key] = record[key];
    return validateState({
      ...next,
      profiles: [profile],
      activeProfileId: null,
    }).profiles[0];
  });
  if (snapshot.activeId !== null && !seen.has(snapshot.activeId))
    throw Error("Invalid active snapshot character");
  const usedIds = new Set(next.profiles.map((p) => p.id));
  let omitted = 0;
  for (const incoming of records) {
    let profile = sources.get(incoming.source.id);
    if (!profile) {
      const matches = next.profiles.filter(
        (p) =>
          !p.source && p.name === incoming.name && p.realm === incoming.realm,
      );
      const rosterMatches = records.filter(
        (p) => p.name === incoming.name && p.realm === incoming.realm,
      );
      if (matches.length === 1 && rosterMatches.length === 1)
        profile = matches[0];
    }
    if (!profile) {
      if (next.profiles.length >= 100) { omitted++; continue; }
      const base =
        "wow-" + createHash("sha256").update(incoming.source.id).digest("hex");
      let id = base,
        suffix = 0;
      while (usedIds.has(id)) id = `${base}-${++suffix}`;
      usedIds.add(id);
      profile = { ...incoming, id };
      next.profiles.push(profile);
    } else if (
      !profile.source ||
      incoming.source.updatedAt > profile.source.updatedAt
    ) {
      for (const key of [
        "name",
        "realm",
        "className",
        "level",
        "race",
        "faction",
        "location",
        "quests",
        "progress",
        "history",
        "readiness",
        "clientBuild",
        "locale",
        "captureVersion",
        "source",
      ]) {
        if (incoming[key] !== undefined) profile[key] = incoming[key];
        else delete profile[key];
      }
    }
    sources.set(incoming.source.id, profile);
  }
  // Never let an older on-disk export roll back the selected character.
  const active = sources.get(snapshot.activeId);
  if (
    active &&
    allowActiveSelection &&
    next.followGameCharacter !== false &&
    snapshot.observedAt >= latestKnown
  )
    next.activeProfileId = active.id;
  onOmitted(omitted);
  return validateState(next);
}

// Apply only fields changed since the form was rendered, preserving imports
// that advanced in the main process while the player was editing.
function mergeUserEdits(current, edited, base) {
  const next = validateState(current);
  edited = validateState(edited);
  base = validateState(base);
  const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
  const original = new Map(base.profiles.map((p) => [p.id, p]));
  const submitted = new Map(edited.profiles.map((p) => [p.id, p]));
  next.profiles = next.profiles.filter(
    (p) => !original.has(p.id) || submitted.has(p.id),
  );
  for (const change of edited.profiles) {
    const before = original.get(change.id);
    const target = next.profiles.find((p) => p.id === change.id);
    if (!before) {
      if (target) throw Error("Character identity already exists.");
      next.profiles.push(structuredClone(change));
    } else if (target) {
      const fields = target.source
        ? ["notes", "goals"]
        : [
            "name",
            "realm",
            "className",
            "level",
            "race",
            "faction",
            "notes",
            "goals",
          ];
      for (const key of fields)
        if (differs(change[key], before[key])) {
          if (change[key] === undefined) delete target[key];
          else target[key] = structuredClone(change[key]);
        }
    }
  }
  for (const key of ["onboarded", "followGameCharacter", "activeProfileId"])
    if (differs(edited[key], base[key])) {
      if (edited[key] === undefined) delete next[key];
      else next[key] = edited[key];
    }
  if (
    next.activeProfileId &&
    !next.profiles.some((p) => p.id === next.activeProfileId)
  )
    next.activeProfileId = next.profiles[0]?.id ?? null;
  return validateState(next);
}
module.exports = { mergeSnapshot, mergeUserEdits };
