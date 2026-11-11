"use strict";
const assert = require("node:assert/strict");
const routes = {
  adventure: ["Adventure", "Next step"],
  "quest-guide": ["Quests"],
  assistant: ["Companion"],
  characters: ["Characters"],
  company: ["Plans", "My plans"],
  party: ["Plans", "Party"],
  preparation: ["Adventure", "Professions"],
  "adventure-map": ["Adventure", "Map"],
  game: ["Settings", "Game connection"],
  connections: ["Settings", "AI connection"],
  updates: ["Settings", "Updates"],
  guide: ["Help", "Field guide"],
};
const legacy = {
  Adventure: "adventure",
  "Quest Guide": "quest-guide",
  "AI Companion": "assistant",
  Characters: "characters",
  Company: "company",
  Party: "party",
  Preparation: "preparation",
  "Game Connection": "game",
  Connections: "connections",
  Updates: "updates",
  "Field Guide": "guide",
};
async function navigate(page, id) {
  id = legacy[id] || id;
  const [section, tab] = routes[id] || [];
  assert.ok(section, `Unknown player destination: ${id}`);
  const nav = page.getByRole("navigation", {
    name: ["Settings", "Help"].includes(section)
      ? "Settings and help"
      : "Main navigation",
    exact: true,
  });
  await nav.getByRole("button", { name: section, exact: true }).click();
  if (tab)
    await page
      .getByRole("navigation", { name: `${section} navigation`, exact: true })
      .getByRole("button", { name: tab, exact: true })
      .click();
  await page.waitForFunction((id) => page === id, id);
  assert.match(
    await page.locator("#page-heading").innerText(),
    new RegExp(section),
  );
}
async function ensureCompanionTools(page, tool) {
  const panel = page.locator(`[data-player-tool="${tool}"]`);
  if (!(await panel.evaluate((n) => n.open)))
    await panel.locator(":scope > summary").click();
  assert.equal(await panel.evaluate((n) => n.open), true);
}
module.exports = { navigate, ensureCompanionTools, routes };
