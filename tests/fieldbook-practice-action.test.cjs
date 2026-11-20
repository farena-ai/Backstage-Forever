"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { scopedPractice } = require('../src/renderer/commands.js');

const profile = { id: 'alpha', source: { kind: 'wow-addon', id: 'source-a' }, clientBuild: '1.60.1.70888' };

test('the exact Deadmines plan and opener survive a round trip for the same context', () => {
  for (const p of [profile, { id: 'manual' }, null]) {
    const action = scopedPractice.create(p, 'dm', 'opener', 'compact');
    assert.equal(scopedPractice.resolve(JSON.parse(JSON.stringify(action)), p, 'dm', 'opener'), 'compact');
  }
});

test('practice scope refuses substituted entities, malformed actions and changed owners', () => {
  const action = scopedPractice.create(profile, 'dm', 'opener', 'full');
  assert.equal(scopedPractice.create(profile, 'dme', 'opener', 'full'), null);
  assert.equal(scopedPractice.create(profile, 'dm', 'triage', 'full'), null);
  assert.equal(scopedPractice.resolve(action, profile, 'dme', 'opener'), null);
  assert.equal(scopedPractice.resolve(action, profile, 'dm', 'triage'), null);
  for (const changed of [null, { ...profile, id: 'beta' }, { ...profile, clientBuild: '1.60.1.70840' }, { ...profile, source: { ...profile.source, id: 'source-b' } }]) {
    assert.equal(scopedPractice.resolve(action, changed, 'dm', 'opener'), null);
  }
  for (const changed of [{ ...action, mode: 'unknown' }, { ...action, command: '/bf next' }]) {
    assert.equal(scopedPractice.resolve(changed, profile, 'dm', 'opener'), null);
  }
});
