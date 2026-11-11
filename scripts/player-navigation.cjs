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
async function clickCompanionTool(page, tool) {
  const panel = page.locator(`[data-player-tool="${tool}"]`);
  // Native details state changes before its queued toggle handler runs.
  await panel.evaluate((n) => {
    n.smokeToggleAcknowledged = false;
    n.addEventListener("toggle", () => { n.smokeToggleAcknowledged = true; }, { once: true });
  });
  await panel.locator(":scope > summary").click();
  await page.waitForFunction((tool) =>
    document.querySelector(`[data-player-tool="${tool}"]`)?.smokeToggleAcknowledged === true,
  tool);
}
async function setCompanionToolOpen(page, tool, open) {
  const panel = page.locator(`[data-player-tool="${tool}"]`);
  if ((await panel.evaluate((n) => n.open)) !== open)
    await clickCompanionTool(page, tool);
  assert.equal(await panel.evaluate((n) => n.open), open);
}
async function ensureCompanionTools(page, tool) {
  await setCompanionToolOpen(page, tool, true);
}
module.exports = { navigate, ensureCompanionTools, setCompanionToolOpen, clickCompanionTool, routes };
