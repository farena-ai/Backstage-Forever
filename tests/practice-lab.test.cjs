const { test } = require('node:test');
const assert = require('node:assert/strict');
const { drills, createAttempt, choose, retry } = require('../src/renderer/practice-lab-model.js');

test('the standalone lab offers four distinctly labeled simulated drills', () => {
  assert.deepEqual(drills.map(({ id }) => id), ['opener', 'resource', 'defensive', 'triage']);
  for (const drill of drills) {
    assert.equal(drill.evidence, 'simulated');
    assert.ok(drill.prompt && drill.improvement);
    assert.equal(drill.options.filter(option => option.preferred).length, 1);
    assert.equal(new Set(drill.options.map(option => option.id)).size, drill.options.length);
    assert.ok(drill.options.every(option => option.label && option.feedback));
  }
});

test('a choice reveals its modeled consequence and one improvement, never a live score', () => {
  const attempt = createAttempt('resource');
  assert.equal(attempt.result, null);
  const result = choose(attempt, 'spend-now').result;
  assert.deepEqual(result, {
    evidence: 'simulated', preferred: false,
    feedback: 'You spend the reserve and cannot afford the planned action on the next beat.',
    improvement: 'Before spending, check what the next planned action costs.'
  });
  assert.equal(attempt.result, null);
  assert.equal(choose(attempt, 'hold').result.preferred, true);
});

test('retry clears the current drill result without unlocking the previous attempt', () => {
  const answered = choose(createAttempt('resource'), 'spend-now');
  assert.equal(choose(answered, 'hold'), answered);
  const fresh = retry(answered);
  assert.deepEqual(fresh, createAttempt('resource'));
  assert.equal(choose(fresh, 'hold').result.preferred, true);
  assert.equal(answered.result.preferred, false);
});

test('unknown drill or option cannot produce feedback', () => {
  assert.equal(createAttempt('constructor'), null);
  const attempt = createAttempt('opener');
  assert.equal(choose(attempt, 'constructor'), attempt);
  assert.equal(choose(null, 'hold'), null);
});
