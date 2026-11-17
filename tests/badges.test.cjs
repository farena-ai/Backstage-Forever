"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { badgesFor, badgeBook, accountBadges, nextUp, BADGES, ACCOUNT_BADGES, GROUPS } = require("../src/core/badges.cjs");
const root = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const jess = { id: "a", name: "Jessiee", faction: "Horde", className: "Mage", level: 24,
  history: { completedCount: 30 },
  journal: { zones: ["Durotar", "The Barrens", "Orgrimmar", "Mulgore", "Stonetalon"], firsts: [{ key: "flight", at: 1700000000 }, { key: "death", at: 1700100000 }] },
  readiness: { workshop: { professions: { items: [{ name: "Tailoring", rank: 160, maxRank: 225 }, { name: "First Aid", rank: 80, maxRank: 150 }] } } },
  ledger: { money: 1234567, reputations: { seenAt: 1700000000, factions: [{ id: 76, name: "Orgrimmar", standing: 6, min: 9000, max: 21000, value: 9500 }, { id: 530, name: "Darkspear Trolls", standing: 5, min: 3000, max: 9000, value: 4000 }] } } };
const bran = { id: "b", name: "Bran", faction: "Alliance", className: "Warrior", level: 8, history: { completedCount: 3 } };

test("1.1 badges: professions, gold and reputation from the saved character", () => {
  const b = badgesFor(jess), get = (id) => b.badges.find((x) => x.id === id);
  assert.equal(get("profession-75").earned, true);
  assert.equal(get("profession-150").earned, true);
  assert.equal(get("profession-225").earned, false);
  assert.deepEqual(get("profession-225").progress, { have: 160, need: 225 });
  assert.equal(get("gold-100").earned, true, "123g carried");
  assert.equal(get("gold-1000").earned, false);
  assert.equal(get("rep-honored").earned, true);
  assert.equal(get("rep-revered").earned, false);
  assert.equal(get("first-flight").at, 1700000000);
  const none = badgesFor(bran);
  for (const id of ["profession-75", "gold-10", "rep-honored"]) assert.equal(none.badges.find((x) => x.id === id).earned, false, `${id} needs data`);
  for (const b of BADGES) assert.ok(GROUPS.includes(b.group), `${b.id} has a known group`);
});

test("the Badges page: one character's case, who else holds each badge, account badges, closest next", () => {
  const book = badgeBook({ profiles: [jess, bran], activeProfileId: "b" }, "a");
  assert.equal(book.character.name, "Jessiee");
  assert.equal(book.characters.length, 2);
  assert.equal(book.characters.find((c) => c.id === "a").active, true);
  assert.deepEqual(book.holders["level-10"], ["Jessiee"]);
  assert.equal(book.recent[0].id, "first-death", "latest first");
  assert.ok(book.next.length && book.next.every((b) => !b.earned && b.progress), "closest next are unfinished badges with progress");
  assert.ok(book.account.badges.find((b) => b.id === "account-both").earned, "a Horde and an Alliance character");
  assert.ok(book.account.badges.find((b) => b.id === "account-2").earned);
  assert.equal(book.account.badges.find((b) => b.id === "account-5").earned, false);
  const fallback = badgeBook({ profiles: [jess, bran], activeProfileId: "b" }, "missing");
  assert.equal(fallback.character.name, "Bran", "unknown id falls back to the active character");
  const empty = badgeBook({ profiles: [] }, null);
  assert.equal(empty.book, null);
  assert.equal(empty.account.earned, 0);
});

test("closest next: the biggest share done first", () => {
  const list = nextUp({ badges: [
    { id: "x", earned: false, progress: { have: 1, need: 10 } },
    { id: "y", earned: false, progress: { have: 9, need: 10 } },
    { id: "z", earned: true, progress: { have: 10, need: 10 } },
    { id: "w", earned: false, progress: { have: 0, need: 10 } },
  ] });
  assert.deepEqual(list.map((b) => b.id), ["y", "x"]);
});

test("every badge, account badges included, ships its painted art", () => {
  for (const b of [...BADGES, ...ACCOUNT_BADGES]) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/badges", b.id + ".png")), `missing badge art ${b.id}`);
  assert.ok(fs.existsSync(path.join(root, "src/renderer/art/heroes/badges.webp")), "the Badges page paints its own hero");
});

test("wiring: Characters → Badges route, IPC, preload, page and the banner opens it", () => {
  assert.match(read("src/renderer/player-navigation.js"), /\["badges", "Badges"\]/);
  assert.match(read("src/main.cjs"), /handle\("badges"/);
  assert.match(read("src/preload.cjs"), /badges: \(profileId = null\) => invoke\("badges", profileId\)/);
  const html = read("src/renderer/index.html");
  assert.ok(html.indexOf("badges.js") > html.indexOf("journey.js") && html.indexOf("badges.js") < html.indexOf("app.js"));
  assert.match(html, /badges\.css/);
  assert.match(read("src/renderer/app.js"), /badges: BadgesView\.page/);
  assert.match(read("src/renderer/app.js"), /BadgesView\.mounted\(\)/);
  const journey = read("src/renderer/journey.js");
  assert.match(journey, /BadgesView\?\.open\(profileId, b\.id\)/);
  assert.match(journey, /dataset\.nav = "badges"/);
  assert.match(journey, /See all your badges/);
});

test("the Badges view renders a character's case, filters and account shelf", async () => {
  const vm = require("node:vm");
  const book = badgeBook({ profiles: [jess, bran], activeProfileId: "a" }, null);
  const calls = [];
  let html = "";
  const rootEl = { addEventListener() {}, querySelectorAll: () => [], set outerHTML(v) { html = v; } };
  const ctx = { console, Date, CSS: { escape: (s) => s }, matchMedia: () => ({ matches: true }),
    document: { querySelector: (sel) => (sel === "[data-badges]" ? rootEl : null) } };
  ctx.window = { backstage: { badges: async (id) => { calls.push(id); return book; } }, PageHero: { render: (o) => `<header>${o.title}|${o.subtitle}</header>`, classCrest: () => "" } };
  ctx.PageHero = ctx.window.PageHero;
  vm.createContext(ctx);
  vm.runInContext(read("src/renderer/badges.js"), ctx);
  const V = ctx.window.BadgesView;
  assert.match(V.page(), /Badges appear once a character has been saved/);
  V.mounted();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [null], "the active character by default");
  assert.match(html, /Jessiee's badges/);
  assert.match(html, /Account badges/);
  assert.match(html, /data-badge-char="b"/, "a chip per character");
  assert.match(html, /Earned/);
  assert.match(html, /160 \/ 225/, "progress toward Expert");
  assert.match(html, /Also: |Closest next/);
  V.open("b", "gold-10");
  assert.equal(V._state().focus, "gold-10");
  assert.equal(V._state().chosen, "b");
});

test("1.1.1: badges in game follow the app's rules, toast new ones, and /bf badges reports progress", () => {
  const { spawnSync } = require("node:child_process");
  const src = String.raw`
local t=1000 time=function() return t end
local lines,toasts={},{}
DEFAULT_CHAT_FRAME={AddMessage=function(_,m) lines[#lines+1]=m end}
BackstageForeverToast=function(title,body) toasts[#toasts+1]=title end
UnitLevel=function() return 21 end
GetMoney=function() return 1234567 end
BackstageForeverSavedFacts=function() return {quests=30,profession=160,standing=6} end
dofile('addon/BackstageForever/BackstageForeverJournal.lua')
for _,z in ipairs({1,2,3,4,5}) do BackstageForeverJournalZone(z) end
BackstageForeverJournalFirst('flight',10)
BackstageForeverJournalLevel(20,100) BackstageForeverJournalPlayed(1000)
local list,earned=BackstageForeverBadgeList()
local by={} for _,b in ipairs(list) do by[b.id]=b end
assert(#list==30,'same 30 badges as the app: '..#list)
assert(by['level-20'].earned and not by['level-30'].earned and by['level-30'].have==21)
assert(by['quests-25'].earned and by['explorer-5'].earned and by['first-flight'].earned and not by['first-mount'].earned)
assert(by['profession-150'].earned and not by['profession-225'].earned and by['gold-100'].earned and not by['gold-1000'].earned)
assert(by['rep-honored'].earned and not by['rep-revered'].earned)
assert(#BackstageForeverBadgeCheck()==earned and #toasts==0,'first check is the baseline, no toasts')
UnitLevel=function() return 30 end
local fresh=BackstageForeverBadgeCheck()
assert(#fresh==1 and fresh[1].id=='level-30' and toasts[1]=='Badge earned: Level 30','a new badge toasts once')
assert(#BackstageForeverBadgeCheck()==0 and #toasts==1)
BackstageForeverBadgesCommand('badges')
assert(lines[1]:find(earned+1 ..' of 30 badges earned',1,true),lines[1])
assert(lines[2]:find('Next: ',1,true))
BackstageForeverBadgesCommand('badges all')
local joined=table.concat(lines,'\n')
assert(joined:find('Levels: Level 10, Level 20, Level 30',1,true),joined)
print('ok')`;
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: src, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), "ok");
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /word=='badges'/);
  assert.match(read("addon/BackstageForever/BackstageForever.lua"), /function BackstageForeverSavedFacts\(\)/);
  const app = require("../src/core/badges.cjs").BADGES.map((b) => b.id).sort();
  const lua = [...read("addon/BackstageForever/BackstageForeverJournal.lua").matchAll(/add\('([a-z0-9-]+)'(\.\.n)?/g)].length;
  assert.ok(app.length === 30 && lua > 0);
});
