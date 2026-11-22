"use strict";
// One next step from the leveling advice, in plain words (0.44, roadmap 3.4 mini Now and 3.5
// spoken steps). Pure: the same order as /bf next in game: a finished quest to hand in first,
// then the nearest open objective, then a quest to pick up, then the zone to head for.
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

function nextStep(advice) {
  // The advisor marks a usable answer "ok"; any other status (no character, no level) has no step.
  if (!advice || (advice.status && advice.status !== "ok")) return null;
  const me = advice.character?.position || null, log = advice.log || {}, zone = advice.next || null;
  const placed = (w) => {
    if (!w || !Number.isFinite(w.x)) return { where: null, dir: null };
    const where = { mapId: w.mapId ?? null, mapName: w.mapName ?? null, x: w.x, y: w.y };
    const dir = direction(me, where);
    return { where, dir: dir?.words || (where.mapName ? `in ${where.mapName}` : null) };
  };
  if (advice.character?.dead) return { kind: "dead", title: "Run back to your body", detail: "Release, then follow the arrow back to your corpse.", where: null, dir: null, spoken: "You died. Release and run back to your body." };
  const ready = log.ready?.[0];
  if (ready) {
    const { where, dir } = placed(ready.turnIn);
    const npc = ready.turnIn?.name || null;
    return { kind: "turnin", questId: ready.id, title: `Hand in ${ready.title}`, detail: npc ? `${ready.turnIn.guess ? "Probably to" : "To"} ${npc}${coords(where) ? ` at ${coords(where)}` : ""}` : "Back to whoever gave it to you", where, dir,
      spoken: `Hand in ${ready.title}${npc ? ` to ${npc}` : ""}${dir ? `, ${dir}` : ""}.` };
  }
  const active = log.active?.[0];
  if (active) {
    const { where, dir } = placed(active.where);
    const progress = active.total ? `${active.done}/${active.total}` : null;
    return { kind: "objective", questId: active.id, title: active.title, detail: active.next || (progress ? `${progress} done` : "Keep going"), progress, where, dir,
      spoken: `${active.title}: ${active.next || "keep going"}${dir ? `, ${dir}` : ""}.` };
  }
  const pick = zone?.quests?.[0];
  if (pick) {
    const { where, dir } = placed({ mapId: zone.mapId, mapName: zone.name, x: pick.x, y: pick.y });
    return { kind: "pickup", questId: pick.id, title: `Pick up ${pick.title}`, detail: `From ${pick.giver}${zone.name ? ` in ${zone.name}` : ""}`, where, dir,
      spoken: `Pick up ${pick.title} from ${pick.giver}${dir ? `, ${dir}` : ""}.` };
  }
  if (zone) return { kind: "zone", title: `Head to ${zone.name}`, detail: zone.why || `Level ${zone.min}–${zone.max}`, where: null, dir: null, spoken: `Head to ${zone.name}.` };
  return null;
}

module.exports = { nextStep, direction };
