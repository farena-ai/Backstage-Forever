#!/usr/bin/env node
"use strict";
// Owner CLI. Reads the same env file as the service (default
// ~/bf-community/secrets/bf-community.env) and never prints the salt.
//
//   node admin.js stats
//   node admin.js reports [--all] [--limit N]
//   node admin.js report <id>            show one report with its attached log
//   node admin.js mark-read <id>
//   node admin.js delete-report <id>
//   node admin.js purge-install <hash|installId> [--block]
//   node admin.js hash <installId>        hash a user's install id (for deletion requests)
//   node admin.js pack                    print published counts
process.removeAllListeners("warning");
const { loadConfig, loadEnvFileIfPresent } = require("./lib/config");
const { Store, hashInstall } = require("./lib/store");
const { buildPackData } = require("./lib/pack");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

function usage(code = 1) {
  console.error("usage: node admin.js stats | reports [--all] [--limit N] | report <id> | mark-read <id> | delete-report <id> | purge-install <hash|installId> [--block] | hash <installId> | pack");
  process.exit(code);
}

// Strip terminal control sequences from stored text before printing.
function safe(s) { return String(s ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f\x9b]/g, "?"); }

function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") usage(cmd ? 0 : 1);
  loadEnvFileIfPresent();
  const config = loadConfig();
  const store = new Store(config.dbPath);
  try {
    switch (cmd) {
      case "stats":
        console.log(JSON.stringify(store.stats(), null, 2));
        break;
      case "reports": {
        const all = args.includes("--all");
        const li = args.indexOf("--limit");
        const lim = li >= 0 ? Number(args[li + 1]) : 50;
        if (!Number.isSafeInteger(lim) || lim < 1) usage();
        const rows = store.listReports({ all, limit: lim });
        if (!rows.length) console.log(all ? "No reports." : "No unread reports.");
        for (const r of rows)
          console.log(`#${r.id} ${r.created_at} [${r.category}] app ${safe(r.app_version) || "?"} build ${safe(r.build) || "?"}${r.read ? "" : " (unread)"}${r.log_bytes ? ` log ${r.log_bytes}B` : ""}\n    ${safe(r.preview).replace(/\n/g, " / ")}`);
        break;
      }
      case "report": {
        const r = store.getReport(Number(args[0]));
        if (!r) { console.error("No such report."); process.exitCode = 1; break; }
        console.log(`#${r.id} ${r.created_at} [${r.category}] app ${safe(r.app_version)} build ${safe(r.build)} install ${r.install.slice(0, 16)}…`);
        console.log(`\n${safe(r.text)}\n`);
        if (r.log) console.log(`--- attached log (${Buffer.byteLength(r.log)} bytes) ---\n${safe(r.log)}\n--- end log ---`);
        store.markRead(r.id);
        break;
      }
      case "mark-read":
        console.log(store.markRead(Number(args[0])) ? "Marked read." : "No such report.");
        break;
      case "delete-report":
        console.log(store.deleteReport(Number(args[0])) ? "Deleted." : "No such report.");
        break;
      case "purge-install": {
        const target = String(args[0] || "");
        let hash;
        if (HASH.test(target)) hash = target;
        else if (UUID.test(target)) hash = hashInstall(config.salt, target);
        else usage();
        const r = store.purgeInstall(hash, { block: args.includes("--block") });
        console.log(`Removed ${r.observations} observation rows and ${r.reports} reports${r.blocked ? "; install blocked" : ""}.`);
        break;
      }
      case "hash":
        if (!UUID.test(String(args[0] || ""))) usage();
        console.log(hashInstall(config.salt, args[0]));
        break;
      case "pack": {
        const data = buildPackData(store, config.minInstalls);
        console.log(JSON.stringify(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.rows.length])), null, 2));
        break;
      }
      default:
        usage();
    }
  } finally {
    store.close();
  }
}

try {
  main(process.argv.slice(2));
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
