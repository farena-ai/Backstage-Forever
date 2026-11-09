"use strict";
// Offline build tool only. Runtime community refresh must never emit or evaluate Lua.
const fs = require("node:fs");
const path = require("node:path");
const { validatePack } = require("../src/core/knowledge.cjs");
const root = path.join(__dirname, "..");
const MAX_BYTES = 1024 * 1024;

// Three-digit decimal escapes are compatible with Lua 5.1 and cannot absorb a
// following digit. Encode bytes so even embedded UTF-8 round-trips exactly.
function luaString(value) {
  if (typeof value !== "string") throw new TypeError("Expected a literal string.");
  return '"' + [...Buffer.from(value, "utf8")].map(byte =>
    byte >= 32 && byte <= 126 && byte !== 34 && byte !== 92
      ? String.fromCharCode(byte) : "\\" + String(byte).padStart(3, "0")
  ).join("") + '"';
}
function literal(value) {
  if (typeof value === "string") return luaString(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return "{" + value.map(literal).join(",") + "}";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key =>
    "[" + luaString(key) + "]=" + literal(value[key])
  ).join(",") + "}";
  throw new TypeError("Unsupported reference literal.");
}
function compile(input) {
  const pack = validatePack(input);
  const coordinates = p => ({ mapId: p.mapId, x: p.x, y: p.y });
  const npcPoint = (rows, evidence) => {
    for (const row of rows) {
      const npc = pack.npcs[`${row.kind}:${row.id}`];
      if (npc.positions[0]) return {
        ...coordinates(npc.positions[0]), name: npc.name, kind: npc.kind, evidence, approximate: true,
      };
    }
    return null;
  };
  const metadata = {
    schemaVersion: 1, build: pack.build, locale: pack.locale,
    sourceCommit: pack.sourceCommit, license: pack.license,
    attribution: pack.attribution, observedThrough: pack.observedThrough,
  };
  const lines = [
    "-- Generated offline by scripts/build-addon-reference.cjs; do not edit.",
    "-- Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.",
    "-- License: https://creativecommons.org/licenses/by/4.0/",
    `-- Source commit: ${pack.sourceCommit}; build ${pack.build}; locale ${pack.locale}.`,
    `-- Source: https://github.com/JIVESCORP/eg-link-output-wowf/tree/${pack.sourceCommit}`,
    "-- Changes: bounded titles and phase-specific first-position facts; narratives/rewards omitted.",
    "-- Positions are approximate player observation spots; NPC mentions do not establish quest roles.",
    "-- World of Warcraft and related content copyright Blizzard Entertainment, Inc.",
    "-- Not affiliated with or endorsed by Blizzard Entertainment. Build tool code: MIT.",
    "BackstageForeverReference=" + literal(metadata).slice(0, -1) + ',["quests"]={',
  ];
  // Numeric IDs stay numeric, inside the one data-only global assignment.
  for (const q of Object.values(pack.quests).sort((a, b) => a.id - b.id)) {
    const row = { title: q.title };
    const turnIn = npcPoint(q.turnIns, "observed-turn-in-npc");
    if (turnIn) row.turnIn = turnIn;
    const objectives = q.objectiveLocations.filter(loc => loc.positions[0]).slice(0, 10).map(loc => ({
      index: loc.index, type: loc.type, required: loc.required,
      destination: { ...coordinates(loc.positions[0]), approximate: true, evidence: "observed-objective-gain" },
    }));
    if (objectives.length) row.objectives = objectives;
    if (q.mentions.length === 1 && !q.objectives.some(o => ["monster", "item", "gameObject"].includes(o.type))) {
      const mention = npcPoint(q.mentions, "mentioned-in-objective");
      if (mention) row.mention = mention;
    }
    lines.push(`[${q.id}]=${literal(row)},`);
  }
  lines.push("}}", "");
  const result = lines.join("\n");
  if (Buffer.byteLength(result) > MAX_BYTES) throw Error("Compiled addon reference exceeds 1 MiB.");
  return result;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
    throw Error("Usage: node scripts/build-addon-reference.cjs [--check]");
  const source = path.join(root, "data/forever/pack.json");
  if (fs.statSync(source).size > 12 * MAX_BYTES) throw Error("Reference source exceeds its bound.");
  const result = compile(JSON.parse(fs.readFileSync(source, "utf8")));
  const destination = path.join(root, "addon/BackstageForever/BackstageForeverReference.lua");
  if (args.includes("--check")) {
    if (fs.readFileSync(destination, "utf8") !== result) throw Error("Compiled addon reference differs from the bundle.");
    console.log("Offline addon reference reproduction passed.");
  } else {
    fs.writeFileSync(destination, result, "utf8");
    console.log(`Compiled offline addon reference (${Buffer.byteLength(result)} bytes).`);
  }
}
module.exports = { compile, luaString, MAX_BYTES };
