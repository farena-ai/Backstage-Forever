"use strict";
// The website pictures: file name, fixture character, destination and the few clicks that bring
// the screen into its telling state. Used by scripts/site-screenshots.cjs; the pages that show
// them are listed in site/content.cjs.
//   top     the element the picture starts at (scrolled to the top of the window first)
//   bottom  the element the picture ends at (otherwise the window's lower edge)
//   frame   the whole window, side rail included (only the home page's opening picture)
//   clip    one element only
const optionStarting = async (page, selector, start) => {
  const select = page.locator(selector).first();
  const value = await select.locator("option").evaluateAll((options, start) => options.find((o) => o.textContent.trim().startsWith(start))?.value, start);
  if (value === undefined) throw new Error(`no option starting with ${start}`);
  await select.selectOption(value);
};
const toTop = (page) => page.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll(".main, .content")]) el.scrollTop = 0; });
module.exports = [
  // Leveling and quests. The quest picture comes first: it pins the quest as the objective the Now picture shows.
  { name: "quest-log", who: "Aelora", route: "quest-guide", top: ".quest-ledger", steps: async ({ page }) => {
    await page.locator('.quest-ledger-row[data-quest-id="845"]').click();
    await page.locator(".quest-detail").first().waitFor();
    await page.waitForTimeout(800);
  }, after: async ({ page }) => {
    const pin = page.locator("[data-objective-change]").first();
    if (await pin.count()) { await pin.click(); await page.waitForTimeout(600); }
  } },
  { name: "now", who: "Aelora", route: "now", frame: true, steps: async ({ page }) => { await toTop(page); } },
  { name: "guided-route", who: "Aelora", route: "guided-route", top: ".page-hero", bottom: "details:has(.gr-cov)", steps: async ({ page }) => { await page.locator("details:has(.gr-cov) > summary").click(); } },
  { name: "zones", who: "Aelora", route: "zones", top: ".page-hero" },
  // Map and travel
  { name: "world-map-loop", who: "Aelora", route: "world-map", steps: async ({ page }) => {
    await page.locator("[data-wm-loop-show]").check();
    await page.locator('[data-wm-layer="objective-area"]').uncheck();
    await toTop(page);
  } },
  { name: "travel", who: "Aelora", route: "travel", top: ".page-hero", steps: async ({ page }) => {
    await page.locator("[data-tp-search]").fill("Thunder Bluff");
    await page.locator("[data-tp-to]").first().click();
    await page.locator("[data-tp-option]").first().waitFor();
  } },
  // Dungeons and raids
  { name: "dungeons-loot", who: "Brannoc", route: "dungeons", top: '.atlas-card:has([data-atlas-loot="sm"])', steps: async ({ page }) => { await page.locator('.atlas-loot-btn[data-atlas-loot="sm"]').click(); } },
  { name: "run-history", who: "Thessaly", route: "run-history", top: ".page-hero" },
  { name: "attunements", who: "Thessaly", route: "attunements", top: ".page-hero" },
  // Talents and gear
  { name: "talents-plan", who: "Thessaly", route: ["Characters", "Talents"], top: ".tal-bar", bottom: ".tal-layout", steps: async ({ page }) => {
    await page.locator('[data-tal-mode="plan"]').click();
    await page.locator('[data-tal-act="from-path"]').click();
  } },
  { name: "character-sheet", who: "Thessaly", route: "sheet", top: ".gp-switch" },
  { name: "gear-plan", who: "Thessaly", route: "sheet", top: ".gp-switch", steps: async ({ page }) => {
    await page.getByRole("tab", { name: "Gear plan" }).click();
    await page.locator(".gp-card").first().waitFor();
    await page.locator('.gp-pin[aria-pressed="false"]').first().click();
    await page.waitForTimeout(800);
  } },
  { name: "stat-weights", who: "Thessaly", route: "sheet", top: ".gp-switch", steps: async ({ page }) => {
    await page.getByRole("tab", { name: "Gear plan" }).click();
    await page.locator(".gp-card").first().waitFor();
    await page.locator("[data-gear-weights] > summary").click();
  }, after: async ({ page }) => { await page.locator("[data-gear-weights] > summary").click(); } },
  // Professions
  { name: "recipe-book", who: "Thessaly", route: "preparation", top: ".rb-switch", steps: async ({ page }) => {
    await page.locator(".rb-links button", { hasText: "Recipe book" }).click();
    await optionStarting(page, ".rb-view select", "Alchemy");
  } },
  { name: "skill-path", who: "Thessaly", route: "preparation", top: ".rb-switch", steps: async ({ page }) => {
    await page.locator(".rb-switch button", { hasText: "Skill path" }).click();
    await optionStarting(page, ".rb-view select", "Alchemy");
    await page.locator("[data-rb-earlier]").click();
  } },
  { name: "craft-profit", who: "Thessaly", route: "ledger-crafts", top: ".page-hero", bottom: ".content > *:last-child" },
  // Gold
  { name: "price-history", who: "Thessaly", route: "ledger-gold", top: ".ldg-summary" },
  { name: "bags-bank", who: "Thessaly", route: "ledger", top: ".page-hero", bottom: ".ldg-summary + .ldg-card" },
  { name: "reputation", who: "Thessaly", route: "ledger-reputation", top: ".page-hero" },
  { name: "calendar", who: "Thessaly", route: "calendar", top: ".page-hero" },
  // Groups
  { name: "party", who: "Thessaly", route: "party", top: ".page-hero", steps: async ({ page }) => {
    await page.locator('[data-party-role="damage"]').first().click();
    await page.waitForTimeout(1200);
  } },
  // Journey
  { name: "all-characters", who: "Thessaly", route: "alts", top: ".page-hero", bottom: ".content > *:last-child" },
  { name: "journey-story", who: "Thessaly", route: "journey", top: ".jx-views", steps: async ({ page }) => { await page.locator('[data-journey-view="story"]').click(); await page.locator("[data-journey-story]").waitFor(); } },
  { name: "journey-timeline", who: "Thessaly", route: "journey", top: ".jx-day", steps: async ({ page }) => { await page.locator('[data-journey-view="timeline"]').click(); } },
  { name: "badges", who: "Thessaly", route: ["Characters", "Badges"], top: ".page-hero" },
  { name: "share-card", who: "Thessaly", route: "run-history", clip: ".share-dialog", steps: async ({ page }) => { await page.getByRole("button", { name: "Share" }).first().click(); await page.getByLabel("Show character name").check(); await page.waitForTimeout(600); },
    after: async ({ page }) => { await page.getByRole("button", { name: "Close", exact: true }).click(); } },
  // Help
  { name: "commands", who: "Aelora", route: ["Help", "Commands"], top: ".page-hero" },
  { name: "coverage", who: "Aelora", route: ["Help", "Data coverage"], top: ".cov-summary" },
];
