"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness() {
  const requests = [];
  const window = { backstage: { dungeonAtlas: () => new Promise(resolve => requests.push(resolve)) } };
  let root, select;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/renderer/dungeon-atlas.js'), 'utf8'), {
    window, document: { querySelector: (selector) => selector === '#active-character' ? select : root },
    PageHero: { render: () => '' },
  });
  return {
    requests, page: window.DungeonAtlas.page,
    mount(profileId = 'main') {
      const elements = new Map();
      let change;
      select = {
        selectedOptions: [{ getAttribute: () => profileId }],
        addEventListener(type, fn) { if (type === 'change') change = fn; },
      };
      root = {
        addEventListener() {},
        querySelector(selector) {
          if (!elements.has(selector)) elements.set(selector, { addEventListener() {}, setAttribute() {}, replaceChildren() { this.innerHTML = ''; } });
          return elements.get(selector);
        },
        querySelectorAll: () => [],
      };
      window.DungeonAtlas.mounted();
      const panel = root.querySelector('[data-atlas-recap]');
      return { html: () => panel.innerHTML, change: id => { profileId = id; change?.(); } };
    },
  };
}

const atlasWith = (profileId, encounters) => ({ level: 20, suggested: [], entries: [], recap: { profileId, encounters } });
const savedDefeat = { name: 'Example <boss>', atlasName: 'A & B', instanceType: 'party', instanceMap: 36, at: 1700000000 };
const flush = () => new Promise(setImmediate);

test('the personal recap shows recent saved defeats without inferring runs or clears', async () => {
  const h = harness();
  assert.match(h.page(), /Your encounter recap/);
  const recap = h.mount();
  h.requests[0](atlasWith('main', [
    { ...savedDefeat, name: 'Unmatched raid boss', atlasName: null, instanceType: 'raid', at: 1700000001 },
    savedDefeat,
    { ...savedDefeat, name: 'Third boss', at: 1699999999 },
    { ...savedDefeat, name: 'Older boss', at: 1699999998 },
  ]));
  await flush();
  assert.match(recap.html(), /Last saved/);
  assert.match(recap.html(), /Unmatched raid boss[\s\S]*Unknown raid[\s\S]*Example &lt;boss&gt;[\s\S]*A &amp; B/);
  assert.match(recap.html(), /datetime="2023-11-14T22:13:20.000Z"/);
  assert.match(recap.html(), /Showing the latest 3 of 4 saved defeats/);
  assert.doesNotMatch(recap.html(), /<boss>|Older boss|\b(?:clears?|runs?|lockouts?)\b/i);
});

test('switching characters clears the visible recap and ignores an older mount response', async () => {
  const h = harness();
  const main = h.mount();
  h.requests[0](atlasWith('main', [savedDefeat]));
  await flush();
  assert.match(main.html(), /Example/);
  main.change('alt');
  assert.doesNotMatch(main.html(), /Example/);
  h.mount('alt'); // Another shell repaint while the older request is still pending.
  const alt = h.mount('alt');
  h.requests[2](atlasWith('alt', []));
  await flush();
  assert.match(alt.html(), /No saved encounter defeats yet/);
  h.requests[1](atlasWith('alt', [{ ...savedDefeat, name: 'Stale response' }]));
  await flush();
  assert.match(alt.html(), /No saved encounter defeats yet/);
  assert.doesNotMatch(alt.html(), /Stale response|Example/);
});

test('the recap does not use another profile’s history returned by the current request', async () => {
  const h = harness();
  const recap = h.mount();
  h.requests[0](atlasWith('alt', [savedDefeat]));
  await flush();
  assert.match(recap.html(), /Recap unavailable for the active character/);
  assert.doesNotMatch(recap.html(), /Example/);
});

test('without an active character the recap offers selection instead of displaying history', async () => {
  const h = harness();
  const recap = h.mount(null);
  h.requests[0](atlasWith(null, [savedDefeat]));
  await flush();
  assert.match(recap.html(), /Choose a character/);
  assert.doesNotMatch(recap.html(), /Example/);
});
