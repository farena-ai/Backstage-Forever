"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { newer } = require("../src/core/updater.cjs");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("1.0 is the stable release, newer than every preview, with aligned versions", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(pkg.releaseChannel, "stable");
  assert.ok(newer(pkg.version, "0.12.3"), "Installed 0.12.3 must see a newer version");
  assert.ok(newer(pkg.version, "0.13.6"), "Failed candidate tags remain unchanged; publish a newer patch");
  assert.ok(!newer("0.59.0", pkg.version), "1.0 is newer than every preview");
  assert.ok(newer(pkg.version, "0.59.0"), "previews update to 1.0");
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.equal(toc.match(/^## Version: (.+)$/m)?.[1].trim(), pkg.version);
});

test("validation and tag publication require acquisition, Compass, Professions and Map acceptance", () => {
  for (const filename of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
    const workflow = read(filename);
    const commands = [...workflow.matchAll(/^\s+- run: (.+)\r?$/gm)].map((m) => m[1].trim());
    for (const command of [
      "npm run check:addon-reference", "npm run check:forever-vendors",
      "npm run check:forever-insights", "npm run check:forever-travel",
      "npm run check:forever-acquisition", "npm test", "npm run test:setup",
      "npm run test:adventure-coach", "npm run test:profession-coach",
      "npm run test:packaged",
    ]) assert.ok(commands.includes(command), `${filename} requires ${command}`);
    assert.equal(commands.filter((c) => c === "npm test").length, 1);
  }
  const release = read(".github/workflows/release.yml");
  assert.match(release, /Tag must match strict package version/);
  assert.match(release, /node scripts\/sign-update\.cjs/);
  assert.match(release, /secrets\.BF_UPDATE_SIGNING_KEY/);
});

test("a hung check fails in minutes, not after GitHub's six-hour default", () => {
  for (const [name, ceiling] of [[".github/workflows/ci.yml", 60], [".github/workflows/release.yml", 90]]) {
    const yml = read(name).replace(/\r\n/g, "\n");
    assert.match(yml, new RegExp(`runs-on: windows-latest\n    timeout-minutes: ${ceiling}\n`), name);
    const steps = yml.match(/      - run: npm run test:[a-z:-]+\n.*/g) || [];
    assert.ok(steps.length > 20, name);
    for (const s of steps) assert.match(s, /\n        timeout-minutes: 10$/, `${name}: ${s.split("\n")[0].trim()}`);
  }
  assert.match(read(".github/workflows/release.yml").replace(/\r\n/g, "\n"), /runs-on: macos-latest\n    timeout-minutes: 40\n/);
  // Apple Silicon will not open an unsigned app: the Mac job signs ad hoc and checks it before uploading.
  assert.match(read(".github/workflows/release.yml"), /codesign --force --deep --sign - "sign\/Backstage Forever\.app"/);
  assert.match(read(".github/workflows/release.yml"), /codesign --verify --deep --strict/);
});
