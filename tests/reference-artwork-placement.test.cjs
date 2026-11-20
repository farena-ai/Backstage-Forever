const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function questGuide(details) {
  const root = { addEventListener() {}, querySelector: (s) => s === '.quest-guide' ? {} : null, querySelectorAll: () => [] };
  const ctx = vm.createContext({ window: {}, document: { activeElement: null, addEventListener() {} }, setTimeout, clearTimeout, queueMicrotask });
  for (const [file, global] of [['interaction', 'InteractionGuard'], ['player-navigation', 'PlayerNavigation'], ['page-hero', 'PageHero'], ['zone-art', 'ZoneArt'], ['commands', 'CommandsView'], ['quest-guide', 'QuestGuide']]) {
    vm.runInContext(fs.readFileSync(require.resolve(`../src/renderer/${file}.js`), 'utf8'), ctx);
    ctx[global] = ctx.window[global];
  }
  ctx.QuestGuide.init({ root, api: { questDetails: async () => details }, esc: (v) => String(v ?? '') });
  ctx.QuestGuide.sync({ id: 'player', name: 'Aeralyn', faction: 'Alliance', quests: [{ id: 1, title: 'A chapter', complete: true }] });
  return ctx.QuestGuide;
}

test('quest chapter uses the known saved-game zone as decorative artwork without replacing status', async () => {
  const guide = questGuide({ status: 'matched', waypoint: { source: 'game', canCopy: true, destination: { mapId: 1429, x: .2, y: .3 } } });
  await guide.open(1);
  const html = guide.page();
  assert.match(html, /<img class="quest-chapter-scene" src="art\/zones\/map-1429\.webp" alt="">/);
  assert.match(html, /Ready to turn in in your saved snapshot\./);
  assert.match(html, /SAVED GAME DESTINATION/);
});

test('unpainted maps and approximate NPC clues use neutral quest art, not a location painting', async () => {
  for (const waypoint of [
    undefined,
    { source: 'game', canCopy: true, destination: { mapId: 9999, x: .2, y: .3 } },
    { source: 'reference', canCopy: true, destination: { mapId: 1429, x: .2, y: .3, name: 'Named NPC', evidence: 'mentioned-in-objective' } },
  ]) {
    const guide = questGuide({ status: 'matched', waypoint });
    await guide.open(1);
    const html = guide.page();
    assert.match(html, /<img class="quest-chapter-scene" src="art\/reference\/quest\.webp" alt="">/);
    if (waypoint?.source === 'reference') assert.match(html, /NPC CLUE · DESTINATION UNCONFIRMED/);
  }
});
