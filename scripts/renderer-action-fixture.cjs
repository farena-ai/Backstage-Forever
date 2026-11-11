"use strict";
const assert = require("node:assert/strict");
let sequence = 0;

// Observe only the action dispatched by this physical click. Another completed
// action, an old node, or an earlier same-name control cannot acknowledge it.
async function beginRendererAction(page, locator, target) {
  const token = `renderer-action-${++sequence}`;
  await page.evaluate(({ token, target }) => {
    const records = window.rendererActionFixtures ||= new Map();
    const record = { settled: false };
    records.set(token, record);
    document.addEventListener("click", function capture(event) {
      const node = event.target.closest("button");
      if (!node || node.getAttribute(target.attribute) !== target.value) return;
      document.removeEventListener("click", capture, true);
      const matches = [...document.querySelectorAll(`button[${target.attribute}]`)].filter(n => n.getAttribute(target.attribute) === target.value);
      if (matches.length !== 1 || matches[0] !== node || !node.isConnected || !node.getClientRects().length) return;
      const original = action;
      const observed = fn => {
        action = original;
        record.promise = original(fn);
        record.promise.then(() => { record.settled = true; }, () => { record.settled = true; });
        return record.promise;
      };
      action = observed;
      document.addEventListener("click", () => { if (action === observed) action = original; }, { once: true });
    }, true);
  }, { token, target });
  await locator.click();
  assert.equal(await page.evaluate(token => Boolean(window.rendererActionFixtures.get(token)?.promise), token), true,
    `Physical click dispatched its intended renderer action: ${target.value}`);
  return token;
}

async function finishRendererAction(page, token) {
  await page.waitForFunction(token => window.rendererActionFixtures.get(token)?.settled === true, token);
  await page.evaluate(async token => {
    const records = window.rendererActionFixtures, record = records.get(token);
    try { await record.promise; } finally { records.delete(token); }
  }, token);
}
module.exports = { beginRendererAction, finishRendererAction };
