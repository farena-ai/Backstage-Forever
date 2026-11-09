"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const {
  FILES,
  normalizeData,
  validatePack,
  hash,
} = require("../src/core/knowledge.cjs");
const root = path.join(__dirname, "..");
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
      "Provide the directory containing the six locked source datasets.",
    );
  const inputs = {};
  if (lock.product !== "wowf" || lock.license !== "CC BY 4.0")
    throw Error("Invalid source lock.");
  for (const name of FILES) {
    const size = fs.statSync(path.join(sourceDir, name)).size;
    if (size > 4 * 1024 * 1024 || size !== lock.files[name].bytes)
      throw Error(`Source hash mismatch: ${name}`);
    const bytes = fs.readFileSync(path.join(sourceDir, name));
    if (
      hash(bytes) !== lock.files[name].sha256 ||
      bytes.length !== lock.files[name].bytes
    )
      throw Error(`Source hash mismatch: ${name}`);
    inputs[name] = bytes;
  }
  const pack = validatePack(
    normalizeData(inputs, { commit: lock.commit, build: lock.build }),
  );
  const coverage = {};
  for (const name of FILES) {
    const d = JSON.parse(inputs[name]);
    coverage[name] = Object.fromEntries(
      Object.entries(d)
        .filter(([k, v]) => k !== "meta" && v && typeof v === "object")
        .map(([k, v]) => [k, Object.keys(v).length]),
    );
  }
  const sourceLock = {
    ...lock,
    locale: "enUS",
    files: Object.fromEntries(
      FILES.map((name) => [
        name,
        {
          ...pack.files[name],
          meta: JSON.parse(inputs[name]).meta,
          coverage: coverage[name],
        },
      ]),
    ),
    normalization:
      "Factual IDs, names, reported next links, rewards, bounded objective evidence and public observation positions only. Narrative descriptions, personal data and undocumented prerequisites omitted. Positions are approximate player interaction spots. Sources count contributing saved files, not observation totals.",
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
    console.log("Locked six-file bundle reproduction passed.");
  } else {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pack.json"), result.pack);
    fs.writeFileSync(path.join(dir, "source-lock.json"), result.lock);
    console.log("Compiled locked live Forever factual reference pack.");
  }
}
module.exports = { compile };
