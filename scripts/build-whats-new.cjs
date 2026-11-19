const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { versionParts, compareVersions, releaseIdentity } = require('../src/core/whats-new-catalog.cjs');

const previewSource = 'living-journal-preview-1.8.0.md';
const superseded = {
  '0.12.3': ['0.9.0', '0.10.0', '0.11.0', '0.12.0', '0.12.1', '0.12.2'],
  '0.13.4': ['0.13.0', '0.13.1', '0.13.2', '0.13.3'],
  '0.13.7': ['0.13.5', '0.13.6'],
  '0.14.1': ['0.14.0'],
};
const kinds = ['new', 'improved', 'fixed', 'compatibility'];
const platforms = ['desktop', 'windows', 'macos', 'addon'];
const actions = ['companion', 'workshop', 'ledger', 'badges', 'now', 'guided-route', 'atlas'];
const root = path.join(__dirname, '..');

// Plain display text, not a Markdown renderer. Links contribute labels, never destinations.
function plain(text) {
  return text.replace(/!?(\[[^\]\n]*\])\((?:[^()\n]|\([^()\n]*\))*\)/g, (_, label) => label.slice(1, -1))
    .replace(/<!--[^]*?-->/g, '').replace(/<[^<>]*>/g, '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();
}

function parseNote(markdown, filename, annotated) {
  const lines = markdown.replace(/\r\n/g, '\n').trim().split('\n');
  const heading = lines.shift();
  if (!/^# \S/.test(heading) || !plain(heading.slice(2))) throw new Error(`Missing title in ${filename}`);
  const channel = /^<!-- whats-new: (stable|preview) -->$/.exec(lines.find(line => line.trim()) || '')?.[1];
  if (annotated && !channel) throw new Error(`Missing reviewed release channel in ${filename}`);
  const changes = [];
  const ids = new Set();
  let section = 'Changes', pending = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('<!-- change')) {
      const match = /^<!-- change: ([a-z][a-z0-9-]*) \| (\w+) \| ([a-z,]+) \| ([a-z-]+) -->$/.exec(line);
      if (!annotated || !match || pending || !kinds.includes(match[2]) ||
          match[3].split(',').some(p => !platforms.includes(p)) || new Set(match[3].split(',')).size !== match[3].split(',').length ||
          (match[4] !== 'none' && !actions.includes(match[4]))) throw new Error(`Invalid change metadata in ${filename}`);
      if (ids.has(match[1])) throw new Error(`Duplicate change ${match[1]} in ${filename}`);
      pending = { id: match[1], kind: match[2], platforms: match[3].split(','), action: match[4] === 'none' ? null : match[4] };
      continue;
    }
    if (!line || /^<!-- whats-new: (stable|preview) -->$/.test(line)) continue;
    if (/^#{2,6} /.test(line)) {
      if (pending) throw new Error(`Invalid change block in ${filename}`);
      section = plain(line.replace(/^#+ /, ''));
      continue;
    }
    const bullet = /^(?:[-*+] |\d+\. )/;
    const block = [line.replace(bullet, '')];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(?:#{1,6} |<!--|[-*+] |\d+\. )/.test(lines[i + 1].trim())) {
      block.push(lines[++i].trim());
    }
    if (annotated && !pending) {
      if (bullet.test(line)) throw new Error(`Unreviewed change bullet in ${filename}`);
      continue; // Publication/installation prose is not recap content unless explicitly marked.
    }
    const text = plain(block.join(' '));
    if (!text) throw new Error(`Empty change in ${filename}`);
    const legacyId = 'history-' + createHash('sha256').update(text).digest('hex').slice(0, 24);
    const metadata = pending || { id: legacyId, kind: 'history', platforms: [], action: null };
    if (!ids.has(metadata.id)) changes.push({ ...metadata, section, text });
    ids.add(metadata.id);
    pending = null;
  }
  if (pending || !changes.length) throw new Error(`Missing reviewed change text in ${filename}`);
  return { title: plain(heading.slice(2)), channel, changes };
}

function buildCatalog(files, pkg) {
  const running = releaseIdentity({ version: pkg.version, channel: pkg.releaseChannel });
  if (!running) throw new Error('Invalid package release identity');
  const releases = [], identities = new Set(), excluded = [], reviewed = new Map();
  for (const [filename, markdown] of files) {
    const optIn = filename === previewSource;
    const version = optIn ? '1.8.0' : filename.slice(0, -3);
    if (!filename.endsWith('.md') || !versionParts(version)) throw new Error(`Invalid release source ${filename}`);
    const annotated = !optIn && (compareVersions(version, '1.9.0') >= 0 || version === running.version);
    const { title, channel: declared, changes } = parseNote(markdown, filename, annotated);
    const channel = annotated ? declared : optIn || version.startsWith('0.') ? 'preview' : 'stable';
    const key = `${channel}:${version}`;
    if (identities.has(key)) throw new Error(`Duplicate release ${key}`);
    identities.add(key);
    const source = `docs/releases/${filename}`;
    const successor = Object.keys(superseded).find(v => channel === 'preview' && superseded[v].includes(version));
    if (successor) excluded.push({ version, channel, source, supersededBy: successor });
    else {
      for (const change of changes) {
        if (change.kind === 'history') continue;
        const changeKey = `${channel}:${change.id}`;
        const payload = JSON.stringify(change);
        if (reviewed.has(changeKey) && reviewed.get(changeKey) !== payload) throw new Error(`Conflicting change ID ${change.id}; give corrections new IDs`);
        reviewed.set(changeKey, payload);
      }
      releases.push({ version, channel, source, title, changes });
    }
  }
  if (!releases.some(r => r.version === running.version && r.channel === running.channel)) throw new Error('Missing reviewed notes for the current package release');
  for (const candidate of excluded) {
    if (!releases.some(r => r.channel === candidate.channel && r.version === candidate.supersededBy)) {
      throw new Error(`Missing reviewed successor ${candidate.supersededBy} for ${candidate.version}`);
    }
  }
  const order = (a, b) => compareVersions(a.version, b.version) || (a.channel === b.channel ? 0 : a.channel === 'preview' ? -1 : 1);
  const missing = [{ version: '0.1.0', channel: 'preview' }].filter(entry => !identities.has(`${entry.channel}:${entry.version}`));
  return { schema: 1, releases: releases.sort(order), excluded: excluded.sort(order), missing };
}

function projectCatalog() {
  const dir = path.join(root, 'docs/releases');
  return buildCatalog(fs.readdirSync(dir).filter(name => /\.md$/i.test(name)).sort()
    .map(name => [name, fs.readFileSync(path.join(dir, name), 'utf8')]), require('../package.json'));
}

if (require.main === module) {
  const output = path.join(root, 'data/whats-new-catalog.json');
  const next = JSON.stringify(projectCatalog(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8').replace(/\r\n/g, '\n') !== next) {
      console.error('What’s New catalog is stale. Run npm run build:whats-new and commit the result.');
      process.exitCode = 1;
    }
  } else fs.writeFileSync(output, next);
}

module.exports = { buildCatalog, projectCatalog };
