"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const assert = require("node:assert/strict");
const test = require("node:test");
const { badgeBook } = require("../src/core/badges.cjs");

function renderer(script, globals = {}) {
  globals.window = globals;
  for (const name of ["page-hero", script]) runInNewContext(readFileSync(join(__dirname, "../src/renderer", `${name}.js`), "utf8"), globals);
  return globals;
}

test("Now offers a named Badge Case action before any profile data loads", () => {
  const { NowView } = renderer("now", { backstage: {} });
  assert.match(NowView.page(), /<button[^>]*data-nav="badges"[^>]*>[\s\S]*?Open Badge Case/);
});

test("the case uses optional badge art without inventing an earned date", async () => {
  const data = badgeBook({ profiles: [{ id: "hero", name: "Hero", level: 12 }] });
  const b = data.book.badges.find((badge) => badge.id === "level-10");
  b.art = "explorer-5";
  const desktop = data.book.badges.find((badge) => badge.id === "profession-alchemy-150");
  data.next.push({ ...desktop, progress: { have: 140, need: 150 } });
  const root = { querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };
  const { BadgesView } = renderer("badges", { backstage: { badges: async () => data }, document: { querySelector: (s) => s === "[data-badges]" ? root : null } });
  BadgesView.mounted();
  await new Promise(setImmediate);
  const html = BadgesView.page();
  const tile = html.match(/<li[^>]*data-badge="level-10".*?<\/li>/s)?.[0];
  assert.match(tile, /art\/badges\/explorer-5\.png/);
  assert.match(tile, />Earned<\/span>/);
  assert.match(html, /data-badge-search/);
  assert.match(html, /data-badge-category/);
  assert.match(html, /data-badge="profession-alchemy-150"[^>]*>[\s\S]*?Desktop only/);
  assert.match(html, /data-badge-jump="profession-alchemy-150"[^>]*>[\s\S]*?Desktop only/);
  assert.match(html, /<code>\/bf badges pin<\/code>/);
});
