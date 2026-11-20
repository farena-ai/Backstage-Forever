const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function main() {
  const channel = process.env.BF_PRACTICE_BROWSER;
  const browser = await chromium.launch(channel ? { channel } : {});
  try {
    const context = await browser.newContext({ offline: true, viewport: { width: 960, height: 680 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    const remote = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (!request.url().startsWith('file:')) remote.push(request.url()); });
    const url = pathToFileURL(path.join(__dirname, '../src/renderer/practice-lab.html'));
    await page.goto(url.href);
    const choice = label => page.getByRole('button', { name: label, exact: true });
    const result = page.getByRole('region', { name: 'Simulated result' });
    const select = page.getByLabel('Choose a drill');
    const focused = () => page.evaluate(() => document.activeElement.textContent.trim());
    assert.match(await page.locator('main').innerText(), /no live game data/i);
    assert.equal(await result.isVisible(), false);

    await page.keyboard.press('Tab'); // Native scenario selector
    assert.equal(await select.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await focused(), 'Attack before the signal');
    await page.keyboard.press('Enter');
    assert.equal(await focused(), 'Simulated result');
    assert.match(await result.innerText(), /before the rest of the group is ready/);
    await page.keyboard.press('Tab');
    assert.equal(await focused(), 'Retry drill');
    await page.keyboard.press('Enter');
    assert.equal(await result.isVisible(), false);
    assert.equal(await focused(), 'Attack before the signal');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    assert.match(await result.innerText(), /group starts together/);

    for (const [id, action, feedback] of [
      ['resource', 'Spend 3 energy now', /cannot afford/],
      ['defensive', 'Use the guard on the beat the hit lands', /guard is active/],
      ['triage', 'Heal the ally about to take the hit', /10% health/]
    ]) {
      await select.selectOption(id);
      assert.equal(await result.isVisible(), false);
      await choice(action).click();
      assert.match(await result.innerText(), feedback);
      assert.match(await result.innerText(), /One thing to practice/);
    }
    if (process.env.BF_PRACTICE_SCREENSHOTS) {
      await page.screenshot({ path: path.join(process.env.BF_PRACTICE_SCREENSHOTS, 'practice-lab-desktop.png') });
    }
    await page.setViewportSize({ width: 340, height: 560 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await result.isVisible(), true);
    await page.keyboard.press('Tab');
    assert.equal(await focused(), 'Retry drill');
    const retryBounds = await choice('Retry drill').boundingBox();
    assert.ok(retryBounds.y >= 0 && retryBounds.y + retryBounds.height <= 560);
    if (process.env.BF_PRACTICE_SCREENSHOTS) {
      await page.screenshot({ path: path.join(process.env.BF_PRACTICE_SCREENSHOTS, 'practice-lab-compact.png'), fullPage: true });
    }
    await page.reload();
    assert.equal(await result.isVisible(), false);
    assert.equal(await select.inputValue(), 'opener');
    assert.deepEqual(errors, []);
    assert.deepEqual(remote, []);
    console.log('PASS Practice Lab: offline keyboard, all four drills, retry, compact layout and clean reload');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
