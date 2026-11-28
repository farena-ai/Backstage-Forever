"use strict";
// Rank desktop advice once for Now, Mini Now and spoken steps.
const DIRS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];

/** Compass words from one map point to another on the same map (map y grows southwards). */
function direction(from, to) {
  if (!from || !to || from.mapId !== to.mapId || ![from.x, from.y, to.x, to.y].every(Number.isFinite)) return null;
  const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
  if (d < 0.015) return { words: "right here", near: true, distance: d };
  const i = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  return { words: `${d < 0.06 ? "a short way " : ""}${DIRS[i]}`, near: false, distance: d };
}
const coords = (w) => (w && Number.isFinite(w.x) && Number.isFinite(w.y) ? `${(w.x * 100).toFixed(1)}, ${(w.y * 100).toFixed(1)}` : null);

function recommendSteps(advice, { hidden = [], pinnedQuest = null } = {}) {
  if (!advice || (advice.status && advice.status !== "ok")) return [];
  const me = advice.character?.position || null, log = advice.log || {}, zone = advice.next || null;
  if (advice.character?.dead) return [{ key: "dead", kind: "dead", title: "Run back to your body", detail: "Release, then follow the arrow back to your corpse.", where: null, dir: null, source: "live", reason: "The live link reported that your character died.", spoken: "You died. Release and run back to your body." }];
  const source = log.live ? "live" : "saved";
  const sourceText = log.live ? "your live quest log" : "your last saved quest log";
  const candidates = [];
  function placed(w) {
    const where = w && Number.isSafeInteger(w.mapId) && [w.x, w.y].every(Number.isFinite) ? { mapId: w.mapId, mapName: w.mapName ?? null, x: w.x, y: w.y } : null;
    return { where, dir: direction(me, where)?.words || (where?.mapName ? `in ${where.mapName}` : null) };
  }
  function add(step, base) {
    if (hidden.includes(step.key)) return;
    const relative = direction(me, step.where);
    const uncertainty = { "likely-quest-giver": 24, "missing-location": 22, reference: 8 }[step.evidence] || 0;
    const pinned = step.questId != null && step.questId === pinnedQuest;
    const score = base + (relative ? Math.max(0, 35 - relative.distance * 80) : me && step.where ? -20 : 0) - uncertainty + (pinned ? 80 : 0);
    const proximity = relative?.distance < .13 ? "Nearby. " : "";
    candidates.push({ score, step: { ...step, reason: `${pinned ? "Your pinned quest. " : proximity}${step.reason}` } });
  }
  for (const ready of log.ready || []) {
    const { where, dir } = placed(ready.turnIn);
    const npc = ready.turnIn?.name || null;
    const evidence = !where ? "missing-location" : ready.turnIn.evidence || (ready.turnIn.guess ? "likely-quest-giver" : "verified-turn-in");
    const uncertain = evidence !== "verified-turn-in";
    add({ kind: "turnin", key: `hand-in:${ready.id}`, questId: ready.id, title: `Hand in ${ready.title}`, detail: npc && where ? `${uncertain ? "Probably to" : "To"} ${npc} at ${coords(where)}` : where ? `Game waypoint at ${coords(where)}` : "Hand-in location not recorded yet.", where, dir, evidence, source, destination: npc, npcId: ready.turnIn?.npcId, reason: `Ready to turn in according to ${sourceText}.`,
      spoken: `Hand in ${ready.title}${npc && where ? `${uncertain ? ", probably to" : " to"} ${npc}` : ""}${dir ? `, ${dir}` : ""}.` }, 75);
  }
  for (const active of log.active || []) {
    const { where, dir } = placed(active.where);
    const progress = active.total ? `${active.done}/${active.total}` : null;
    const evidence = where ? active.where.evidence || "recorded-objective" : "missing-location";
    add({ kind: "objective", key: `quest:${active.id}`, questId: active.id, title: active.title, detail: active.next || (progress ? `${progress} done` : "Objectives in progress"), progress, where, dir, evidence, source, reason: `Still in progress in ${sourceText}.${log.live && active.total ? " Objective details come from your save." : ""}`,
      spoken: `${active.title}: ${active.next || "keep going"}${dir ? `, ${dir}` : ""}.` }, 59);
  }
  const training = advice.training;
  if (training?.trainer && training.newNow?.length) {
    const { where, dir } = placed(training.trainer);
    add({ kind: "training", key: `train:${advice.character.level}:${training.className}`, title: `Check ${training.newNow.length} ${training.className} skills at your trainer`, destination: training.trainer.name, npcId: training.trainer.npcId, detail: training.newNow.slice(0, 6).map((s) => `${s.name}${s.rank ? ` (${s.rank})` : ""}`).join(", "),
      where, dir, evidence: where ? "reference" : "missing-location", source: "reference", reason: `Training reference for level ${advice.character.level}. Check in game what you already know.`, spoken: `Check your ${training.className} trainer for new skills${dir ? `, ${dir}` : ""}.` }, 53);
  }
  const pick = zone?.quests?.[0];
  if (pick) {
    const { where, dir } = placed({ mapId: zone.mapId, mapName: zone.name, x: pick.x, y: pick.y });
    add({ kind: "pickup", key: `pickup:${pick.id}`, questId: pick.id, title: `Pick up ${pick.title}`, destination: pick.giver, npcId: pick.npcId, detail: `From ${pick.giver}${zone.name ? ` in ${zone.name}` : ""}`, where, dir, evidence: where ? "reference" : "missing-location", source: "reference", reason: "Listed in the Forever leveling reference. Check availability in game.",
      spoken: `Pick up ${pick.title} from ${pick.giver}${dir ? `, ${dir}` : ""}.` }, 25);
  }
  if (zone) {
    const { where, dir } = placed(zone.hub && { ...zone.hub, mapId: zone.mapId, mapName: zone.name });
    add({ kind: "zone", key: `zone:${zone.mapId}`, title: zone.mapId === me?.mapId ? `Keep leveling in ${zone.name}` : `Head to ${zone.name}`, detail: zone.why || `Level ${zone.min}–${zone.max}`, where, dir, evidence: "reference", source: "reference", reason: "This zone fits your level in the Forever reference.", spoken: `Head to ${zone.name}.` }, 0);
  }
  return candidates.sort((a, b) => b.score - a.score).map(({ step }) => step);
}

function nextStep(advice, options) { return recommendSteps(advice, options)[0] || null; }

module.exports = { nextStep, direction, recommendSteps };
