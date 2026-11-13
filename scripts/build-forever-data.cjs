"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const {
  FILES,
  OPTIONAL_FILES,
  LIMIT,
  TOTAL,
  MAX_BUILDS,
  BUILD,
  normalizeData,
  rewardItemFacts,
  mergeItemFacts,
  validatePack,
  mergePacks,
  hash,
} = require("../src/core/knowledge.cjs");
const root = path.join(__dirname, "..");
const NORMALIZATION =
  "Factual IDs, names, reported next links, rewards (items with names and qualities where any pinned dataset names them, money, reputation tier and override/100 amount, XP difficulty and multiplier, reward spell IDs), bounded objective evidence and public observation positions only. Narrative descriptions, personal data and undocumented prerequisites omitted. Positions are approximate player interaction spots. Sources count contributing saved files, not observation totals. Several client builds are normalized separately and merged newest-first: givers, turn-ins, objective and NPC positions are unioned with exact dedupe and bounded caps; scalar facts come from the newest build that reports them. Vendor and tooltip-scan files are read only for reward item names and qualities, and an older build's name may fill a newer build's unnamed reward item by exact item ID.";
/**
 * Locked multi-build compile. sourceDir holds one subdirectory per build
 * (sourceDir/<build>/<file>); lock.builds lists them newest-first with exact
 * byte sizes and SHA256 hashes. The first build is the pack's own build.
 */
function compile(
  sourceDir,
  lock = JSON.parse(
    fs.readFileSync(
      path.join(root, "data", "forever", "source-lock.json"),
      "utf8",
    ),
  ),
) {
  if (!sourceDir)
    throw Error(
      "Provide the directory containing one subdirectory of six locked datasets per build.",
    );
  if (
    lock.product !== "wowf" ||
    lock.license !== "CC BY 4.0" ||
    !Array.isArray(lock.builds) ||
    !lock.builds.length ||
    lock.builds.length > MAX_BUILDS ||
    lock.builds[0].build !== lock.build ||
    new Set(lock.builds.map((b) => b.build)).size !== lock.builds.length ||
    lock.builds.some((b) => !BUILD.test(b.build))
  )
    throw Error("Invalid source lock.");
  const verified = lock.builds.map(({ build, files }) => {
    const inputs = {};
    let total = 0;
    // Optional name sources are read only when the build's lock entry lists them.
    const names = [
      ...FILES,
      ...OPTIONAL_FILES.filter((n) => files && Object.hasOwn(files, n)),
    ];
    for (const name of names) {
      const file = path.join(sourceDir, build, name),
        size = fs.statSync(file).size;
      if (
        size > LIMIT ||
        (total += size) > TOTAL ||
        size !== files?.[name]?.bytes
      )
        throw Error(`Source hash mismatch: ${build}/${name}`);
      const bytes = fs.readFileSync(file);
      if (hash(bytes) !== files[name].sha256 || bytes.length !== files[name].bytes)
        throw Error(`Source hash mismatch: ${build}/${name}`);
      inputs[name] = bytes;
    }
    return { build, inputs, names };
  });
  // Reward item names/qualities from every pinned build (newest first) so a name
  // published only by an older build still labels a newer build's reward.
  const itemFacts = { names: {}, quality: {} };
  for (const { inputs } of verified)
    mergeItemFacts(
      itemFacts,
      rewardItemFacts(
        Object.fromEntries(
          Object.entries(inputs)
            .filter(([n]) => /^(item_hotfixes|vendors|tooltip_scan)\./.test(n))
            .map(([n, bytes]) => [n.split(".")[0], JSON.parse(bytes)]),
        ),
      ),
    );
  const perBuild = verified.map(({ build, inputs, names }) => ({
    build,
    inputs,
    names,
    pack: validatePack(
      normalizeData(inputs, { commit: lock.commit, build, itemFacts }),
    ),
  }));
  const pack = mergePacks(perBuild.map((b) => b.pack));
  const coverage = (bytes) =>
    Object.fromEntries(
      Object.entries(JSON.parse(bytes))
        .filter(([k, v]) => k !== "meta" && v && typeof v === "object")
        .map(([k, v]) => [k, Object.keys(v).length]),
    );
  const { files: _legacy, ...rest } = lock;
  const sourceLock = {
    ...rest,
    locale: "enUS",
    builds: perBuild.map(({ build, inputs, names, pack: p }) => ({
      build,
      files: Object.fromEntries(
        names.map((name) => [
          name,
          {
            ...p.files[name],
            meta: JSON.parse(inputs[name]).meta,
            coverage: coverage(inputs[name]),
          },
        ]),
      ),
    })),
    normalization: NORMALIZATION,
  };
  return {
    pack: JSON.stringify(pack) + "\n",
    lock: JSON.stringify(sourceLock, null, 2) + "\n",
  };
}
if (require.main === module) {
  const args = process.argv.slice(2),
    source = args.indexOf("--source-dir");
  if (source < 0 || !args[source + 1])
    throw Error(
      "Usage: node scripts/build-forever-data.cjs --source-dir DIRECTORY [--check]",
    );
  const result = compile(path.resolve(args[source + 1])),
    dir = path.join(root, "data", "forever");
  if (args.includes("--check")) {
    if (
      fs.readFileSync(path.join(dir, "pack.json"), "utf8") !== result.pack ||
      fs.readFileSync(path.join(dir, "source-lock.json"), "utf8") !==
        result.lock
    )
      throw Error("Compiled data differs from the bundle.");
    console.log("Locked multi-build bundle reproduction passed.");
  } else {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pack.json"), result.pack);
    fs.writeFileSync(path.join(dir, "source-lock.json"), result.lock);
    console.log("Compiled locked multi-build Forever factual reference pack.");
  }
}
module.exports = { compile, NORMALIZATION };
