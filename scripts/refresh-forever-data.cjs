"use strict";
// One command to move the bundled quest reference to a newer upstream snapshot (roadmap D7).
//
//   node scripts/refresh-forever-data.cjs --commit <40-hex> [--add-build 1.60.1.71037 ...] [--dir work/forever-sources] [--offline]
//
// It downloads the pinned commit's files for every build in data/forever/source-lock.json plus any
// --add-build (newest first), writes them under <dir>/<commit>/<build>/, records exact byte sizes and
// SHA-256 hashes, and compiles the pack through the same locked compiler the checks use. Nothing is
// fetched at app runtime; this is an authoring tool.
//
// After the quest pack it rebuilds every other pack that has a compiler (sellers, flight graph, trainer
// costs, field notes, creatures, NPC positions, quest loot, boss loot, world finds), then the addon data
// files, and finally runs every check:* script and says which ones need a pinned number updated.
// --offline never downloads: every file must already be under <dir>/<commit>/ (a missing optional file is
// skipped, a missing required one stops the run). Packs written by hand or reviewed by a person are not
// rebuilt; the run lists them with the reason. Review the diff and run npm test before committing.
const fs = require("node:fs"),
  path = require("node:path"),
  https = require("node:https");
const { FILES, OPTIONAL_FILES, BUILD, hash } = require("../src/core/knowledge.cjs");
const { compile } = require("./build-forever-data.cjs");
const root = path.join(__dirname, "..");
const { spawnSync } = require("node:child_process");
const REPO = "JIVESCORP/eg-link-output-wowf";
const EXTRA = ["creature_details.enUS.json", "npcs.json", "loot.json", "object_details.enUS.json", "creatures.json", "flights.json", "trainers.json", "quest_scan.json", "texts.enUS.json", "encounters.json", "hunter_pets.json", "quest_prerequisites.json"];

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "backstage-forever-data-refresh" } }, (res) => {
        if (res.statusCode === 404) { res.resume(); return resolve(null); }
        if (res.statusCode !== 200) { res.resume(); return reject(Error(`HTTP ${res.statusCode} for ${url}`)); }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const commit = value("--commit"), offline = args.includes("--offline");
  // Offline: what is not in the folder does not exist.
  const fetch = offline ? async () => null : get;
  if (!/^[a-f0-9]{40}$/.test(commit || "")) throw Error("Usage: --commit <40-hex upstream commit> [--add-build BUILD ...] [--dir DIRECTORY]");
  const added = args.flatMap((a, i) => (a === "--add-build" ? [args[i + 1]] : []));
  if (added.some((b) => !BUILD.test(b || ""))) throw Error("Each --add-build needs a build like 1.60.1.71037.");
  const lockPath = path.join(root, "data", "forever", "source-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const number = (b) => Number(b.split(".").pop());
  const builds = [...new Set([...added, ...lock.builds.map((b) => b.build)])].sort((a, b) => number(b) - number(a));
  const dir = path.resolve(value("--dir") || path.join(root, "work", "forever-sources"), commit);
  const next = { ...lock, commit, build: builds[0], builds: [] };
  for (const build of builds) {
    const files = {};
    fs.mkdirSync(path.join(dir, build), { recursive: true });
    for (const name of [...FILES, ...OPTIONAL_FILES]) {
      const file = path.join(dir, build, name);
      const url = `https://raw.githubusercontent.com/${REPO}/${commit}/data/wowf/${build}/${name}`;
      let bytes = fs.existsSync(file) ? fs.readFileSync(file) : await fetch(url);
      if (!bytes) {
        if (OPTIONAL_FILES.includes(name)) continue;
        throw Error(offline ? `${file} is not cached; run without --offline to download it.` : `Upstream has no ${build}/${name} at ${commit}.`);
      }
      if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
      files[name] = { sha256: hash(bytes), bytes: bytes.length, url };
    }
    // Files the other compilers read (loot, creatures, flights, insights). Stored beside the quest files; each compiler keeps its own lock.
    for (const name of EXTRA) {
      const file = path.join(dir, build, name);
      if (fs.existsSync(file)) continue;
      const bytes = await fetch(`https://raw.githubusercontent.com/${REPO}/${commit}/data/wowf/${build}/${name}`);
      if (bytes) fs.writeFileSync(file, bytes);
    }
    next.builds.push({ build, files });
    console.log(`${build}: ${Object.keys(files).length} files, ${Object.values(files).reduce((t, f) => t + f.bytes, 0)} bytes`);
  }
  const result = compile(dir, next);
  fs.writeFileSync(path.join(root, "data", "forever", "pack.json"), result.pack);
  fs.writeFileSync(lockPath, result.lock);
  console.log(`Compiled data/forever for ${builds.length} builds at ${commit}. Sources kept in ${dir}.`);
  // The seller pack keeps its own lock in the same shape; rebuild it from the same snapshot.
  const vendors = require("./build-forever-vendors.cjs");
  const vendorFiles = require("../src/core/vendor-facts.cjs").FILES;
  const vendorDir = path.join(root, "data", "forever-vendors");
  const { compiled: _compiled, ...vendorLock } = JSON.parse(fs.readFileSync(path.join(vendorDir, "source-lock.json"), "utf8"));
  const withSellers = builds.filter((build) => vendorFiles.every((name) => fs.existsSync(path.join(dir, build, name))));
  const sellers = vendors.compile(dir, {
    ...vendorLock, commit, build: withSellers[0],
    builds: withSellers.map((build) => ({
      build,
      files: Object.fromEntries(vendorFiles.map((name) => {
        const bytes = fs.readFileSync(path.join(dir, build, name));
        return [name, { url: `https://raw.githubusercontent.com/${REPO}/${commit}/data/wowf/${build}/${name}`, bytes: bytes.length, sha256: hash(bytes), meta: JSON.parse(bytes).meta }];
      })),
    })),
  });
  fs.writeFileSync(path.join(vendorDir, "pack.json"), sellers.pack);
  fs.writeFileSync(path.join(vendorDir, "source-lock.json"), sellers.lock);
  console.log(`Compiled data/forever-vendors for ${withSellers.length} builds.`);
  // The transport graph and the trainer costs lock every build that has their files, then rebuild.
  for (const script of ["./build-forever-transport.cjs", "./build-forever-trainers.cjs"]) require(script).main(["--relock", dir, "--commit", commit]);
  restOfThePacks({ dir, commit, previousCommit: lock.commit, builds });
}

// Everything after the four packs above. Each step is its own process, so a compiler always reads the
// source list the step before it has just rewritten.
function restOfThePacks({ dir, commit, previousCommit, builds }) {
  const failed = [];
  const run = (label, command, argv, { optional = false } = {}) => {
    // npm is a script on Windows and needs the shell; its arguments here are fixed script names.
    const r = command === "npm" ? spawnSync(`npm ${argv.join(" ")}`, { cwd: root, encoding: "utf8", shell: true }) : spawnSync(command, argv, { cwd: root, encoding: "utf8" });
    const ok = r.status === 0;
    const last = `${r.stdout || ""}${r.stderr || ""}`.trim().split(/\r?\n/).filter(Boolean).pop() || "";
    console.log(`${ok ? "ok  " : optional && r.error ? "skip" : "FAIL"}  ${label}${ok ? "" : `: ${r.error ? r.error.message : last}`}`);
    if (!ok) failed.push(label);
    return ok;
  };
  const node = (label, script, ...rest) => run(label, process.execPath, [path.join("scripts", script), ...rest]);
  console.log("\nOther packs:");
  node("field notes: source list", "refresh-forever-insights-sources.cjs", dir, commit);
  node("field notes: pack", "build-forever-insights.cjs", "--source-dir", dir);
  // Python is only needed for these two source lists (and the notices below).
  if (run("creatures and NPC positions: source lists", "python", [path.join("scripts", "refresh-forever-sources.py"), dir, commit], { optional: true })) {
    node("creatures: pack", "build-forever-creatures.cjs", "--source-dir", dir);
    node("NPC positions: pack", "build-forever-npc-locations.cjs", "--source-dir", dir);
  }
  node("quest loot: pack", "build-forever-loot.cjs", "--source-dir", dir, commit);
  node("boss loot: pack", "build-forever-boss-loot.cjs", "--source-dir", dir, commit);
  node("world finds: pack", "build-forever-world.cjs", "--source-dir", dir, commit);
  node("flight masters: table", "refresh-forever-flight-masters.cjs", dir, commit);
  if (previousCommit !== commit) run("notices: commit", "python", [path.join("scripts", "refresh-forever-notices.py"), commit, previousCommit, builds.join(",")], { optional: true });
  // Three compilers still carry their build list as a constant.
  for (const script of ["build-forever-loot.cjs", "build-forever-boss-loot.cjs", "build-forever-world.cjs"]) {
    const listed = /const BUILDS = (\[[^\]]*\]);/.exec(fs.readFileSync(path.join(root, "scripts", script), "utf8"));
    if (listed && JSON.stringify(JSON.parse(listed[1])) !== JSON.stringify(builds)) console.log(`edit  scripts/${script}: BUILDS does not match the refreshed builds (${builds.join(", ")}); update it and run this again.`);
  }
  console.log("\nAddon data:");
  const scripts = require("../package.json").scripts;
  for (const name of ["build:addon-reference", "build:addon-sources", "build:addon-atlas", "build:addon-advisor", "build:addon-travel", "build:addon-rares", "build:find-index", "build:guided-route"]) run(name, "npm", ["run", "--silent", name]);
  console.log("\nNot rebuilt here (say so in the release notes if they are behind):");
  for (const [pack, why] of [
    ["data/forever-travel", "a small hand-reviewed reference (boats, zeppelins, roads) pinned to exact files and published guides in src/core/travel-sources.cjs; a person has to review any change"],
    ["data/forever-encounters", "no compiler in the repo; the pack and src/core/companion-dungeon.cjs name one exact upstream file and build"],
    ["data/forever-acquisition", "seven hand-qualified relations from four files that are not part of the per-build snapshot"],
    ["data/forever-leveling, data/forever-route", "written and reviewed by hand"],
  ]) console.log(`skip  ${pack}: ${why}.`);
  console.log("\nChecks:");
  const stale = [];
  for (const name of Object.keys(scripts).filter((n) => n.startsWith("check:"))) if (!run(name, "npm", ["run", "--silent", name])) stale.push(name);
  if (stale.length) console.log(`\n${stale.length} check(s) failed. A "pinned coverage" failure after a real data change means the COVERAGE numbers in that compiler (and the counts the tests and notices quote) need updating by hand.`);
  const broken = failed.filter((f) => !f.startsWith("check:"));
  if (broken.length) { console.log(`\nSteps that did not finish: ${broken.join(", ")}.`); process.exitCode = 1; }
  else if (stale.length) process.exitCode = 1;
  else console.log("\nEvery pack with a compiler is rebuilt and every check passes. Now run npm test.");
}

main().catch((error) => { console.error(error.message); process.exit(1); });
