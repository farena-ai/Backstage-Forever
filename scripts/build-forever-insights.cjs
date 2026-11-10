"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { isDeepStrictEqual } = require("node:util"),
  { createHash } = require("node:crypto");
const { COMMIT, BUILD, SOURCES } = require("../src/core/insights-sources.cjs");
const {
  INPUT_BYTES,
  TOTAL_BYTES,
  PACK_BYTES,
  normalizeInsights,
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
  commit: COMMIT,
  license: "CC BY 4.0",
  attribution: ATTRIBUTION,
  files: Object.fromEntries(
    SOURCES.map(({ name, ...source }) => [name, source]),
  ),
};
const LICENSE = {
  bytes: 18659,
  sha256: "5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0",
};
function validateLock(lock) {
  if (
    !lock ||
    !isDeepStrictEqual(
      Object.fromEntries(
        Object.entries(lock).filter(([k]) => k !== "compiled"),
      ),
      LOCK,
    )
  )
    throw Error("Insights immutable source lock/provenance mismatch.");
}
function compile(sourceDir, lock = LOCK) {
  validateLock(lock);
  const inputs = {};
  let total = 0;
  for (const s of SOURCES) {
    const file = path.join(sourceDir, s.name),
      size = fs.statSync(file).size;
    if (size > INPUT_BYTES || (total += size) > TOTAL_BYTES)
      throw Error("Insights source exceeds bounded bytes.");
    if (size !== s.bytes)
      throw Error(`Insights source bytes/hash mismatch: ${s.name}`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== s.bytes || hash(bytes) !== s.sha256)
      throw Error(`Insights source hash mismatch: ${s.name}`);
    if (!isDeepStrictEqual(JSON.parse(bytes).meta, s.meta))
      throw Error(`Insights source metadata mismatch: ${s.name}`);
    inputs[s.name] = bytes;
  }
  const pack =
    JSON.stringify(
      normalizeInsights(inputs, { commit: COMMIT, build: BUILD }),
    ) + "\n";
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
  const expected = {
    quests: 3884,
    sharing: 3677,
    durations: 33,
    startItems: 928,
    dropLists: 131,
    trainers: 34,
    services: 2074,
    uniqueSpells: 1139,
    items: 5014,
  };
  if (!isDeepStrictEqual(p.coverage, expected))
    throw Error("Insights pinned coverage mismatch.");
  const license = fs.readFileSync(path.join(dir, "LICENSE"));
  if (license.length !== LICENSE.bytes || hash(license) !== LICENSE.sha256)
    throw Error("Insights license checksum mismatch.");
  const notice = fs.readFileSync(path.join(dir, "NOTICE"), "utf8");
  if (
    !notice.includes(COMMIT) ||
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
      "Offline seven-file insights bundle/provenance/coverage check passed.",
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
        "Locked seven-file insights original-byte reproduction passed.",
      );
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "pack.json"), result.pack);
      fs.writeFileSync(path.join(dir, "source-lock.json"), result.lock);
      console.log("Compiled locked seven-file offline insights.");
    }
  }
}
module.exports = { compile, checkBundle };
