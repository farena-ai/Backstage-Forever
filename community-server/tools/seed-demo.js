#!/usr/bin/env node
"use strict";
// Fills a THROWAWAY database with realistic fake data for 120 days so the
// admin dashboard can be looked at. Everything is made up: random install
// hashes, invented report text, no real names.
//
//   node tools/seed-demo.js <dbfile> [--days 120] [--force]
//
// It refuses to touch a file that already exists unless --force is given, and
// it must never be pointed at the live database.
process.removeAllListeners("warning");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { Store } = require("../lib/store");
const { FLAGS, HEARTBEAT_AREAS, TICKET_AREAS } = require("../lib/validate-desk");

const DAY = 86_400_000;

function rng(seed) { // mulberry32: the same demo every time
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function seed(file, { days = 120, now = Date.now(), seedValue = 20261124 } = {}) {
  const rand = rng(seedValue);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const weighted = (pairs) => { let r = rand() * pairs.reduce((a, p) => a + p[1], 0); for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[0][0]; };
  const fakeHash = () => crypto.createHash("sha256").update(`demo-${rand()}-${rand()}`).digest("hex");
  const dayOf = (i) => new Date(now - (days - 1 - i) * DAY).toISOString().slice(0, 10);
  const at = (i, frac = rand()) => Math.min(now - 60_000, Date.UTC(...dayOf(i).split("-").map((v, k) => (k === 1 ? Number(v) - 1 : Number(v)))) + Math.floor(frac * DAY));

  const store = new Store(file);
  const db = store.db, desk = store.desk;
  const releases = [["1.23.2", -40], ["1.24.0", 0], ["1.25.0", Math.round(days * 0.34)], ["1.25.1", Math.round(days * 0.62)], ["1.26.0", Math.round(days * 0.84)]];
  const builds = [["1.60.0.70211", 0], ["1.60.1.71037", Math.round(days * 0.5)]];
  const installs = [];

  store.tx(() => {
    const putHb = db.prepare("INSERT OR REPLACE INTO heartbeats(install, day, app_version, addon_version, channel, os, os_major, lang, build, first_week, flags, areas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const putFirst = db.prepare("INSERT OR IGNORE INTO first_seen(install, day) VALUES (?, ?)");
    for (let d = 0; d < days; d++) {
      // New installs: slow growth, a bump for a few days after each release.
      const bump = releases.some(([, rd]) => d >= rd && d < rd + 4) ? 6 : 0;
      const fresh = Math.max(0, Math.round(3 + d / 30 + bump * rand() + (rand() - 0.5) * 4));
      for (let k = 0; k < fresh; k++) {
        const os = weighted([["windows", 80], ["macos", 13], ["linux", 7]]);
        installs.push({
          hash: fakeHash(), first: d, os,
          osMajor: os === "windows" ? weighted([["11", 68], ["10", 32]]) : os === "macos" ? weighted([["15", 55], ["14", 35], ["13", 10]]) : null,
          lang: weighted([["en", 54], ["de", 31], ["fr", 8], ["es", 7]]),
          channel: weighted([["stable", 93], ["beta", 6], ["dev", 1]]),
          keen: 0.12 + rand() * 0.75, // how often this install opens the app
          quits: rand() < 0.3 ? d + 1 + Math.floor(rand() * 20) : rand() < 0.35 ? d + 20 + Math.floor(rand() * 70) : Infinity,
          lag: Math.floor(rand() * rand() * 30), // days before it takes an update
          stuck: rand() < 0.07, // never updates
          connected: rand() < 0.86, addon: rand() < 0.72, live: rand() < 0.34, sharing: rand() < 0.81,
          tastes: HEARTBEAT_AREAS.map(() => rand()),
          version: null,
        });
      }
      const dayName = dayOf(d), weekend = [0, 6].includes(new Date(`${dayName}T00:00:00Z`).getUTCDay()) ? 1.25 : 1;
      for (const it of installs) {
        if (d > it.quits) continue;
        if (d !== it.first && rand() > it.keen * weekend) continue;
        if (it.version === null) it.version = [...releases].reverse().find(([, rd]) => rd <= it.first)[0];
        if (!it.stuck) for (const [v, rd] of releases) if (d >= rd + it.lag) it.version = v;
        const setup = d - it.first;
        const flags = (it.connected && (setup > 0 || rand() < 0.7) ? 1 : 0) | (it.connected && it.addon && setup > 0 ? 2 : 0) | (it.connected && it.addon && it.live && setup > 2 ? 4 : 0) | (it.sharing ? 8 : 0);
        let areas = 0;
        const reach = [0.9, 0.62, 0.55, 0.3, 0.42, 0.25, 0.36, 0.2, 0.15];
        HEARTBEAT_AREAS.forEach((_, i) => { if (rand() < reach[i] * (0.5 + it.tastes[i])) areas |= 1 << i; });
        const build = flags & 1 ? [...builds].reverse().find(([, bd]) => bd <= d)[0] : null;
        const firstDay = new Date(`${dayOf(it.first)}T00:00:00Z`);
        const wk = `${firstDay.getUTCFullYear()}-W${String(Math.min(53, Math.max(1, Math.ceil(((firstDay - Date.UTC(firstDay.getUTCFullYear(), 0, 1)) / DAY + 1) / 7)))).padStart(2, "0")}`;
        putHb.run(it.hash, dayName, it.version, flags & 2 ? it.version : null, it.channel, it.os, it.osMajor, it.lang, build, wk, flags, areas);
        putFirst.run(it.hash, dayOf(it.first));
      }
    }

    // Community observations in the existing tables.
    const putObs = db.prepare("INSERT OR IGNORE INTO obs(kind, key, install, n, first_day, last_day) VALUES (?, ?, ?, ?, ?, ?)");
    const maps = [1429, 1411, 1412, 1426, 1438, 1413, 1421, 1432, 1440, 1433, 1424, 1437];
    const sharers = installs.filter(i => i.sharing && i.connected);
    for (let d = 0; d < days; d++) {
      const active = sharers.filter(i => i.first <= d && d <= i.quits && rand() < i.keen * 0.5);
      for (const it of active) {
        const n = 1 + Math.floor(rand() * 6);
        for (let k = 0; k < n; k++) {
          const kind = weighted([["herb", 30], ["ore", 24], ["chest", 5], ["npc", 18], ["vendor", 9], ["drop", 11], ["recipe", 3]]);
          const map = pick(maps), x = Math.floor(rand() * 60) * 3, y = Math.floor(rand() * 60) * 3;
          const last = dayOf(Math.min(days - 1, d + Math.floor(rand() * rand() * 20)));
          if (["herb", "ore", "chest"].includes(kind)) putObs.run("node", `${kind}|o${1600 + Math.floor(rand() * 40)}|${map}|${x}|${y}`, it.hash, 1, dayOf(d), last);
          else if (kind === "npc") putObs.run("npc", `${100 + Math.floor(rand() * 900)}|${map}|${x}|${y}`, it.hash, 1, dayOf(d), last);
          else if (kind === "vendor") putObs.run("vendor", `${1200 + Math.floor(rand() * 200)}|${150 + Math.floor(rand() * 800)}`, it.hash, 1, dayOf(d), last);
          else if (kind === "drop") putObs.run("drop", `${400 + Math.floor(rand() * 300)}|${700 + Math.floor(rand() * 900)}`, it.hash, 1 + Math.floor(rand() * 4), dayOf(d), last);
          else putObs.run("recipe", `trainer|${1200 + Math.floor(rand() * 60)}|${2000 + Math.floor(rand() * 400)}|`, it.hash, 1, dayOf(d), last);
        }
      }
    }
    db.prepare("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'revision'").run();
  });

  // Admins used as authors of demo replies (they cannot sign in: the hash is not a real one).
  const adminIds = ["mara", "tobin"].map(name => Number(db.prepare("INSERT INTO admins(name, pw_hash, totp_secret, disabled, created_at) VALUES (?, 'demo-no-login', 'demo', 1, ?)")
    .run(`demo-${name}`, new Date(now - days * DAY).toISOString().replace(/\.\d{3}Z$/, "Z")).lastInsertRowid));

  const SUBJECTS = {
    bug: ["The talent planner shows the wrong tree after a respec", "Map pins vanish when I zoom out twice", "Route step stays ticked after I log to another character", "Ledger total is off by a few copper", "The Now screen is blank until I click another tab", "Dungeon checklist forgets the last boss", "Window opens off screen on my second monitor", "Addon button overlaps my minimap ring"],
    data: ["A herb spot near the river is inside a rock", "Vendor list is missing two recipes", "Wrong level range shown for a dungeon", "Trainer is listed in the wrong town", "Drop rate looks far too high for a common item"],
    translation: ["German text is cut off on the gear screen", "French label still in English on Settings", "Spanish quest hint uses the wrong word for mount"],
    idea: ["Let me pin two routes side by side", "A darker map background would help at night", "Show profession cooldowns in the ledger", "Add a search box to the journey list"],
    other: ["How do I move my data to a new computer?", "Thank you, and one small question about updates"],
  };
  const DETAILS = ["I opened the screen, picked my character and it happened right away. Closing and opening the app did not help.", "Steps: open the app, go to the screen, change one setting, come back. The old value is still shown.", "It worked last week. Since the update it happens every time I try.", "It only happens on one of my characters. The others look fine.", "I am not sure it is a bug, but it looks wrong compared to what I see in the game."];
  const EXPECTED = ["The screen should show what the game shows.", "The value should update without a restart.", "", "It should behave like it did before the update.", ""];
  const TEAM = ["Thanks for the report. Which character class was this on?", "We can see the same thing here and are looking into it.", "This is fixed in the next version. Thank you for the clear steps.", "Could you say which game build the Settings screen shows?", "That spot has been corrected in the community data. It reaches the app with the next daily pack."];
  const PLAYER = ["It was on my druid.", "The Settings screen says 1.60.1.71037.", "Still happens after the update, sadly.", "Works now, thank you!", "It happens on both of my characters."];
  const ERRORS = ["TypeError: Cannot read properties of undefined (reading 'tree')", null, "RangeError: Invalid array length", null, null, "Error: save file is not readable (paths removed)"];

  const ticketCount = Math.round(days * 0.55);
  for (let k = 0; k < ticketCount; k++) {
    const d = Math.min(days - 1, Math.floor(Math.pow(rand(), 0.7) * days));
    const candidates = installs.filter(i => i.first <= d);
    if (!candidates.length) continue;
    const it = pick(candidates), kind = weighted([["bug", 52], ["data", 20], ["idea", 14], ["translation", 8], ["other", 6]]);
    const version = [...releases].reverse().find(([, rd]) => rd <= d)[0];
    const t0 = at(d);
    const made = desk.createTicket(it.hash, {
      kind, area: pick(TICKET_AREAS), frequency: pick(["once", "sometimes", "always", null]), summary: pick(SUBJECTS[kind]), details: pick(DETAILS), expected: pick(EXPECTED),
      appVersion: version, addonVersion: it.addon ? version : null, os: it.os, osMajor: it.osMajor, lang: it.lang, build: it.connected ? builds[d >= builds[1][1] ? 1 : 0][0] : null,
      diagnostics: rand() < 0.85 ? { screen: pick(["talents", "map", "route", "ledger", "now", "settings"]), lastError: pick(ERRORS), gameConnected: it.connected, addonInstalled: it.addon } : null,
    }, t0);
    const age = days - 1 - d, admin = pick(adminIds);
    const stage = age < 2 ? weighted([["new", 70], ["answered", 30]]) : weighted([["new", 6], ["answered", 18], ["back", 14], ["fixed", 34], ["closed", 28]]);
    if (stage === "new") continue;
    const t1 = Math.min(now - 30_000, t0 + (0.5 + rand() * 30) * 3_600_000);
    desk.adminReply(made.id, admin, pick(TEAM), "question", t1);
    desk.updateTicket(made.id, { severity: weighted([["normal", 55], ["low", 20], ["high", 20], ["critical", 5]]), assignee: admin, tags: rand() < 0.5 ? pick(["needs-repro", "talents", "map-data", "ui", "regression"]) : "" }, t1);
    if (rand() < 0.3) desk.addNote(made.id, admin, "Seen on two of our machines as well. Likely the same cause as the earlier report.", t1 + 60_000);
    if (stage === "answered") continue;
    const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(made.id);
    const t2 = Math.min(now - 20_000, t1 + (1 + rand() * 40) * 3_600_000);
    desk.playerReply(row, pick(PLAYER), t2);
    if (stage === "back") continue;
    const t3 = Math.min(now - 10_000, t2 + (2 + rand() * 90) * 3_600_000);
    if (stage === "fixed") {
      desk.adminReply(made.id, admin, TEAM[2], "fixed", t3);
      const next = releases.find(([, rd]) => rd > d);
      desk.updateTicket(made.id, { fixedIn: next ? next[0] : "1.26.1", github: rand() < 0.4 ? `https://github.com/farena-ai/Backstage-Forever/issues/${200 + k}` : null }, t3);
    } else desk.updateTicket(made.id, { status: "closed" }, t3);
  }

  // Automatic error reports.
  const GROUPS = [
    ["TypeError", "Cannot read properties of undefined (reading 'tree')", ["at buildTree (talents.js:212:18)", "at renderPlanner (talents.js:88:5)", "at show (router.js:41:9)"], "renderer", 9],
    ["RangeError", "Invalid array length", ["at pad (ledger.cjs:57:21)", "at totals (ledger.cjs:120:14)", "at handle (ledger-ipc.cjs:33:10)"], "main", 4],
    ["Error", "save file is not readable <path>", ["at readSaved (game-sync.cjs:301:11)", "at refresh (game-sync.cjs:144:7)", "at Timeout.tick (game-sync.cjs:60:5)"], "main", 6],
    ["TypeError", "pin.zone is not a function", ["at drawPin (world-map.js:455:22)", "at drawLayer (world-map.js:390:7)", "at paint (world-map.js:120:3)"], "renderer", 3],
    ["SyntaxError", "Unexpected end of JSON input", ["at JSON.parse (<anonymous>)", "at loadPack (community.cjs:233:20)", "at start (community.cjs:90:9)"], "main", 2],
    ["Error", "ResizeObserver loop completed with undelivered notifications", ["at layout (shell.js:77:3)"], "renderer", 1.5],
  ];
  for (let d = 0; d < days; d++) {
    const version = [...releases].reverse().find(([, rd]) => rd <= d)[0];
    GROUPS.forEach(([name, message, stack, where, weight], gi) => {
      if (gi === 0 && d < releases[2][1]) return; // appears with 1.25.0
      if (gi === 2 && d > releases[3][1] + 5) return; // fixed in 1.25.1
      const n = Math.floor(rand() * weight * (0.4 + d / days));
      for (let k = 0; k < n; k++) desk.recordError({ name, message, stack, where, appVersion: rand() < 0.75 ? version : releases[Math.max(0, releases.findIndex(r => r[0] === version) - 1)][0], os: weighted([["windows", 80], ["macos", 13], ["linux", 7]]) }, at(d));
    });
  }
  desk.ticketFromErrorGroup(1, adminIds[0], now - 2 * DAY);

  const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  desk.saveAnnouncement({ title: "1.26.0 is out", text: "The talent planner reads your saved build again, and the map loads faster.\nThe app updates itself the next time you start it.", level: "info", link: "https://github.com/farena-ai/Backstage-Forever/releases", from: stamp(now - 3 * DAY), until: stamp(now + 11 * DAY), minVersion: null, maxVersion: "1.25.1", os: [], lang: [] }, adminIds[0], now - 3 * DAY);
  desk.saveAnnouncement({ title: "1.25.0: planner problem on macOS", text: "The talent planner can show the wrong tree on macOS. 1.25.1 fixes it.", level: "warning", link: null, from: stamp(now - 50 * DAY), until: stamp(now - 36 * DAY), minVersion: "1.25.0", maxVersion: "1.25.0", os: ["macos"], lang: [] }, adminIds[1], now - 50 * DAY);
  desk.saveAnnouncement({ title: "Winter data refresh", text: "Gathering spots for the northern zones get a full refresh next week.", level: "info", link: null, from: stamp(now + 4 * DAY), until: stamp(now + 18 * DAY), minVersion: null, maxVersion: null, os: [], lang: ["en", "de"] }, adminIds[0], now);
  desk.saveSavedReply({ title: "Ask for the game build", body: "Thanks for the report.\n\nCould you tell us the game build shown under Settings, About? That helps us find it." }, now);
  desk.saveSavedReply({ title: "Fixed in the next version", body: "This is fixed and will be in the next version. The app updates itself when you start it.\n\nThank you for taking the time to write." }, now);
  desk.saveSavedReply({ title: "Community data corrected", body: "That entry has been corrected. It reaches your app with the next daily data pack." }, now);
  desk.audit({ id: adminIds[0], name: "demo-mara" }, "demo_seed", "", `days=${days}`, now);

  const counts = Object.fromEntries(["heartbeats", "first_seen", "obs", "tickets", "messages", "error_groups", "announcements"].map(t => [t, db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c]));
  store.close();
  return counts;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const di = args.indexOf("--days"), days = di >= 0 ? Number(args[di + 1]) : 120;
  const file = args.find((a, i) => !a.startsWith("--") && (di < 0 || i !== di + 1));
  if (!file || !Number.isSafeInteger(days) || days < 7 || days > 400) {
    console.error("usage: node tools/seed-demo.js <dbfile> [--days 120] [--force]\nMakes a demo database. Never point it at the live one.");
    process.exit(1);
  }
  if (fs.existsSync(file) && !args.includes("--force")) {
    console.error(`${file} already exists. Choose a new file name, or pass --force to add demo data to it.`);
    process.exit(1);
  }
  console.log(JSON.stringify(seed(file, { days }), null, 2));
}

module.exports = { seed };
