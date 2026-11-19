function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) || /\s/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  if (!left || !right) throw new TypeError('Expected strict numeric release versions');
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

function releaseIdentity(value) {
  return value && versionParts(value.version) && ['stable', 'preview'].includes(value.channel)
    ? { version: value.version, channel: value.channel } : null;
}

function history(running, catalog = require('../../data/whats-new-catalog.json')) {
  if (!releaseIdentity(running)) return [];
  return catalog.releases.filter(r => r.channel === running.channel && compareVersions(r.version, running.version) <= 0).reverse();
}

function selectRange(from, to, catalog = require('../../data/whats-new-catalog.json')) {
  if (!releaseIdentity(from) || !releaseIdentity(to) || from.channel !== to.channel || compareVersions(from.version, to.version) >= 0) return null;
  const available = history(to, catalog);
  const gaps = [from, to].filter(boundary => !available.some(r => r.version === boundary.version)).map(r => r.version);
  for (const missing of catalog.missing) {
    if (missing.channel === to.channel && compareVersions(missing.version, from.version) > 0 && compareVersions(missing.version, to.version) < 0) gaps.push(missing.version);
  }
  gaps.sort(compareVersions);
  const keyFor = ({ id, text, kind }) => kind === 'history' ? `history:${text}` : `reviewed:${id}`;
  const seen = new Set(available.filter(r => compareVersions(r.version, from.version) <= 0).flatMap(r => r.changes.map(keyFor)));
  const releases = available.filter(r => compareVersions(r.version, from.version) > 0).reverse().map(r => ({
    ...r,
    changes: r.changes.filter(change => {
      const key = keyFor(change);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  }));
  return { releases, gaps };
}

module.exports = { versionParts, compareVersions, releaseIdentity, history, selectRange };
