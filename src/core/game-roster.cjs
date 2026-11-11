"use strict";
const { createHash } = require("node:crypto");
// Inputs have already passed the bounded SavedVariables parser. No account metadata escapes.
function combineSnapshots(snapshots) {
  if (!snapshots.length) return null;
  const serialized = (value) => JSON.stringify(value);
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  // Compute tie keys once; sorting must not repeatedly serialize large account exports.
  const keys = new Map(snapshots.map(snapshot => [snapshot, createHash("sha256").update(serialized(snapshot)).digest("hex")]));
  const ordered = [...snapshots].sort((a,b) => compare(b.observedAt,a.observedAt) || compare(keys.get(a),keys.get(b)));
  const newest = ordered[0], records = new Map();
  for (const snapshot of ordered) for (const character of snapshot.characters) {
    const previous = records.get(character.id);
    if (!previous || character.updatedAt > previous.updatedAt) records.set(character.id,character);
    else if (character.updatedAt === previous.updatedAt) {
      const chosen = serialized(character) < serialized(previous) ? character : previous;
      const other = chosen === character ? previous : character;
      const combined = { ...chosen };
      const gathering = require("./gathering-data.cjs").intersectGatheringProfiles(other.gathering, chosen.gathering);
      if (gathering === undefined) delete combined.gathering;
      else combined.gathering = gathering;
      records.set(character.id, combined);
    }
  }
  let characters = [...records.values()].sort((a,b) => compare(b.updatedAt,a.updatedAt) || compare(a.id,b.id));
  const omittedCharacterCount = Math.max(0,characters.length - 100);
  if (characters.length > 100) {
    const active = records.get(newest.activeId);
    characters = characters.slice(0,100);
    if (active && !characters.some(c=>c.id===active.id)) characters[99] = active;
  }
  characters.sort((a,b)=>compare(a.id,b.id));
  return { snapshot: structuredClone({ characters, activeId:newest.activeId, observedAt:newest.observedAt }), coverage:{ omittedCharacterCount } };
}
module.exports = { combineSnapshots };
