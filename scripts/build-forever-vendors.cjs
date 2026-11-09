"use strict";
const fs = require("node:fs"), path = require("node:path"), { isDeepStrictEqual } = require("node:util");
const { hash, ATTRIBUTION } = require("../src/core/knowledge.cjs");
const { FILES, MAX_BYTES, normalizeVendors, validateVendorPack } = require("../src/core/vendor-facts.cjs");
const dir = path.join(__dirname, "../data/forever-vendors");
const readLock = () => JSON.parse(fs.readFileSync(path.join(dir, "source-lock.json"), "utf8"));
function compile(sourceDir, lock = readLock()) {
  if (!sourceDir || lock.product !== "wowf" || lock.license !== "CC BY 4.0" || !isDeepStrictEqual(Object.keys(lock.files).sort(), [...FILES].sort())) throw Error("Invalid historical seller source lock.");
  const inputs = {}; let total = 0;
  for (const name of FILES) {
    const file = path.join(sourceDir, name), expected = lock.files[name], size = fs.statSync(file).size;
    if (size > MAX_BYTES || (total += size) > 3 * MAX_BYTES) throw Error(`Historical seller source exceeds bounded size limit: ${name}`);
    if (size !== expected.bytes) throw Error(`Source hash mismatch: ${name}`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw Error(`Source hash mismatch: ${name}`);
    if (!isDeepStrictEqual(JSON.parse(bytes).meta, expected.meta)) throw Error(`Source metadata mismatch: ${name}`);
    inputs[name] = bytes;
  }
  const pack = JSON.stringify(normalizeVendors(inputs, { commit: lock.commit, build: lock.build })) + "\n";
  if (Buffer.byteLength(pack) > MAX_BYTES) throw Error("Compiled historical seller pack exceeds 1 MiB.");
  return { pack, lock: JSON.stringify({ ...lock, compiled: { bytes: Buffer.byteLength(pack), sha256: hash(pack) } }, null, 2) + "\n" };
}
/** Offline release gate checks bundled bytes/provenance; raw-input reproduction is separate. */
function checkBundle() {
  const lock = readLock(), file = path.join(dir, "pack.json"), bytes = fs.readFileSync(file);
  if (bytes.length > MAX_BYTES || lock.compiled?.bytes !== bytes.length || lock.compiled.sha256 !== hash(bytes)) throw Error("Historical seller bundle checksum mismatch.");
  const pack = validateVendorPack(JSON.parse(bytes));
  if (lock.commit !== pack.sourceCommit || lock.build !== pack.build || lock.product !== pack.product || lock.license !== pack.license || lock.attribution !== ATTRIBUTION || !isDeepStrictEqual(Object.keys(lock.files).sort(), [...FILES].sort())) throw Error("Historical seller bundle provenance mismatch.");
  let total = 0;
  for (const name of FILES) {
    const f = lock.files[name], meta = f.meta;
    const url = `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${lock.commit}/data/wowf/${lock.build}/${name}`;
    if (!Number.isSafeInteger(f.bytes) || f.bytes < 1 || f.bytes > MAX_BYTES || (total += f.bytes) > 3 * MAX_BYTES || !/^[a-f0-9]{64}$/.test(f.sha256) || f.url !== url || meta.product !== pack.product || meta.clientBuild !== pack.build || meta.dataset !== name.split(".")[0] || meta.schemaVersion !== 1 || meta.license !== pack.license || meta.attribution !== ATTRIBUTION) throw Error("Historical seller source provenance mismatch.");
  }
  if (fs.readFileSync(path.join(dir, "LICENSE"), "utf8").includes("Creative Commons") === false || !fs.readFileSync(path.join(dir, "NOTICE"), "utf8").includes(lock.commit)) throw Error("Historical seller attribution missing.");
  return true;
}
if (require.main === module) {
  const args = process.argv.slice(2), i = args.indexOf("--source-dir");
  if (i < 0 && args.includes("--check")) { checkBundle(); console.log("Offline historical seller bundle/provenance check passed."); }
  else {
    if (i < 0 || !args[i + 1]) throw Error("Usage: node scripts/build-forever-vendors.cjs --check | --source-dir DIRECTORY [--check]");
    const result = compile(path.resolve(args[i + 1]));
    if (args.includes("--check")) {
      if (result.pack !== fs.readFileSync(path.join(dir, "pack.json"), "utf8") || result.lock !== fs.readFileSync(path.join(dir, "source-lock.json"), "utf8")) throw Error("Compiled historical sellers differ from bundle.");
      checkBundle(); console.log("Locked three-file historical seller reproduction passed.");
    } else { fs.writeFileSync(path.join(dir, "pack.json"), result.pack); fs.writeFileSync(path.join(dir, "source-lock.json"), result.lock); console.log("Compiled locked historical seller catalog."); }
  }
}
module.exports = { compile, checkBundle };
