const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { buildCatalog, projectCatalog } = require('../scripts/build-whats-new.cjs');
const { selectRange, history } = require('../src/core/whats-new-catalog.cjs');
const stable = version => ({ version, channel: 'stable' });

test('bundled index equals reviewed sources and selects only the installed interval', () => {
  const catalog = require('../data/whats-new-catalog.json');
  assert.deepEqual(catalog, projectCatalog());
  const range = selectRange(stable('1.9.0'), stable('1.11.0'));
  assert.deepEqual(range.releases.map(r => r.version), ['1.10.0', '1.11.0']);
  assert.deepEqual(range.gaps, []);
  const last = range.releases.at(-1);
  assert.equal(last.changes.length, 4);
  assert.match(last.changes.find(c => c.id === 'desktop-only-preparation').text, /without reading saved preparation data or calling a provider/);
  const source = readFileSync(join(__dirname, '..', last.source), 'utf8');
  for (const change of last.changes) assert.ok(source.replaceAll('**', '').replaceAll('`', '').includes(change.text));
});

test('history is numeric, excludes superseded candidates and isolates opt-in previews', () => {
  const stableHistory = history(stable('1.10.0'));
  assert.deepEqual(stableHistory.slice(0, 3).map(r => r.version), ['1.10.0', '1.9.0', '1.8.0']);
  const preview = version => ({ version, channel: 'preview' });
  assert.deepEqual(selectRange(preview('0.13.4'), preview('0.15.0')).releases.map(r => r.version), ['0.13.7', '0.14.1', '0.15.0']);
  assert.equal(history(preview('1.8.0'))[0].source, 'docs/releases/living-journal-preview-1.8.0.md');
  assert.equal(selectRange(preview('1.8.0'), stable('1.8.0')), null);
});

test('unrecorded interval boundaries are disclosed, not filled by guessing patch numbers', () => {
  assert.deepEqual(selectRange(stable('1.9.1'), stable('1.11.1')).gaps, ['1.9.1', '1.11.1']);
  for (const value of ['v1.9.0', '1.09.0', '1.9.0-beta', '1.9.0\n', '9007199254740992.0.0']) {
    assert.equal(selectRange(stable(value), stable('1.11.0')), null);
  }
  assert.equal(selectRange(stable('1.11.0'), stable('1.9.0')), null);
});

const note = (line = 'repair | fixed | desktop | none') => `# Note\n\n<!-- whats-new: stable -->\n\n<!-- change: ${line} -->\n- **Recover safely.** Read [this](https://example.org) and use \`/reload\`.\n`;
test('current release requires reviewed source, unique known metadata and inert text', () => {
  const pkg = { version: '2.0.0', releaseChannel: 'stable' };
  const build = (files = [['2.0.0.md', note()]]) => buildCatalog(files, pkg);
  assert.throws(() => build([]), /Missing reviewed/);
  assert.throws(() => build([['2.0.0.md', note()], ['2.0.0.md', note()]]), /Duplicate release/);
  assert.throws(() => build([['2.0.0.md', note('repair | fixed | desktop | https://example.org')]]), /Invalid change/);
  assert.throws(() => build([['2.0.0.md', note() + note().split('\n').slice(4).join('\n')]]), /Duplicate change/);
  assert.equal(build().releases[0].changes[0].text, 'Recover safely. Read this and use /reload.');
});

test('repeated changes appear once, but a later correction keeps its own ID and entry', () => {
  const files = [
    ['2.0.0.md', note('baseline | new | desktop | none')],
    ['2.1.0.md', note()], ['2.2.0.md', note()],
    ['2.3.0.md', note('repair-correction | fixed | desktop | none').replace('Recover safely.', 'A correction.')],
  ];
  const pkg = { version: '2.3.0', releaseChannel: 'stable' };
  const catalog = buildCatalog(files, pkg);
  assert.deepEqual(selectRange(stable('2.0.0'), stable('2.3.0'), catalog).releases.flatMap(r => r.changes.map(c => c.id)),
    ['repair', 'repair-correction']);
  assert.deepEqual(selectRange(stable('2.1.0'), stable('2.3.0'), catalog).releases.flatMap(r => r.changes.map(c => c.id)),
    ['repair-correction']);
  assert.throws(() => buildCatalog([...files, ['2.4.0.md', note().replace('Recover safely.', 'Different text.')]], pkg), /Conflicting change ID/);
});
