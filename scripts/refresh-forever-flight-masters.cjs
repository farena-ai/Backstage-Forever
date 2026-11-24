"use strict";
// Authoring helper for the data refresh (roadmap D7): rewrites the pinned sources and the
// flight master table in src/core/flight-masters.cjs from fetched flights.json files.
//   node scripts/refresh-forever-flight-masters.cjs <sources dir>/<commit> <commit>
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const { latinName } = require("../src/core/latin-name.cjs");
const [dir, commit] = process.argv.slice(2);
if (!dir || !/^[a-f0-9]{40}$/.test(commit || "")) throw Error("Usage: <sources dir>/<commit> <commit>");
const file = path.join(__dirname, "../src/core/flight-masters.cjs");
let text = fs.readFileSync(file, "utf8");
const nl = text.includes("\r\n") ? "\r\n" : "\n";
const builds = fs.readdirSync(dir).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d) && fs.existsSync(path.join(dir, d, "flights.json")))
  .sort((a, b) => Number(b.split(".").pop()) - Number(a.split(".").pop()));
const masters = {}, rows = [];
for (const build of builds) {
  const bytes = fs.readFileSync(path.join(dir, build, "flights.json")), data = JSON.parse(bytes), m = data.meta;
  rows.push(`  source(${JSON.stringify(build)}, ${bytes.length}, ${JSON.stringify(createHash("sha256").update(bytes).digest("hex"))}, meta(${JSON.stringify(build)}, ${JSON.stringify(m.collectedOn.first)}, ${JSON.stringify(m.collectedOn.last)}, ${m.sources})),`);
  for (const [id, v] of Object.entries(data.masters || {})) {
    // Names come in the contributor's language: an English name wins over one in another script.
    if (masters[id] && (masters[id][1] !== v.node || (masters[id][0] !== v.name && latinName(masters[id][0]) && latinName(v.name)))) throw Error(`Builds disagree on flight master ${id}.`);
    if (!masters[id] || (!latinName(masters[id][0]) && latinName(v.name))) masters[id] = [v.name, v.node];
  }
}
const replace = (start, end, body) => {
  const i = text.indexOf(start), j = text.indexOf(end, i);
  if (i < 0 || j < 0) throw Error(`Marker not found: ${start}`);
  text = text.slice(0, i + start.length) + nl + body + nl + text.slice(j);
};
text = text.replace(/const COMMIT = "[a-f0-9]{40}";/, `const COMMIT = ${JSON.stringify(commit)};`);
replace("const SOURCES = Object.freeze([", "]);", rows.join(nl));
replace("const MASTERS = Object.freeze({", "});", Object.keys(masters).map(Number).sort((a, b) => a - b).map((id) => `  ${id}: [${JSON.stringify(masters[id][0])}, ${masters[id][1]}],`).join(nl));
fs.writeFileSync(file, text);
console.log(`${builds.length} builds, ${Object.keys(masters).length} flight masters`);
