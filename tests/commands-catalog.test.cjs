"use strict";
// Keeps Help → Commands honest: every /bf command the addon handles is explained there,
// and the page never lists a command the addon does not handle.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { CATALOG, FEATURES, APP } = require("../src/renderer/commands.js");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

function handledWords() {
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  const slash = hud.slice(hud.indexOf("SlashCmdList.BACKSTAGEFOREVER="));
  const words = new Set();
  for (const m of slash.matchAll(/match\('\^(\w+)/g)) words.add(m[1]);
  for (const m of slash.matchAll(/word=='(\w+)'/g)) words.add(m[1]);
  for (const m of slash.matchAll(/message=='(\w*)'/g)) words.add(m[1]);
  return words;
}

test("every /bf command the addon handles is on the Commands page, and nothing else", () => {
  const handled = handledWords();
  assert.ok(handled.size >= 15, `parsed ${[...handled].join(",")}`);
  const listed = new Set(CATALOG.flatMap((c) => [c.word, ...(c.also || [])]));
  assert.deepEqual([...handled].filter((w) => !listed.has(w)).sort(), [], "missing from the Commands page");
  assert.deepEqual([...listed].filter((w) => !handled.has(w)).sort(), [], "listed but not handled by the addon");
});

test("each entry explains itself in plain words with a usable example", () => {
  const seen = new Set();
  for (const c of CATALOG) {
    assert.ok(!seen.has(c.command), `duplicate ${c.command}`); seen.add(c.command);
    for (const k of ["group", "command", "what", "when", "example"]) assert.ok(typeof c[k] === "string" && c[k].trim(), `${c.command}: ${k}`);
    assert.ok(c.command.startsWith("/bf"), c.command);
    assert.ok(c.example.startsWith(`/bf${c.word ? " " + c.word : ""}`), `${c.command} example ${c.example}`);
    assert.ok(c.what.length <= 260, `${c.command} is too long to scan`);
  }
  for (const f of FEATURES) assert.ok(f.name && f.where && f.what);
  for (const a of APP) assert.ok(a.name && a.what);
});

test("/bf help in game only mentions commands the page explains", () => {
  const assist = read("addon/BackstageForever/BackstageForeverAssist.lua");
  const help = assist.slice(assist.indexOf("local HELP_TOPICS={"), assist.indexOf("function BackstageForeverAssistCommand(message)"));
  const words = [...help.matchAll(/\/bf (\w+)/g)].map((m) => m[1]);
  assert.ok(words.length >= 60);
  const listed = new Set(CATALOG.flatMap((c) => [c.word, ...(c.also || [])]));
  for (const w of words) assert.ok(listed.has(w), `/bf ${w} in game help but not on the Commands page`);
});

test("/bf help is paged: a short index, one page per topic, one command by its word, and everything on request", () => {
  const { spawnSync } = require("node:child_process");
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, encoding: "utf8", timeout: 20000, input: String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
dofile('addon/BackstageForever/BackstageForeverAssist.lua')
local topics=BackstageForeverHelpTopics
assert(#topics==7)
-- The bare command: one line per topic plus a heading and a closing line, never the wall of text.
local index=BackstageForeverHelpLines(nil)
assert(#index==#topics+2 and #index<=10,'the index is short: '..#index)
for i,topic in ipairs(topics) do
  assert(index[i+1]==topic.index and topic.index:sub(1,#topic.key+2)==i..' '..topic.key,topic.key)
  assert(#topic.lines>=5 and #topic.lines<=14,topic.key..' is one screen of chat: '..#topic.lines)
  local byName,byNumber=BackstageForeverHelpLines(topic.key),BackstageForeverHelpLines(tostring(i))
  assert(#byName==#topic.lines+1 and byName[1]==topic.head and byName[2]==topic.lines[1])
  assert(#byNumber==#byName and byNumber[#byNumber]==byName[#byName],'page number and topic word give the same page')
  assert(BackstageForeverHelpLines('  '..topic.key:upper()..' ')[1]==topic.head,'case and spaces do not matter')
end
-- Every line is in exactly one topic, and "all" prints each once.
local seen,total={},0
for _,topic in ipairs(topics) do for _,line in ipairs(topic.lines) do assert(not seen[line],line) seen[line]=true total=total+1 assert(#line<=200,line) end end
local all=BackstageForeverHelpLines('all') assert(#all==total and total>=60)
-- A command word finds its own lines.
local fly=BackstageForeverHelpLines('fly') assert(#fly==1 and fly[1]:sub(1,13)=='/bf fly PLACE')
local guild=BackstageForeverHelpLines('guild') assert(#guild==2)
local helpers=BackstageForeverHelpLines('helpers') assert(#helpers==3)
-- An unknown word says so and shows the index again.
local unknown=BackstageForeverHelpLines('zzz') assert(unknown[1]=='No help page with that name.' and #unknown==#index+1)
assert(BackstageForeverHelpLines('99')[1]=='No help page with that name.')
-- The command prints what the function returns.
said={} local printed=BackstageForeverAssistCommand('help') assert(#said==#index and #printed==#index and said[1]=='Backstage Forever: '..index[1])
said={} BackstageForeverAssistCommand('help 3') assert(#said==#topics[3].lines+1 and said[1]=='Backstage Forever: '..topics[3].head)
said={} BackstageForeverAssistCommand('help Gold') assert(said[1]=='Backstage Forever: '..topics[3].head)
said={} BackstageForeverAssistCommand('help all') assert(#said==total)
print('ok')` });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), "ok");
});

test("about ninety commands stay easy to scan: nine groups in a set order, none huge, no row saying 'the same as'", () => {
  const groups = [...new Set(CATALOG.map((c) => c.group))];
  assert.deepEqual(groups, ["Finding your way", "Your character", "Gold, bags and professions", "Dungeons and groups", "Adventure Compass", "Helpers on or off", "Ask the companion", "Live link", "Advanced"]);
  // Each group is one block in the list (no group comes back later) and none is a wall.
  let last = null; const closed = new Set();
  for (const c of CATALOG) { if (c.group !== last) { assert.ok(!closed.has(c.group), `${c.group} is split`); if (last) closed.add(last); last = c.group; } }
  for (const g of groups) { const n = CATALOG.filter((c) => c.group === g).length; assert.ok(n >= 3 && n <= 20, `${g} has ${n} commands`); }
  for (const c of CATALOG) assert.ok(!/^The same .* as \/bf /.test(c.what), `${c.command} only repeats another row`);
  // Where a player looks first: the arrow, then how; the settings window leads its group.
  assert.equal(CATALOG[0].command, "/bf next");
  assert.equal(CATALOG.find((c) => c.group === "Helpers on or off").word, "options");
  const of = (word) => CATALOG.find((c) => c.word === word).group;
  for (const word of ["lfg", "check", "mentor", "sr", "guild", "raid", "atlas", "run", "party", "group"]) assert.equal(of(word), "Dungeons and groups", word);
  for (const word of ["prof", "nodes", "loop", "ledger", "prices", "sell", "shop", "mail", "bags", "wish"]) assert.equal(of(word), "Gold, bags and professions", word);
});

test("the Commands page is reachable from Help", () => {
  assert.match(read("src/renderer/player-navigation.js"), /\["commands", "Commands"\]/);
  assert.match(read("src/renderer/app.js"), /commands: CommandsView\.page/);
  const html = read("src/renderer/index.html");
  assert.match(html, /<script src="commands\.js"><\/script>/);
  assert.match(html, /href="commands\.css"/);
});

test("every art file the pages reference ships with the app", () => {
  const referenced = new Set();
  for (const f of ["src/renderer/now.css", "src/renderer/commands.css", "src/renderer/styles.css", "src/renderer/page-hero.css", "src/renderer/command-center.css", "src/renderer/moments.css"]) for (const m of read(f).matchAll(/url\("(art\/[^"]+)"\)/g)) referenced.add(m[1]);
  for (const m of read("src/renderer/commands.js").matchAll(/"([a-z-]+)"/g)) if (fs.existsSync(path.join(root, "src/renderer/art/icons", m[1] + ".png"))) referenced.add(`art/icons/${m[1]}.png`);
  assert.ok(referenced.size >= 10, [...referenced].join(","));
  for (const r of referenced) assert.ok(fs.existsSync(path.join(root, "src/renderer", r)), `missing ${r}`);
  for (const g of new Set(CATALOG.map((c) => c.group))) assert.match(read("src/renderer/commands.js"), new RegExp(`"${g}": "`), `no crest for ${g}`);
});

test("every Now step has its painted crest", () => {
  const now = read("src/renderer/now.js");
  const kinds = [...new Set([...now.matchAll(/out\.push\(\{ kind: "([a-z-]+)"/g)].map((m) => m[1]))];
  assert.ok(kinds.length >= 5, kinds.join(","));
  for (const k of kinds) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/steps", k + ".png")), `missing crest ${k}`);
  const wm = read("src/renderer/world-map.js"), pins = /for \(const k of (\[[^\]]+\])\)/.exec(wm.slice(wm.indexOf("const PAINTED")));
  for (const k of JSON.parse(pins[1])) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/pins", k + ".png")), `missing map pin art ${k}`);
  for (const b of require("../src/core/badges.cjs").BADGES) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/badges", b.id + ".png")), `missing badge art ${b.id}`);
  const biomes = new Set([...(now + read("src/renderer/zone-art.js")).matchAll(/\d+: "([a-z]+)"/g)].map((m) => m[1]));
  assert.ok(biomes.has("warcamp") && biomes.has("citadel"), "capital cities have vistas");
  for (const b of biomes) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/zones", b + ".webp")), `missing vista ${b}`);
});

test("every page banner has its painting, layered over a fallback, and the companion has its crest", () => {
  const css = read("src/renderer/page-hero.css");
  global.window = {}; eval(read("src/renderer/page-hero.js")); const { ART } = window.PageHero; delete global.window;
  for (const key of ART) {
    const rule = new RegExp(`\.ph-art-${key}::before \{ background-image: ([^;]+);`).exec(css);
    assert.ok(rule, `no banner rule for ${key}`);
    const urls = [...rule[1].matchAll(/url\("(art\/[^"]+)"\)/g)].map((m) => m[1]);
    assert.ok(urls.length >= 1, key);
    for (const u of urls) assert.ok(fs.existsSync(path.join(root, "src/renderer", u)), `missing ${u}`);
    if (!["now", "settings"].includes(key)) assert.deepEqual(urls, [`art/heroes/${key}.webp`, "art/hero-help.webp"], `${key} paints its own hero over the fallback`);
  }
  assert.ok(fs.existsSync(path.join(root, "src/renderer/art/pins/companion.png")), "companion crest");
  assert.match(read("src/renderer/free-ai.css"), /art\/pins\/companion\.png/, "the companion page uses its own crest");
  assert.match(read("src/renderer/index.html"), /href="page-hero\.css"/); assert.match(read("src/renderer/index.html"), /src="page-hero\.js"/);
});

test("quest how-to steps and coverage meters use art that exists and fits", () => {
  const how = JSON.parse(read("src/renderer/quest-guide.js").match(/const HOW_ICON = (\{[^}]*\})/)[1].replace(/(\w+|"[^"]+"):/g, (m, k) => `"${k.replace(/"/g, "")}":`));
  for (const v of Object.values(how)) assert.ok(fs.existsSync(path.join(root, "src/renderer/art", v + ".png")), v);
  assert.notEqual(how.item, how["turn-in"], "collecting an item is not a hand-in");
  const cov = [...read("src/renderer/coverage.js").matchAll(/\["(\w+)", "[^"]+", "([a-z/-]+)", \d+\]/g)];
  assert.ok(cov.length >= 6);
  for (const [, , art] of cov) assert.ok(fs.existsSync(path.join(root, "src/renderer/art", art + ".png")), art);
  const by = Object.fromEntries(cov.map(([, k, a]) => [k, a]));
  assert.equal(by.professionTrainers, "pins/profession-trainer"); assert.equal(by.questGivers, "pins/quest-giver");
});

test("every moment kind has its painted medallion, and every stand-in art file exists", () => {
  const js = read("src/renderer/moments.js");
  const medallions = JSON.parse("{" + js.match(/const MEDALLION = Object\.freeze\(\{([^}]*)\}/)[1].replace(/(\w+):/g, '"$1":') + "}");
  const { KINDS } = require("../src/core/moments.cjs");
  assert.deepEqual(Object.keys(medallions).sort(), [...KINDS].sort(), "a medallion per moment kind");
  for (const f of Object.values(medallions)) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/moments", f + ".png")), `missing medallion ${f}`);
  for (const m of js.match(/const FALLBACK = Object\.freeze\(\{([^}]*)\}/)[1].matchAll(/"(art\/[^"]+)"/g)) assert.ok(fs.existsSync(path.join(root, "src/renderer", m[1])), `missing ${m[1]}`);
  assert.match(read("src/renderer/art/NOTICE.md"), /`moments\/\*\.png`/);
  const html = read("src/renderer/index.html");
  assert.match(html, /<script src="moments\.js"><\/script>/); assert.match(html, /href="moments\.css"/);
});

test("every class has its crest", () => {
  for (const c of ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"]) assert.ok(fs.existsSync(path.join(root, "src/renderer/art/classes", c + ".png")), c);
});

test("Help → Commands explains the loot browser, the wish list and hover cards", () => {
  const app = APP.map((a) => `${a.name} ${a.what}`).join("\n");
  assert.match(app, /Loot/); assert.match(app, /wish list/); assert.match(app, /Upgrade for you/);
  assert.match(app, /Hover cards/); assert.match(app, /an item or an NPC/);
});

test("Help → Commands lists the live strip placement and hairline/compact/safe modes the addon accepts", () => {
  const live = CATALOG.filter((c) => c.word === "live").map((c) => c.command);
  assert.ok(live.includes("/bf live pos topleft|topright|bottomleft|bottomright"), live.join(" / "));
  assert.ok(live.includes("/bf live hairline|compact|safe"), live.join(" / "));
  const addon = read("addon/BackstageForever/BackstageForeverLive.lua");
  const parse = addon.slice(addon.indexOf("function BackstageForeverLiveParse"), addon.indexOf("function BackstageForeverLiveCommand"));
  for (const w of ["pos", "safe", "compact", "hairline"]) assert.match(parse, new RegExp(`'${w}'`), `addon parses /bf live ${w}`);
  for (const corner of ["topleft", "topright", "bottomleft", "bottomright"]) assert.match(addon, new RegExp(`${corner}='[A-Z]+'`), corner);
});

test("live link status shows the strip's mode, placement and the remote desktop tip", () => {
  const vm = require("node:vm");
  const c = { window: {}, document: { querySelectorAll: () => [], addEventListener() {} }, setInterval() {} };
  vm.createContext(c);
  vm.runInContext(read("src/renderer/live-link.js"), c);
  const L = c.window.LiveLink;
  assert.equal(L.stripLine({ enabled: true, strip: { mode: "compact", corner: "topright", width: 84, height: 4, idle: false } }), "Mode: Compact · Placement: top-right · 84×4 px");
  assert.equal(L.stripLine({ enabled: true, strip: { mode: "safe", corner: "bottomleft", width: 456, height: 12, idle: true } }), "Mode: Safe · Placement: bottom-left · 456×12 px · idle (nothing changing)");
  assert.equal(L.stripLine({ enabled: false, strip: { mode: "compact", corner: "topleft", width: 84, height: 4 } }), "");
  assert.match(L.markup(), /Type \/bf live safe if the link drops over remote desktop\./);
  assert.match(read("src/renderer/now.js"), /Type <code>\/bf live safe<\/code> if the link drops over remote desktop/);
  assert.match(read("src/renderer/now.js"), /sig === "compact-unreadable"/);
});

test("Help explains community sharing and how to turn it off", () => {
  const entry = APP.find((a) => a.name === "Community");
  assert.ok(entry, "Community entry on the Commands page");
  assert.match(entry.what, /anonymous/); assert.match(entry.what, /Turn it off under Settings → Game connection → Community/);
  assert.match(entry.what, /No names, realm, account or chat/);
  assert.match(read("src/renderer/app.js"), /Community sharing(?:<\/strong>)? is on by default[^<]*Turn it off any time in Settings → Game connection → Community/);
  const html = read("src/renderer/index.html");
  assert.match(html, /<script src="community\.js"><\/script>/); assert.match(html, /href="community\.css"/);
  assert.match(read("src/renderer/app.js"), /CommunityView\.markup\(\)/);
});

test("Help names the newer pages where a player would look for them", () => {
  const app = read("src/renderer/app.js"), nav = read("src/renderer/player-navigation.js");
  const guide = app.slice(app.indexOf("function guide()"), app.indexOf("const onMac"));
  for (const id of ["travel", "talents", "recipes", "runs", "ledger", "gear-plan"]) assert.ok(guide.includes(`data-guide-new="${id}"`), `Field guide has no paragraph for ${id}`);
  for (const route of ["travel", "talents", "journey", "run-history", "attunements", "ledger-reputation", "calendar"]) assert.ok(guide.includes(`data-nav="${route}"`), `Field guide has no button to ${route}`);
  for (const words of ["travel planner", "run history", "recipe book", "cooldown calendar", "gear plan", "trainer costs", "story so far", "craft profit", "reputation planner", "look up every command"]) assert.ok(nav.includes(words), `no section description mentions ${words}`);
  const names = APP.map((a) => a.name);
  for (const name of ["Travel planner", "Talent planner and trainer costs", "Gear plan and stat weights", "Recipe book and skill path", "Run history and keys", "Craft profit and reputation planner", "Story so far, timeline and races"]) assert.ok(names.includes(name), name);
  for (const a of APP) assert.ok(a.what.length <= 520, `${a.name} is too long to scan`);
  assert.match(read("src/renderer/onboarding.js"), /gear plan, talents, gold, bags, professions with a recipe book, dungeon runs and the story so far/);
  const de = JSON.parse(read("data/i18n/de.json")).app;
  for (const m of nav.matchAll(/description:\s*"([^"]+)"/g)) assert.ok(de[m[1]], `no German for the section description: ${m[1]}`);
  for (const m of guide.matchAll(/<p data-guide-new="[a-z-]+">([^<]+)<\/p>/g)) assert.ok(de[m[1]], `no German for: ${m[1]}`);
});
