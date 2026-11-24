"use strict";
// Shared command line for the bundled packs whose source lock lives beside the pack
// (data/<pack>/source-lock.json): the transport graph and the trainer costs.
//   --check                         offline: bundled bytes, lock, provenance, licence, notice
//   --source-dir DIR [--check]      rebuild from the locked upstream files (DIR/<build>/<file>)
//   --relock DIR --commit SHA       authoring: lock every build found in DIR, then rebuild
// Nothing is fetched here; scripts/refresh-forever-data.cjs downloads the upstream files.
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto"), { isDeepStrictEqual } = require("node:util");
const ATTRIBUTION = "Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.";
const LICENSE = Object.freeze({ bytes: 18659, sha256: "5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0" });
const BUILD_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/, MAX_BUILDS = 16;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const url = (commit, build, name) => `https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${commit}/data/wowf/${build}/${name}`;
const number = (build) => Number(build.split(".").pop());

/**
 * spec: { name, dir, files, optional (files a build may lack), rawLimits, packLimit, compile(builds, { commit }) -> pack object,
 *         validate(pack), notice(pack, lock) -> text }
 */
function packTool(spec) {
  const { dir, files: FILES } = spec, OPTIONAL = spec.optional || [];
  const at = (name) => path.join(dir, name);
  const readLock = () => JSON.parse(fs.readFileSync(at("source-lock.json"), "utf8"));
  function checkLock(lock) {
    const bad = () => { throw Error(`Invalid ${spec.name} source lock.`); };
    if (!lock || lock.schemaVersion !== 1 || lock.product !== "wowf" || lock.license !== "CC BY 4.0" || lock.attribution !== ATTRIBUTION || !/^[a-f0-9]{40}$/.test(lock.commit || "")) bad();
    if (!Array.isArray(lock.builds) || !lock.builds.length || lock.builds.length > MAX_BUILDS || lock.builds[0].build !== lock.build || new Set(lock.builds.map((b) => b.build)).size !== lock.builds.length) bad();
    let last = Infinity;
    for (const { build, files } of lock.builds) {
      if (!BUILD_RE.test(build) || number(build) >= last || !files || !isDeepStrictEqual(Object.keys(files).filter((name) => !OPTIONAL.includes(name)).sort(), [...FILES].sort())) bad();
      last = number(build);
      for (const name of Object.keys(files)) {
        const f = files[name];
        if (!Number.isSafeInteger(f.bytes) || f.bytes < 1 || f.bytes > spec.rawLimits[name] || !/^[a-f0-9]{64}$/.test(f.sha256) || f.url !== url(lock.commit, build, name)) bad();
        if (f.meta?.product !== "wowf" || f.meta.clientBuild !== build || f.meta.dataset !== name.split(".")[0] || f.meta.license !== "CC BY 4.0" || f.meta.attribution !== ATTRIBUTION) bad();
      }
    }
    return lock;
  }
  /** Reads and verifies every locked file, then compiles. */
  function compile(sourceDir, lock = readLock()) {
    const { compiled: _old, ...source } = checkLock(lock);
    const builds = source.builds.map(({ build, files }) => {
      const inputs = {};
      for (const name of Object.keys(files)) {
        const file = path.join(sourceDir, build, name), expected = files[name];
        if (fs.statSync(file).size !== expected.bytes) throw Error(`Source size mismatch: ${build}/${name}`);
        const bytes = fs.readFileSync(file);
        if (hash(bytes) !== expected.sha256) throw Error(`Source hash mismatch: ${build}/${name}`);
        if (!isDeepStrictEqual(JSON.parse(bytes).meta, expected.meta)) throw Error(`Source metadata mismatch: ${build}/${name}`);
        inputs[name] = bytes;
      }
      return { build, files: inputs };
    });
    const object = spec.compile(builds, { commit: source.commit });
    const pack = JSON.stringify(object) + "\n";
    if (Buffer.byteLength(pack) > spec.packLimit) throw Error(`Compiled ${spec.name} pack is too large.`);
    return { pack, lock: JSON.stringify({ ...source, compiled: { bytes: Buffer.byteLength(pack), sha256: hash(pack) } }, null, 2) + "\n", notice: spec.notice(object, source) };
  }
  /** Authoring: lock every build directory under sourceDir that has all the files. */
  function relock(sourceDir, commit) {
    const builds = fs.readdirSync(sourceDir).filter((b) => BUILD_RE.test(b) && FILES.every((name) => fs.existsSync(path.join(sourceDir, b, name)))).sort((a, b) => number(b) - number(a));
    if (!builds.length) throw Error(`No build under ${sourceDir} has ${FILES.join(" and ")}.`);
    return {
      schemaVersion: 1, product: "wowf", license: "CC BY 4.0", attribution: ATTRIBUTION, commit, build: builds[0],
      builds: builds.map((build) => ({ build, files: Object.fromEntries([...FILES, ...OPTIONAL.filter((name) => fs.existsSync(path.join(sourceDir, build, name)))].map((name) => { const bytes = fs.readFileSync(path.join(sourceDir, build, name)); return [name, { url: url(commit, build, name), bytes: bytes.length, sha256: hash(bytes), meta: JSON.parse(bytes).meta }]; })) })),
    };
  }
  function write(result) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(at("pack.json"), result.pack);
    fs.writeFileSync(at("source-lock.json"), result.lock);
    fs.writeFileSync(at("NOTICE"), result.notice);
  }
  /** Offline release gate: bundled bytes, lock, provenance, licence and notice. */
  function checkBundle() {
    const lock = checkLock(readLock()), bytes = fs.readFileSync(at("pack.json"));
    if (bytes.length > spec.packLimit || lock.compiled?.bytes !== bytes.length || lock.compiled.sha256 !== hash(bytes)) throw Error(`${spec.name} bundle checksum mismatch.`);
    const pack = spec.validate(JSON.parse(bytes));
    if (pack.sourceCommit !== lock.commit || pack.build !== lock.build || !isDeepStrictEqual(pack.builds, lock.builds.map((b) => b.build))) throw Error(`${spec.name} bundle provenance mismatch.`);
    const license = fs.readFileSync(at("LICENSE"));
    if (license.length !== LICENSE.bytes || hash(license) !== LICENSE.sha256) throw Error(`${spec.name} license mismatch.`);
    const { compiled: _c, ...source } = lock;
    if (fs.readFileSync(at("NOTICE"), "utf8").replace(/\r\n/g, "\n") !== spec.notice(pack, source)) throw Error(`${spec.name} NOTICE is stale.`);
    return pack;
  }
  function main(args) {
    const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
    if (value("--relock")) {
      const commit = value("--commit");
      if (!/^[a-f0-9]{40}$/.test(commit || "")) throw Error("Usage: --relock DIRECTORY --commit <40-hex upstream commit>");
      const sourceDir = path.resolve(value("--relock"));
      write(compile(sourceDir, relock(sourceDir, commit)));
      console.log(`Locked and compiled ${spec.name}: ${spec.summary(checkBundle())}`);
    } else if (value("--source-dir")) {
      const result = compile(path.resolve(value("--source-dir")));
      if (args.includes("--check")) {
        for (const [key, name] of [["pack", "pack.json"], ["lock", "source-lock.json"], ["notice", "NOTICE"]]) if (result[key] !== fs.readFileSync(at(name), "utf8").replace(/\r\n/g, "\n")) throw Error(`${spec.name} reproduction differs from shipped ${name}.`);
        checkBundle();
        console.log(`${spec.name}: reproduced from the locked upstream files.`);
      } else { write(result); console.log(`Compiled ${spec.name}: ${spec.summary(checkBundle())}`); }
    } else if (args.length === 1 && args[0] === "--check") console.log(`${spec.name}: offline bundle, lock, licence and notice check passed (${spec.summary(checkBundle())}).`);
    else throw Error("Usage: --check | --source-dir DIRECTORY [--check] | --relock DIRECTORY --commit SHA");
  }
  return { compile, relock, checkBundle, checkLock, readLock, main };
}
module.exports = { packTool, ATTRIBUTION, LICENSE, hash };
