"use strict";
// The Companion's dated answer stays on the pinned single-build file it names (see ENCOUNTER_URL).
const { BASELINE, loadPinnedEncounters: loadEncounters } = require("./dungeon-atlas.cjs");
const buildCompat = require("./build-compat.cjs");
const { mentionsDungeonAlias } = require("./companion-intents.cjs");
const { savedSource } = require("./journal-data.cjs");

// Atlas labels identify the question, not facts about the ruleset. Only these reviewed
// exact instance map joins are admitted from the single-build Forever encounter source.
const TARGETS = BASELINE.map(([id, name]) => ({ id, name }));
const ENCOUNTER_MAPS = new Map([["sm", 189], ["rfk", 47]]);
const nameKey = (value) => value.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").replace(/^the /, "");
const phrase = (value) => ` ${nameKey(value).replace(/[^a-z0-9#']/g, " ").trim().replace(/ +/g, " ")} `;
const EXAMPLE = "Try ‘Dungeon prep for The Deadmines’ or use the exact #ID shown in the Dungeon Atlas.";
const OTHER_EDITION = /\b(?:retail|classic|season of discovery|the war within|midnight|dragonflight)\b/i;
const FACT_OTHER_EDITION = /\b(?:retail|classic|season of discovery|the war within|dragonflight)\b|\b(?:in|wow) midnight\b|\bmidnight\s+expansion\b|\(midnight\)/i;
const EDITION_SUFFIX = /\s+in\s+(?:wow\s+)?(?:retail|classic|season of discovery|the war within|midnight|dragonflight)$|\s+\((?:wow\s+)?(?:retail|classic|season of discovery|the war within|midnight|dragonflight)\)$/i;
const ENCOUNTER_URL = "https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/3067c6919046428152f2152fa551f44a8c215d79/data/wowf/1.60.1.70888/encounters.json";
const ENCOUNTER_BUILD = "1.60.1.70888";
const BUILD = /^\d+\.\d+\.\d+\.\d+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (s) => typeof s === "string" && DAY.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().startsWith(s);

function dungeonQuestion(prompt) {
  const text = prompt.trim();
  const explicit = /^(?:dungeon|raid)\s+prep(?:aration)?(?:(?:\s+for\b|\s*:)\s*([\s\S]*?))?[.?!]?$/i.exec(text);
  const natural = /^(?:(?:how (?:(?:do|should|can) i|to) (?:prep(?:are)?|get ready)|what should i do to prepare) for|what do i need (?:to enter|before entering))\s+([^\n]+?)[.?!]?$/i.exec(text);
  if (!explicit && !natural) return null;
  const target = (explicit?.[1] ?? natural?.[1] ?? "").trim();
  const title = target.replace(/\s*[,;—-]?\s+not (?:retail|classic)$/i, "")
    .replace(/\s+in (?:wow |world of warcraft: )?forever$/i, "").trim();
  const bare = title.replace(/^(?:retail|classic)\s+/i, "").replace(EDITION_SUFFIX, "");
  const match = TARGETS.find(({ id, name }) => bare.startsWith("#") ? bare === `#${id}` : nameKey(name) === nameKey(bare));
  // A compound request may mention a known instance without resolving to an exact
  // target. Keep it local and clarify rather than delegating the rest to a model.
  const words = phrase(title);
  const mentionsInstance = /\b(?:dungeon|raid|instance)\b/i.test(title) || mentionsDungeonAlias(bare) || TARGETS.some(({ id, name }) =>
    words.includes(phrase(name)) || words.includes(` #${id} `));
  const editionQualified = EDITION_SUFFIX.test(title) || /^(?:wow\s+(?:retail|classic)|retail)\s/i.test(title);
  const wrongEdition = editionQualified || Boolean((explicit || mentionsInstance) && OTHER_EDITION.test(title));
  const prepFollowUp = /^(?:it|there|that (?:one|run))$/i.test(target);
  if (!explicit && !match && !wrongEdition && !mentionsInstance && !prepFollowUp) return null;
  return { id: match?.id ?? null, wrongEdition };
}

function encounterEvidence(pack, id, build) {
  const instanceMap = ENCOUNTER_MAPS.get(id);
  if (!instanceMap || !BUILD.test(build) || pack?.kind !== "forever-encounters" || pack.product !== "wowf" || pack.build !== build ||
      pack.schemaVersion !== 1 || pack.source?.name !== "encounters.json" ||
      pack.source.url !== ENCOUNTER_URL || !ENCOUNTER_URL.endsWith(`/data/wowf/${build}/encounters.json`)) return null;
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

const FACT_EXAMPLE = "Use the full instance name or exact Dungeon Atlas #ID, for example ‘Where is #dm?’";
const WRONG_EDITION = "Companion only covers World of Warcraft: Forever. Ask about a Forever instance instead.";
const LOCATION = /^(?:where(?:'s|s| is| are| (?:can|do) i find)|how (?:do|can|should) i (?:get|travel) to|(?:directions|route) to)\s+/i;
const FACT_CUE = /\b(?:boss(?:es)?|encounters?|entrance|level(?:s| range)?|lvl|attunement|lockouts?|doable|too high|too low|can i (?:still )?(?:do|enter|run)|requirements?|mechanics)\b/i;
const LEARNING = /\b(?:learn|train)(?:ing)?\b/i;
const INSTANCE_CUE = /\b(?:dungeon|raid|instance)\b/i;

function dungeonFactsQuestion(prompt, { legacyInstanceIntent = false } = {}) {
  const raw = prompt.trim().replace(/[‘’]/g, "'").toLowerCase();
  // Sentence punctuation cannot repair a malformed explicit build token.
  const explicitBuild = /^historical encounters?\b.*\bon build\b/.test(raw);
  const text = raw.replace(explicitBuild ? /[?!]+$/ : /[.?!]+$/, "");
  const editionText = text.replace(/\s+(?:in (?:wow |world of warcraft: )?forever\s*)?[,;—-]?\s*not (?:retail|classic)$/i, "");
  const historical = /^historical encounters?\b/i.test(editionText);
  const wrongEdition = FACT_OTHER_EDITION.test(editionText);
  if (historical) {
    const historic = /^historical encounters?\s+(?:for|in)\s+(.+?)(?: on build (\S+))?$/i.exec(editionText);
    const target = historic?.[1] ?? "";
    const match = TARGETS.find(({id,name}) => target === `#${id}` || nameKey(target) === nameKey(name));
    return { id: match?.id, wrongEdition, historical, build: historic?.[2] ?? ENCOUNTER_BUILD };
  }
  const loc = LOCATION.test(editionText);
  const facts = FACT_CUE.test(editionText) && !LEARNING.test(editionText);
  const entrance = /^(?:the )?entrance (?:to|of|for|in)\s+/;
  const locationTarget = editionText.replace(LOCATION, "");
  const subject = locationTarget.replace(entrance, "")
    .replace(/^(?:the )?(?:wow )?(?:retail|classic)\s+/, "");
  const words = phrase(editionText), subjectWords = phrase(subject).trimStart();
  const ids = [...editionText.matchAll(/(?:^|[\s(])#([a-z][^\s(),;?!]*)/gu)].map(m => m[1]);
  const names = TARGETS.filter(({name}) => words.includes(phrase(name)));
  const candidates = new Set([...ids, ...names.map(({id}) => id)]);
  const directLocation = loc && (/^#[a-z]/.test(subject) || names.some(({name}) => subjectWords.startsWith(phrase(name).trimStart())));
  // Exact IDs are meaningful only in instance fact shapes, not in quests or arbitrary prose.
  const genericInstance = loc
    ? /^(?:the )?(?:dungeon|raid|instance)\b/.test(subject) ||
      (/\b(?:dungeon|raid|instance)$/.test(subject) && !/\b(?:near|in|at|by)\b/.test(subject)) ||
      (entrance.test(locationTarget) && (INSTANCE_CUE.test(subject) || wrongEdition))
    : INSTANCE_CUE.test(editionText) && /\b(?:boss(?:es)?|entrance|attunement|lockouts?|access requirements?|can i (?:still )?(?:enter|run))\b/i.test(editionText);
  const aliasTarget = subject.match(/^(?:what bosses are in\s+)?([a-z]{2,4})$/)?.[1];
  const alias = (loc || facts) && aliasTarget && mentionsDungeonAlias(aliasTarget);
  const bossRoster = /^(?:(?:what|which) bosses? (?:are|is) (?:in|at)|who(?: is|'s) (?:the )?(?:last|final|first) boss (?:of|in)|(?:list|compare) (?:the )?bosses (?:in|for|of))\b/i.test(editionText);
  if (!legacyInstanceIntent && !genericInstance && !bossRoster && !alias && !directLocation && !(!loc && facts && candidates.size)) return null;
  return { id: candidates.size === 1 ? [...candidates][0] : null, wrongEdition, historical };
}

function encounterText({ build, first, last, rows }) {
  return `**Historical Forever encounter observations**\n${rows.map((row) => `- ${row.name} (encounter #${row.id})`).join("\n")}\nEfficient Games (CC BY 4.0) · build ${build} · collection window ${first} to ${last}. Not a full roster, a record of your defeats, or proof of access.`;
}

function dungeonFactsAnswer({ id, wrongEdition, historical, build }, { encounters = loadEncounters } = {}) {
  if (wrongEdition) return WRONG_EDITION;
  const target = TARGETS.find((row) => row.id === id);
  if (!target) return `Which instance do you mean? ${FACT_EXAMPLE}`;
  const heading = `**${target.name} (#${id})**`;
  if (historical) {
    const evidence = build === ENCOUNTER_BUILD && ENCOUNTER_MAPS.has(id) ? encounterEvidence(encounters(), id, build) : null;
    return `${heading}\n\n${evidence ? encounterText(evidence) : "No verified historical Forever encounter observations match that request. Try ‘Historical encounters for #sm’."}`;
  }
  const next = ENCOUNTER_MAPS.has(id) ? ` For dated observations, try ‘Historical encounters for #${id}’.` : "";
  return `${heading}\n\nNo verified current Forever instance facts are available here for that question. Check the current requirements or instance information in the Forever client.${next}`;
}

function dungeonAnswer({ id, wrongEdition }, { profile, shareProfile, encounters = loadEncounters }) {
  if (wrongEdition) return "Companion only covers World of Warcraft: Forever. Ask for preparation for a Forever instance instead.";
  const target = TARGETS.find((row) => row.id === id);
  if (!target) return `Which instance are you preparing for? ${EXAMPLE}`;
  const answer = [`**${target.name} (#${id})**`, "No verified Forever preparation details are available for the entrance, level range, access requirements, quests, or loot. Check the current requirements in the Forever client." ];
  if (!shareProfile) {
    answer.push("Turn on ‘Use my active character’ to check your saved quest log and whether bundled Forever encounter observations match your saved build.");
  } else {
    const source = savedSource(profile), savedAt = Date.parse(source?.updatedAt);
    if (!source || typeof profile.clientBuild !== "string" || !BUILD.test(profile.clientBuild) || !(savedAt > 0 && savedAt <= Date.now())) {
      answer.push("No dated addon save with a known build is available for the active character. Import an updated Forever save to check for matching observations.");
    } else {
      // Match explicit instance mentions in the saved log, not Classic bosses or Atlas quests.
      const instance = phrase(target.name);
      const quests = (profile.quests || []).filter(q => [q.title, ...(q.objectives || []).map(o => o.text)]
        .some(text => typeof text === "string" && phrase(text).includes(instance)))
        .filter(q => Number.isSafeInteger(q.id) && q.id > 0 && /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’.,:!?()-]{0,149}$/u.test(q.title)).slice(0, 4);
      if (quests.length) answer.push(`**From your saved quest log · ${source.updatedAt} (not live)**\n${quests.map(q => `- ${q.title} (quest #${q.id})`).join("\n")}\nPossible matches by instance name only; not proof of access, requirements or quests to pick up.`);
      // Observations made on another build of the same patch still apply (build-compat.cjs); the text
      // names the build they were made on.
      const observed = encounters();
      const evidenceBuild = buildCompat.usable(observed?.build, profile.clientBuild) ? observed.build : profile.clientBuild;
      const evidence = ENCOUNTER_MAPS.has(id) ? encounterEvidence(observed, id, evidenceBuild) : null;
      if (!evidence) answer.push("No verified Forever encounter observations match this instance and saved build.");
      else answer.push(encounterText(evidence));
    }
  }
  return answer.join("\n\n");
}

module.exports = { dungeonQuestion, dungeonAnswer, dungeonFactsQuestion, dungeonFactsAnswer };
