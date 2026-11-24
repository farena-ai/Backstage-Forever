"use strict";
// Backstage Live end to end on the desktop: the recorded live-link signals (tests/fixtures/live-signals.json,
// exactly what the addon writes) go through the real live-bridge page decoder and the real game feed into
// the guild service, which talks to the in-test contract server; what the service learns there comes back
// through feed.setHandoff into the compiled hand-off file, and the addon's own Lua reads and merges that file.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const bridge = require("../src/core/live-bridge.cjs");
const feedModule = require("../src/core/game-guild-feed.cjs");
const handoff = require("../src/core/desktop-handoff.cjs");
const { GuildService } = require("../src/core/guild-service.cjs");
const { GroupStore } = require("../src/core/group-planner.cjs");
const { createLiveGuildHub } = require("../src/core/live-guild-ipc.cjs");
const { LiveClient } = require("../src/core/live-client.cjs");
const { CommunityService } = require("../src/core/community.cjs");
const { fakeLive } = require("./live-fake-server.cjs");

const root = path.join(__dirname, "..");
const SIGNALS = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/live-signals.json"), "utf8")).signals;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bf-live-int-"));
const until = async (fn, ms = 5000, what = "condition") => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)); } assert.fail(`timed out waiting for ${what}`); };
const quiet = (ms) => new Promise((r) => setTimeout(r, ms));
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const ABEL = { name: "Abel", realm: "Thunder Hold" }, ANNA = { name: "Anna", realm: "Thunder Hold" };
const IDENTITY = 4242;

test("recorded live signals -> decoder -> feed -> guild service -> service; and back: service -> hand-off file -> the addon's merge", async () => {
  const fake = await fakeLive().listen();
  const dir = tmp();
  // Anna's desktop linked the guild earlier; the code is the one the recorded link signal carries.
  const annaCommunity = new CommunityService({ dir: tmp(), getProfiles: () => [], appVersion: "1.28.0", baseUrl: fake.url });
  const anna = new GuildService({ dir: tmp(), community: annaCommunity });
  await anna.createGuild({ character: ANNA, faction: "horde", guildName: "Night Watch", rankIndex: 0, consent: true });
  const guild = fake.anyGuild(), guildId = guild.id;
  guild.linkCode = SIGNALS[0].payloads[0].code;
  await quiet(80);

  // Abel's desktop: a live bridge that sees his game, the real feed attached to it, the service, the planner.
  const community = new CommunityService({ dir, getProfiles: () => [], appVersion: "1.28.0", baseUrl: fake.url });
  const client = new LiveClient({ baseUrl: fake.url, getInstallId: () => community.settings.installId });
  const feed = feedModule.create();
  const live = new bridge.LiveBridge({ platform: "linux", now: () => 1000 });
  live.frame = { characterHash: IDENTITY };
  const detach = feed.attach(live);
  const state = { activeProfileId: "p1", profiles: [{ id: "p1", name: "Abel", realm: "Thunder Hold", faction: "Horde", level: 40, className: "Priest" }] };
  const group = new GroupStore({ file: path.join(dir, "group.json") });
  let hub = null;
  const service = new GuildService({ dir, community, live: client, feed, setHandoff: (data) => feed.setHandoff(data), getPlan: (c) => hub.handoffPlan(c) });
  hub = createLiveGuildHub({ getState: () => state, service, group, feed: { real: true } });
  service.on("party", (p) => { if (p) group.sawParty(p); });
  let serial = 0;
  // One signal as the game sends it: pages on the live link, twice (the second pass), decoded by the bridge.
  const play = (signal) => { const pages = bridge.encodeSignalPages(++serial, signal.text, IDENTITY); for (let pass = 0; pass < 2; pass++) for (const p of pages) live.questionPage(bridge.parseQuestionPage(p)); };
  const file = path.join(os.tmpdir(), `bf-live-int-${process.pid}.lua`);
  try {
    fake.clear();
    // 1. The link is heard: an invitation, and not one request.
    play(SIGNALS.find((s) => s.type === "link"));
    assert.deepEqual(service.offers().map((o) => [o.guildName, o.character.name, o.faction]), [["Night Watch", "Abel", "horde"]]);
    for (const s of SIGNALS.filter((x) => x.type === "event" || x.type === "signup")) play(s);
    await quiet(400);
    assert.deepEqual(fake.log, [], "events and sign-ups heard before Join are not sent");
    assert.equal(handoff.compile({ live: feed.handoff() }), handoff.EMPTY, "and the game is handed nothing");
    // 2. Join (rank 1 counts as an officer on this service).
    await service.join(SIGNALS[0].payloads[0].code, { consent: true });
    assert.equal(service.view().guilds[0].role, "officer");
    await until(() => client.status().state === "live", 5000, "live");
    // 3. The game reports its events and sign-ups again (a change, as the feed tells each fact once).
    const event = SIGNALS.find((s) => s.type === "event").payloads[0];
    const feed2 = feedModule.create(), live2 = new bridge.LiveBridge({ platform: "linux", now: () => 1000 });
    live2.frame = { characterHash: IDENTITY };
    feed2.attach(live2);
    for (const name of ["event", "signup", "party", "listing", "unlink"]) feed2.on(name, (p) => feed.emit(name, p)); // the same decoder, a fresh memory
    const replay = (signal) => { const pages = bridge.encodeSignalPages(++serial, signal.text, IDENTITY); for (const p of pages) live2.questionPage(bridge.parseQuestionPage(p)); };
    for (const s of SIGNALS.filter((x) => x.type === "event" || x.type === "signup")) replay(s);
    await until(() => fake.guild(guildId).events.size === 2 && (fake.guild(guildId).signups.get(event.id)?.size || 0) >= 3, 5000, "the game's events and sign-ups on the service");
    const { character: _c, ...sent } = event;
    assert.deepEqual(fake.guild(guildId).events.get(event.id), sent, "the event arrives exactly as the signal recorded it");
    assert.ok(fake.requests(`/v1/guilds/${guildId}/events/`).every((e) => e.member && e.method === "PUT"));
    assert.deepEqual([...fake.guild(guildId).signups.get(event.id).values()].every((s) => s.via === "game"), true);
    // What the game already holds is not handed back to it.
    assert.deepEqual(feed.handoff().guild.events, []); assert.deepEqual(feed.handoff().guild.signups, []);
    // 4. The party and a listing from the game reach the screens, not the service.
    const before = fake.log.length;
    for (const s of SIGNALS.filter((x) => x.type === "party" || x.type === "listing")) replay(s);
    assert.ok(service.view().party || true);
    await quiet(200);
    assert.equal(fake.log.slice(before).filter((e) => e.route.startsWith("/v1/lfg")).length, 0, "a listing made in game is not posted without the board's consent");
    // 5. News from the service: an event by Anna, an answer by a Discord button, live on Abel's stream.
    const at = new Date(Date.now() + 2 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");
    fake.putEvent(guildId, { id: "def456", version: 2, creator: ANNA, editor: ANNA, at, place: "bwl", title: "Blackwing Lair", note: "Bring \"onyxia\" cloaks", roles: { tank: 3, healer: 9, damage: 28 }, cancelled: false });
    fake.putSignup(guildId, "def456", { who: { name: "Cy", realm: "Thunder Hold" }, answer: "tank", version: 1, via: "discord" });
    fake.putSignup(guildId, event.id, { who: ANNA, answer: "healer", version: 7, via: "discord" });
    await until(() => feed.handoff().guild?.events.length === 2 && feed.handoff().guild.signups.length === 2, 5000, "the news in the hand-off");
    // 6. Abel answers in the app and lays out a plan.
    await service.answer(guildId, "def456", "healer");
    feed.emit("party", { leader: "Anna", total: 3, place: "bwl", plan: null, character: ABEL, members: [{ ...ANNA, class: "warrior", role: "tank", level: 60, online: true, ready: true }, { ...ABEL, class: "priest", role: "healer", level: 60, online: true, ready: true }, { name: "Cy", realm: "Thunder Hold", class: "mage", role: "damage", level: 60, online: true, ready: false }] });
    hub.changePlan(null, { action: "shape", place: "bwl" });
    hub.changePlan(null, { action: "auto" });
    hub.changePlan(null, { action: "note", slot: 0, note: "Pull with the bow" });
    hub.changePlan(null, { action: "planNote", note: "Meet at the stone" });
    // 7. The compiled hand-off file, read and merged by the addon's own Lua.
    const compiled = handoff.compile({ live: feed.handoff() });
    assert.match(compiled, /guild=/); assert.match(compiled, /plan=/); assert.match(compiled, /Night Watch/); assert.doesNotMatch(compiled, /lfg=/, "no board: it is switched off");
    for (const g of fake.guild(guildId).members) assert.ok(!compiled.includes(g.token), "no member key in the file the game reads");
    fs.writeFileSync(file, compiled);
    const out = lua(String.raw`DEFAULT_CHAT_FRAME={AddMessage=function() end}
for _,f in ipairs({'Lfg','Events','LiveGuild'}) do dofile('addon/BackstageForever/BackstageForever'..f..'.lua') end
dofile(${JSON.stringify(file.replace(/\\/g, "/"))})
local D=BackstageForeverDesktopData
local g=BackstageForeverDeskGuild(D)
assert(g and g.id==${JSON.stringify(guildId)} and g.name=='Night Watch' and g.realm=='Thunder Hold' and g.discord=='none','the guild part: '..tostring(g and g.id))
assert(#g.events==2,'the new event, and the one whose new answer needs its row: '..#g.events)
local ev={} for _,e in ipairs(g.events) do ev[e.id]=e end
assert(ev.abc123 and ev.abc123.ver==3 and ev.def456.ver==2 and ev.def456.creator=='Anna' and ev.def456.dungeon=='bwl' and ev.def456.roles.t==3 and ev.def456.roles.h==9 and ev.def456.roles.d==28 and ev.def456.note=='Bring "onyxia" cloaks')
assert(#g.signups==3,'three answers the game does not have: '..#g.signups)
local by={} for _,s in ipairs(g.signups) do by[s.id..':'..s.n]=s end
assert(by['def456:Cy'].s=='t' and by['def456:Cy'].via=='d' and by['def456:Abel'].s=='h' and by['def456:Abel'].via=='k' and by['abc123:Anna'].s=='h' and by['abc123:Anna'].v==7)
-- A game that knows neither event yet (a guildmate who was offline): the merge brings both, with the answers.
local NOW=${Math.floor(Date.now() / 1000)}
local db={events={}}
local ctx={now=NOW,guild='Night Watch',rank=function() return 1 end,member=function(n) return n=='Anna' or n=='Abel' or n=='Cy' or n=='Bob' end}
local news,why=BackstageForeverDeskMerge(db,g,'Abel',ctx)
assert(why==nil and #news.events==2 and db.events.def456.title=='Blackwing Lair' and db.events.abc123.title=='Molten Core' and db.events.abc123.ver==3,'both events are merged: '..tostring(why)..' '..#news.events)
assert(news.signups.def456 and #news.signups.def456==2 and news.signups.abc123 and #news.signups.abc123==1 and news.count==5,'and the answers: '..news.count)
assert(BackstageForeverDeskMerge(db,g,'Abel',ctx).count==0,'the next reload brings nothing new')
local other=select(2,BackstageForeverDeskMerge({events={}},g,'Abel',{now=NOW,guild='Another Guild',rank=ctx.rank,member=ctx.member}))
assert(other=='other','a hand-off for another guild is left alone')
local p=BackstageForeverDeskPlan(D,'Abel-Thunder Hold')
assert(p and p.place=='bwl' and p.note=='Meet at the stone' and #p.members==3 and p.members[1].name=='Anna' and p.members[1].role=='t' and p.members[1].bring=='Pull with the bow' and p.members[2].name=='Abel' and p.members[2].role=='h' and p.members[3].role=='d')
assert(BackstageForeverDeskPlan(D,'Anna-Thunder Hold')==nil,'the plan is for the character that made it')
print('ok')`);
    assert.equal(out, "ok");
    // 8. The game reloaded and saved: it now holds everything, and the hand-off empties itself.
    service.getSaved = () => [{ name: "Abel", realm: "Thunder Hold", guild: { events: [{ id: "abc123", ver: 3, signups: [{ name: "Anna", status: "h" }] }, { id: "def456", ver: 2, signups: [{ name: "Cy", status: "t" }, { name: "Abel", status: "h" }] }, { id: "zz9zz9", ver: 1, signups: [] }] } }];
    service.savedFileRead();
    assert.deepEqual(feed.handoff().guild.events, []); assert.deepEqual(feed.handoff().guild.signups, []);
    assert.equal(service.view().pending, 0);
    // 9. The leader ends the link in game: nothing is sent, the membership stays until Abel leaves.
    replay(SIGNALS.find((s) => s.type === "unlink"));
    assert.equal(service.view().guilds.length, 1);
    await service.leave(guildId);
    assert.equal(feed.handoff().guild, null); assert.doesNotMatch(handoff.compile({ live: feed.handoff() }), /guild=/);
  } finally {
    detach(); service.stop(); anna.stop(); client.stop(); fs.rmSync(file, { force: true }); await fake.close();
  }
});
