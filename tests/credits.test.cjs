"use strict";
// Credits on the app's front: both designers and the Backstage Coding website (0.58).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("the rail and the About note credit Frank Arena and Jason Babiuch and link backstagecoding.com", () => {
  const app = read("src/renderer/app.js");
  assert.match(app, /<small><button type="button" class="rail-link" data-link="website" title="Open backstagecoding\.com in your browser">BACKSTAGE CODING<\/button><br>Frank Arena &amp; Jason Babiuch<br>/);
  assert.match(app, /Designed by Frank Arena and Jason Babiuch · <button type="button" class="rail-link" data-link="website">/);
  // The site opens through the main process's fixed link list, never a URL from the page.
  assert.match(read("src/main.cjs"), /\n {2}website: "https:\/\/www\.backstagecoding\.com\/",\n/);
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.description, /Designed by Frank Arena and Jason Babiuch/);
  assert.deepEqual(pkg.contributors, ["Jason Babiuch"]);
  assert.match(read("README.md"), /Designed by Frank Arena and Jason Babiuch, made by \[Backstage Coding\]\(https:\/\/www\.backstagecoding\.com\)/);
});
