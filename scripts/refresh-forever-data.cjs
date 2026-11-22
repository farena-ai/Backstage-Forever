"use strict";
// One command to move the bundled quest reference to a newer upstream snapshot (roadmap D7).
//
//   node scripts/refresh-forever-data.cjs --commit <40-hex> [--add-build 1.60.1.71037 ...] [--dir work/forever-sources]
//
// It downloads the pinned commit's files for every build in data/forever/source-lock.json plus any
// --add-build (newest first), writes them under <dir>/<commit>/<build>/, records exact byte sizes and
// SHA-256 hashes, and compiles the pack through the same locked compiler the checks use. Nothing is
// fetched at app runtime; this is an authoring tool. Review the diff, then run the generators
// (build:addon-reference, build:addon-advisor, build:find-index, build:guided-route) and the tests.
const fs = require("node:fs"),
  path = require("node:path"),
  https = require("node:https");
const { FILES, OPTIONAL_FILES, BUILD, hash } = require("../src/core/knowledge.cjs");
const { compile } = require("./build-forever-data.cjs");
const root = path.join(__dirname, "..");
const REPO = "JIVESCORP/eg-link-output-wowf";
const EXTRA = ["creature_details.enUS.json", "npcs.json", "loot.json", "object_details.enUS.json", "creatures.json", "flights.json", "trainers.json", "quest_scan.json", "texts.enUS.json", "encounters.json", "hunter_pets.json", "quest_prerequisites.json"];
const LICENSE_URL = (commit) => `https://raw.githubusercontent.com/${REPO}/${commit}/LICENSE`;

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
  const commit = value("--commit");
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
      let bytes = fs.existsSync(file) ? fs.readFileSync(file) : await get(url);
      if (!bytes) {
        if (OPTIONAL_FILES.includes(name)) continue;
        throw Error(`Upstream has no ${build}/${name} at ${commit}.`);
      }
      fs.writeFileSync(file, bytes);
      files[name] = { sha256: hash(bytes), bytes: bytes.length, url };
    }
    // Files the other compilers read (loot, creatures, flights, insights). Stored beside the quest files; each compiler keeps its own lock.
    for (const name of EXTRA) {
      const file = path.join(dir, build, name);
      if (fs.existsSync(file)) continue;
      const bytes = await get(`https://raw.githubusercontent.com/${REPO}/${commit}/data/wowf/${build}/${name}`);
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
  console.log("Then run: npm run build:addon-travel");
}

main().catch((error) => { console.error(error.message); process.exit(1); });
