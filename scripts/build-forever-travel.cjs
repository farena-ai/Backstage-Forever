"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { createHash } = require("node:crypto"),
  { isDeepStrictEqual } = require("node:util");
const {
  COMMIT,
  BUILD,
  INPUTS,
  SOURCES,
} = require("../src/core/travel-sources.cjs");
const {
  PACK_BYTES,
  INPUT_BYTES,
  TOTAL_BYTES,
  compileTravelReference,
  loadTravelReference,
} = require("../src/core/travel-data.cjs");
const dir = path.join(__dirname, "../data/forever-travel");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ATTRIBUTION =
  "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const LOCK = {
  schemaVersion: 1,
  product: "wowf",
  build: BUILD,
  commit: COMMIT,
  attribution: ATTRIBUTION,
  license:
    "CC BY 4.0 for compilation and observations; Blizzard rights excluded",
  files: Object.fromEntries(INPUTS.map(({ name, ...s }) => [name, s])),
  guides: SOURCES.filter((s) => s.id !== "E1"),
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
    throw Error("Travel immutable source lock/provenance mismatch.");
}
function compile(sourceDir, lock = LOCK) {
  validateLock(lock);
  const inputs = {};
  let total = 0;
  for (const s of INPUTS) {
    const file = path.join(sourceDir, s.name),
      size = fs.statSync(file).size;
    if (size > INPUT_BYTES || (total += size) > TOTAL_BYTES || size !== s.bytes)
      throw Error("Travel source bytes mismatch: " + s.name);
    inputs[s.name] = fs.readFileSync(file);
  }
  const pack = compileTravelReference(inputs);
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
/** Entirely offline; uses only shipped resources and the immutable code descriptor. */
function checkBundle() {
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "source-lock.json")));
  validateLock(lock);
  const file = path.join(dir, "pack.json");
  if (fs.statSync(file).size > PACK_BYTES)
    throw Error("Travel pack byte limit.");
  const bytes = fs.readFileSync(file);
  if (
    !isDeepStrictEqual(lock.compiled, {
      bytes: bytes.length,
      sha256: hash(bytes),
    })
  )
    throw Error("Travel compiled checksum mismatch.");
  const pack = loadTravelReference(bytes);
  if (
    pack.nodes.length !== 17 ||
    pack.edges.length !== 16 ||
    pack.negatives.length !== 1 ||
    pack.itineraries.length !== 1 ||
    pack.sources.length !== 4
  )
    throw Error("Travel pinned coverage mismatch.");
  const license = fs.readFileSync(path.join(dir, "LICENSE-CC-BY-4.0.txt"));
  if (
    license.length !== 18659 ||
    hash(license) !==
      "5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0"
  )
    throw Error("Travel license mismatch.");
  const notice = fs.readFileSync(path.join(dir, "NOTICE"), "utf8");
  if (
    !notice.includes(ATTRIBUTION) ||
    !notice.includes(COMMIT) ||
    !notice.includes("original factual curation")
  )
    throw Error("Travel attribution notice missing.");
  return true;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--check") {
    checkBundle();
    console.log("Offline travel bundle/provenance/license check passed.");
  } else if (
    (args.length === 2 || args.length === 3) &&
    args[0] === "--source-dir" &&
    args[1] &&
    !args[1].startsWith("--") &&
    (args.length === 2 || args[2] === "--check")
  ) {
    const result = compile(path.resolve(args[1]));
    if (args[2] === "--check") {
      for (const [key, name] of [
        ["pack", "pack.json"],
        ["lock", "source-lock.json"],
      ])
        if (result[key] !== fs.readFileSync(path.join(dir, name), "utf8"))
          throw Error("Travel reproduction differs from shipped " + name);
      checkBundle();
      console.log(
        "Travel original-byte reproduction and offline check passed.",
      );
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "pack.json"), result.pack);
      fs.writeFileSync(path.join(dir, "source-lock.json"), result.lock);
      console.log("Compiled bounded offline travel reference.");
    }
  } else
    throw Error(
      "Invalid travel compiler arguments. Usage: --check | --source-dir DIRECTORY [--check]",
    );
}
module.exports = { compile, checkBundle };
