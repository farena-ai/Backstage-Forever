"use strict";
// Releasing the addon where players look for it (0.59): the GitHub release carries the addon on its
// own, and the BigWigs packager builds it for the WoW Forever flavor and uploads it to CurseForge,
// Wago Addons and WoWInterface once their IDs and tokens are set.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, ".."), read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");

test("every release carries the addon alone, unzipping to AddOns\\BackstageForever", () => {
  const release = read(".github/workflows/release.yml");
  assert.match(release, /git archive --format=zip --prefix=BackstageForever\/ --output="dist\/BackstageForever-Addon-\$env:RELEASE_VERSION\.zip" "\$\(\$env:GITHUB_REF_NAME\):addon\/BackstageForever"/);
  assert.match(release, /\$names = @\([^)]*"BackstageForever-Addon-\$env:RELEASE_VERSION\.zip"/, "in the checksums");
  assert.match(release, /gh release upload \$tag [^\n]*"dist\/BackstageForever-Addon-\$env:RELEASE_VERSION\.zip"/, "uploaded with the app");
});

test("the addon-sites workflow builds the Forever flavor on every PR and uploads only from release tags", () => {
  const wf = read(".github/workflows/addon-sites.yml");
  assert.match(wf, /uses: BigWigsMods\/packager@v2/);
  // The packager needs its own checkout: a throwaway repository with only the addon, tagged with the version.
  assert.match(wf, /cp -R addon\/BackstageForever\/\. "\$dest\/"/);
  assert.match(wf, /git tag "\$tag"/);
  assert.match(wf, /-t \$\{\{ runner\.temp \}\}\/BackstageForever -r \$\{\{ runner\.temp \}\}\/addon-release -g forever/);
  // Artifact upload skips hidden folders, so the package goes to a visible one.
  assert.match(wf, /path: \$\{\{ runner\.temp \}\}\/addon-release\/\*\.zip/);
  assert.match(wf, /github\.event_name != 'push' && '-d'/, "pull requests never upload");
  assert.match(wf, /tags: \["v\*"\]/);
  for (const v of ["CURSEFORGE_PROJECT_ID", "WAGO_PROJECT_ID", "WOWI_ADDON_ID"]) assert.match(wf, new RegExp(`vars\\.${v}`), v);
  for (const s of ["CF_API_KEY", "WAGO_API_TOKEN", "WOWI_API_TOKEN"]) assert.match(wf, new RegExp(`secrets\\.${s}`), s);
  assert.match(wf, /permissions:\n  contents: read/, "the packager never writes to the repository");
  assert.doesNotMatch(wf, /GITHUB_OAUTH/, "the GitHub release stays with release.yml");
  assert.match(read("addon/BackstageForever/.pkgmeta"), /^package-as: BackstageForever$/m);
  // The packager reads the flavor from the TOC: 16xxx is WoW Forever.
  assert.match(read("addon/BackstageForever/BackstageForever.toc"), /^## Interface: 16\d{3}$/m);
});

test("the distribution guide tells the owner exactly what to create and set", () => {
  const doc = read("docs/DISTRIBUTION.md");
  for (const s of ["CurseForge", "Wago", "WoWInterface", "CF_API_KEY", "WAGO_API_TOKEN", "WOWI_API_TOKEN", "CURSEFORGE_PROJECT_ID", "WAGO_PROJECT_ID", "WOWI_ADDON_ID", "backstagecoding.com"]) assert.ok(doc.includes(s), s);
});
