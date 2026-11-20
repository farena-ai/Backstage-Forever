const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { choose } = require('../src/renderer/practice-lab-model.js');

const packPath = '../src/renderer/academy-tank-pack.js';

test('a first-pull plan replays setup, positioning, defensive timing and recovery in the Lab', () => {
  const { drill } = require(packPath);
  const branches = [
    ['rush', false, /second pack.*group has not confirmed/i],
    ['blind-corner', false, /breaks sight.*heavy swing/i],
    ['guard-early', false, /guard expires.*heavy swing/i],
    ['chase', false, /leaves the agreed spot.*second pack/i],
    ['regroup', true, /one pack.*in view.*guard covers.*call out/i]
  ];
  assert.equal(drill.id, 'tank-first-pull');
  assert.deepEqual(drill.options.map(({ id }) => id), branches.map(([id]) => id));
  const attempt = Object.freeze({ drill, result: null });
  for (const [id, preferred, consequence] of branches) {
    const answered = choose(attempt, id);
    assert.equal(answered.result.evidence, 'simulated');
    assert.equal(answered.result.preferred, preferred);
    assert.match(answered.result.feedback, consequence);
    assert.equal(answered.result.improvement, drill.improvement);
    assert.equal(choose(answered, 'regroup'), answered);
  }
  assert.equal(choose(attempt, 'constructor'), attempt);
  assert.equal(attempt.result, null);
});

test('the browser pack loads without a profile, game, bridge, network or storage', () => {
  const context = vm.createContext({});
  for (const name of ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket',
    'localStorage', 'sessionStorage', 'backstage']) {
    Object.defineProperty(context, name, { get() { assert.fail(`Unexpected access to ${name}`); } });
  }
  vm.runInContext(readFileSync(require.resolve(packPath), 'utf8'), context);
  const pack = context.BFAcademyTankPack;
  assert.deepEqual(JSON.parse(JSON.stringify(pack)), require(packPath));
  assert.match(pack.lesson.scope, /fictional.*not live.*Forever build/i);
  assert.match(pack.lesson.threat, /does not tell you why.*rather than assuming a threat ranking/i);
  for (const value of [pack, pack.lesson, pack.drill, pack.drill.options, ...pack.drill.options]) {
    assert.ok(Object.isFrozen(value));
  }
  const fresh = () => Object.freeze({ drill: pack.drill, result: null });
  assert.equal(choose(fresh(), 'chase').result.preferred, false);
  assert.equal(choose(fresh(), 'regroup').result.preferred, true);
});
