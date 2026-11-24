"use strict";
// Backstage Live on the desktop: the guild service against the in-test contract server
// (tests/live-fake-server.cjs) with a fake game feed. The fake server's request log is the proof
// for the privacy line: nothing is sent before the player agreed, and nothing after Leave.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { EventEmitter } = require("node:events");
const G = require("../src/core/guild-service.cjs");
const { GuildService, GuildError } = G;
const { LiveClient } = require("../src/core/live-client.cjs");
const { CommunityService } = require("../src/core/community.cjs");
const { fakeLive, validEvent, validSignup, validListing } = require("./live-fake-server.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bf-guild-"));
const until = async (fn, ms = 5000, what = "condition") => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)); } assert.fail(`timed out waiting for ${what}`); };
const quiet = (ms) => new Promise((r) => setTimeout(r, ms));
const ABEL = { name: "Abel", realm: "Thunder Hold" }, BRUNA = { name: "Bruna", realm: "Thunder Hold" }, CYRA = { name: "Cyra", realm: "Thunder Hold" };
const soon = (h = 48) => new Date(Date.now() + h * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const AT = soon(); // one moment for the whole file, so two calls never straddle a second
const EVENT = (over = {}) => ({ id: "mc7k2m9q", version: 1, creator: BRUNA, editor: BRUNA, at: AT, place: "mc", title: "Molten Core Thursday", note: "Bring fire resist", roles: { tank: 2, healer: 8, damage: 30 }, cancelled: false, ...over });
const LINK = (code, over = {}) => ({ code, character: ABEL, rankIndex: 4, guildName: "Ashen Vanguard", realm: "Thunder Hold", faction: "horde", ...over });

/** One desktop: its own data folder, install id, live client, feed and hand-off sink. */
function desktop(fake, { dir = tmp(), saved = [], live = true, plan = null } = {}) {
  const community = new CommunityService({ dir, getProfiles: () => [], appVersion: "1.28.0", baseUrl: fake.url });
  const client = live ? new LiveClient({ baseUrl: fake.url, getInstallId: () => community.settings.installId }) : null;
  const feed = new EventEmitter(), handoffs = [];
  const box = { saved, plan };
  const service = new GuildService({ dir, community, live: client, feed, setHandoff: (d) => handoffs.push(JSON.parse(JSON.stringify(d))), getSaved: () => box.saved, getPlan: () => box.plan });
  return { dir, community, client, feed, service, handoffs, box, installId: community.settings.installId, stop: () => { service.stop(); client?.stop(); } };
}
/** A guild that already exists on the fake service, set up by its leader's own desktop. */
async function leaderGuild(fake) {
  const d = desktop(fake, { live: false });
  await d.service.createGuild({ character: BRUNA, faction: "Horde", guildName: "Ashen Vanguard", rankIndex: 0, consent: true });
  const g = fake.anyGuild();
  await d.service.refreshGuild(g.id, { force: true }).catch(() => {});
  await quiet(60); // the read that follows a new membership has landed
  return { leader: d, guildId: g.id, code: g.linkCode };
}
const stateFile = (d) => fs.readFileSync(path.join(d.dir, "live", "guild-state.json"), "utf8");

test("payloads are built from fixed lists: nothing extra can ride along", () => {
  const e = G.eventShape({ ...EVENT(), secret: "x", account: "WoW1", signups: [1], roles: { tank: 2, healer: 8, damage: 30, extra: 1 }, creator: { ...BRUNA, account: "me", guid: "Player-1" } });
  assert.deepEqual(Object.keys(e), ["id", "version", "creator", "editor", "at", "place", "title", "note", "roles", "cancelled"]);
  assert.deepEqual(e.creator, BRUNA); assert.deepEqual(Object.keys(e.roles), ["tank", "healer", "damage"]);
  assert.ok(validEvent(e), "the strict service accepts it");
  assert.equal(G.eventShape(EVENT({ title: "join us at discord.gg/abc" })), null, "no web address in a title");
  assert.equal(G.eventShape(EVENT({ title: "|cffff0000Red|r" })).title, "cffff0000Red r", "colour codes cannot survive");
  assert.equal(G.eventShape(EVENT({ id: "has space" })), null); assert.equal(G.eventShape(EVENT({ version: 0 })), null); assert.equal(G.eventShape(EVENT({ at: "tomorrow" })), null);
  assert.equal(G.eventShape(EVENT({ creator: { name: "A1", realm: "x" } })), null, "a name is letters only");
  const s = G.signupShape({ who: { ...ABEL, level: 60 }, answer: "healer", version: 3, via: "desktop", ip: "1.2.3.4" });
  assert.deepEqual(s, { who: ABEL, answer: "healer", version: 3, via: "desktop" }); assert.ok(validSignup(s));
  assert.equal(G.signupShape({ who: ABEL, answer: "bench", version: 1, via: "game" }), null);
  const l = G.listingShape({ id: "abcdefgh12345678", kind: "lfm", who: ABEL, level: 34, class: "hunter", roles: ["damage", "damage", "bard"], place: "sm", note: "Cath, 2 spots", need: { tank: 1, healer: 0, damage: 2 }, at: soon(0), realm: "x", installId: "y", zone: "Tirisfal" });
  assert.deepEqual(Object.keys(l), ["id", "kind", "who", "level", "class", "roles", "place", "note", "need", "at"]);
  assert.deepEqual(l.roles, ["damage"]); assert.ok(validListing(l));
  assert.equal(G.listingShape({ ...l, kind: "lfg" }).need, null, "looking for a group names no open spots");
  assert.equal(G.listingShape({ ...l, note: "cheap gold www.example.com" }), null);
  const id = "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f";
  assert.deepEqual(G.createBody({ installId: id, character: { ...ABEL, level: 60 }, faction: "Horde", guildName: "Ashen Vanguard", rankIndex: 0, note: "x" }),
    { schema: 1, installId: id, realm: "Thunder Hold", faction: "horde", guildName: "Ashen Vanguard", character: ABEL, rankIndex: 0 });
  assert.deepEqual(G.joinBody({ installId: id, linkCode: "BFG-7K2M-Q9XD", character: ABEL, rankIndex: 4, consent: true, guildName: "x" }),
    { schema: 1, installId: id, linkCode: "BFG-7K2M-Q9XD", character: ABEL, rankIndex: 4, consent: true });
  assert.throws(() => G.joinBody({ installId: id, linkCode: "BFG-7K2M-Q9XD", character: ABEL, rankIndex: 4, consent: "yes" }), (e) => e instanceof GuildError && e.code === "consent");
  assert.throws(() => G.listingBody({ installId: id, realm: "Thunder Hold", faction: "horde", listing: l }), (e) => e.code === "consent");
  assert.deepEqual(Object.keys(G.listingBody({ installId: id, realm: "Thunder Hold", faction: "horde", listing: l, consent: true })), ["schema", "installId", "realm", "faction", "listing", "consent"]);
  assert.deepEqual(G.summaryBody({ attended: ["Abel", "Abel", "x y", 7], bosses: 10, durationSec: 7200, loot: [1] }), { schema: 1, attended: ["Abel"], bosses: 10, durationSec: 7200 });
  // Only Discord's own page is ever opened for step 1.
  assert.equal(G.discordUrl("https://discord.com/oauth2/authorize?client_id=1&state=abc"), "https://discord.com/oauth2/authorize?client_id=1&state=abc");
  for (const bad of ["http://discord.com/x", "https://discord.com.evil.example/x", "https://evil.example/discord.com", "https://user@discord.com/x", "javascript:alert(1)", ""]) assert.equal(G.discordUrl(bad), null, bad);
});

test("the one merge rule: higher version wins, a tie goes to the larger author name, the saved file fills gaps", () => {
  const a = EVENT({ version: 2, title: "Old title" }), b = EVENT({ version: 3, title: "New title", editor: ABEL });
  assert.equal(G.mergeGuild({ events: [a] }, { events: [b] }).events[0].title, "New title");
  assert.equal(G.mergeGuild({ events: [b] }, { events: [a] }).events[0].title, "New title", "an older version never replaces a newer one");
  assert.deepEqual(G.mergeGuild({ events: [b] }, { events: [a] }).changed.events, []);
  const tieA = EVENT({ version: 3, title: "By Abel", editor: ABEL }), tieZ = EVENT({ version: 3, title: "By Zed", editor: { name: "Zed", realm: "Thunder Hold" } });
  assert.equal(G.mergeGuild({ events: [tieA] }, { events: [tieZ] }).events[0].title, "By Zed");
  assert.equal(G.mergeGuild({ events: [tieZ] }, { events: [tieA] }).events[0].title, "By Zed", "both orders settle on the same row, as in the addon");
  assert.equal(G.eventWins(tieZ, tieA), true); assert.equal(G.eventWins(tieA, tieZ), false); assert.equal(G.eventWins(tieA, tieA), false);
  // Sign-ups: by version, per member.
  const one = { who: ABEL, answer: "healer", version: 1, via: "game" }, two = { who: ABEL, answer: "no", version: 2, via: "discord" };
  const m = G.mergeGuild({ events: [a], signups: { [a.id]: [one] } }, { signups: { [a.id]: [two, { who: CYRA, answer: "tank", version: 1, via: "desktop" }] } });
  assert.deepEqual(m.signups[a.id].map((s) => [s.who.name, s.answer]), [["Abel", "no"], ["Cyra", "tank"]]);
  assert.deepEqual(m.changed.signups, [[a.id, "Abel"], [a.id, "Cyra"]]);
  assert.equal(G.mergeGuild({ events: [a], signups: { [a.id]: [two] } }, { signups: { [a.id]: [one] } }).signups[a.id][0].answer, "no");
  assert.deepEqual(G.mergeGuild({ events: [a] }, { signups: { unknownid: [one] } }).signups, {}, "a sign-up for an event nobody knows is not kept");
  // The saved file: events carry their version; sign-ups do not, so they only fill a gap.
  const saved = G.fromSaved({ events: [{ id: "mc7k2m9q", ver: 2, title: "Old title", dungeon: "mc", at: Math.floor(Date.parse(a.at) / 1000), creator: "Bruna", roles: { t: 2, h: 8, d: 30 }, note: "Bring fire resist",
    signups: [{ name: "Abel", status: "h" }, { name: "Dorn-Stormrage", status: "d" }] }] }, "Thunder Hold");
  assert.deepEqual(saved.events[0].creator, BRUNA); assert.equal(saved.events[0].version, 2); assert.deepEqual(saved.events[0].roles, { tank: 2, healer: 8, damage: 30 });
  assert.deepEqual(saved.signups.mc7k2m9q, [{ who: ABEL, answer: "healer", version: 0, via: "game" }, { who: { name: "Dorn", realm: "Stormrage" }, answer: "damage", version: 0, via: "game" }]);
  const both = G.mergeGuild({ events: [b], signups: { [b.id]: [two] } }, saved);
  assert.equal(both.events[0].title, "New title", "the service's newer event stays");
  assert.deepEqual(both.signups[b.id].map((s) => [s.who.name, s.answer, s.version]), [["Abel", "no", 2], ["Dorn", "damage", 0]], "the saved answer fills the gap and loses against a versioned one");
});

test("consent first: nothing is sent before Join, Not now and Never send nothing, and the token never shows", async () => {
  const fake = await fakeLive().listen();
  const { leader, guildId, code } = await leaderGuild(fake);
  const d = desktop(fake);
  try {
    fake.clear();
    // The game reports everything it can before the player agreed to anything.
    d.feed.emit("link", LINK(code));
    d.feed.emit("event", { ...EVENT(), character: ABEL });
    d.feed.emit("signup", { eventId: "mc7k2m9q", signup: { who: ABEL, answer: "healer", version: 1, via: "game" }, character: ABEL });
    d.feed.emit("party", { leader: BRUNA, members: [{ ...ABEL, class: "priest", role: "healer", level: 60, online: true }, { ...BRUNA, class: "warrior", role: "tank", level: 60, online: true }], place: "mc", plan: null, character: ABEL });
    d.feed.emit("listing", { id: "abcdefgh12345678", kind: "lfg", who: CYRA, level: 34, class: "hunter", roles: ["damage"], place: "sm", note: "", need: null, at: soon(0), character: ABEL });
    await quiet(700);
    assert.deepEqual(fake.log, [], "not one request before consent");
    assert.equal(d.client.status().state, "idle", "and no stream");
    assert.deepEqual(d.service.offers().map((o) => [o.code, o.guildName, o.character.name]), [[code, "Ashen Vanguard", "Abel"]]);
    assert.deepEqual(d.handoffs.at(-1) ?? { guild: null, lfg: null, plan: null }, { guild: null, lfg: null, plan: null }, "nothing for the game either");
    // Calls that need a membership fail without one, and still send nothing.
    await assert.rejects(d.service.answer(guildId, "mc7k2m9q", "healer"), (e) => e instanceof GuildError && e.code === "gone");
    await assert.rejects(d.service.refreshEvents(guildId), GuildError);
    await assert.rejects(d.service.discordStart(guildId), GuildError);
    await assert.rejects(d.service.browse(), (e) => e.code === "consent");
    await assert.rejects(d.service.post({ kind: "lfg", who: ABEL, level: 60, roles: ["healer"], place: "mc" }, { consent: true }), (e) => e.code === "consent", "the board has its own switch");
    await assert.rejects(d.service.join(code), (e) => e.code === "consent");
    await assert.rejects(d.service.join(code, { consent: "true" }), (e) => e.code === "consent", "consent must be literally true");
    await assert.rejects(d.service.createGuild({ character: ABEL, faction: "horde", guildName: "Ashen Vanguard" }), (e) => e.code === "consent");
    assert.deepEqual(fake.log, []);
    // Not now: the card goes away and comes back the next time the code is heard.
    assert.deepEqual(d.service.decline(code), { declined: true });
    assert.deepEqual(d.service.offers(), []);
    d.feed.emit("link", LINK(code));
    assert.equal(d.service.offers().length, 1);
    // Never for this guild: it is not offered again, not even with a new code.
    d.service.decline(code, { never: true });
    d.feed.emit("link", LINK(code)); d.feed.emit("link", LINK("BFG-OTHER-CODE"));
    assert.deepEqual(d.service.offers(), []);
    assert.deepEqual(d.service.neverList().map((n) => n.guildName), ["ashen vanguard"]);
    await quiet(300);
    assert.deepEqual(fake.log, [], "declining sends nothing");
    // The choice can be taken back; then Join sends exactly the join body.
    d.service.allowAgain(d.service.neverList()[0].key);
    d.feed.emit("link", LINK(code));
    assert.deepEqual(await d.service.join(code, { consent: true }), { guildId });
    const join = fake.requests("/v1/guilds/join")[0];
    assert.deepEqual(join.body, { schema: 1, installId: d.installId, linkCode: code, character: ABEL, rankIndex: 4, consent: true });
    assert.equal(join.member, null, "no member header before there is a token");
    const token = fake.guild(guildId).members.find((m) => m.character.name === "Abel").token;
    await until(() => d.client.status().state === "live", 5000, "the stream opens once there is a membership");
    assert.deepEqual(fake.requests("/v1/live/session").at(-1).body.subs, [{ t: "guild", guildId, member: token }]);
    // The token is kept in the app's own folder and nowhere a screen can see.
    assert.ok(stateFile(d).includes(token));
    const view = d.service.view();
    assert.doesNotMatch(JSON.stringify(view), new RegExp(token), "no view carries the token");
    assert.doesNotMatch(JSON.stringify(d.service.preview(ABEL)), new RegExp(token));
    assert.doesNotMatch(JSON.stringify(d.client.status()), new RegExp(token));
    assert.equal(view.guilds[0].linkCode, null, "a member is not shown the link code");
    assert.equal(view.guilds[0].role, "member"); assert.deepEqual(view.offers, []);
    for (const e of fake.log.filter((x) => x.route.startsWith(`/v1/guilds/${guildId}`))) assert.equal(e.member, token, `${e.method} ${e.route} carries X-BF-Member`);
  } finally { d.stop(); leader.stop(); await fake.close(); }
});

test("what the game reports reaches the service within seconds, and what the service reports reaches the hand-off", async () => {
  const fake = await fakeLive().listen();
  const { leader, guildId, code } = await leaderGuild(fake);
  const d = desktop(fake);
  try {
    d.feed.emit("link", LINK(code));
    await d.service.join(code, { consent: true });
    await until(() => d.client.status().state === "live", 5000, "live");
    const token = fake.guild(guildId).members.find((m) => m.character.name === "Abel").token;
    fake.clear();
    // A guild event heard in game.
    const started = Date.now();
    d.feed.emit("event", { ...EVENT(), character: ABEL, heardFrom: "guild channel" });
    await until(() => fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q`).length === 1, 3000, "the event PUT");
    assert.ok(Date.now() - started < 3000);
    const put = fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q`)[0];
    assert.equal(put.method, "PUT"); assert.equal(put.member, token); assert.deepEqual(put.body, EVENT());
    // The same event again changes nothing and is not sent twice.
    d.feed.emit("event", { ...EVENT(), character: ABEL });
    // My own answer in game, and somebody else's (a member only passes on their own).
    d.feed.emit("signup", { eventId: "mc7k2m9q", signup: { who: ABEL, answer: "healer", version: 1, via: "game" }, character: ABEL });
    d.feed.emit("signup", { eventId: "mc7k2m9q", signup: { who: CYRA, answer: "tank", version: 1, via: "game" }, character: ABEL });
    await until(() => fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q/signups/`).length === 1, 3000, "the sign-up PUT");
    await quiet(300);
    assert.deepEqual(fake.log.filter((e) => e.method === "PUT").map((e) => e.route), [`/v1/guilds/${guildId}/events/mc7k2m9q`, `/v1/guilds/${guildId}/events/mc7k2m9q/signups/Abel`]);
    assert.deepEqual(fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q/signups/Abel`)[0].body, { who: ABEL, answer: "healer", version: 1, via: "game" });
    let view = d.service.view().guilds[0];
    assert.deepEqual(view.events[0].counts, { tank: 1, healer: 1, damage: 0, maybe: 0, no: 0 }); assert.equal(view.events[0].mine, "healer");
    assert.equal(d.service.view().pending, 0, "what came from the game does not wait for the game");
    // Another member answers on Discord, an officer changes the event, a second event appears: all live.
    fake.putSignup(guildId, "mc7k2m9q", { who: BRUNA, answer: "tank", version: 1, via: "discord" });
    fake.putEvent(guildId, EVENT({ version: 2, editor: BRUNA, title: "Molten Core Friday" }));
    fake.putEvent(guildId, EVENT({ id: "bwl00001", title: "Blackwing Lair", place: "bwl" }));
    await until(() => d.service.view().guilds[0].events.length === 2 && d.service.view().guilds[0].events.some((e) => e.title === "Molten Core Friday" && e.counts.tank === 2), 3000, "live updates");
    assert.equal(d.service.view().pending, 3, "one sign-up, one changed event and one new event wait for the game's next /reload");
    const handoff = d.handoffs.at(-1);
    assert.equal(handoff.guild.id, guildId); assert.equal(handoff.guild.discord, "none");
    assert.deepEqual([handoff.guild.guildName, handoff.guild.realm], ["Ashen Vanguard", "Thunder Hold"], "the game merges only into the guild it is in");
    assert.deepEqual(handoff.guild.events.map((e) => [e.id, e.version]).sort(), [["bwl00001", 1], ["mc7k2m9q", 2]], "rows the game lacks or holds older");
    assert.deepEqual(handoff.guild.signups, { mc7k2m9q: [{ who: BRUNA, answer: "tank", version: 1, via: "discord" }] }, "answers the game already has are not handed back");
    // The game reloads: it read the hand-off and saved its file again.
    d.box.saved = [{ name: "Abel", realm: "Thunder Hold", guild: { events: [
      { id: "mc7k2m9q", ver: 2, title: "Molten Core Friday", dungeon: "mc", at: Math.floor(Date.parse(EVENT().at) / 1000), creator: "Bruna", roles: { t: 2, h: 8, d: 30 }, signups: [{ name: "Abel", status: "h" }, { name: "Cyra", status: "t" }, { name: "Bruna", status: "t" }] },
      { id: "bwl00001", ver: 1, title: "Blackwing Lair", dungeon: "bwl", at: Math.floor(Date.parse(EVENT().at) / 1000), creator: "Bruna", roles: { t: 2, h: 8, d: 30 }, signups: [] }] } }];
    d.service.savedFileRead();
    assert.equal(d.service.view().pending, 0);
    assert.deepEqual(d.handoffs.at(-1).guild.events, []); assert.deepEqual(d.handoffs.at(-1).guild.signups, {});
    // An event removed on the service disappears here too.
    fake.putEvent(guildId, EVENT({ id: "ony00001", title: "Onyxia", place: "ony" }));
    await until(() => d.service.view().guilds[0].events.length === 3, 3000, "a third event");
    fake.removeEvent(guildId, "ony00001");
    await until(() => d.service.view().guilds[0].events.length === 2, 3000, "gone");
    // Events and sign-ups of a character that did not join are never sent.
    fake.clear();
    d.feed.emit("event", { ...EVENT({ id: "other001" }), character: CYRA });
    d.feed.emit("signup", { eventId: "mc7k2m9q", signup: { who: CYRA, answer: "no", version: 2, via: "game" }, character: CYRA });
    await quiet(400);
    assert.deepEqual(fake.log.filter((e) => e.method !== "GET"), []);
  } finally { d.stop(); leader.stop(); await fake.close(); }
});

test("offline queue: an answer and an event edit wait, survive a restart, and go out in order", async () => {
  const fake = await fakeLive().listen();
  const { leader, guildId, code } = await leaderGuild(fake);
  const dir = tmp();
  let d = desktop(fake, { dir, live: false });
  try {
    d.feed.emit("link", LINK(code, { rankIndex: 1 }));           // an officer by rank
    await d.service.join(code, { consent: true });
    assert.equal(d.service.view().guilds[0].role, "officer");
    fake.putEvent(guildId, EVENT());
    await d.service.refreshEvents(guildId);
    fake.clear();
    fake.state.offline = true;
    assert.deepEqual(await d.service.answer(guildId, "mc7k2m9q", "healer"), { sent: false, queued: true });
    assert.deepEqual(await d.service.answer(guildId, "mc7k2m9q", "tank"), { sent: false, queued: true });
    const made = await d.service.saveEvent(guildId, { at: soon(72), place: "ony", title: "Onyxia after MC", note: "", roles: { tank: 2, healer: 8, damage: 30 } });
    assert.equal(made.queued, true);
    await d.service.answer(guildId, made.id, "damage");
    let view = d.service.view();
    assert.equal(view.waiting, 3, "the two answers to one event became one row");
    assert.equal(view.guilds[0].events.find((e) => e.id === "mc7k2m9q").mine, "tank", "it shows at once");
    assert.equal(view.guilds[0].events.find((e) => e.id === "mc7k2m9q").waiting, true);
    assert.ok(view.pending >= 3, "and is handed to the game for its next /reload");
    // The app closes and opens again while still offline.
    d.stop();
    d = desktop(fake, { dir, live: false });
    assert.equal(d.service.view().waiting, 3);
    assert.equal((await d.service.flush()).sent, 0);
    assert.equal(d.service.view().waiting, 3, "still waiting");
    fake.state.offline = false; fake.clear();
    assert.equal((await d.service.flush()).sent, 3);
    const puts = fake.log.filter((e) => e.method === "PUT").map((e) => e.route.replace(`/v1/guilds/${guildId}`, ""));
    assert.deepEqual(puts, [`/events/${made.id}`, "/events/mc7k2m9q/signups/Abel", `/events/${made.id}/signups/Abel`], "the event before the sign-up that needs it");
    assert.equal(fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q/signups/Abel`)[0].body.answer, "tank");
    assert.equal(fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q/signups/Abel`)[0].body.version, 2);
    assert.equal(fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q/signups/Abel`)[0].body.via, "desktop");
    assert.equal(d.service.view().waiting, 0);
    assert.ok(validEvent(fake.guild(guildId).events.get(made.id)));
    // A plain member may not edit; the refusal is undone here and said plainly.
    fake.guild(guildId).members.find((m) => m.character.name === "Abel").role = "member";
    await d.service.refreshGuild(guildId, { force: true });
    fake.guild(guildId).thresholds.proposeRank = 0; await d.service.refreshGuild(guildId, { force: true });
    await assert.rejects(d.service.saveEvent(guildId, { at: soon(96), place: "zg", title: "Zul Gurub", roles: { tank: 2, healer: 4, damage: 14 } }), (e) => e.code === "forbidden");
    // The service refuses somebody else's answer from a member: nothing of it stays here.
    const other = desktop(fake, { live: false });
    other.feed.emit("link", LINK(code, { character: CYRA, rankIndex: 5 }));
    await other.service.join(code, { consent: true });
    await other.service.refreshEvents(guildId);
    assert.deepEqual(await other.service.answer(guildId, "mc7k2m9q", "damage"), { sent: true });
    assert.deepEqual(await other.service.answer(guildId, "mc7k2m9q", "damage"), { sent: true, unchanged: true });
    await assert.rejects(other.service.answer(guildId, "nosuchevent", "damage"), (e) => e.code === "invalid");
    other.stop();
  } finally { d.stop(); leader.stop(); await fake.close(); }
});

test("an event known only from the saved file is passed on before the answer to it", async () => {
  const fake = await fakeLive().listen();
  const { leader, guildId, code } = await leaderGuild(fake);
  const at = Math.floor(Date.now() / 1000) + 86400;
  const d = desktop(fake, { live: false, saved: [{ name: "Abel", realm: "Thunder Hold", guild: { events: [{ id: "zg5x1a2b", ver: 3, title: "Zul Gurub", dungeon: "zg", at, creator: "Bruna", editor: "Cyra", roles: { t: 2, h: 4, d: 14 }, signups: [{ name: "Cyra", status: "d" }] }] } }] });
  try {
    d.feed.emit("link", LINK(code));
    await d.service.join(code, { consent: true });
    const shown = d.service.view().guilds[0].events;
    assert.deepEqual(shown.map((e) => [e.id, e.title, e.counts.damage]), [["zg5x1a2b", "Zul Gurub", 1]], "the page shows what the game saved even though the service has nothing");
    fake.clear();
    assert.deepEqual(await d.service.answer(guildId, "zg5x1a2b", "healer"), { sent: true });
    const puts = fake.log.filter((e) => e.method === "PUT");
    assert.deepEqual(puts.map((e) => e.route.replace(`/v1/guilds/${guildId}`, "")), ["/events/zg5x1a2b", "/events/zg5x1a2b/signups/Abel"]);
    assert.deepEqual(puts[0].body.editor, CYRA); assert.equal(puts[0].body.version, 3);
  } finally { d.stop(); leader.stop(); await fake.close(); }
});

test("Leave removes the token, and nothing is sent afterwards", async () => {
  const fake = await fakeLive().listen();
  const { leader, guildId, code } = await leaderGuild(fake);
  const d = desktop(fake);
  try {
    d.feed.emit("link", LINK(code));
    await d.service.join(code, { consent: true });
    await until(() => d.client.status().state === "live", 5000, "live");
    const token = fake.guild(guildId).members.find((m) => m.character.name === "Abel").token;
    fake.putEvent(guildId, EVENT());
    await until(() => d.service.view().guilds[0]?.events.length === 1, 3000, "event");
    // Offline, Leave says so and changes nothing: the name would stay on the service otherwise.
    fake.state.offline = true;
    await assert.rejects(d.service.leave(guildId), (e) => e.code === "offline" && /still a member/.test(e.message));
    assert.equal(d.service.view().guilds.length, 1);
    fake.state.offline = false;
    assert.deepEqual(await d.service.leave(guildId), { left: true });
    assert.equal(fake.requests(`/v1/guilds/${guildId}/leave`).at(-1).member, token);
    assert.equal(fake.guild(guildId).members.some((m) => m.character.name === "Abel"), false, "the service dropped the name");
    assert.doesNotMatch(stateFile(d), new RegExp(token), "the token is gone from the disk");
    assert.deepEqual(d.service.view().guilds, []);
    await until(() => d.client.status().state === "idle" && fake.streams.size === 0, 4000, "the stream closes");
    assert.deepEqual(d.handoffs.at(-1), { guild: null, lfg: null, plan: null }, "the game gets no guild data any more");
    fake.clear();
    // Everything that could cause a request, after Leave.
    d.feed.emit("event", { ...EVENT({ version: 5 }), character: ABEL });
    d.feed.emit("signup", { eventId: "mc7k2m9q", signup: { who: ABEL, answer: "no", version: 9, via: "game" }, character: ABEL });
    fake.putEvent(guildId, EVENT({ version: 6 }));
    await assert.rejects(d.service.answer(guildId, "mc7k2m9q", "tank"), GuildError);
    await assert.rejects(d.service.refreshGuild(guildId), GuildError);
    await d.service.refetch(); await d.service.flush(); await d.service.tick();
    await quiet(700);
    assert.deepEqual(fake.log, [], "nothing after Leave");
    // The code heard again offers the guild again; it is never joined silently.
    d.feed.emit("link", LINK(code));
    assert.equal(d.service.offers().length, 1); assert.deepEqual(fake.log, []);
  } finally { d.stop(); leader.stop(); await fake.close(); }
});

test("the leader's setup: consent, the link code, proof it was said in game, rotate, remove a member, delete with the typed name", async () => {
  const fake = await fakeLive().listen();
  const d = desktop(fake, { live: false });
  try {
    await assert.rejects(d.service.createGuild({ character: BRUNA, faction: "Horde", guildName: "", consent: true }), /guild yet/);
    await assert.rejects(d.service.createGuild({ character: { name: "Bruna" }, faction: "Horde", guildName: "Ashen Vanguard", consent: true }), /name and realm/);
    assert.deepEqual(fake.log, []);
    const { guildId } = await d.service.createGuild({ character: BRUNA, faction: "Horde", guildName: "Ashen Vanguard", rankIndex: 0, consent: true });
    assert.deepEqual(fake.requests("/v1/guilds")[0].body, { schema: 1, installId: d.installId, realm: "Thunder Hold", faction: "horde", guildName: "Ashen Vanguard", character: BRUNA, rankIndex: 0 });
    let g = d.service.view().guilds[0];
    assert.match(g.linkCode, /^BFG-/); assert.equal(g.isLeader, true); assert.equal(g.linkHeard, false);
    // The leader types /bf guild link CODE; the game reports the same code back.
    d.feed.emit("link", LINK(g.linkCode, { character: BRUNA, rankIndex: 0 }));
    assert.equal(d.service.view().guilds[0].linkHeard, true); assert.deepEqual(d.service.offers(), [], "the leader is not asked to join their own guild");
    // The same guild cannot be connected twice: no details come back.
    const second = desktop(fake, { live: false });
    await assert.rejects(second.service.createGuild({ character: ABEL, faction: "horde", guildName: "ashen vanguard", consent: true }), (e) => e.code === "exists" && /Join/.test(e.message));
    second.feed.emit("link", LINK(g.linkCode));
    await second.service.join(g.linkCode, { consent: true });
    await d.service.refreshGuild(guildId, { force: true });
    assert.deepEqual(d.service.view().guilds[0].members.map((m) => [m.name, m.role, m.me]), [["Bruna", "leader", true], ["Abel", "member", false]]);
    // A member cannot do what only the leader may.
    await assert.rejects(second.service.rotateCode(guildId), (e) => e.code === "forbidden");
    await assert.rejects(second.service.deleteGuild(guildId, "Ashen Vanguard"), (e) => e.code === "forbidden");
    assert.equal(second.service.view().guilds.length, 1, "a refused delete changes nothing here");
    // Rotate: the old code stops working.
    const old = g.linkCode;
    await d.service.rotateCode(guildId);
    g = d.service.view().guilds[0];
    assert.notEqual(g.linkCode, old); assert.equal(fake.guild(guildId).linkCode, g.linkCode);
    const late = desktop(fake, { live: false });
    late.feed.emit("link", LINK(old, { character: CYRA }));
    await assert.rejects(late.service.join(old, { consent: true }), (e) => e.code === "gone" && /no longer valid/.test(e.message));
    assert.deepEqual(late.service.offers(), [], "a dead code is not offered again");
    late.stop();
    // Remove a member: their app notices at its next read and forgets the membership.
    await d.service.removeMember(guildId, "Abel");
    await assert.rejects(second.service.refreshGuild(guildId, { force: true }), (e) => e.code === "gone");
    assert.deepEqual(second.service.view().guilds, []);
    second.stop();
    // Delete our guild's data needs the name typed exactly.
    fake.clear();
    await assert.rejects(d.service.deleteGuild(guildId, "ashen vanguard"), /exactly/);
    await assert.rejects(d.service.deleteGuild(guildId, ""), /exactly/);
    assert.deepEqual(fake.log, []);
    assert.deepEqual(await d.service.deleteGuild(guildId, " Ashen Vanguard "), { deleted: true });
    assert.equal(fake.guild(guildId), undefined); assert.deepEqual(d.service.view().guilds, []);
  } finally { d.stop(); await fake.close(); }
});

test("Discord: add, live status, test post, link my Discord, disconnect; and everything else works while Discord is off", async () => {
  const fake = await fakeLive().listen();
  const d = desktop(fake);
  try {
    const { guildId } = await d.service.createGuild({ character: BRUNA, faction: "Horde", guildName: "Ashen Vanguard", rankIndex: 0, consent: true });
    await until(() => d.client.status().state === "live", 5000, "live");
    const start = await d.service.discordStart(guildId);
    assert.match(start.url, /^https:\/\/discord\.com\/oauth2\/authorize\?/);
    await until(() => d.service.view().guilds[0].discord.state === "pending", 3000, "pending");
    await assert.rejects(d.service.discordTest(guildId), GuildError, "no test post before it is connected");
    fake.discordConnected(guildId, { guildName: "Ashen Vanguard HQ", channel: "#raids" });
    await until(() => d.service.view().guilds[0].discord.channel === "#raids", 3000, "connected, live");
    assert.deepEqual({ ...d.service.view().guilds[0].discord, testAt: null }, { state: "connected", guildName: "Ashen Vanguard HQ", channel: "#raids", problem: null, available: true, testAt: null });
    assert.equal(d.handoffs.at(-1).guild.discord, "connected");
    assert.deepEqual(await d.service.discordTest(guildId), { posted: true });
    assert.equal(fake.guild(guildId).tests, 1); assert.ok(d.service.view().guilds[0].discord.testAt > 0);
    fake.discordProblem(guildId, "Missing permission: Send Messages in #raids");
    await until(() => d.service.view().guilds[0].discord.state === "problem" && d.service.view().guilds[0].discord.problem, 3000, "problem shown");
    // Link my Discord: the code from /backstage link.
    await assert.rejects(d.service.discordLink(guildId, "no"), /does not look like a link code/);
    await assert.rejects(d.service.discordLink(guildId, "L-unknowncode"), (e) => e.code === "gone" && /\/backstage link/.test(e.message));
    assert.equal(d.service.view().guilds.length, 1, "a wrong code does not cost the membership");
    assert.deepEqual(await d.service.discordLink(guildId, ` ${fake.discordCode("Bruna#7")} `), { linked: true, name: "Bruna#7" });
    assert.deepEqual(fake.requests(`/v1/guilds/${guildId}/discord/link`).at(-1).body.schema, 1);
    assert.deepEqual(Object.keys(fake.requests(`/v1/guilds/${guildId}/discord/link`).at(-1).body), ["schema", "code"]);
    assert.equal(d.service.view().guilds[0].linkedDiscord, "Bruna#7");
    await d.service.discordUnlink(guildId);
    assert.equal(d.service.view().guilds[0].linkedDiscord, null);
    await d.service.discordDisconnect(guildId);
    assert.equal(d.service.view().guilds[0].discord.state, "none");
    // A service whose owner has not set Discord up yet.
    fake.state.discord = false;
    await assert.rejects(d.service.discordStart(guildId), (e) => e.code === "discord_off" && e.message === "Discord connection is not available yet.");
    assert.equal(d.service.view().discordAvailable, false); assert.equal(d.service.view().guilds[0].discord.available, false);
    const made = await d.service.saveEvent(guildId, { at: soon(), place: "mc", title: "Molten Core", note: "", roles: { tank: 2, healer: 8, damage: 30 } });
    assert.equal(made.sent, true, "events work without Discord");
    assert.deepEqual(await d.service.answer(guildId, made.id, "tank"), { sent: true });
    assert.deepEqual(await d.service.postSummary(guildId, made.id, { attended: ["Bruna", "Bruna"], bosses: 10, durationSec: 7200, loot: ["x"] }), { posted: true });
    assert.deepEqual(fake.guild(guildId).summaries.at(-1), { id: made.id, schema: 1, attended: ["Bruna"], bosses: 10, durationSec: 7200 });
    fake.state.discord = true;
    await d.service.discordStart(guildId);
    assert.equal(d.service.view().discordAvailable, true, "it comes back by itself once the service has it");
    // A link that is not Discord's is never handed out to be opened.
    const orig = d.service.guildCall.bind(d.service);
    d.service.guildCall = async (g, m, rest, body) => (rest === "/discord/start" ? { ok: true, url: "https://discord.com.evil.example/oauth2" } : orig(g, m, rest, body));
    await assert.rejects(d.service.discordStart(guildId), /not Discord's/);
  } finally { d.stop(); await fake.close(); }
});

test("the realm party board: its own switch, consent before the first post, live listings, renew and remove", async () => {
  const fake = await fakeLive().listen();
  const d = desktop(fake);
  const MINE = { kind: "lfm", who: ABEL, level: 34, class: "Hunter", roles: ["damage"], place: "sm", note: "Cathedral, two spots", need: { tank: 1, healer: 0, damage: 1 } };
  try {
    d.service.setBoardPlace({ realm: "Thunder Hold", faction: "Horde" });
    d.service.watchBoard(true);
    await quiet(600);
    assert.deepEqual(fake.log, [], "looking at the page with the board off asks nothing");
    assert.equal(d.service.view().board.on, false);
    await d.service.setBoard(true);
    d.service.watchBoard(true);
    await d.service.browse();
    const get = fake.requests("/v1/lfg")[0];
    assert.equal(get.method, "GET"); assert.deepEqual(get.query, { realm: "Thunder Hold", faction: "horde" }, "browsing sends the realm and faction and nothing else");
    assert.equal(get.body, null);
    await until(() => d.client.status().state === "live", 5000, "the board is live while a screen shows it");
    assert.deepEqual(fake.requests("/v1/live/session").at(-1).body.subs, [{ t: "lfg", realm: "Thunder Hold", faction: "horde" }]);
    // Somebody posts: it appears without asking again.
    fake.putListing("Thunder Hold", "horde", { id: "cyracyracyra0001", kind: "lfg", who: CYRA, level: 36, class: "mage", roles: ["damage"], place: "sm", note: "Any wing", need: null, at: soon(0) });
    fake.putListing("Thunder Hold", "alliance", { id: "alliancealliance", kind: "lfg", who: { name: "Other", realm: "Thunder Hold" }, level: 36, class: "mage", roles: ["damage"], place: "sm", note: "", need: null, at: soon(0) });
    await until(() => d.service.view().board.listings.length === 1, 3000, "the live listing");
    assert.equal(d.service.view().board.listings[0].who.name, "Cyra");
    // Posting: not without consent the first time.
    await assert.rejects(d.service.post(MINE), (e) => e.code === "consent");
    assert.equal(fake.log.filter((e) => e.method === "PUT").length, 0);
    const posted = await d.service.post(MINE, { consent: true });
    const put = fake.log.find((e) => e.method === "PUT");
    assert.deepEqual(Object.keys(put.body), ["schema", "installId", "realm", "faction", "listing", "consent"]);
    assert.equal(put.body.consent, true); assert.equal(put.body.installId, d.installId); assert.ok(validListing(put.body.listing));
    assert.deepEqual({ ...put.body.listing, at: null }, { id: posted.id, kind: "lfm", who: ABEL, level: 34, class: "hunter", roles: ["damage"], place: "sm", note: "Cathedral, two spots", need: { tank: 1, healer: 0, damage: 1 }, at: null });
    let board = d.service.view().board;
    assert.equal(board.mine.id, posted.id); assert.equal(board.mine.expiresAt - board.mine.postedAt, 30 * 60 * 1000);
    assert.equal(board.listings.some((l) => l.id === posted.id), false, "your own listing is shown apart, not twice");
    assert.deepEqual(d.handoffs.at(-1).lfg.rows.map((l) => l.who.name).sort(), ["Abel", "Cyra"], "the game gets the board at its next /reload");
    assert.deepEqual([d.handoffs.at(-1).lfg.realm, d.handoffs.at(-1).lfg.faction], ["Thunder Hold", "horde"]);
    assert.match(posted.id, /^[a-z0-9]{16}$/, "an id the game accepts");
    // Edit keeps the id; renew posts the same listing again; neither asks for consent twice.
    assert.equal((await d.service.post({ ...MINE, note: "Cathedral, one spot" })).id, posted.id);
    assert.equal((await d.service.renew()).id, posted.id);
    assert.equal(fake.log.filter((e) => e.method === "PUT").length, 3);
    assert.equal([...fake.lfg.values()].filter((x) => x.install === d.installId).length, 1, "one live listing per install");
    // A listing heard in game is shown, marked, and never passed on to the service.
    fake.clear();
    d.feed.emit("listing", { id: "heardingame00001", kind: "lfg", who: { name: "Dorn", realm: "Thunder Hold" }, level: 40, class: "warrior", roles: ["tank"], place: "ulda", note: "", need: null, at: soon(0), character: ABEL });
    assert.equal(d.service.view().board.listings.find((l) => l.who.name === "Dorn").source, "game");
    d.feed.emit("listing", { gone: true, id: "heardingame00001", character: ABEL });
    assert.equal(d.service.view().board.listings.some((l) => l.who.name === "Dorn"), false);
    await quiet(300);
    assert.deepEqual(fake.log, []);
    // Your own listing made in game (/bf lfg list …) is posted for you once you agreed to posting; "list off" takes it down.
    const mineInGame = { id: "madeingame000001", kind: "lfg", who: ABEL, level: 34, class: "hunter", roles: ["damage"], place: "ulda", note: "", need: null, at: soon(0), character: ABEL };
    d.feed.emit("listing", mineInGame);
    await until(() => fake.lfg.has("madeingame000001"), 3000, "the in-game listing on the service");
    assert.equal(d.service.view().board.mine.id, "madeingame000001"); assert.equal(fake.lfg.has(posted.id), false, "it replaced the older one");
    d.feed.emit("listing", { gone: true, id: "madeingame000001", character: ABEL });
    await until(() => !fake.lfg.has("madeingame000001") && d.service.view().board.mine === null, 3000, "taken down");
    await d.service.post(MINE);
    // Remove, then switch the board off: the stream closes and nothing more is asked.
    fake.removeListing("cyracyracyra0001");
    await until(() => d.service.view().board.listings.length === 0, 3000, "gone live");
    assert.deepEqual(await d.service.removeListing(), { removed: true });
    assert.deepEqual(fake.log.at(-1).body, { schema: 1, installId: d.installId }); assert.equal(fake.log.at(-1).method, "DELETE");
    assert.equal(d.service.view().board.mine, null);
    await d.service.post(MINE);
    await d.service.setBoard(false);
    assert.equal([...fake.lfg.values()].filter((x) => x.install === d.installId).length, 0, "switching the board off removes your listing");
    await until(() => d.client.status().state === "idle", 4000, "idle");
    fake.clear();
    d.service.watchBoard(true);
    await assert.rejects(d.service.browse(), (e) => e.code === "consent");
    await assert.rejects(d.service.post(MINE, { consent: true }), (e) => e.code === "consent");
    await d.service.refetch(); await quiet(500);
    assert.deepEqual(fake.log, []);
    assert.equal(d.handoffs.at(-1).lfg, null);
  } finally { d.stop(); await fake.close(); }
});

test("two characters of one player in the same guild: each joins by itself, with its own member key", async () => {
  const fake = await fakeLive().listen();
  const d = desktop(fake);
  try {
    const { guildId } = await d.service.createGuild({ character: BRUNA, faction: "Horde", guildName: "Ashen Vanguard", rankIndex: 0, consent: true });
    const code = fake.guild(guildId).linkCode;
    // The leader types the line; the game reports it for the leader and, later, for the alt.
    d.feed.emit("link", LINK(code, { character: BRUNA, rankIndex: 0 }));
    assert.deepEqual(d.service.offers(), [], "the leader is not asked to join");
    d.feed.emit("link", LINK(code));
    assert.deepEqual(d.service.offers().map((o) => o.character.name), ["Abel"], "the alt is invited like anyone");
    await d.service.join(code, { consent: true });
    const view = d.service.view();
    assert.deepEqual(view.guilds.map((g) => [g.character.name, g.role, g.guildId === guildId]), [["Bruna", "leader", true], ["Abel", "member", true]]);
    assert.notEqual(view.guilds[0].memberId, view.guilds[1].memberId);
    assert.equal(view.guilds[1].linkCode, null);
    await until(() => d.client.status().state === "live" && fake.streams.size === 1, 5000, "live");
    await quiet(500);
    assert.equal(fake.requests("/v1/live/session").at(-1).body.subs.length, 1, "one subscription per guild");
    // Each answers as itself, with its own key.
    fake.putEvent(guildId, EVENT());
    await until(() => d.service.view().guilds.every((g) => g.events.length === 1), 3000, "both see the event");
    const [bruna, abel] = d.service.view().guilds;
    await d.service.answer(bruna.memberId, "mc7k2m9q", "tank");
    await d.service.answer(abel.memberId, "mc7k2m9q", "healer");
    const tokens = Object.fromEntries(fake.guild(guildId).members.map((m) => [m.character.name, m.token]));
    assert.equal(fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q/signups/Bruna`)[0].member, tokens.Bruna);
    assert.equal(fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q/signups/Abel`)[0].member, tokens.Abel);
    await until(() => d.service.view().guilds.every((g) => g.events[0].counts.tank === 1 && g.events[0].counts.healer === 1), 3000, "both copies agree");
    assert.deepEqual(d.service.view().guilds.map((g) => g.events[0].mine), ["tank", "healer"]);
    // The alt leaves; the leader stays.
    await d.service.leave(abel.memberId);
    assert.deepEqual(d.service.view().guilds.map((g) => g.character.name), ["Bruna"]);
    assert.equal(fake.guild(guildId).members.length, 1);
  } finally { d.stop(); await fake.close(); }
});

test("the group from the game and the plan travel in the hand-off; a lost membership is noticed; Forget me empties everything", async () => {
  const fake = await fakeLive().listen();
  const { leader, guildId, code } = await leaderGuild(fake);
  const d = desktop(fake);
  try {
    const parties = [];
    d.service.on("party", (p) => parties.push(p));
    d.feed.emit("party", { leader: "Bruna", total: 3, members: [{ ...ABEL, class: "PRIEST", role: "healer", level: 60, online: true, ready: true, guid: "Player-1-ABC", missing: ["Aqual Quintessence", "|cffff0000x|r"] }, { ...BRUNA, class: "warrior", role: "tank", level: 60, online: false, ready: false }, { name: "x", realm: "" }], place: "mc", plan: null, character: ABEL });
    assert.equal(parties.length, 1);
    const party = d.service.view().party;
    assert.deepEqual(party.members, [{ ...ABEL, class: "priest", role: "healer", level: 60, online: true, ready: true, missing: ["Aqual Quintessence", "cffff0000x r"] }, { ...BRUNA, class: "warrior", role: "tank", level: 60, online: false, ready: false, missing: [] }]);
    assert.deepEqual(party.leader, BRUNA, "the game names the leader; the realm is the character's"); assert.equal(party.place, "mc"); assert.equal(party.total, 3);
    d.feed.emit("party", { leader: null, members: [], place: null, plan: null, character: ABEL });
    assert.equal(d.service.view().party, null, "leaving the group clears it");
    // The plan is whatever the planner holds for the character last seen in game.
    d.box.plan = { place: "mc", for: ABEL, members: [{ name: "Bruna", role: "tank", bring: "Pull with the bow" }] };
    d.service.planChanged();
    assert.deepEqual(d.handoffs.at(-1).plan, d.box.plan); assert.equal(d.service.view().pending, 1);
    d.service.savedFileRead();
    assert.equal(d.service.view().pending, 0);
    // The leader ends the link in game: a waiting invitation is withdrawn.
    d.feed.emit("link", LINK(code));
    assert.equal(d.service.offers().length, 1);
    d.feed.emit("unlink", { character: ABEL, guildName: "Ashen Vanguard", realm: "Thunder Hold", faction: "horde" });
    assert.deepEqual(d.service.offers(), []);
    // The leader removes this member while the app is running: the stream is refused and the app finds out why.
    d.feed.emit("link", LINK(code));
    await d.service.join(code, { consent: true });
    await until(() => d.client.status().state === "live", 5000, "live");
    fake.guild(guildId).members = fake.guild(guildId).members.filter((m) => m.character.name !== "Abel");
    fake.dropStreams();
    await until(() => d.service.view().guilds.length === 0, 8000, "the membership is dropped");
    // Forget me.
    d.feed.emit("link", LINK(code));
    await d.service.join(code, { consent: true });
    await d.service.setBoard(true);
    d.service.wipe();
    const view = d.service.view();
    assert.deepEqual([view.guilds, view.offers, view.never, view.board.on, view.waiting], [[], [], [], false, 0]);
    assert.doesNotMatch(stateFile(d), /"member":"/);
  } finally { d.stop(); leader.stop(); await fake.close(); }
});

test("a damaged or hostile state file never costs the app: bad rows are dropped one by one", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "live"), { recursive: true });
  fs.writeFileSync(path.join(dir, "live", "guild-state.json"), JSON.stringify({ guilds: [{ guildId: "g_ok", guildName: "Ashen Vanguard", realm: "Thunder Hold", faction: "horde", character: ABEL, member: "t".repeat(43), role: "wizard", events: [EVENT(), { id: "bad id" }], signups: { mc7k2m9q: [{ who: ABEL, answer: "healer", version: 1, via: "game" }, { who: "x" }] } },
    { guildId: "nope", member: "t".repeat(43) }, null, "x"], offers: [{ code: "x" }, 7], never: [1, "a|b|c"], queue: [{ type: "signup", guildId: "g_ok~thunder hold|abel", eventId: "mc7k2m9q", body: { who: ABEL, answer: "tank", version: 2, via: "desktop" } }, { type: "signup", guildId: "g_ok", eventId: "mc7k2m9q", body: { who: ABEL, answer: "no", version: 3, via: "desktop" } },
      { type: "event", guildId: "g_ok~thunder hold|abel", eventId: "x", body: {} }, { type: "shell", guildId: "g_ok~thunder hold|abel", eventId: "x" }],
    board: { on: "yes", listing: { listing: { id: "short" } } }, __proto__: { polluted: true } }));
  const community = { settings: { installId: "3f2b8c1e-9d4a-4b7e-8f21-0a1b2c3d4e5f" }, request: async () => { throw Error("offline"); } };
  const s = new GuildService({ dir, community });
  const v = s.view();
  assert.equal(v.guilds.length, 1); assert.equal(v.guilds[0].role, "member"); assert.equal(v.guilds[0].events.length, 1); assert.equal(v.guilds[0].events[0].counts.healer, 1);
  assert.deepEqual([v.offers, v.never.length, v.waiting, v.board.on, v.board.mine], [[], 1, 1, false, null]);
  s.stop();
  fs.writeFileSync(path.join(dir, "live", "guild-state.json"), "{ not json");
  const empty = new GuildService({ dir, community });
  assert.deepEqual(empty.view().guilds, []);
  empty.stop();
});
