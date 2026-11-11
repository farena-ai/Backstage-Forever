"use strict";
async function waitForCompanyTitleFocus(page, journeyId, title) {
  // The store/queue can finish before Company.perform's guarded final paint.
  // Return ownership from the same snapshot that recognizes the renamed card.
  const result = await page.waitForFunction(({ journeyId, title }) => {
    if (page !== "company" || setupOpen || stateMutationBusy) return false;
    const cards = [...document.querySelectorAll("[data-company] [data-company-journey]")].filter(n => n.dataset.companyJourney === journeyId);
    if (cards.length !== 1 || !cards[0].isConnected || !cards[0].getClientRects().length) return false;
    const controls = cards[0].querySelectorAll('[data-company-command="remove"]');
    if (controls.length !== 1) return false;
    const node = controls[0];
    if (!node.isConnected || !node.getClientRects().length || node.getAttribute("aria-label") !== `Delete plan ${title}` || document.activeElement !== node) return false;
    return { focused: true };
  }, { journeyId, title });
  try { return await result.jsonValue(); } finally { await result.dispose(); }
}
module.exports = { waitForCompanyTitleFocus };
