"use strict";
const v = require("./validation.cjs"),
  ai = require("./providers.cjs");
const { questInsights } = require("./insights-data.cjs");
function enrichRewards(result, p, gameData) {
  const rw = result.rewards;
  if (!rw || typeof rw !== "object") return;
  const list = [...(Array.isArray(rw.items) ? rw.items : []), ...(Array.isArray(rw.choices) ? rw.choices : [])];
  if (!list.length) return;
  const ids = [...new Set(list.map((r) => r.itemId))].filter((id) => Number.isSafeInteger(id) && id > 0);
  const found = gameData.items(ids), byId = new Map(ids.map((id, i) => [id, found[i]]));
  if (!found.some(Boolean)) return;
  const attach = (rows) => rows.map((r) => (byId.get(r.itemId) ? { ...r, details: byId.get(r.itemId) } : r));
  result.rewards = { ...rw, ...(Array.isArray(rw.items) ? { items: attach(rw.items) } : {}), ...(Array.isArray(rw.choices) ? { choices: attach(rw.choices) } : {}) };
  const choices = result.rewards.choices || [];
  if (!p.className || !choices.some((c) => c.details)) return;
  const equipment = Array.isArray(p.readiness?.equipment) ? p.readiness.equipment : null;
  const worn = equipment?.length ? gameData.items(equipment.map((e) => e.itemId)) : [];
  const bySlot = {};
  // Worn items the game tables do not cover still occupy their slot; they are compared as unknown.
  (equipment || []).forEach((e, i) => { bySlot[e.slot] = worn[i] || { id: e.itemId, name: e.name || `Item #${e.itemId}`, unknown: true, stats: [], armor: 0 }; });
  const ctx = { className: p.className, level: Number.isInteger(p.level) ? p.level : undefined, equipmentKnown: !!equipment };
  const pick = require("./gear-score.cjs").bestReward(choices, ctx, bySlot);
  if (pick) result.rewardPick = { ...pick, equipmentKnown: !!equipment };
}
function registerKnowledgeHandlers({
  handle,
  knowledge,
  getState,
  connected,
  clipboard,
  getInsights = () => null,
  getCreatures = () => null,
  getLocationContext = () => null,
  gameData = null,
}) {
  const sync = () => {
    const s = getState();
    knowledge.setContext(
      s.profiles.find((p) => p.id === s.activeProfileId) || {},
      connected(),
    );
  };
  const profile = (profileId) => {
    const s = getState();
    if (profileId !== null && profileId !== undefined)
      v.str(profileId, 100, false);
    const p = s.profiles.find((p) => p.id === (profileId ?? s.activeProfileId));
    if (!p && profileId) throw Error("Choose a character.");
    return p || {};
  };
  const count = (args, min, max = min) => {
    if (args.length < min || args.length > max)
      throw Error("Invalid reference request.");
  };
  handle("knowledgeStatus", (...args) => {
    count(args, 0);
    sync();
    return knowledge.status();
  });
  handle("refreshKnowledge", (...args) => {
    count(args, 0);
    sync();
    return knowledge.refresh();
  });
  handle("setKnowledgeAutomatic", (...args) => {
    count(args, 1);
    if (typeof args[0] !== "boolean")
      throw Error("Invalid reference preference.");
    const status = knowledge.setAutomatic(args[0]);
    sync();
    return status;
  });
  handle("searchQuests", (...args) => {
    count(args, 1, 3);
    sync();
    const [query, profileId, options = {}] = args,
      p = profile(profileId);
    const index = knowledge.index(p) || knowledge.bundled;
    return index.search(query, p, options);
  });
  // One read-only details builder behind two channels: the Quests page's selection pipeline
  // (questDetails) and hover cards (questCard), so a hover never shares the page's IPC traffic.
  function questDetails(args) {
    count(args, 2);
    sync();
    const [profileId, questId] = args,
      p = profile(profileId);
    if (!Number.isSafeInteger(questId) || questId < 1 || questId > 2147483647)
      throw Error("Invalid quest ID.");
    const index = knowledge.index(p) || knowledge.bundled;
    const active = p.quests?.find((q) => q.id === questId);
    const result = {
      ...index.details(p, questId),
      waypoint: index.resolveWaypoint(
        p,
        questId,
        active ? (active.complete ? "t" : "o") : "r",
      ),
    };
    // Zone names for every map the quest mentions, so pages say "Durotar" rather than a map number.
    try {
      const { MAP_NAMES } = require("./map-names.cjs"), ids = new Set();
      for (const list of [result.givers, result.turnIns, result.mentions]) for (const n of list || []) for (const p of n.positions || []) ids.add(p.mapId);
      for (const o of result.objectiveLocations || []) for (const p of o.positions || []) ids.add(p.mapId);
      if (result.waypoint?.destination?.mapId) ids.add(result.waypoint.destination.mapId);
      result.mapNames = Object.fromEntries([...ids].filter((id) => MAP_NAMES[id]).map((id) => [id, MAP_NAMES[id]]));
    } catch {}
    // What each objective is ("Southsea Brigand", "Silithid Egg"), from the reference's own names.
    try {
      const pack = index.pack, names = {};
      for (const o of result.record?.objectives || []) {
        const n = o.type === "monster" ? pack.creatures?.[String(o.objectId)]?.name : o.type === "item" ? pack.items?.[String(o.objectId)]?.name : null;
        if (typeof n === "string" && n) names[o.index] = { type: o.type, name: n };
      }
      // Items the community reference never named (often Forever-only): ask the player's own install.
      const unnamed = (result.record?.objectives || []).filter((o) => o.type === "item" && !names[o.index] && Number.isSafeInteger(o.objectId));
      if (unnamed.length && gameData) { const found = gameData.items(unnamed.map((o) => o.objectId)); unnamed.forEach((o, i) => { if (found[i]?.name) names[o.index] = { type: "item", name: found[i].name }; }); }
      if (Object.keys(names).length) result.objectiveNames = names;
    } catch {}
    // Level range and elite/rare flags of each kill objective's creature, when the creature reference knows it.
    try {
      const creatures = getCreatures();
      if (creatures) {
        const byId = require("./creature-data.cjs").creatureIndex(creatures), out = {};
        for (const o of result.record?.objectives || []) {
          const c = o.type === "monster" && Number.isSafeInteger(o.objectId) ? byId.get(o.objectId) : null;
          if (c) out[o.index] = { name: result.objectiveNames?.[o.index]?.name || c.name, minLevel: c.minLevel, maxLevel: c.maxLevel, elite: Boolean(c.elite), rare: Boolean(c.rare) };
        }
        if (Object.keys(out).length) result.objectiveCreatures = out;
      }
    } catch {}
    // Experience at this character's level, by the rule observed in turn-ins (full to +5, then 80/60/50%).
    try {
      const xp = result.rewards?.xp, level = Number.isInteger(p.level) ? p.level : null, questLevel = result.record?.level;
      if (xp?.base && level && Number.isInteger(questLevel)) result.rewards = { ...result.rewards, xp: { ...xp, atYourLevel: { level, xp: require("./knowledge.cjs").estimateQuestXP(xp.base, questLevel, level) } } };
    } catch {}
    // Reward facts from the player's own game install, plus a suggested pick for this character.
    if (gameData) try { enrichRewards(result, p, gameData); } catch {}
    const insights = getInsights();
    if (insights) {
      result.insights =
        result.provenance?.build !== insights.build ||
        result.provenance?.sourceCommit !== insights.sourceCommit
          ? {
              status: "unavailable",
              reason:
                "The selected quest reference source differs from the bundled supplementary reference.",
            }
          : result.status === "conflict" ||
            (active && result.record && active.title !== result.record.title)
            ? {
                status: "unavailable",
                reason:
                  "Quest title differs from the selected primary reference; supplementary facts are unavailable.",
              }
            : !["match", "reference"].includes(result.status) ||
                result.record?.id !== questId
              ? {
                  status: "unavailable",
                  reason:
                    "The selected primary quest reference is missing or incompatible; supplementary facts are unavailable.",
                }
              : questInsights(insights, {
                  id: questId,
                  title: result.record.title,
                  build: p.clientBuild,
                  locale: p.locale,
                });
    }
    // Quest intel from this player's own game (quest log text, where they looted its items); only when present.
    try { Object.assign(result, require("./quest-intel.cjs").questIntel(p, questId, result.record)); } catch {}
    // Plain "how to do it" steps from everything above (own looting, community drops, levels, quest text).
    try { const how = require("./quest-howto.cjs").buildHowTo(result, { loot: require("./loot-data.cjs").loadLootPack() }); if (how?.steps.length) result.howTo = how; } catch {}
    return result;
  }
  handle("questDetails", (...args) => questDetails(args));
  handle("questCard", (...args) => questDetails(args));
  handle("copyQuestWaypoint", (...args) => {
    count(args, 3);
    sync();
    const [profileId, questId, phase] = args,
      p = profile(profileId);
    if (
      !Number.isSafeInteger(questId) ||
      questId < 1 ||
      questId > 2147483647 ||
      !["t", "o", "r"].includes(phase)
    )
      throw Error("Invalid waypoint request.");
    const index = knowledge.index(p);
    if (!index) throw Error("No compatible reference pack.");
    const command = index.waypoint(p, questId, phase);
    clipboard.writeText(command);
    return {
      command,
      message:
        phase === "r"
          ? "Paste in the game chat and press Enter to set a reference marker; check quest availability."
          : "Paste in the game chat and press Enter to set a quest waypoint.",
    };
  });
  handle("contextPreview", (...args) => {
    count(args, 2, 4);
    const [profileId, share, prompt = "", memoryIds = []] = args;
    if (typeof share !== "boolean") throw Error("Invalid context choice.");
    v.str(prompt, 12000);
    if(!Array.isArray(memoryIds)||memoryIds.length>5||new Set(memoryIds).size!==memoryIds.length)throw Error('Invalid location preview memory scope.');
    memoryIds.forEach(require('./memory-data.cjs').uuid);
    if (!share) return null;
    const p = profile(profileId);
    if (!p.id) throw Error("Choose a character.");
    // Stored-profile previews remain public/read-only; volatile conversation
    // reports and the current draft belong only to the selected character.
    const reportedLocation=p.id===getState().activeProfileId?getLocationContext(p.id,share,prompt,memoryIds):null;
    return ai.approvedProfile(p, { knowledge: knowledge.index(p), prompt, reportedLocation });
  });
}
module.exports = { registerKnowledgeHandlers };
