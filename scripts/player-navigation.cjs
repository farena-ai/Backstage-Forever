"use strict";
const assert = require("node:assert/strict");
const { beginRendererAction, finishRendererAction } = require("./renderer-action-fixture.cjs");
const routes = {
  now: ["Now"],
  adventure: ["Adventure", "Next step"],
  "quest-guide": ["Quests"],
  "world-map": ["World Map"],
  dungeons: ["Adventure", "Dungeons & raids"],
  assistant: ["Companion"],
  characters: ["Characters"],
  company: ["Plans", "My plans"],
  party: ["Plans", "Party"],
  preparation: ["Adventure", "Professions"],
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
  const actions = [];
  const click = async (locator, value) => {
    // Other suites deliberately leave route-specific reads pending to test their
    // retirement. Only Game connection needs its final status paint here.
    if (id === "game") actions.push(await beginRendererAction(page, locator,
      { attribute: "data-shell-control", value }));
    else await locator.click();
  };
  const sectionRoute = { Adventure: "adventure", Plans: "company", Settings: "game", Help: "guide" }[section] || id;
  await click(nav.getByRole("button", { name: section, exact: true }), `nav:${sectionRoute}`);
  if (tab) {
    const subtab = page.getByRole("navigation", { name: `${section} navigation`, exact: true })
      .getByRole("button", { name: tab, exact: true });
    await click(subtab, `subtab:${id}`);
  }
  await page.waitForFunction((id) => page === id, id);
  assert.match(
    await page.locator("#page-heading").innerText(),
    new RegExp(section),
  );
  for (const token of actions) await finishRendererAction(page, token);
}
async function clickCompanionTool(page, tool, timeout) {
  const panel = page.locator(`[data-player-tool="${tool}"]`);
  // Native details state changes before its queued toggle handler runs.
  await panel.evaluate((n) => {
    n.smokeToggleAcknowledged = false;
    n.addEventListener("toggle", () => { n.smokeToggleAcknowledged = true; }, { once: true });
  });
  await panel.locator(":scope > summary").click();
  await page.waitForFunction((tool) =>
    document.querySelector(`[data-player-tool="${tool}"]`)?.smokeToggleAcknowledged === true,
  tool, timeout ? { timeout } : undefined);
}
async function setCompanionToolOpen(page, tool, open) {
  const panel = page.locator(`[data-player-tool="${tool}"]`);
  // A re-render can swap the panel between the click and its toggle handler; wait for the state itself
  // and retry a lost click rather than waiting forever on the old node.
  for (let attempt = 0; attempt < 3 && (await panel.evaluate((n) => n.open)) !== open; attempt++) {
    await clickCompanionTool(page, tool, 10000).catch(() => {});
    await page.waitForFunction(({ tool, open }) => document.querySelector(`[data-player-tool="${tool}"]`)?.open === open, { tool, open }, { timeout: 5000 }).catch(() => {});
  }
  assert.equal(await panel.evaluate((n) => n.open), open);
}
async function ensureCompanionTools(page, tool) {
  await setCompanionToolOpen(page, tool, true);
}
module.exports = { navigate, ensureCompanionTools, setCompanionToolOpen, clickCompanionTool, routes };
