"use strict";
const { BASELINE, loadEncounters } = require("./dungeon-atlas.cjs");

// Atlas labels identify the question, not facts about the ruleset. Only these reviewed
// exact instance map joins are admitted from the single-build Forever encounter source.
const TARGETS = BASELINE.map(([id, name]) => ({ id, name }));
const ENCOUNTER_MAPS = new Map([["sm", 189], ["rfk", 47]]);
const nameKey = (value) => value.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").replace(/^the /, "");
const EXAMPLE = "Try ‘Dungeon prep for The Deadmines’ or use the exact #ID shown in the Dungeon Atlas.";
const OTHER_EDITION = /\b(?:retail|classic|season of discovery|the war within|midnight|dragonflight)\b/i;
const BUILD = /^\d+\.\d+\.\d+\.\d+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (s) => typeof s === "string" && DAY.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().startsWith(s);

function dungeonQuestion(prompt) {
  const text = prompt.trim();
  const explicit = /^(?:dungeon|raid)\s+prep(?:aration)?(?:\s+for(?:\s+([\s\S]*?))?)?[.?!]?$/i.exec(text);
  const natural = /^(?:(?:how (?:do|should|can) i (?:prep(?:are)?|get ready)|what should i do to prepare) for|what do i need (?:to enter|before entering))\s+([^\n]+?)[.?!]?$/i.exec(text);
  if (!explicit && !natural) return null;
  const target = (explicit?.[1] ?? natural?.[1] ?? "").trim();
  const title = target.replace(/\s*[,;—-]?\s+not (?:retail|classic)$/i, "")
    .replace(/\s+in (?:wow |world of warcraft: )?forever$/i, "").trim();
  const wrongEdition = OTHER_EDITION.test(title);
  const bare = title.replace(/^(?:retail|classic)\s+/i, "").replace(/\s+in\s+(?:wow\s+)?(?:retail|classic|season of discovery|the war within|midnight|dragonflight)$/i, "");
  const match = TARGETS.find(({ id, name }) => bare.startsWith("#") ? bare === `#${id}` : nameKey(name) === nameKey(bare));
  // A compound request may mention a known instance without resolving to an exact
  // target. Keep it local and clarify rather than delegating the rest to a model.
  const words = ` ${nameKey(title).replace(/[^a-z0-9#']/g, " ")} `;
  const mentionsInstance = /\b(?:dungeon|raid|instance)\b/i.test(title) || TARGETS.some(({ id, name }) =>
    words.includes(` ${nameKey(name)} `) || words.includes(` #${id} `));
  if (!explicit && !match && !wrongEdition && !mentionsInstance) return null;
  return { id: match?.id ?? null, wrongEdition };
}

function encounterEvidence(pack, id, build) {
  const instanceMap = ENCOUNTER_MAPS.get(id);
  if (!instanceMap || !BUILD.test(build) || pack?.kind !== "forever-encounters" || pack.product !== "wowf" || pack.build !== build ||
      pack.schemaVersion !== 1 || pack.source?.name !== "encounters.json" ||
      typeof pack.source.url !== "string" || !pack.source.url.endsWith(`/data/wowf/${build}/encounters.json`)) return null;
  const { first, last } = pack.source.collectedOn ?? {};
  if (!isoDay(first) || !isoDay(last) || last < first || Date.parse(last) > Date.now() || !Array.isArray(pack.encounters)) return null;
  const rows = [], seen = new Set();
  for (const row of pack.encounters) {
    if (row?.instanceMap !== instanceMap) continue;
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id) ||
        typeof row.name !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N} '’.,-]{0,99}$/u.test(row.name) ||
        !Number.isSafeInteger(row.runs) || row.runs <= 0) return null;
    seen.add(row.id);
    if (rows.length < 4) rows.push({ id: row.id, name: row.name });
  }
  return rows.length ? { build, first, last, rows } : null;
}

function dungeonAnswer({ id, wrongEdition }, { profile, shareProfile, encounters = loadEncounters }) {
  if (wrongEdition) return "Companion only covers World of Warcraft: Forever. Ask for preparation for a Forever instance instead.";
  const target = TARGETS.find((row) => row.id === id);
  if (!target) return `Which instance are you preparing for? ${EXAMPLE}`;
  const answer = [`**${target.name} (#${id})**`, "No verified Forever preparation details are available for the entrance, level range, access requirements, quests, or loot. Check the current requirements in the Forever client." ];
  if (!shareProfile) {
    answer.push("Turn on ‘Use my active character’ to check whether bundled Forever encounter observations match the build in your last save.");
  } else {
    const savedAt = Date.parse(profile?.source?.updatedAt);
    if (profile?.source?.kind !== "wow-addon" || !profile.source.id || !BUILD.test(profile.clientBuild) || !(savedAt > 0 && savedAt <= Date.now())) {
      answer.push("No dated addon save with a known build is available for the active character. Import an updated Forever save to check for matching observations.");
    } else {
      const evidence = ENCOUNTER_MAPS.has(id) ? encounterEvidence(encounters(), id, profile.clientBuild) : null;
      if (!evidence) answer.push("No verified Forever encounter observations match this instance and saved build.");
      else {
        const { build, first, last, rows } = evidence;
        answer.push(`**Some encounters observed in Forever**\n${rows.map((row) => `- ${row.name} (encounter #${row.id})`).join("\n")}\nEfficient Games (CC BY 4.0) · build ${build} · collection window ${first} to ${last}. Not a full roster or proof of access.`);
      }
    }
  }
  return answer.join("\n\n");
}

module.exports = { dungeonQuestion, dungeonAnswer };
