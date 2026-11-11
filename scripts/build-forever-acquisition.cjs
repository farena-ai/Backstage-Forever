"use strict";
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const { compileAcquisition, loadAcquisitionPack, buildAddonAcquisition } = require("../src/core/acquisition-data.cjs");
const root = fs.realpathSync(path.join(__dirname, ".."));
const directory = path.join(root, "data/forever-acquisition");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = v => JSON.stringify(v) + "\n";
const licensePin = { bytes: 18659, sha256: "5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0" };
const inputNames = ["eg-loot.json", "eg-npcs.json", "eg-creatures.json", "eg-vendors.json"];
function readBounded(file, max) {
  if (fs.statSync(file).size > max) throw Error("Acquisition source exceeds size bound.");
  const bytes = fs.readFileSync(file); if (bytes.length > max) throw Error("Acquisition source exceeds size bound."); return bytes;
}
function identity(p) {
  return Object.fromEntries(["sourceRepository", "sourceCommit", "product", "clientBuild", "license", "licenseUrl", "attribution"].map(k => [k, p[k]]));
}
function notice(p) {
  return `# Qualified historical acquisition reference\n\n${p.attribution}\n\nSource: https://github.com/${p.sourceRepository}/tree/${p.sourceCommit}\nProduct: ${p.product}; reference build: ${p.clientBuild}.\nLicense: ${p.license} (${p.licenseUrl}). Original license bytes retained in LICENSE.\n\nChanges: ${p.changes}\n\nSeven relations and seventeen approximate historical player-standing points, observed November 9, 2026. Creature contributions span November 7–9; other input contributions are November 9. Contributor and loot-window counts are observations, never spawn counts.\n\nThis grant covers Efficient Games' compilation and player observations. Blizzard Entertainment's underlying game content, code, names, textures and map assets remain excluded from that grant. No client code, artwork or map assets are redistributed here. App code remains MIT. Current availability, access and required gathering rank remain unknown.\n`;
}
function outputs(p, inputs, license) {
  const pack = Buffer.from(json(p));
  const files = Object.fromEntries(inputNames.map(name => {
    const dataset = name.slice(3, -5), bytes = inputs[name];
    return [name, { bytes: bytes.length, sha256: hash(bytes), maxBytes: dataset === "loot" ? 2097152 : 1048576,
      url: `https://raw.githubusercontent.com/${p.sourceRepository}/${p.sourceCommit}/data/${p.product}/${p.clientBuild}/${dataset}.json`, meta: JSON.parse(bytes).meta }];
  }));
  const lock = { schemaVersion: 1, ...identity(p), files, compiled: { bytes: pack.length, sha256: hash(pack) }, licenseFile: licensePin };
  return new Map([
    [path.join(directory, "pack.json"), pack],
    [path.join(directory, "source-lock.json"), Buffer.from(json(lock))],
    [path.join(directory, "LICENSE"), license],
    [path.join(directory, "NOTICE.md"), Buffer.from(notice(p))],
    [path.join(root, "addon/BackstageForever/BackstageForeverAcquisition.lua"), Buffer.from(buildAddonAcquisition(p))],
  ]);
}
function contained(target) {
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) throw Error("Acquisition output must stay in the repository.");
}
function preflight(target) {
  contained(path.resolve(target));
  // Check physical ancestors before creating directories, and never follow output symlinks.
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  contained(fs.realpathSync(ancestor) === root ? target : path.join(fs.realpathSync(ancestor), path.basename(target)));
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error("Acquisition output symlinks are unsupported.");
}
function readLicense(sourceDir) {
  const original = path.join(sourceDir, "eg-LICENSE");
  // Existing byte-verified CC BY copy; this does not become a fifth data Buffer.
  const file = fs.existsSync(original) ? original : path.join(root, "data/forever-insights/LICENSE");
  const bytes = readBounded(file, licensePin.bytes);
  if (bytes.length !== licensePin.bytes || hash(bytes) !== licensePin.sha256) throw Error("Acquisition original license mismatch.");
  return bytes;
}
function checkShipped() {
  const p = loadAcquisitionPack();
  if (!readBounded(path.join(root, "addon/BackstageForever/BackstageForeverAcquisition.lua"), 131072).equals(Buffer.from(buildAddonAcquisition(p))) || !readBounded(path.join(directory, "NOTICE.md"), 8192).equals(Buffer.from(notice(p)))) throw Error("Acquisition shipped Lua/notice parity mismatch.");
}
function main(args) {
  let sourceDir = null, check = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check" && !check) check = true;
    else if (args[i] === "--source-dir" && !sourceDir && args[i + 1] && !args[i + 1].startsWith("--")) sourceDir = path.resolve(args[++i]);
    else throw Error("Usage: node scripts/build-forever-acquisition.cjs --check | --source-dir DIRECTORY [--check]");
  }
  if (!sourceDir) {
    if (!check) throw Error("Explicit --source-dir is required for generation.");
    checkShipped(); console.log("Shipped acquisition identity/provenance/license/Lua parity check passed; raw originals were not reproduced."); return;
  }
  const inputs = Object.fromEntries(inputNames.map(name => [name, readBounded(path.join(sourceDir, name), name === "eg-loot.json" ? 2097152 : 1048576)]));
  const p = compileAcquisition(inputs), generated = outputs(p, inputs, readLicense(sourceDir));
  if (check) {
    for (const [file, bytes] of generated) if (!readBounded(file, 131072).equals(bytes)) throw Error("Acquisition raw reproduction differs from shipped artifacts.");
    checkShipped(); console.log("Locked four-file acquisition raw reproduction and all shipped artifact parity passed.");
  } else {
    for (const file of generated.keys()) preflight(file);
    for (const [file, bytes] of generated) { fs.mkdirSync(path.dirname(file), { recursive: true }); preflight(file); fs.writeFileSync(file, bytes); }
    console.log(`Compiled acquisition reference: ${p.counts.relations} relations / ${p.counts.positions} historical standing points; ${Buffer.byteLength(json(p))} pack bytes; SHA256 ${hash(json(p))}.`);
  }
}
if (require.main === module) main(process.argv.slice(2));
