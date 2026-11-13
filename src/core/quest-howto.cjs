"use strict";
// "How to do it": plain steps for one quest, built from what we actually know, most trusted first:
// what this player looted, community loot observations, creature levels, the quest's own text.
// Each step says where its knowledge came from, so a guess never reads like a fact.

const pct = (p) => `${(p.x * 100).toFixed(1)}, ${(p.y * 100).toFixed(1)}`;
const levels = (c) => (c?.minLevel ? (c.maxLevel && c.maxLevel !== c.minLevel ? `level ${c.minLevel}–${c.maxLevel}` : `level ${c.minLevel}`) : c?.skull ? "level ??" : "");
const centre = (positions = []) => {
  const by = new Map();
  for (const p of positions) if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) (by.get(p.mapId) || by.set(p.mapId, []).get(p.mapId)).push(p);
  const best = [...by.values()].sort((a, b) => b.length - a.length)[0];
  return best ? { mapId: best[0].mapId, x: best.reduce((t, p) => t + p.x, 0) / best.length, y: best.reduce((t, p) => t + p.y, 0) / best.length } : null;
};
// Sentences of the quest text that say where to go or what to do.
function hints(text) {
  const all = String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const verbs = /\b(travel|go|head|find|search|collect|gather|recover|retrieve|bring|kill|slay|destroy|defeat|hunt|use|place|speak|talk|look|loot|pick|take|deliver|investigate|explore|return)\b/i;
  return all.filter((s) => verbs.test(s) && s.length <= 260).slice(0, 2);
}
// Does the text suggest things lying around rather than enemy drops?
const objectHint = (text) => /\b(lying|scattered|crates?|barrels?|chests?|bottles?|ruins|ground|herbs?|plants?|mushrooms?|flowers?|bushes|pick up|gather)\b/i.test(String(text || ""));

function buildHowTo(details, { loot = null, mapNames = {} } = {}) {
  const record = details?.record;
  if (!record) return null;
  const steps = [], basis = new Set();
  const where = (p) => (p ? `${mapNames[p.mapId] || details.mapNames?.[p.mapId] || "the area"} around ${pct(p)}` : "");
  const text = [details.questText?.description, details.questText?.objectives, record.objectiveEvidence].filter(Boolean).join(" ");
  const giver = details.givers?.[0], turnIn = details.turnIns?.[0] || giver;
  for (const o of record.objectives || []) {
    const name = details.objectiveNames?.[o.index]?.name;
    const area = centre((details.objectiveLocations || []).find((l) => l.index === o.index)?.positions);
    const n = o.required > 1 ? `${o.required} ` : "";
    if (o.type === "monster") {
      const c = details.objectiveCreatures?.[o.index];
      const lv = levels(c);
      steps.push({ kind: "kill", text: `Kill ${name ? `${n}${name}` : o.required > 1 ? `the ${o.required} target creatures` : "the target creature"}${lv ? ` (${lv})` : ""}${area ? ` in ${where(area)}` : ""}.`, warn: c?.elite ? "Elite: much tougher than normal enemies. Bring a group or come back a few levels higher." : null });
      if (c) basis.add("creature levels from community data");
      continue;
    }
    if (o.type === "item") {
      const learned = details.itemSources?.find((i) => i.itemId === o.objectId);
      const community = loot?.items?.[o.objectId] || [];
      const item = name || learned?.name || null;
      const what = item ? `${n}${item}` : o.required > 1 ? `the ${o.required} quest items` : "the quest item";
      if (learned?.sources?.length) {
        const s = learned.sources[0], p = s.positions?.[0];
        const how = s.kind === "object" ? `pick them up from ${s.name ? `“${s.name}”` : "objects on the ground"} (click them; they sparkle)` : `loot them from ${s.name || "creatures"} you kill`;
        steps.push({ kind: "item", text: `Collect ${what}: you've already found these, so ${how}${p ? ` near ${where(p)}` : area ? ` in ${where(area)}` : ""}.` });
        basis.add("your own looting");
      } else if (community.length) {
        const npcs = community.filter((s) => s.kind === "npc" && s.name), objs = community.filter((s) => s.kind === "object" && s.name);
        const parts = [];
        if (objs.length) parts.push(`found in ${objs.slice(0, 2).map((s) => `“${s.name}”`).join(" or ")} (click them in the world)`);
        if (npcs.length) parts.push(`dropped by ${npcs.slice(0, 3).map((s) => `${s.name}${s.chance > 0 && s.chance < 1 ? ` (${Math.round(s.chance * 100)}% of kills)` : " (usually)"}`).join(", ")}`);
        steps.push({ kind: "item", text: `Collect ${what}: ${parts.join("; or ")}${area ? `. Best spot: ${where(area)}` : ""}.` });
        basis.add("community loot observations");
      } else {
        const objects = objectHint(text);
        steps.push({ kind: "item", text: `Collect ${what}${area ? ` in ${where(area)}` : ""}. ${objects ? "The quest text points to things lying around: look for clickable objects (they sparkle when you hover them)." : "Kill the enemies in that area and loot them; if nothing drops after a few, look for clickable objects on the ground instead."}`, guess: true });
        basis.add(objects ? "the quest's own text" : "a general rule (no drop data yet)");
      }
      continue;
    }
    // Events, exploration, talking: the objective text is the best guide.
    const line = (details.questText?.objectives || record.objectiveEvidence || "").trim();
    if (line) { steps.push({ kind: "other", text: line }); basis.add("the quest's own text"); }
  }
  if (!steps.length && record.objectiveEvidence) { steps.push({ kind: "other", text: record.objectiveEvidence }); basis.add("the quest's objective text"); }
  const say = hints(details.questText?.description);
  if (turnIn) {
    const p = turnIn.positions?.[0];
    steps.push({ kind: "turn-in", text: `Hand it in to ${turnIn.name}${p ? ` (${where(p)})` : ""}.` });
  }
  return { steps, questSays: say, basis: [...basis] };
}
module.exports = { buildHowTo, hints, objectHint };
