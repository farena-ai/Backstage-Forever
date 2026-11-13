"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { isDeepStrictEqual } = require("node:util"),
  { createHash } = require("node:crypto");
const {
  COMMIT,
  BUILD,
  BUILDS,
  SOURCES,
} = require("../src/core/insights-sources.cjs");
const {
  INPUT_BYTES,
  TOTAL_BYTES,
  PACK_BYTES,
  normalizeInsights,
  mergeInsights,
  validateInsights,
} = require("../src/core/insights-data.cjs");
const dir = path.join(__dirname, "../data/forever-insights"),
  hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ATTRIBUTION =
  "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const LOCK = {
  schemaVersion: 1,
  product: "wowf",
  build: BUILD,
  builds: BUILDS,
  commit: COMMIT,
  license: "CC BY 4.0",
  attribution: ATTRIBUTION,
  // Newest build first; seven files per build.
  files: SOURCES,
};
const LICENSE = {
  bytes: 18659,
  sha256: "5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0",
};
// Pinned merged coverage of the bundled builds.
const COVERAGE = {
  quests: 4916,
  sharing: 4847,
  durations: 37,
  startItems: 1189,
  dropLists: 186,
  trainers: 113,
  services: 5552,
  uniqueSpells: 1427,
  items: 6670,
};
function validateLock(lock) {
  if (
    !lock ||
    !isDeepStrictEqual(
      Object.fromEntries(
        Object.entries(lock).filter(([k]) => k !== "compiled"),
      ),
      JSON.parse(JSON.stringify(LOCK)),
    )
  )
    throw Error("Insights immutable source lock/provenance mismatch.");
}
/** sourceDir holds one subdirectory per pinned build: sourceDir/<build>/<file>. */
function compile(sourceDir, lock = LOCK) {
  validateLock(lock);
  const all = BUILDS.map((build) => {
    const inputs = {};
    let total = 0;
    for (const s of SOURCES.filter((s) => s.build === build)) {
      const file = path.join(sourceDir, build, s.name),
        size = fs.statSync(file).size;
      if (size > INPUT_BYTES || (total += size) > TOTAL_BYTES)
        throw Error("Insights source exceeds bounded bytes.");
      if (size !== s.bytes)
        throw Error(`Insights source bytes/hash mismatch: ${build}/${s.name}`);
      const bytes = fs.readFileSync(file);
      if (bytes.length !== s.bytes || hash(bytes) !== s.sha256)
        throw Error(`Insights source hash mismatch: ${build}/${s.name}`);
      if (!isDeepStrictEqual(JSON.parse(bytes).meta, s.meta))
        throw Error(`Insights source metadata mismatch: ${build}/${s.name}`);
      inputs[s.name] = bytes;
    }
    return { build, inputs };
  });
  const details = all.map(
    ({ inputs }) => JSON.parse(inputs["creature_details.enUS.json"]).creatures,
  );
  const packs = all.map(({ build, inputs }, i) => {
    // Other pinned builds' creature records, newest first, for exact-ID title joins.
    const fallbackDetails = {};
    details.forEach((d, j) => {
      if (j !== i)
        for (const [id, row] of Object.entries(d))
          if (!Object.hasOwn(fallbackDetails, id)) fallbackDetails[id] = row;
    });
    return normalizeInsights(inputs, { commit: COMMIT, build, fallbackDetails });
  });
  const pack = JSON.stringify(mergeInsights(packs, { pinned: true })) + "\n";
  if (Buffer.byteLength(pack) > PACK_BYTES)
    throw Error("Compiled insights exceeds size limit.");
  return {
    pack,
    lock:
      JSON.stringify(
        {
          ...LOCK,
          compiled: { bytes: Buffer.byteLength(pack), sha256: hash(pack) },
        },
        null,
        2,
      ) + "\n",
  };
}
/** Release check is entirely offline; ignored source downloads are not a dependency. */
function checkBundle() {
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "source-lock.json")));
  validateLock(lock);
  const file = path.join(dir, "pack.json");
  if (fs.statSync(file).size > PACK_BYTES)
    throw Error("Insights bundle size limit.");
  const bytes = fs.readFileSync(file);
  if (
    bytes.length > PACK_BYTES ||
    !lock.compiled ||
    Object.keys(lock.compiled).sort().join(",") !== "bytes,sha256" ||
    lock.compiled.bytes !== bytes.length ||
    lock.compiled.sha256 !== hash(bytes)
  )
    throw Error("Insights compiled checksum mismatch.");
  const p = validateInsights(JSON.parse(bytes));
  if (
    !isDeepStrictEqual(p.builds, BUILDS) ||
    !isDeepStrictEqual(p.sources, JSON.parse(JSON.stringify(SOURCES)))
  )
    throw Error("Insights bundled build provenance mismatch.");
  if (!isDeepStrictEqual(p.coverage, COVERAGE))
    throw Error("Insights pinned coverage mismatch.");
  const license = fs.readFileSync(path.join(dir, "LICENSE"));
  if (license.length !== LICENSE.bytes || hash(license) !== LICENSE.sha256)
    throw Error("Insights license checksum mismatch.");
  const notice = fs.readFileSync(path.join(dir, "NOTICE"), "utf8");
  if (
    !notice.includes(COMMIT) ||
    BUILDS.some((b) => !notice.includes(b)) ||
    !notice.includes(ATTRIBUTION) ||
    !notice.includes("normalization")
  )
    throw Error("Insights attribution/normalization notice missing.");
  return true;
}
if (require.main === module) {
  const args = process.argv.slice(2),
    i = args.indexOf("--source-dir");
  if (
    args.some(
      (a, index) =>
        a !== "--check" && a !== "--source-dir" && !(i >= 0 && index === i + 1),
    )
  )
    throw Error("Invalid insights compiler arguments.");
  if (i < 0 && args.includes("--check")) {
    checkBundle();
    console.log(
      "Offline multi-build insights bundle/provenance/coverage check passed.",
    );
  } else {
    if (i < 0 || !args[i + 1])
      throw Error(
        "Usage: node scripts/build-forever-insights.cjs --check | --source-dir DIRECTORY [--check]",
      );
    const result = compile(path.resolve(args[i + 1]));
    if (args.includes("--check")) {
      if (
        result.pack !== fs.readFileSync(path.join(dir, "pack.json"), "utf8") ||
        result.lock !==
          fs.readFileSync(path.join(dir, "source-lock.json"), "utf8")
      )
        throw Error("Insights reproduction differs from bundled bytes.");
      checkBundle();
      console.log(
        "Locked multi-build insights original-byte reproduction passed.",
      );
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "pack.json"), result.pack);
      fs.writeFileSync(path.join(dir, "source-lock.json"), result.lock);
      console.log("Compiled locked multi-build insights.");
    }
  }
}
module.exports = { compile, checkBundle, COVERAGE };
