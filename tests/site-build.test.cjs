"use strict";
// Website pages (scripts/build-site.cjs) and winget manifests (scripts/build-winget.cjs).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const site = require("../scripts/build-site.cjs");
const winget = require("../scripts/build-winget.cjs");
const pkg = require("../package.json");

const INDEX = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title><link rel="stylesheet" href="/css/products.css?v=1"><link rel="stylesheet" href="./landing.css"></head><body>
<a class="skip" href="#main">Skip to content</a><header class="site-head"><nav><a href="./" aria-current="page">Backstage Forever</a></nav></header>
<main id="main"><section id="setup"><a class="btn" data-download="windows" href="https://github.com/farena-ai/Backstage-Forever/releases/latest">Download for Windows</a></section></main><footer class="footer"><a href="/contact.html">Contact</a></footer><script src="/js/products.js?v=1" defer></script><script src="./desktop-downloads.js" defer></script></body></html>`;

function fixtureSite(t, { pictures = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-site-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "index.html"), INDEX);
  for (const name of ["landing.css", "desktop-downloads.js", "crest.png", "compass.png", "helpers.png"]) fs.writeFileSync(path.join(dir, name), "");
  fs.mkdirSync(path.join(dir, "tour"));
  if (pictures) for (const name of [...site.TOUR.flatMap((p) => p.shots.map((s) => s[0])), "commands"]) for (const suffix of ["", "-small"]) fs.writeFileSync(path.join(dir, "tour", `${name}${suffix}.webp`), "");
  return dir;
}

test("the website pages build from the repo, with working relative links and the site's own chrome", (t) => {
  const dir = fixtureSite(t);
  const { files, problems } = site.build(dir);
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(files).sort(), ["commands.html", "coverage.html", "index.html", "tour.css", "tour.html", "whats-new.html"]);
  for (const [name, html] of Object.entries(files)) {
    if (!name.endsWith(".html")) continue;
    assert.match(html, /<a class="skip" href="#main">/, `${name} keeps the site header`);
    assert.match(html, /<footer class="footer">/, `${name} keeps the site footer`);
    assert.match(html, /<script src="\.\/desktop-downloads\.js" defer><\/script>/, `${name} keeps the download script`);
    assert.match(html, /data-download="windows"/, `${name} offers the desktop download`);
    assert.doesNotMatch(html, /no desktop app required/i);
    // Nothing from another site is loaded: no scripts, styles, fonts or images.
    assert.doesNotMatch(html.replace(/<link rel="canonical"[^>]*>/, ""), /<(?:script|link|img)\b[^>]*(?:src|href)="https?:/);
  }
});

test("only the what's new page carries app version numbers", (t) => {
  const { files } = site.build(fixtureSite(t));
  const latest = site.stableReleases()[0];
  assert.equal(latest.channel, "stable");
  assert.ok(files["whats-new.html"].includes(`Version ${latest.version}`));
  assert.ok(files["whats-new.html"].includes(site.tagline(latest).replace(/&/g, "&amp;")));
  assert.doesNotMatch(files["whats-new.html"], /preview/i);
  // The game's own build numbers (1.60.1.x) are data; the app's version must not be written into the other pages.
  const appVersion = /\b\d+\.\d+\.\d+\b(?!\.\d)/;
  for (const name of ["tour.html", "commands.html", "coverage.html", "index.html"]) assert.doesNotMatch(files[name].replace(/\?v=[\w.-]+/g, "").replace(/\b\d+\.\d+\.\d+\.\d+\b/g, ""), appVersion, name);
});

test("the commands page lists every command and the coverage page both factions", (t) => {
  const { files } = site.build(fixtureSite(t));
  const { CATALOG } = require("../src/renderer/commands.js");
  const esc = (v) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  for (const row of CATALOG) assert.ok(files["commands.html"].includes(`<code>${esc(row.command)}</code>`), row.command);
  for (const faction of ["Alliance", "Horde"]) assert.match(files["coverage.html"], new RegExp(`<section class="bfx-cov" id="${faction.toLowerCase()}"><h2>${faction}</h2><p><strong>\\d+ of \\d+</strong>`));
  assert.match(files["coverage.html"], /The Barrens/);
});

test("the download page gains one generated block and stays the same on a second run", (t) => {
  const dir = fixtureSite(t);
  const first = site.build(dir).files;
  for (const [name, text] of Object.entries(first)) fs.writeFileSync(path.join(dir, name), text);
  const second = site.build(dir).files;
  assert.deepEqual(second, first, "building twice changes nothing");
  assert.equal(first["index.html"].split("<!-- bf:more").length, 2);
  assert.equal(first["index.html"].split('href="./tour.css"').length, 2);
  // Everything the live page had is still there, in order.
  assert.equal(first["index.html"].replace(/<!-- bf:more[^]*?<!-- \/bf:more -->/, "").replace('<link rel="stylesheet" href="./tour.css">', ""), INDEX);
});

test("a missing picture or a broken link is reported", (t) => {
  const { problems } = site.build(fixtureSite(t, { pictures: false }));
  assert.ok(problems.some((p) => p.includes("tour/now.webp is missing")));
  assert.deepEqual(site.checkLinks(os.tmpdir(), { "a.html": '<a href="./nowhere.html">x</a><a href="tour.html">y</a><a href="#gone">z</a>' }).length, 3);
});

test("winget manifests come from package.json and take the installer hash", () => {
  const files = winget.manifests({ pkg, sha256: "ab".repeat(32) });
  assert.deepEqual(Object.keys(files), [`${winget.ID}.yaml`, `${winget.ID}.installer.yaml`, `${winget.ID}.locale.en-US.yaml`]);
  const installer = files[`${winget.ID}.installer.yaml`];
  assert.ok(installer.includes(`PackageVersion: ${pkg.version}\n`));
  assert.ok(installer.includes(`/releases/download/v${pkg.version}/${winget.installerName(pkg.version)}\n`));
  assert.ok(installer.includes(`InstallerSha256: ${"AB".repeat(32)}\n`));
  assert.match(installer, /InstallerType: nullsoft\nScope: user\n/);
  // The installer name is the one electron-builder is told to write.
  assert.equal(winget.installerName("1.2.3"), pkg.build.artifactName.replace("${version}", "1.2.3").replace("${arch}", "x64").replace("${ext}", "exe"));
  assert.ok(winget.manifests({ pkg })[`${winget.ID}.installer.yaml`].includes(winget.OPEN_HASH), "no hash given: left open, never guessed");
  assert.throws(() => winget.manifests({ pkg, sha256: "abc" }));
  assert.throws(() => winget.manifests({ pkg, version: "1.2" }));
  const short = /ShortDescription: "(.*)"/.exec(files[`${winget.ID}.locale.en-US.yaml`])[1];
  assert.ok(short.length >= 3 && short.length <= 256);
});

test("the Linux build is an x64 AppImage with its own file name", () => {
  assert.deepEqual(pkg.build.linux.target, [{ target: "AppImage", arch: ["x64"] }]);
  assert.equal(pkg.build.linux.artifactName, "Backstage-Forever-${version}-Linux-x64.${ext}");
  assert.match(pkg.scripts["dist:linux"], /--linux AppImage --x64 --publish never/);
  const release = fs.readFileSync(path.join(__dirname, "../.github/workflows/release.yml"), "utf8");
  const linux = release.slice(release.indexOf("\n  linux:"));
  assert.match(linux, /needs: \[release, mac\]/, "after the Mac job: both rewrite SHA256SUMS.txt");
  assert.match(linux, /grep -v -- '-Linux-' > sums\.tmp/);
  assert.doesNotMatch(linux, /backstage-update\.json/, "the Windows update file is not touched");
});
