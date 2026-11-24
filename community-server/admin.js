#!/usr/bin/env node
"use strict";
// Owner CLI. Reads the same env file as the service (default
// ~/bf-community/secrets/bf-community.env) and never prints the salt.
//
// Community data
//   node admin.js stats
//   node admin.js reports [--all] [--limit N]
//   node admin.js report <id>            show one old-style report with its attached log
//   node admin.js mark-read <id>
//   node admin.js delete-report <id>
//   node admin.js purge-install <hash|installId> [--block]
//   node admin.js hash <installId>        hash a user's install id (for deletion requests)
//   node admin.js pack                    print published counts
//
// Backstage Desk
//   node admin.js admin-add <name>        new admin; asks for a password, prints the authenticator setup
//   node admin.js admin-password <name>   new password for an admin
//   node admin.js admin-reset-totp <name> new authenticator secret (signs the admin out)
//   node admin.js admin-disable <name>    / admin-enable <name> / admin-unlock <name>
//   node admin.js admins
//   node admin.js tickets [--all] [--limit N]
//   node admin.js ticket <BF-1042>
//   node admin.js reply <BF-1042> <text>  reply to the player as the team
//   node admin.js rollup                  run the retention job and prune sessions now
//   node admin.js backup                  write today's database copy now
//   node admin.js notify-test             send a harmless test to whatever alerts are configured
process.removeAllListeners("warning");
const { loadConfig, loadEnvFileIfPresent } = require("./lib/config");
const { Store, hashInstall } = require("./lib/store");
const { buildPackData } = require("./lib/pack");
const { Auth } = require("./lib/auth");
const { Notifier } = require("./lib/notify");
const { runMaintenance } = require("./lib/maintenance");
const { runBackup, retentionStatus } = require("./lib/stats");
const V = require("./lib/validate-desk");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const CLI = { id: null, name: "(command line)" };

function usage(code = 1) {
  console.error(`usage: node admin.js <command>
  stats | reports [--all] [--limit N] | report <id> | mark-read <id> | delete-report <id>
  purge-install <hash|installId> [--block] | hash <installId> | pack
  admin-add <name> | admin-password <name> | admin-reset-totp <name> | admin-disable <name> | admin-enable <name> | admin-unlock <name> | admins
  tickets [--all] [--limit N] | ticket <BF-nnnn> | reply <BF-nnnn> <text>
  rollup | backup | notify-test`);
  process.exit(code);
}

// Strip terminal control sequences from stored text before printing.
function safe(s) { return String(s ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "?"); }

function limitArg(args, fallback = 50) {
  const li = args.indexOf("--limit");
  const lim = li >= 0 ? Number(args[li + 1]) : fallback;
  if (!Number.isSafeInteger(lim) || lim < 1) usage();
  return lim;
}

function ticketArg(value) {
  const text = String(value || "");
  const n = V.ticketNumber(/^\d+$/.test(text) ? V.ticketLabel(Number(text)) : text.toUpperCase());
  if (n === null) usage();
  return n;
}

// Reads a password from the terminal without showing it. When input is piped
// (a script), the first line of standard input is the password.
let piped = null;
function readPassword(prompt) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    if (!piped) {
      piped = new Promise((resolve, reject) => {
        let buf = "";
        stdin.setEncoding("utf8");
        stdin.on("data", (c) => { buf += c; if (buf.length > 4096) reject(new Error("password input is too long")); });
        stdin.on("end", () => resolve(buf.split(/\r?\n/)));
        stdin.on("error", reject);
      });
    }
    return piped.then((lines) => lines[0] ?? "");
  }
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    let buf = "";
    const done = (fn, value) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); process.stderr.write("\n"); fn(value); };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\x04") return done(resolve, buf);
        if (ch === "\x03") return done(reject, new Error("cancelled"));
        if (ch === "\x7f" || ch === "\b") buf = buf.slice(0, -1);
        else if (ch >= " ") buf += ch;
      }
    };
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

async function newPassword(auth) {
  const first = await readPassword("Password (at least 14 characters, not shown): ");
  auth.checkPassword(first);
  if (process.stdin.isTTY) {
    const second = await readPassword("Again: ");
    if (first !== second) throw new Error("the two passwords are not the same");
  }
  return first;
}

function printTotp(r) {
  console.log(`Admin "${r.name}" is ready. Add this to an authenticator app now; it is not shown again.`);
  console.log(`  Secret (type it in by hand): ${r.secret}`);
  console.log(`  Or as a link / QR text:      ${r.uri}`);
  console.log("Sign in with the name, the password and the 6-digit code from the app.");
}

function deskStats(store, now = Date.now()) {
  const db = store.db, c = (sql, ...a) => db.prepare(sql).get(...a).c;
  const since = (days) => new Date(now - days * 86400000).toISOString().slice(0, 10);
  const st = retentionStatus(store, now);
  return {
    activeInstalls: {
      today: c("SELECT COUNT(*) AS c FROM heartbeats WHERE day = ?", since(0)),
      last7Days: c("SELECT COUNT(DISTINCT install) AS c FROM heartbeats WHERE day > ?", since(7)),
      last30Days: c("SELECT COUNT(DISTINCT install) AS c FROM heartbeats WHERE day > ?", since(30)),
      everSeen: c("SELECT COUNT(*) AS c FROM first_seen"),
    },
    tickets: store.desk.ticketCounts(),
    errorGroups: c("SELECT COUNT(*) AS c FROM error_groups"),
    announcementsLive: store.desk.activeAnnouncements({ appVersion: null, os: null, lang: null }, now).length,
    admins: c("SELECT COUNT(*) AS c FROM admins WHERE disabled = 0"),
    retention: { heartbeatsKeptFrom: st.cutoff, oldestHeartbeat: st.oldestHeartbeat, lastRun: st.lastRun, lastBackup: st.lastBackup },
    databaseBytes: st.dbBytes,
  };
}

async function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") usage(cmd ? 0 : 1);
  loadEnvFileIfPresent();
  const config = loadConfig();
  const store = new Store(config.dbPath);
  const auth = new Auth({ store, salt: config.salt, options: config.auth || {} });
  const desk = store.desk;
  try {
    switch (cmd) {
      case "stats":
        console.log(JSON.stringify({ ...store.stats(), desk: deskStats(store) }, null, 2));
        break;
      case "reports": {
        const all = args.includes("--all");
        const rows = store.listReports({ all, limit: limitArg(args) });
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
        desk.audit(CLI, "install_purge", `install ${hash.slice(0, 8)}`, `observations=${r.observations} reports=${r.reports} tickets=${r.tickets} heartbeats=${r.heartbeats} blocked=${r.blocked}`);
        console.log(`Removed ${r.observations} observation rows, ${r.reports} reports, ${r.tickets} tickets and ${r.heartbeats} heartbeat rows${r.blocked ? "; install blocked" : ""}.`);
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

      // ------------------------------------------------------------- admins
      case "admin-add": {
        const name = auth.normalizeName(args[0]);
        if (auth.getAdmin(name)) throw new Error("an admin with that name already exists");
        const r = await auth.createAdmin(name, await newPassword(auth));
        desk.audit(CLI, "admin_add", r.name);
        printTotp(r);
        break;
      }
      case "admin-password": {
        if (!auth.getAdmin(String(args[0] || ""))) throw new Error("no such admin");
        const name = await auth.setPassword(args[0], await newPassword(auth));
        desk.audit(CLI, "admin_password", name);
        console.log(`Password changed for "${name}". They are signed out everywhere.`);
        break;
      }
      case "admin-reset-totp": {
        const r = auth.resetTotp(String(args[0] || ""));
        desk.audit(CLI, "admin_reset_totp", r.name);
        printTotp(r);
        break;
      }
      case "admin-disable":
      case "admin-enable": {
        const name = auth.setDisabled(String(args[0] || ""), cmd === "admin-disable");
        if (!name) throw new Error("no such admin");
        desk.audit(CLI, cmd.replace("-", "_"), name);
        console.log(cmd === "admin-disable" ? `"${name}" is disabled and signed out.` : `"${name}" can sign in again.`);
        break;
      }
      case "admin-unlock": {
        if (!auth.getAdmin(String(args[0] || ""))) throw new Error("no such admin");
        auth.unlock(args[0]);
        desk.audit(CLI, "admin_unlock", auth.getAdmin(args[0]).name);
        console.log("Sign-in lock cleared.");
        break;
      }
      case "admins": {
        const rows = auth.listAdmins();
        if (!rows.length) console.log("No admins yet. Make one with: node admin.js admin-add <name>");
        for (const a of rows) console.log(`${a.name}${a.disabled ? " (disabled)" : ""}  created ${a.created_at}  last sign-in ${a.last_login_at || "never"}  sessions ${a.sessions}`);
        break;
      }

      // ------------------------------------------------------------ tickets
      case "tickets": {
        const list = desk.listTickets({ filter: args.includes("--all") ? "all" : "open" });
        const rows = list.rows.slice(0, limitArg(args, 25));
        if (!rows.length) console.log("No tickets.");
        for (const t of rows)
          console.log(`${V.ticketLabel(t.id)} ${t.updated_at} [${t.status}] ${t.kind}/${t.area} app ${t.app_version || "?"} ${t.os || "internal"}  msgs ${t.messages}\n    ${safe(t.summary).replace(/\n/g, " / ")}`);
        if (list.total > rows.length) console.log(`… ${list.total - rows.length} more. The admin area shows them all.`);
        break;
      }
      case "ticket": {
        const id = ticketArg(args[0]), t = desk.getTicket(id);
        if (!t) { console.error("No such ticket."); process.exitCode = 1; break; }
        console.log(`${V.ticketLabel(t.id)} [${t.status}${t.fixed_in ? `, fixed in ${t.fixed_in}` : ""}] ${t.kind}/${t.area}${t.frequency ? ` (${t.frequency})` : ""}`);
        console.log(`app ${t.app_version || "?"} addon ${t.addon_version || "?"} ${t.os || "?"} ${t.os_major || ""} lang ${t.lang || "?"} build ${t.build || "?"} install ${t.install ? t.install.slice(0, 8) : "none (internal)"}`);
        console.log(`opened ${t.created_at}  updated ${t.updated_at}${t.severity ? `  severity ${t.severity}` : ""}${t.tags ? `  tags ${t.tags}` : ""}`);
        console.log(`\nSummary: ${safe(t.summary)}`);
        if (t.expected) console.log(`Expected: ${safe(t.expected)}`);
        if (t.diagnostics) console.log(`Diagnostics: ${safe(t.diagnostics)}`);
        for (const m of desk.ticketMessages(id)) console.log(`\n--- ${m.sender}${m.admin_name ? ` (${m.admin_name})` : ""} ${m.at} ---\n${safe(m.text)}`);
        break;
      }
      case "reply": {
        const id = ticketArg(args[0]), t = desk.getTicket(id);
        if (!t || !t.install) { console.error("No such ticket, or it has no player."); process.exitCode = 1; break; }
        const text = V.deskText(args.slice(1).join(" "), "text", 1, V.DESK_LIMITS.message);
        const r = desk.adminReply(id, null, text, null);
        desk.audit(CLI, "ticket_reply", V.ticketLabel(id), `status=${r.status}`);
        console.log(`Reply sent on ${V.ticketLabel(id)}. Status: ${r.status}.`);
        break;
      }

      // -------------------------------------------------------- maintenance
      case "rollup": {
        const r = runMaintenance({ store, auth, config, backup: false, log: (l) => console.error(l) });
        if (!r.retention) { process.exitCode = 1; break; }
        console.log(`Heartbeat rows are kept from ${r.retention.cutoff}. Rolled up ${r.retention.months.length} month(s)${r.retention.months.length ? ` (${r.retention.months.join(", ")})` : ""}, removed ${r.retention.heartbeatsDeleted} heartbeat rows and ${r.retention.errorRowsDeleted} old error counts.`);
        if (r.pruned) console.log(`Pruned ${r.pruned.sessions} expired sessions and ${r.pruned.attempts} old sign-in counters.`);
        break;
      }
      case "backup": {
        if (!config.backupDir) throw new Error("backups are switched off (BF_DESK_BACKUP_DIR)");
        const r = runBackup(store, config.backupDir, Date.now(), config.backupKeep);
        console.log(r.created ? `Wrote ${r.file}` : `Today's copy already exists: ${r.file}`);
        break;
      }
      case "notify-test": {
        const n = new Notifier({ config, log: (l) => console.error(l) });
        const on = n.channels();
        if (!on.email && !on.discord) { console.log("No alerts are configured. Set BF_DESK_NOTIFY_EMAIL and/or BF_DESK_DISCORD_WEBHOOK in the env file."); break; }
        const r = await n.test();
        if ("email" in r) console.log(`E-mail to ${config.notify.email.length} address(es): ${r.email ? "handed to sendmail" : "FAILED"}`);
        if ("discord" in r) console.log(`Discord webhook: ${r.discord ? "accepted" : "FAILED"}`);
        if (Object.values(r).includes(false)) process.exitCode = 1;
        break;
      }
      default:
        usage();
    }
  } finally {
    store.close();
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
