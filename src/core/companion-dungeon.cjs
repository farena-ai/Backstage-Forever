"use strict";
const { BASELINE, buildAtlas } = require("./dungeon-atlas.cjs");

const nameKey = (value) => value.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").replace(/^the /, "");
const EXAMPLE = "Try ‘Dungeon prep for The Deadmines’ or ‘Dungeon prep for #dm’. Use a full name or the exact #ID from the Dungeon Atlas.";

function dungeonQuestion(prompt) {
  const text = prompt.trim();
  const explicit = /^(?:dungeon|raid)\s+prep(?:aration)?(?:\s+for(?:\s+(.*?))?)?[.?!]?$/i.exec(text);
  const natural = /^(?:how (?:do|should|can) i prepare|what should i do to prepare) for ([^\n]{1,100}?)[.?!]?$/i.exec(text);
  if (!explicit && !natural) return null;
  const target = (explicit?.[1] ?? natural?.[1] ?? "").trim();
  const matches = target.startsWith("#")
    ? BASELINE.filter(([id]) => target === `#${id}`)
    : BASELINE.filter(([, name]) => nameKey(name) === nameKey(target));
  if (matches.length === 1) return { id: matches[0][0] };
  // Unrelated questions using “prepare for” still follow the normal route.
  return explicit ? { id: null } : null;
}

function dungeonAnswer({ id }, { profile, shareProfile, lootPack = () => null, wishes = () => [] }) {
  if (!id) return `Which instance are you preparing for? ${EXAMPLE}`;
  const savedAt = shareProfile ? Date.parse(profile?.source?.updatedAt) : NaN;
  const saved = shareProfile && profile?.source?.kind === "wow-addon" && /^\d+\.\d+\.\d+\.\d+$/.test(profile.clientBuild) &&
    Number.isFinite(savedAt) && savedAt > 0 && savedAt <= Date.now() ? profile : null;
  // The Atlas matches saved quest titles/objectives to this instance. These are leads,
  // not a list of quests the player can pick up, or proof of prerequisites.
  const entry = buildAtlas({ profile: saved }).entries.find((row) => row.id === id);
  const { name, kind, zone, entrance, levels, faction, prep, yourQuests } = entry;
  const band = levels.min === levels.max ? levels.min : `${levels.min}–${levels.max}`;
  const answer = [
    `**${name} (#${id})**`,
    `Classic-era baseline (verify in Forever): level ${band}, approximate entrance in ${zone} (${(entrance.x * 100).toFixed(1)}, ${(entrance.y * 100).toFixed(1)})${faction ? ` · ${faction}-side entrance` : ""}. This does not confirm access.`,
    `**Before you go**\n- ${prep.join("\n- ")}`,
  ];
  if (!shareProfile) {
    answer.push("Turn on ‘Use my active character’ to check the active save and its Atlas wish list locally.");
  } else if (!saved) {
    answer.push("No dated addon save with a known build is available for the active character. Log out of the game and import the updated save to check quests and match wish-list references.");
  } else {
    answer.push(`**Last saved** for ${saved.name} · build ${saved.clientBuild} · ${saved.source.updatedAt} (not live).`);
    const quests = yourQuests.slice(0, 4);
    answer.push(quests.length ? `**Possible matches in your saved quest log**\n- ${quests.map((q) => `${q.title} (quest #${q.id})`).join("\n- ")}\nCheck your current log; this is not a pickup or eligibility list.` :
      "No matching quests found in the saved log. Check your current quest log and the Dungeon Atlas; coverage may be incomplete.");
    const pack = lootPack();
    if (!pack?.builds.includes(saved.clientBuild)) {
      answer.push("No bundled boss-loot reference covers this save’s build. Check the Loot tab in the Dungeon Atlas for reference details.");
    } else {
      const starred = new Set(wishes(saved.id));
      const bossesByItem = new Map();
      for (const boss of pack.instances[id]?.bosses ?? []) {
        for (const { itemId } of boss.items) {
          if (!starred.has(itemId)) continue;
          if (!bossesByItem.has(itemId)) bossesByItem.set(itemId, []);
          bossesByItem.get(itemId).push(boss.name);
        }
      }
      const rows = [...bossesByItem].slice(0, 4).map(([itemId, bosses]) => `Item #${itemId} · ${bosses.join(", ")}`);
      answer.push(rows.length ? `**Your Atlas wishes with historical boss-loot listings**\n- ${rows.join("\n- ")}\n${pack.attribution} Observations pooled across builds ${pack.builds.join(", ")}; no per-build confirmation, personal drops, or drop guarantees.` :
        "No starred items matched the bundled boss-loot listings here. This does not rule out other loot.");
    }
  }
  answer.push(`Open the Dungeon Atlas for more reference details. Check current ${kind} requirements in game.`);
  return answer.join("\n\n");
}

module.exports = { dungeonQuestion, dungeonAnswer };
