"use strict";
// The website pictures, in tour order: file name, fixture character, destination and the few
// clicks that bring the screen into its telling state. `top` scrolls that element to the top of
// the window first. Used by scripts/site-screenshots.cjs.
const pick = async (page, selector, label) => { await page.locator(selector).first().selectOption({ label }); };
const optionStarting = async (page, selector, start) => {
  const select = page.locator(selector).first();
  const value = await select.locator("option").evaluateAll((options, start) => options.find((o) => o.textContent.trim().startsWith(start))?.value, start);
  if (value === undefined) throw new Error(`no option starting with ${start}`);
  await select.selectOption(value);
};
module.exports = [
  { name: "now", who: "Aelora", route: "now" },
  { name: "guided-route", who: "Aelora", route: "guided-route", top: ".page-hero" },
  { name: "world-map-loop", who: "Aelora", route: "world-map", steps: async ({ page }) => {
    await page.locator("[data-wm-loop-show]").check();
    await page.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll(".main, .content")]) el.scrollTop = 0; });
  } },
  { name: "travel", who: "Aelora", route: "travel", top: ".page-hero", steps: async ({ page }) => {
    await page.locator("[data-tp-search]").fill("Thunder Bluff");
    await page.locator("[data-tp-to]").first().click();
    await page.locator("[data-tp-option]").first().waitFor();
  } },
  { name: "dungeons-loot", who: "Thessaly", route: "dungeons", top: '.atlas-card:has([data-atlas-loot="sm"])', steps: async ({ page }) => { await page.locator('.atlas-loot-btn[data-atlas-loot="sm"]').click(); } },
  { name: "run-history", who: "Thessaly", route: "run-history", top: ".page-hero" },
  { name: "attunements", who: "Thessaly", route: "attunements", top: ".page-hero" },
  { name: "talents-plan", who: "Thessaly", route: ["Characters", "Talents"], top: ".tal-bar", steps: async ({ page }) => {
    await page.locator('[data-tal-mode="plan"]').click();
    await page.locator('[data-tal-act="from-path"]').click();
  } },
  { name: "gear-plan", who: "Thessaly", route: "sheet", top: ".gp-switch", steps: async ({ page }) => { await page.getByRole("tab", { name: "Gear plan" }).click(); await page.locator(".gp-card").first().waitFor(); } },
  { name: "recipe-book", who: "Thessaly", route: "preparation", top: ".rb-switch", steps: async ({ page }) => {
    await page.locator(".rb-links button", { hasText: "Recipe book" }).click();
    await optionStarting(page, ".rb-view select", "Alchemy");
  } },
  { name: "skill-path", who: "Thessaly", route: "preparation", top: ".rb-switch", steps: async ({ page }) => {
    await page.locator(".rb-switch button", { hasText: "Skill path" }).click();
    await optionStarting(page, ".rb-view select", "Alchemy");
  } },
  { name: "price-history", who: "Thessaly", route: "ledger-gold" },
  { name: "craft-profit", who: "Thessaly", route: "ledger-crafts" },
  { name: "calendar", who: "Thessaly", route: "calendar", top: ".page-hero" },
  { name: "journey-story", who: "Thessaly", route: "journey", top: ".jx-views", steps: async ({ page }) => { await page.locator('[data-journey-view="story"]').click(); await page.locator("[data-journey-story]").waitFor(); } },
  { name: "journey-timeline", who: "Thessaly", route: "journey", top: ".jx-views", steps: async ({ page }) => { await page.locator('[data-journey-view="timeline"]').click(); } },
  { name: "share-card", who: "Thessaly", route: "run-history", steps: async ({ page }) => { await page.getByRole("button", { name: "Share" }).first().click(); await page.getByLabel("Show character name").check(); },
    after: async ({ page }) => { await page.getByRole("button", { name: "Close", exact: true }).click(); } },
  { name: "commands", who: "Aelora", route: ["Help", "Commands"], top: ".page-hero" },
  { name: "coverage", who: "Aelora", route: ["Help", "Data coverage"], top: ".page-hero" },
];
void pick;
