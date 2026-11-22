"use strict";
// winget manifests for the desktop app (roadmap P5). Nothing is submitted from here.
//
//   node scripts/build-winget.cjs                              current package.json version, hash left open
//   node scripts/build-winget.cjs --sha256 <64 hex>            hash of the signed installer on the release
//   node scripts/build-winget.cjs --installer dist/<Setup.exe> hash that file
//   node scripts/build-winget.cjs --sums SHA256SUMS.txt        read the hash from a release's checksum file
//   node scripts/build-winget.cjs --version 1.2.3 ...          another version (default: package.json)
//   node scripts/build-winget.cjs --check                      fail if packaging/winget is not what this would write
//
// Everything else comes from package.json. See packaging/winget/README.md for the manual submission.
const { createHash } = require("node:crypto");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const ID = "BackstageCoding.BackstageForever";
const SCHEMA = "1.6.0";
const OPEN_HASH = "0".repeat(64);
const installerName = (version) => `Backstage-Forever-${version}-Windows-x64-Setup.exe`;

function manifests({ pkg, version = pkg.version, sha256 = null }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error(`Not a release version: ${version}`);
  if (sha256 !== null && !/^[0-9a-fA-F]{64}$/.test(sha256)) throw new Error("The installer hash must be 64 hex characters (SHA-256).");
  const repo = String(pkg.homepage || "").replace(/#.*$/, "");
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo)) throw new Error("package.json homepage must be the GitHub repository.");
  const name = pkg.build.productName, publisher = "Backstage Coding";
  // First sentence of the package description, without the studio credit that follows it.
  const short = pkg.description.split(/(?<=\.)\s/)[0].replace(/\.$/, "");
  const head = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${SCHEMA}.schema.json\n`;
  const q = (s) => JSON.stringify(String(s));
  return {
    [`${ID}.yaml`]: `${head("version")}PackageIdentifier: ${ID}\nPackageVersion: ${version}\nDefaultLocale: en-US\nManifestType: version\nManifestVersion: ${SCHEMA}\n`,
    [`${ID}.installer.yaml`]: `${head("installer")}PackageIdentifier: ${ID}\nPackageVersion: ${version}\nMinimumOSVersion: 10.0.17763.0\nInstallerType: nullsoft\nScope: user\nInstallModes:\n- interactive\n- silent\nUpgradeBehavior: install\nInstallers:\n- Architecture: x64\n  InstallerUrl: ${repo}/releases/download/v${version}/${installerName(version)}\n  InstallerSha256: ${(sha256 || OPEN_HASH).toUpperCase()}\nManifestType: installer\nManifestVersion: ${SCHEMA}\n`,
    [`${ID}.locale.en-US.yaml`]: `${head("defaultLocale")}PackageIdentifier: ${ID}\nPackageVersion: ${version}\nPackageLocale: en-US\nPublisher: ${publisher}\nPublisherUrl: https://www.backstagecoding.com\nPublisherSupportUrl: ${repo}/issues\nPrivacyUrl: ${repo}/blob/main/docs/PRIVACY.md\nAuthor: ${q(pkg.author)}\nPackageName: ${name}\nPackageUrl: https://backstagecoding.com/backstage-forever/\nLicense: ${pkg.license}\nLicenseUrl: ${repo}/blob/main/LICENSE\nShortDescription: ${q(short)}\nDescription: ${q(pkg.description)}\nMoniker: backstage-forever\nTags:\n- addon\n- companion\n- gaming\n- world-of-warcraft\n- wow\nReleaseNotesUrl: ${repo}/releases/tag/v${version}\nManifestType: defaultLocale\nManifestVersion: ${SCHEMA}\n`,
  };
}

function hashFrom(args) {
  const value = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  if (value("--sha256")) return value("--sha256");
  if (value("--installer")) return createHash("sha256").update(fs.readFileSync(value("--installer"))).digest("hex");
  if (value("--sums")) {
    const version = value("--version") || require("../package.json").version;
    const line = fs.readFileSync(value("--sums"), "utf8").split(/\r?\n/).find((l) => l.trim().endsWith(installerName(version)));
    if (!line) throw new Error(`${value("--sums")} has no line for ${installerName(version)}`);
    return line.trim().split(/\s+/)[0];
  }
  return null;
}

if (require.main === module) {
  const args = process.argv.slice(2), dir = path.join(root, "packaging", "winget");
  const at = args.indexOf("--version");
  const pkg = require("../package.json");
  const files = manifests({ pkg, version: at < 0 ? pkg.version : args[at + 1], sha256: hashFrom(args) });
  if (args.includes("--check")) {
    // The hash is the one thing that cannot come from the repo: compare everything else.
    const same = (a, b) => a.replace(/\r\n/g, "\n").replace(/InstallerSha256: \S+/, "") === b.replace(/InstallerSha256: \S+/, "");
    const stale = Object.entries(files).filter(([name, text]) => !fs.existsSync(path.join(dir, name)) || !same(fs.readFileSync(path.join(dir, name), "utf8"), text)).map(([name]) => name);
    if (stale.length) { console.error(`Stale winget manifests: ${stale.join(", ")}. Run node scripts/build-winget.cjs.`); process.exit(1); }
    console.log("winget manifests match package.json.");
  } else {
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
    const open = files[`${ID}.installer.yaml`].includes(OPEN_HASH.toUpperCase());
    console.log(`Wrote ${Object.keys(files).length} manifests to packaging/winget${open ? " (installer hash still open: pass --sha256, --installer or --sums before submitting)" : ""}.`);
  }
}
module.exports = { manifests, installerName, ID, OPEN_HASH };
