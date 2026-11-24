"use strict";
// Housekeeping, run every hour inside the service and by `admin.js rollup`:
//  - heartbeat rows older than 13 months are rolled into monthly totals and deleted;
//  - expired admin sessions and old sign-in counters are pruned;
//  - once a day (after 03:00 UTC) the database is copied to a dated file and
//    only the newest copies are kept.
// It never throws: a failed step is logged (no data in the message) and the
// next run tries again.
const { runRetention, runBackup } = require("./stats");

function runMaintenance({ store, auth, config, now = Date.now(), log = () => {}, backup = true }) {
  const out = { retention: null, pruned: null, backup: null };
  const step = (name, fn) => {
    try { return fn(); } catch (e) { log(`${new Date(now).toISOString()} maintenance ${name} failed: ${e && e.code ? e.code : "error"}`); return null; }
  };
  out.retention = step("retention", () => runRetention(store, now));
  if (auth) out.pruned = step("prune", () => auth.prune(now));
  if (backup && config.backupDir && new Date(now).getUTCHours() >= 3) out.backup = step("backup", () => runBackup(store, config.backupDir, now, config.backupKeep));
  if (out.retention && out.retention.months.length) log(`${new Date(now).toISOString()} maintenance rolled up ${out.retention.months.length} month(s), removed ${out.retention.heartbeatsDeleted} heartbeat rows`);
  if (out.backup && out.backup.created) log(`${new Date(now).toISOString()} maintenance wrote the nightly backup`);
  return out;
}

// Starts the hourly timer. Returns a function that stops it.
function startMaintenance(ctx, { firstDelayMs = 60_000, everyMs = 3_600_000 } = {}) {
  const tick = () => runMaintenance({ ...ctx, now: Date.now() });
  const first = setTimeout(tick, firstDelayMs), timer = setInterval(tick, everyMs);
  first.unref(); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { runMaintenance, startMaintenance };
