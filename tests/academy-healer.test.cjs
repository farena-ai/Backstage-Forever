const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { choose } = require('../src/renderer/practice-lab-model.js');

const packPath = path.join(__dirname, '../src/renderer/academy-healer-pack.js');

test('the healer scenario uses the existing Lab choice contract for every branch', () => {
  const { drill } = require(packPath);
  const attempt = Object.freeze({ drill, result: null });
  const expected = [
    ['efficient-first', false, /0% health/],
    ['dispel-first', false, /hit still drops/],
    ['emergency-then-dispel', true, /15% health.*1 mana remains/],
    ['group-first', false, /only 1 mana.*cannot afford/]
  ];
  assert.equal(drill.id, 'healer-mana-triage');
  assert.deepEqual(drill.options.map(({ id }) => id), expected.map(([id]) => id));
  for (const [id, preferred, feedback] of expected) {
    const answered = choose(attempt, id);
    assert.deepEqual(answered.result, {
      evidence: 'simulated', preferred, feedback: answered.result.feedback, improvement: drill.improvement
    });
    assert.match(answered.result.feedback, feedback);
    assert.equal(choose(answered, 'emergency-then-dispel'), answered);
  }
  assert.equal(choose(attempt, 'constructor'), attempt);
  assert.equal(attempt.result, null);
});

test('the content loads offline in a browser context with no game, bridge, or storage access', () => {
  const context = vm.createContext({});
  for (const name of ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'backstage']) {
    Object.defineProperty(context, name, { get() { assert.fail(`unexpected access to ${name}`); } });
  }
  vm.runInContext(fs.readFileSync(packPath, 'utf8'), context);
  const pack = context.BFAcademyHealerPack;
  assert.deepEqual(JSON.parse(JSON.stringify(pack)), require(packPath));
  assert.equal(pack.drill.evidence, 'simulated');
  assert.match(pack.lesson.scope, /fictional.*not.*live/i);
  assert.match(pack.lesson.preparation, /before the pull.*mana.*dispel/i);
  for (const item of [pack, pack.lesson, pack.drill, pack.drill.options, ...pack.drill.options]) {
    assert.ok(Object.isFrozen(item));
  }
});
