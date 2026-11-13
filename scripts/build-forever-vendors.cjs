"use strict";
const fs = require("node:fs"), path = require("node:path"), { isDeepStrictEqual } = require("node:util");
const { hash, ATTRIBUTION } = require("../src/core/knowledge.cjs");
const { FILES, MAX_BYTES, RAW_MAX_BYTES, RAW_BUILD_TOTAL, MAX_BUILDS, normalizeVendors, mergeVendorPacks, validateVendorPack } = require("../src/core/vendor-facts.cjs");
const dir = path.join(__dirname, "../data/forever-vendors");
// Pinned merged coverage of the bundled builds (vendors, listings, sellers with an observed
// nonhostile reaction per faction, and sellers whose merchant window offered repairs).
const COVERAGE = Object.freeze({ vendors: 291, listings: 4322, alliance: 62, horde: 229, repairs: 85 });
const BUILD_RE = /^1\.60\.1\.\d{1,8}$/;
const readLock = () => JSON.parse(fs.readFileSync(path.join(dir, "source-lock.json"), "utf8"));
const url = (commit, build, name) => `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${commit}/data/wowf/${build}/${name}`;
function checkLockShape(lock) {
  if (lock.product !== "wowf" || lock.license !== "CC BY 4.0" || lock.attribution !== ATTRIBUTION || !/^[a-f0-9]{40}$/.test(lock.commit) || !Array.isArray(lock.builds) || !lock.builds.length || lock.builds.length > MAX_BUILDS || lock.builds[0]?.build !== lock.build || new Set(lock.builds.map(b => b.build)).size !== lock.builds.length || lock.builds.some(b => !BUILD_RE.test(b.build) || !b.files || !isDeepStrictEqual(Object.keys(b.files).sort(), [...FILES].sort()))) throw Error("Invalid historical seller source lock.");
}
/**
 * Locked multi-build compile. sourceDir holds one subdirectory per build
 * (sourceDir/<build>/<file>); lock.builds lists them newest-first with exact byte sizes,
 * SHA256 hashes and metadata. Each build is normalized separately, then merged.
 */
function compile(sourceDir, lock = readLock()) {
  if (!sourceDir) throw Error("Provide the directory containing one subdirectory of three locked datasets per build.");
  checkLockShape(lock);
  const packs = lock.builds.map(({ build, files }) => {
    const inputs = {}; let total = 0;
    for (const name of FILES) {
      const file = path.join(sourceDir, build, name), expected = files[name], size = fs.statSync(file).size;
      if (size > RAW_MAX_BYTES || (total += size) > RAW_BUILD_TOTAL) throw Error(`Historical seller source exceeds bounded size limit: ${build}/${name}`);
      if (size !== expected.bytes) throw Error(`Source hash mismatch: ${build}/${name}`);
      const bytes = fs.readFileSync(file);
      if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw Error(`Source hash mismatch: ${build}/${name}`);
      if (!isDeepStrictEqual(JSON.parse(bytes).meta, expected.meta)) throw Error(`Source metadata mismatch: ${build}/${name}`);
      inputs[name] = bytes;
    }
    return normalizeVendors(inputs, { commit: lock.commit, build });
  });
  const pack = JSON.stringify(mergeVendorPacks(packs)) + "\n";
  if (Buffer.byteLength(pack) > MAX_BYTES) throw Error("Compiled historical seller pack exceeds 1 MiB.");
  return { pack, lock: JSON.stringify({ ...lock, compiled: { bytes: Buffer.byteLength(pack), sha256: hash(pack) } }, null, 2) + "\n" };
}
const nonhostile = (v, faction) => Boolean(v.observedReactionsByFaction[faction]?.length && v.observedReactionsByFaction[faction].every(n => n >= 4 && n <= 8));
function coverage(pack) {
  return { vendors: pack.counts.vendors, listings: pack.counts.listings, alliance: pack.vendors.filter(v => nonhostile(v, "Alliance")).length, horde: pack.vendors.filter(v => nonhostile(v, "Horde")).length, repairs: pack.vendors.filter(v => v.repairs).length };
}
/** Offline release gate checks bundled bytes/provenance/coverage; raw-input reproduction is separate. */
function checkBundle() {
  const lock = readLock(), file = path.join(dir, "pack.json"), bytes = fs.readFileSync(file);
  if (bytes.length > MAX_BYTES || lock.compiled?.bytes !== bytes.length || lock.compiled.sha256 !== hash(bytes)) throw Error("Historical seller bundle checksum mismatch.");
  const pack = validateVendorPack(JSON.parse(bytes));
  checkLockShape(lock);
  if (lock.commit !== pack.sourceCommit || lock.build !== pack.build || !isDeepStrictEqual(lock.builds.map(b => b.build), pack.builds) || lock.product !== pack.product || lock.license !== pack.license) throw Error("Historical seller bundle provenance mismatch.");
  for (const { build, files } of lock.builds) {
    let total = 0;
    for (const name of FILES) {
      const f = files[name], meta = f.meta;
      if (!Number.isSafeInteger(f.bytes) || f.bytes < 1 || f.bytes > RAW_MAX_BYTES || (total += f.bytes) > RAW_BUILD_TOTAL || !/^[a-f0-9]{64}$/.test(f.sha256) || f.url !== url(lock.commit, build, name) || meta.product !== pack.product || meta.clientBuild !== build || meta.dataset !== name.split(".")[0] || meta.schemaVersion !== 1 || meta.license !== pack.license || meta.attribution !== ATTRIBUTION) throw Error("Historical seller source provenance mismatch.");
    }
  }
  if (!isDeepStrictEqual(coverage(pack), { ...COVERAGE })) throw Error("Historical seller pinned coverage mismatch.");
  const notice = fs.readFileSync(path.join(dir, "NOTICE"), "utf8");
  if (fs.readFileSync(path.join(dir, "LICENSE"), "utf8").includes("Creative Commons") === false || ![lock.commit, ATTRIBUTION, ...pack.builds].every(t => notice.includes(t))) throw Error("Historical seller attribution missing.");
  return true;
}
if (require.main === module) {
  const args = process.argv.slice(2), i = args.indexOf("--source-dir");
  if (i < 0 && args.includes("--check")) { checkBundle(); console.log(`Offline historical seller bundle/provenance check passed (${COVERAGE.vendors} sellers, ${COVERAGE.listings} listings, ${COVERAGE.alliance} Alliance / ${COVERAGE.horde} Horde nonhostile, ${COVERAGE.repairs} repair).`); }
  else {
    if (i < 0 || !args[i + 1]) throw Error("Usage: node scripts/build-forever-vendors.cjs --check | --source-dir DIRECTORY [--check]");
    const result = compile(path.resolve(args[i + 1]));
    if (args.includes("--check")) {
      if (result.pack !== fs.readFileSync(path.join(dir, "pack.json"), "utf8") || result.lock !== fs.readFileSync(path.join(dir, "source-lock.json"), "utf8")) throw Error("Compiled historical sellers differ from bundle.");
      checkBundle(); console.log("Locked multi-build historical seller reproduction passed.");
    } else { fs.writeFileSync(path.join(dir, "pack.json"), result.pack); fs.writeFileSync(path.join(dir, "source-lock.json"), result.lock); console.log("Compiled locked historical seller catalog:", JSON.stringify(coverage(JSON.parse(result.pack)))); }
  }
}
module.exports = { compile, checkBundle, coverage, COVERAGE };
