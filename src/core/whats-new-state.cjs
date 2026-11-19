const { releaseIdentity, compareVersions, selectRange } = require('./whats-new-catalog.cjs');

function interval(from, to) {
  if (!from || !to || from.channel !== to.channel || compareVersions(from.version, to.version) >= 0) return null;
  return { id: `${to.channel}:${from.version}..${to.version}`, from, to };
}

function readInterval(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const value = interval(releaseIdentity(raw.from), releaseIdentity(raw.to));
  return value?.id === raw.id ? value : null;
}

function readState(raw) {
  if (!raw || raw.schema !== 1) return null;
  const lastRun = releaseIdentity(raw.lastRun);
  const pending = readInterval(raw.pending);
  const acknowledged = readInterval(raw.acknowledged);
  if (!lastRun || (raw.pending !== null && !pending) || (raw.acknowledged !== null && !acknowledged)) return null;
  if (pending && (pending.to.version !== lastRun.version || pending.to.channel !== lastRun.channel || pending.id === acknowledged?.id)) return null;
  return { schema: 1, lastRun, pending, acknowledged };
}

// Call only after a successful installed run. Persist the entire returned snapshot in
// one atomic write, before exposing its range. An absent file is null/undefined;
// malformed bytes, read errors, and unknown schemas are not migration evidence.
function recordSuccessfulRun(raw, running, { freshInstall = false, trustedPreviousRun = null } = {}) {
  const current = readState(raw);
  const lastRun = releaseIdentity(running);
  if (!lastRun) return { reason: 'invalid-running', changed: false, state: current };
  const previous = current?.lastRun || (raw == null && !freshInstall ? releaseIdentity(trustedPreviousRun) : null);
  if (current && previous.channel === lastRun.channel && previous.version === lastRun.version) {
    return { reason: 'same', changed: false, state: current };
  }
  const acknowledged = current?.acknowledged || null;
  let reason = 'unknown', pending = null;
  if (previous) {
    if (previous.channel !== lastRun.channel) reason = 'channel-change';
    else {
      const direction = compareVersions(previous.version, lastRun.version);
      reason = direction === 0 ? 'same' : direction < 0 ? 'upgrade' : 'rollback';
      if (reason === 'upgrade') {
        const range = interval(current?.pending?.from || previous, lastRun);
        if (range.id !== acknowledged?.id) pending = range;
      }
    }
  } else if (raw == null && freshInstall) reason = 'fresh';
  return { reason, changed: true, state: { schema: 1, lastRun, pending, acknowledged } };
}

// Deferring does not mutate state. Acknowledge only the interval the player saw,
// not one that may have replaced it since the presentation was opened.
function acknowledge(raw, id) {
  const state = readState(raw);
  if (!state?.pending || state.pending.id !== id) return { changed: false, state };
  return { changed: true, state: { ...state, pending: null, acknowledged: state.pending } };
}

function pendingRecap(raw) {
  const pending = readState(raw)?.pending;
  return pending ? { ...pending, ...selectRange(pending.from, pending.to) } : null;
}

module.exports = { recordSuccessfulRun, acknowledge, pendingRecap };
