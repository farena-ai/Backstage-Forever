"use strict";
// Authoring helper for the data refresh (roadmap D7): rewrites src/core/insights-sources.cjs from
// files already fetched by refresh-forever-data.cjs.
//   node scripts/refresh-forever-insights-sources.cjs <sources dir>/<commit> <commit>
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const [dir, commit] = process.argv.slice(2);
if (!dir || !/^[a-f0-9]{40}$/.test(commit || "")) throw Error("Usage: <sources dir>/<commit> <commit>");
const current = require("../src/core/insights-sources.cjs");
const names = [...new Set(current.SOURCES.map((s) => s.name))];
const builds = fs.readdirSync(dir).filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d))
  .filter((b) => names.every((n) => fs.existsSync(path.join(dir, b, n))))
  .sort((a, b) => Number(b.split(".").pop()) - Number(a.split(".").pop()));
const sources = builds.flatMap((build) => names.map((name) => {
  const bytes = fs.readFileSync(path.join(dir, build, name));
  return {
    name, build, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    url: `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${commit}/data/wowf/${build}/${name}`,
    meta: JSON.parse(bytes).meta,
  };
}));
const text = `"use strict";
// Immutable public provenance, not game mechanics. Builds newest first; the first is the pack's own.
const COMMIT = ${JSON.stringify(commit)};
const BUILDS = Object.freeze(${JSON.stringify(builds)});
const BUILD = BUILDS[0];
const SOURCES = ${JSON.stringify(sources, null, 2)};
module.exports = { COMMIT, BUILD, BUILDS, SOURCES };
`;
fs.writeFileSync(path.join(__dirname, "../src/core/insights-sources.cjs"), text);
console.log(`${builds.length} builds x ${names.length} files: ${names.join(", ")}`);
