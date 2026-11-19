const test = require('node:test');
const assert = require('node:assert/strict');
const { recordSuccessfulRun, pendingRecap, acknowledge } = require('../src/core/whats-new-state.cjs');
const stable = version => ({ version, channel: 'stable' });
const preview = version => ({ version, channel: 'preview' });
const restart = state => JSON.parse(JSON.stringify(state));
const first = record => recordSuccessfulRun(null, record, { freshInstall: true }).state;

test('known skip commits previous run and pending interval in one restartable snapshot', () => {
  const from = stable('1.9.0'), to = stable('1.11.0');
  const run = recordSuccessfulRun(first(from), to);
  assert.equal(run.reason, 'upgrade');
  assert.equal(run.changed, true);
  assert.deepEqual(run.state.lastRun, to);
  const restartRun = recordSuccessfulRun(restart(run.state), to);
  assert.equal(restartRun.changed, false);
  const recap = pendingRecap(restartRun.state);
  assert.deepEqual(recap.from, from);
  assert.deepEqual(recap.to, to);
  assert.deepEqual(recap.releases.map(r => r.version), ['1.10.0', '1.11.0']);
});

test('only explicit acknowledgement clears pending; stale acknowledgement is a no-op', () => {
  const old = first(stable('1.8.0'));
  const update = recordSuccessfulRun(old, stable('1.9.0')).state;
  const next = recordSuccessfulRun(update, stable('1.11.0')).state;
  assert.deepEqual(pendingRecap(next).releases.map(r => r.version), ['1.9.0', '1.10.0', '1.11.0']);
  assert.equal(acknowledge(next, pendingRecap(update).id).changed, false);
  const dismissed = acknowledge(next, pendingRecap(next).id);
  assert.equal(dismissed.changed, true);
  assert.equal(dismissed.state.acknowledged.id, pendingRecap(next).id);
  assert.equal(pendingRecap(recordSuccessfulRun(restart(dismissed.state), stable('1.11.0')).state), null);
});

test('new install, unknown predecessor and damaged state never invent an upgrade', () => {
  const to = stable('1.11.0');
  const fresh = recordSuccessfulRun(null, to, { freshInstall: true, trustedPreviousRun: stable('1.9.0') });
  assert.equal(fresh.reason, 'fresh');
  assert.equal(pendingRecap(fresh.state), null);
  const unknown = recordSuccessfulRun(null, to);
  assert.equal(unknown.reason, 'unknown');
  assert.equal(pendingRecap(unknown.state), null);
  const malformed = [{}, { schema: 2, lastRun: stable('1.9.0') }, { ...first(stable('1.9.0')), pending: { id: 'invalid' } }];
  for (const raw of malformed) {
    const recovered = recordSuccessfulRun(raw, to, { trustedPreviousRun: stable('1.9.0') });
    assert.equal(recovered.reason, 'unknown');
    assert.equal(pendingRecap(recovered.state), null);
  }
  assert.equal(recordSuccessfulRun(null, { version: 'v1.11.0', channel: 'stable' }).changed, false);
});

test('migration accepts an explicitly trusted predecessor only for absent state', () => {
  const to = stable('1.11.0');
  const run = recordSuccessfulRun(null, to, { trustedPreviousRun: stable('1.9.0') });
  assert.equal(run.reason, 'upgrade');
  assert.equal(pendingRecap(run.state).from.version, '1.9.0');
  assert.equal(recordSuccessfulRun(first(to), to, { trustedPreviousRun: stable('1.9.0') }).reason, 'same');
});

test('rollback and channel switches retire pending without synthesizing an upgrade', () => {
  const old = first(stable('1.8.0'));
  const update = recordSuccessfulRun(old, stable('1.10.0')).state;
  const rollback = recordSuccessfulRun(update, stable('1.9.0'));
  assert.equal(rollback.reason, 'rollback');
  assert.equal(pendingRecap(rollback.state), null);
  assert.deepEqual(rollback.state.lastRun, stable('1.9.0'));
  const promoted = recordSuccessfulRun(first(preview('1.8.0')), stable('1.8.0'));
  assert.equal(promoted.reason, 'channel-change');
  assert.equal(pendingRecap(promoted.state), null);
  assert.equal(recordSuccessfulRun(first(preview('0.59.0')), stable('1.11.0')).reason, 'channel-change');
});
