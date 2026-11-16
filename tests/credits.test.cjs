"use strict";
// Credits on the app's front: both designers and the Backstage Coding website (0.58).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("the rail and the About note credit Frank Arena and Jason Babiuch and link backstagecoding.com", () => {
  const app = read("src/renderer/app.js");
  assert.match(app, /BACKSTAGE CODING<br>Designed by Frank Arena &amp; Jason Babiuch<br><button type="button" class="rail-link" data-link="website"/);
  assert.match(app, /Designed by Frank Arena and Jason Babiuch · <button type="button" class="rail-link" data-link="website">/);
  // The site opens through the main process's fixed link list, never a URL from the page.
  assert.match(read("src/main.cjs"), /\n {2}website: "https:\/\/www\.backstagecoding\.com\/",\n/);
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.description, /Designed by Frank Arena and Jason Babiuch/);
  assert.deepEqual(pkg.contributors, ["Jason Babiuch"]);
  assert.equal(JSON.parse(read("data/i18n/de.json")).app["Designed by Frank Arena & Jason Babiuch"], "Entworfen von Frank Arena & Jason Babiuch");
  assert.match(read("README.md"), /Designed by Frank Arena and Jason Babiuch, made by \[Backstage Coding\]\(https:\/\/www\.backstagecoding\.com\)/);
});
