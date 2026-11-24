"use strict";
// Guild and party features: the wording of the opt-in category lives in privacy-wording.js, lists
// every field the builders can send (and no field that is not sent), is used by the app's screens and
// the website's privacy page, and is translated in full. The approved statistics sentences are untouched.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const W = require("../src/renderer/privacy-wording.js");
const G = require("../src/core/guild-service.cjs");
const { sessionBody } = require("../src/core/live-client.cjs");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const flat = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${pre}${k}.`) : [`${pre}${k}`]));
const listed = (name) => W.FIELDS[name].map(([k]) => k).sort();
const ID = "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f", ABEL = { name: "Abel", realm: "Thunder Hold" };

test("the approved sentences did not change, and the new category says what, with whom and how to leave", () => {
  assert.equal(W.SWITCHES.statistics.text, "Once a day the app sends its version, your operating system family, your language, the game build, and which main areas you opened. Nothing about your account or your game is included: no account, character, realm or guild names, no files, no chat. It is only counted with other installs to improve the software, and it cannot be tied back to you.");
  assert.equal(W.SUMMARY, "Your characters stay on your computer. The app shares only what the live map needs and anonymous statistics that help improve it, with no account, character or realm names and no files. Reports are sent only when you write one. Each of these has its own off switch.");
  assert.deepEqual(W.NEVER.length, 5);
  assert.equal(W.GUILD.label, "Guild and party features (only if you join)");
  assert.deepEqual(W.GUILD.join, ["Your guild", "uses Backstage Forever events. Joining shares your character's name and your sign-ups with your guild's members and its Discord. It never shares your account, files or chat."]);
  assert.equal(W.GUILD.board, "This shows your character's name, level and role to other Backstage Forever users on your realm and faction for 30 minutes.");
  assert.equal(W.GUILD.who.length, 3); assert.equal(W.GUILD.leave.length, 4);
  assert.match(W.GUILD.text, /^Off until you join\./); assert.match(W.GUILD.exception, /only if you choose it/);
  for (const s of W.GUILD.leave) assert.match(s, /Leave|Remove|Delete our guild's data|Forget me/);
});

test("every field a guild, board or live request can carry has a plain-words row, and no row names a field that is not sent", () => {
  assert.deepEqual(listed("guildJoin"), flat(G.joinBody({ installId: ID, linkCode: "BFG-7K2M-Q9XD", character: ABEL, rankIndex: 4, consent: true })).filter((k) => k !== "schema").sort());
  assert.deepEqual(listed("guildCreate"), flat(G.createBody({ installId: ID, character: ABEL, faction: "horde", guildName: "Ashen Vanguard", rankIndex: 0 })).filter((k) => k !== "schema").sort());
  const event = G.eventShape({ id: "mc7k2m9q", version: 1, creator: ABEL, editor: ABEL, at: "2026-11-27T19:00:00Z", place: "mc", title: "Molten Core", note: "", roles: { tank: 2, healer: 8, damage: 30 }, cancelled: false });
  assert.deepEqual(listed("guildEvent"), flat(event).sort());
  assert.deepEqual(listed("guildSignup"), flat(G.signupShape({ who: ABEL, answer: "healer", version: 1, via: "desktop" })).sort());
  const listing = { id: "abcdefgh12345678", kind: "lfm", who: ABEL, level: 34, class: "hunter", roles: ["damage"], place: "sm", note: "", need: { tank: 1, healer: 0, damage: 2 }, at: "2026-11-27T19:00:00Z" };
  const board = flat(G.listingBody({ installId: ID, realm: "Thunder Hold", faction: "horde", listing, consent: true })).filter((k) => k !== "schema").map((k) => k.replace(/^listing\.need\..*$/, "listing.need"));
  assert.deepEqual(listed("board"), [...new Set(board)].sort());
  assert.deepEqual(listed("boardRead"), ["faction", "realm"]);
  assert.deepEqual(listed("guildMember"), ["X-BF-Member", "code"]);
  const session = sessionBody(ID, { tickets: [{ ticket: "BF-1", key: "k".repeat(43) }], guild: [{ guildId: "g_a", member: "m".repeat(43) }], lfg: [{ realm: "Thunder Hold", faction: "horde" }] });
  assert.deepEqual(listed("live"), ["installId", ...session.subs.map((s) => `subs.${s.t}`)].sort());
  for (const name of ["guildJoin", "guildCreate", "guildEvent", "guildSignup", "guildMember", "board", "boardRead", "live"]) for (const [, label] of W.FIELDS[name]) assert.ok(label.trim(), `${name} has a label for every field`);
  // The source of each request is the service file; nothing else builds a guild or board request.
  const service = read("src/core/guild-service.cjs");
  assert.match(service, /headers: member \? \{ "X-BF-Member": member \} : \{\}/);
  assert.doesNotMatch(service, /console\.|\.log\(/, "nothing is logged, so no key can end up in a log");
  for (const file of ["src/renderer/live-guild.js", "src/renderer/guild-panel.js", "src/core/live-guild-ipc.cjs", "src/core/guild-panel-window.cjs"]) assert.doesNotMatch(read(file), /\bg\.member\b|X-BF-Member|state\.guilds/, `${file} never touches a member key`);
});

test("the screens and the website take the sentences from the one file", () => {
  const screen = read("src/renderer/live-guild.js");
  for (const use of ["W.GUILD.join[0]", "W.GUILD.join[1]", "W.GUILD.board", "W.GUILD.boardHolds", "W.GUILD.boardOn", "W.GUILD.leader", "W.GUILD.label", "W.GUILD.text", "W.FIELDS.guildJoin", "W.FIELDS.guildSignup", "W.FIELDS.guildMember", "W.FIELDS.guildCreate", "W.FIELDS.guildEvent", "W.FIELDS.board", "W.FIELDS.boardRead", "W.FIELDS.live", "W.GUILD.leave"]) assert.ok(screen.includes(use), use);
  assert.doesNotMatch(screen, /Joining shares your character's name/, "not repeated in the screen code");
  assert.match(read("src/renderer/desk.js"), /window\.LiveGuild\?\.privacyHtml\(\)/); assert.match(read("src/renderer/desk.js"), /W\.GUILD\.exception/);
  const site = read("scripts/build-site.cjs");
  for (const use of ["GUILD.label", "GUILD.text", "GUILD.who", "GUILD.join[0]", "GUILD.board", "GUILD.leave", "GUILD.exception", "FIELDS.guildJoin", "FIELDS.guildSignup", "FIELDS.guildMember", "FIELDS.guildCreate", "FIELDS.guildEvent", "FIELDS.board", "FIELDS.boardRead", "FIELDS.live"]) assert.ok(site.includes(use), `the website's privacy page uses ${use}`);
  const notes = read("docs/PRIVACY.md");
  assert.ok(notes.includes(W.GUILD.label), "the privacy notes name the category"); assert.ok(notes.replace(/\r\n/g, "\n").includes(W.GUILD.text));
  // The page is reachable: a guide under Help, cards on Plans → Guild and Plans → Party, no new tab.
  const nav = read("src/renderer/player-navigation.js"), app = read("src/renderer/app.js");
  assert.match(nav, /"guild-guide": \["guide", "Guild & Party guide"\]/);
  assert.equal(nav.match(/routes: \[\["guide", "Field guide"\][^\]]*\](?:, \[[^\]]*\])*\]/)[0].match(/\["/g).length, 5, "Help keeps its five tabs");
  assert.match(app, /"guild-guide": \(\) => LiveGuild\.guidePage\(\)/); assert.match(app, /data-nav="guild-guide">Open the Guild &amp; Party guide/);
  assert.ok(read("scripts/player-navigation.cjs").includes('"guild-guide": ["Help", "Field guide", "Guild & Party guide"]'));
  const html = read("src/renderer/index.html");
  assert.ok(html.indexOf('<script src="privacy-wording.js"></script>') < html.indexOf('<script src="live-guild.js"></script>') && html.indexOf('<script src="live-guild.js"></script>') < html.indexOf('<script src="guild.js"></script>'));
  assert.match(html, /href="live-guild\.css"/); assert.match(html, /<div id="live-dock"><\/div>/);
});

test("German, French and Spanish hold every sentence of the category, the consent cards and the guide's commands", () => {
  const sentences = [W.GUILD.label, W.GUILD.text, ...W.GUILD.join, W.GUILD.board, W.GUILD.boardHolds, W.GUILD.boardOn, W.GUILD.leader, ...W.GUILD.who, ...W.GUILD.leave, W.GUILD.never, W.GUILD.exception, W.GUILD.planner,
    ...["guildJoin", "guildCreate", "guildEvent", "guildSignup", "guildMember", "board", "boardRead", "live"].flatMap((n) => W.FIELDS[n].flatMap(([, label, what]) => [label, what].filter(Boolean))),
    "Join", "Not now", "Never for this guild", "Connect our guild to Discord", "Add to Discord", "Type this in game", "Send a test post", "Link my Discord", "Delete our guild's data", "Rotate code", "Discord connection is not available yet.",
    "Live", "Reconnecting…", "Offline", "Realm party board", "Group planner", "People you have run with", "Renew", "Remove", "What is live, and what waits for /reload",
    ...["offline", "rate", "blocked", "forbidden", "gone", "exists", "invalid", "consent", "full"].map((code) => new G.GuildError(code).message)];
  for (const lang of ["de", "fr", "es"]) {
    const d = JSON.parse(read(`data/i18n/${lang}.json`));
    for (const en of new Set(sentences)) {
      const v = d.app[en];
      assert.ok(typeof v === "string" && v.trim(), `${lang}: ${en.slice(0, 60)}`);
      if (/\/reload/.test(en)) assert.ok(v.includes("/reload"), `${lang}: /reload kept in: ${en.slice(0, 50)}`);
      if (/30/.test(en)) assert.ok(v.includes("30"), `${lang}: the 30 minutes are kept in: ${en.slice(0, 50)}`);
    }
    // The consent sentences are whole: nothing was shortened away.
    assert.ok(d.app[W.GUILD.join[1]].length > W.GUILD.join[1].length * 0.7, `${lang}: the join sentence is complete`);
    assert.notEqual(d.app[W.GUILD.join[1]], W.GUILD.join[1]); assert.notEqual(d.app[W.GUILD.board], W.GUILD.board);
    for (const t of ["{#0} updates will reach the game at your next /reload", "{#0} changes are waiting for the service and will be sent by themselves", "Level {#0}: under level {#1}", "Members who joined ({#0})"]) {
      const v = d.appTemplates[t];
      assert.ok(typeof v === "string" && v.includes("{#0}") && (!t.includes("{#1}") || v.includes("{#1}")), `${lang}: template ${t}`);
    }
  }
});
