"use strict";
// Website pages for backstagecoding.com/backstage-forever/ (roadmap R4, R5, D6).
//
//   node scripts/build-site.cjs SITE_DIR          write the pages
//   node scripts/build-site.cjs SITE_DIR --check  fail if a page is stale or a link is broken
//
// SITE_DIR is a copy of the live folder (index.html, landing.css, desktop-downloads.js, images).
// The site's own header, footer, stylesheets and scripts are taken from that index.html, so the
// new pages always match the live page. Everything written here is generated from the repo:
//   whats-new.html  data/whats-new-catalog.json (the list the app shows after an update)
//   tour.html       the feature tour; pictures come from scripts/site-screenshots.cjs --webp SITE_DIR/tour
//   commands.html   src/renderer/commands.js (the list behind Help → Commands)
//   coverage.html   the same count the app's Help → Data coverage shows, plus pack totals
//   tour.css        styles for these pages
// and one marked block in index.html that links to them. No page needs JavaScript to be read.
// Run it again for every release; nothing is deployed from here.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const json = (p) => JSON.parse(read(p));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (n) => Number(n).toLocaleString("en-US");
const RELEASES = "https://github.com/farena-ai/Backstage-Forever/releases";
const SHOWN_RELEASES = 8;

// ---------- the site's own chrome, from the live index.html ----------
function chrome(index) {
  const mainStart = index.indexOf('<main id="main">'), mainEnd = index.indexOf("</main>");
  const skip = index.indexOf('<a class="skip"');
  if (mainStart < 0 || mainEnd < 0 || skip < 0) throw new Error("index.html does not look like the live page (no skip link or <main id=\"main\">).");
  const after = index.slice(mainEnd + "</main>".length);
  const scriptAt = after.search(/<script\b/);
  return {
    styles: (index.match(/<link rel="stylesheet"[^>]*>/g) || []).filter((l) => !l.includes("tour.css")),
    header: index.slice(skip, mainStart),
    footer: scriptAt < 0 ? after.replace(/<\/body>[^]*$/, "") : after.slice(0, scriptAt),
    scripts: (after.match(/<script\b[^>]*><\/script>/g) || []),
  };
}

const PAGES = [["tour.html", "Feature tour"], ["whats-new.html", "What's new"], ["commands.html", "Commands"], ["coverage.html", "Data coverage"]];
const downloads = `<div class="actions" aria-label="Download the desktop app"><a class="btn" data-download="windows" href="${RELEASES}/latest">Download for Windows <span aria-hidden="true">↓</span></a><a class="btn light" data-download="arm" href="${RELEASES}/latest">Mac · Apple Silicon <span aria-hidden="true">↓</span></a><a class="btn light" data-download="intel" href="${RELEASES}/latest">Mac · Intel <span aria-hidden="true">↓</span></a></div>`;

function page(c, { file, title, description, eyebrow, heading, lead, body }) {
  const nav = `<nav class="bfx-nav" aria-label="Backstage Forever pages"><a href="./">Download</a>${PAGES.map(([href, label]) => `<a href="./${href}"${href === file ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Backstage Forever</title><link rel="canonical" href="https://backstagecoding.com/backstage-forever/${file}"><meta name="description" content="${esc(description)}">${c.styles.join("")}<link rel="stylesheet" href="./tour.css"></head><body>
${c.header}<main id="main" class="bfx-page">
<section class="bfx-hero"><div class="wrap"><p class="eyebrow"><img src="./crest.png" width="28" height="28" alt=""> ${esc(eyebrow)}</p><h1>${heading}</h1><p class="bfx-lead">${lead}</p>${nav}</div></section>
${body}
<section class="bfx-get"><div class="wrap"><h2>Get the desktop app</h2><p>One download. The desktop app installs its addon into WoW Forever during setup.</p>${downloads}<p class="fine">Free · Windows and Mac · <a class="bf-release" href="${RELEASES}/latest">Latest release ↗</a></p></div></section>
</main>${c.footer}${c.scripts.join("")}</body></html>
`;
}

// ---------- what's new ----------
const KIND_LABEL = { new: "New", improved: "Better", fixed: "Fixed", compatibility: "Game updates" };
const PLATFORM_LABEL = { desktop: "Desktop app", windows: "Windows", macos: "Mac", addon: "In game" };
function stableReleases() {
  const { compareVersions } = require("../src/core/whats-new-catalog.cjs");
  return json("data/whats-new-catalog.json").releases.filter((r) => r.channel === "stable").sort((a, b) => compareVersions(b.version, a.version));
}
const tagline = (r) => r.title.replace(/^Backstage Forever\s+\S+\s*[—–-]\s*/, "").trim() || r.title;
function whatsNew(c) {
  const releases = stableReleases(), shown = releases.slice(0, SHOWN_RELEASES);
  const body = shown.map((r, i) => {
    const groups = Object.keys(KIND_LABEL).map((kind) => {
      const rows = r.changes.filter((ch) => ch.kind === kind);
      return rows.length ? `<h3 class="bfx-kind bfx-kind-${kind}">${KIND_LABEL[kind]}</h3><ul>${rows.map((ch) => `<li>${esc(ch.text)}${ch.platforms?.length ? ` <span class="bfx-where">${ch.platforms.map((p) => esc(PLATFORM_LABEL[p] || p)).join(" · ")}</span>` : ""}</li>`).join("")}</ul>` : "";
    }).join("");
    return `<article class="bfx-release" id="v${esc(r.version)}"><header><p class="bfx-version">${i === 0 ? "Latest · " : ""}Version ${esc(r.version)}</p><h2>${esc(tagline(r))}</h2></header>${groups}<p class="bfx-more"><a class="text-link" href="${RELEASES}/tag/v${esc(r.version)}">Full notes and files for ${esc(r.version)} ↗</a></p></article>`;
  }).join("\n");
  return page(c, { file: "whats-new.html", title: "What's new", description: "What changed in the latest Backstage Forever releases, from the same list the app shows after an update.",
    eyebrow: "Release notes", heading: "What's <em>new.</em>", lead: "The same list the app shows after an update, newest first.",
    body: `<section class="wrap section bfx-releases">${body}<p class="bfx-older">${releases.length > shown.length ? `${releases.length - shown.length} older releases are on ` : "Every release is on "}<a class="text-link" href="${RELEASES}">GitHub ↗</a></p></section>` });
}

// ---------- feature tour ----------
// name = picture in tour/ (name.webp and name-small.webp); alt says what is on it.
const TOUR = [
  { id: "next", title: "Know what to do next", lead: "Open the app and it tells you your next step, from your last save.", shots: [
    ["now", "Now", "Now page: the next quest to hand in for a level 16 hunter, with Show on map", "One clear next step with the reason, then your objective, your week and your quest log."],
    ["guided-route", "Guided route", "Guided route page: the next pick-up on the route and a plan B from the quest log", "A step-by-step leveling route for every race. It finds your place from your save and says what is missing."],
  ] },
  { id: "map", title: "Find your way", lead: "A map that knows where things are, and a planner that knows how long the trip takes.", shots: [
    ["world-map-loop", "World Map with a gathering loop", "World Map of The Barrens with quest pins and a numbered herb gathering loop", "Quest givers, objectives, trainers, vendors and flight masters on one map. Pick Herbalism or Mining and it draws a round trip through spots you and other players found, then sends it to the game."],
    ["travel", "Travel planner", "Travel planner comparing a flight, going on foot and the Hearthstone to Thunder Bluff", "On foot, by flight or by Hearthstone: the time and the price of each, fastest first."],
  ] },
  { id: "dungeons", title: "Dungeons and raids", lead: "What drops, what you ran and which keys you still need.", shots: [
    ["dungeons-loot", "Dungeons & raids with loot", "Scarlet Monastery in the Instance Atlas with each boss's recorded loot and drop chances", "All 27 dungeons and raids by level. Each boss lists the loot players saw, how often, and whether it is an upgrade for you."],
    ["run-history", "Run history", "Run history: personal best time and most bosses for nine dungeons and raids", "Every run with its time, bosses, deaths and your loot, and your best time in each dungeon."],
    ["attunements", "Keys & attunements", "Keys and attunements: the Onyxia chain with four steps done and the current step marked", "The classic key and attunement chains with the step your character is on."],
  ] },
  { id: "character", title: "Plan your character", lead: "Talents and gear, checked against your own game files.", shots: [
    ["talents-plan", "Talents: My plan", "Talent planner for a mage with 51 points placed and the level-up order", "Click talents to build a plan. You get the level-up order, a share code and the respec cost. The game shows your next point with /bf talents."],
    ["gear-plan", "Gear plan", "Gear plan: for each slot the worn item and up to three upgrades with where they come from", "For each slot: what you wear and up to three upgrades you can reach, best first by your stat weights, with the quest, vendor or boss they come from."],
  ] },
  { id: "professions", title: "Professions and gold", lead: "Recipes, prices and cooldowns, from what you saw yourself.", shots: [
    ["recipe-book", "Recipe book", "Recipe book for Alchemy: recipes with skill colours, known or missing, and where each comes from", "Every recipe of a profession: known or missing, the skill colours and where to learn it."],
    ["skill-path", "Skill path", "Skill path for Alchemy: the cheapest recipe for the next skill range with its material cost", "The cheapest way through each skill range, worked out from your game files and the prices you saw. Unknown prices stay unknown."],
    ["price-history", "Price history", "Gold and prices: remembered auction prices with a small history line per item", "The addon remembers the auction prices you looked at. The app shows the usual price and a short history for each item."],
    ["craft-profit", "Craft profit", "Craft profit: material cost, selling price and profit for six recipes", "What your recipes cost to make and what the result sold for, only from prices you saw."],
    ["calendar", "Calendar", "Cooldown calendar for November with a transmute and a Mooncloth cooldown", "Every character's profession cooldowns and mail expiry on one calendar."],
  ] },
  { id: "journey", title: "Your journey", lead: "A record of your character that stays on your computer.", shots: [
    ["journey-story", "Story so far", "Story so far: levels, firsts, dungeon runs and deaths written as short chapters", "Your character's story in plain sentences, written only from what was saved."],
    ["journey-timeline", "Timeline", "Timeline: level-ups and dungeon runs by day", "Level-ups, firsts, dungeon runs and your screenshots, day by day."],
    ["share-card", "Share picture", "Share picture for a Molten Core run: bosses, time and deaths on a painted card", "A painted card for a run, a level-up or a badge. Your name is only on it if you tick the box."],
  ] },
];
function figure(site, name, caption, alt, missing) {
  for (const f of [`tour/${name}.webp`, `tour/${name}-small.webp`]) if (!fs.existsSync(path.join(site, f))) missing.push(f);
  return `<figure class="bfx-shot"><a class="screen-frame" href="./tour/${name}.webp"><img src="./tour/${name}-small.webp" width="720" height="450" alt="${esc(alt)}" loading="lazy"></a><figcaption><strong>${esc(caption)}</strong> ${""}</figcaption></figure>`;
}
function tour(c, site, missing) {
  const { CATALOG } = require("../src/renderer/commands.js");
  const jump = `<nav class="bfx-jump" aria-label="On this page">${TOUR.map((t) => `<a href="#${t.id}">${esc(t.title)}</a>`).join("")}<a href="#in-game">In the game</a></nav>`;
  const sections = TOUR.map((t, i) => `<section class="bfx-pillar${i % 2 ? " bfx-band" : ""}" id="${t.id}"><div class="wrap section"><p class="eyebrow">${String(i + 1).padStart(2, "0")} / ${esc(t.title)}</p><h2>${esc(t.lead)}</h2><div class="bfx-shots">${t.shots.map(([name, caption, alt, text]) => figure(site, name, caption, alt, missing).replace('</strong> </figcaption>', `</strong> ${esc(text)}</figcaption>`)).join("")}</div></div></section>`).join("\n");
  const n = TOUR.length + 1;
  const inGame = `<section class="bfx-pillar${TOUR.length % 2 ? " bfx-band" : ""}" id="in-game"><div class="wrap section"><p class="eyebrow">${String(n).padStart(2, "0")} / In the game</p><h2>The addon brings it into WoW Forever.</h2><div class="bfx-shots"><figure class="bfx-shot"><div class="screen-frame"><img src="./compass.png" width="624" height="438" alt="Adventure Compass showing leveling progress and quest hand-ins" loading="lazy"></div><figcaption><strong>Adventure Compass</strong> What is ready to hand in and how your leveling is going.</figcaption></figure><figure class="bfx-shot"><div class="screen-frame"><img src="./helpers.png" width="672" height="504" alt="In-Game Helpers panel with per-character settings" loading="lazy"></div><figcaption><strong>In-Game Helpers</strong> Choose which hints each character gets.</figcaption></figure>${figure(site, "commands", "Commands", "Help, Commands page in the desktop app: every command with what it does and when to use it", missing).replace('</strong> </figcaption>', `</strong> ${num(CATALOG.length)} things you can type in game, each explained in plain words. <a class="text-link" href="./commands.html">See them all</a></figcaption>`)}</div></div></section>`;
  return page(c, { file: "tour.html", title: "Feature tour", description: "A tour of Backstage Forever with real screenshots: next steps, world map, dungeons, talents and gear, professions, gold and your journey.",
    eyebrow: "Feature tour", heading: "See what it <em>does.</em>", lead: "Real screens from the desktop app. The characters are made up; item pictures come from your own game files.",
    body: `<div class="wrap">${jump}</div>\n${sections}\n${inGame}` });
}

// ---------- commands ----------
function commands(c) {
  const { CATALOG, FEATURES, APP } = require("../src/renderer/commands.js");
  const groups = [...new Set(CATALOG.map((x) => x.group))];
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const jump = `<nav class="bfx-jump" aria-label="On this page">${groups.map((g) => `<a href="#${slug(g)}">${esc(g)}</a>`).join("")}<a href="#in-game">Things you'll see in game</a><a href="#in-app">In the desktop app</a></nav>`;
  const sections = groups.map((g) => `<section class="bfx-cmd-group" id="${slug(g)}"><h2>${esc(g)}</h2><dl class="bfx-cmds">${CATALOG.filter((x) => x.group === g).map((x) => `<div class="bfx-cmd"><dt><code>${esc(x.command)}</code></dt><dd><p>${esc(x.what)}</p>${x.when ? `<p class="bfx-when"><strong>Use it:</strong> ${esc(x.when)}</p>` : ""}${x.example && x.example !== x.command ? `<p class="bfx-when">Example: <code>${esc(x.example)}</code></p>` : ""}</dd></div>`).join("")}</dl></section>`).join("\n");
  const list = (id, title, rows) => `<section class="bfx-cmd-group" id="${id}"><h2>${title}</h2><dl class="bfx-cmds">${rows.map((x) => `<div class="bfx-cmd"><dt>${esc(x.name)}</dt><dd><p>${esc(x.what)}</p>${x.where ? `<p class="bfx-when"><strong>Where:</strong> ${esc(x.where)}</p>` : ""}</dd></div>`).join("")}</dl></section>`;
  return page(c, { file: "commands.html", title: "Commands", description: "Every Backstage Forever command you can type in WoW Forever, in plain words, with when to use it.",
    eyebrow: "Help · Commands", heading: "Everything you can <em>type in game.</em>", lead: `Press Enter in game, type a command, press Enter again. ${num(CATALOG.length)} commands, the same list as Help → Commands in the app.`,
    body: `<div class="wrap section bfx-commands">${jump}${sections}\n${list("in-game", "Things you'll see in game", FEATURES)}\n${list("in-app", "In the desktop app", APP)}</div>` });
}

// ---------- data coverage ----------
function coverageData() {
  const { KnowledgeService } = require("../src/core/knowledge-cache.cjs");
  const knowledge = new KnowledgeService({ dataDir: path.join(os.tmpdir(), "bf-site-knowledge-unused") });
  const quiet = (fn) => { try { return fn(); } catch { return null; } };
  // The same inputs src/main.cjs gives the World Map, so the numbers match Help → Data coverage.
  const worldMap = new (require("../src/core/world-map.cjs").WorldMap)({
    getState: () => ({ profiles: [], activeProfileId: null }), knowledge,
    npcReference: quiet(() => require("../src/core/npc-location-data.cjs").validateNpcLocationPack(json("data/forever-npc-locations/pack.json"))),
    travelReference: quiet(() => require("../src/core/travel-data.cjs").loadTravelReference(fs.readFileSync(path.join(root, "data/forever-travel/pack.json")))),
    vendorPack: quiet(() => require("../src/core/vendor-facts.cjs").loadVendorPack()),
    insights: require("../src/core/insights-data.cjs").loadBundledInsights(),
    acquisitionPack: quiet(() => require("../src/core/acquisition-data.cjs").loadAcquisitionPack()),
    creaturePack: quiet(() => require("../src/core/creature-data.cjs").loadCreaturePack()),
    worldPack: require("../src/core/world-finds.cjs").loadWorldPack(), live: null,
  });
  // The meters' "good" marks live in the app's page; read them from there instead of copying them.
  const sandbox = { window: { backstage: {} } };
  vm.runInNewContext(read("src/renderer/coverage.js"), sandbox);
  return { coverage: worldMap.coverage(), KINDS: sandbox.window.CoverageView.KINDS, level: sandbox.window.CoverageView.level };
}
function coverage(c) {
  const { coverage: data, KINDS, level } = coverageData();
  const score = (z, f) => KINDS.reduce((t, [k, , , good]) => t + Math.min(1, z[f][k] / good), 0) / KINDS.length;
  const verdict = (s) => (s >= 0.7 ? ["Well covered", "good"] : s >= 0.35 ? ["Partly covered", "mid"] : ["Thin", "low"]);
  const zones = [...data.zones].sort((a, b) => a.min - b.min || a.name.localeCompare(b.name));
  const table = (f) => {
    const mine = zones.filter((z) => z.faction === f || z.faction === "Contested");
    const useful = mine.filter((z) => score(z, f) >= 0.35).length;
    const rows = mine.map((z) => { const [label, cls] = verdict(score(z, f)); return `<tr><th scope="row">${esc(z.name)}<small>Levels ${z.min}–${z.max}${z.faction === "Contested" ? " · contested" : ""}</small></th>${KINDS.map(([k, , , good]) => `<td class="bfx-n bfx-${level(z[f][k], good)}">${num(z[f][k])}</td>`).join("")}<td><span class="bfx-verdict bfx-${cls}">${label}</span></td></tr>`; }).join("");
    return `<section class="bfx-cov" id="${f.toLowerCase()}"><h2>${f}</h2><p><strong>${useful} of ${mine.length}</strong> leveling zones for ${f} players have useful coverage.</p><div class="bfx-scroll"><table class="bfx-table"><thead><tr><th scope="col">Zone</th>${KINDS.map(([, label]) => `<th scope="col">${esc(label)}</th>`).join("")}<th scope="col">Overall</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  };
  // Totals straight from the bundled packs.
  const pack = json("data/forever/pack.json"), transport = json("data/forever-transport/pack.json"), trainers = json("data/forever-trainers/pack.json");
  const vendors = json("data/forever-vendors/pack.json"), world = json("data/forever-world/pack.json"), boss = Object.values(json("data/forever-boss-loot/pack.json").instances);
  const creatures = json("data/forever-creatures/pack.json");
  const quests = Object.values(pack.quests), sideOf = (s) => transport.nodes.filter((n) => n.side === s).length;
  const totals = [
    ["Quests", [[num(quests.length), "quests known by name"], [num(quests.filter((q) => q.givers?.length).length), "with a quest giver"], [num(quests.filter((q) => q.objectiveLocations?.some((o) => o.positions?.length)).length), "with an objective place"], [num(quests.filter((q) => q.observedInPlay).length), "seen in play by other players"]]],
    ["People and places", [[num(Object.values(pack.npcs).filter((n) => n.positions?.length).length), "quest NPCs with a position"], [num(vendors.counts.vendors), "vendors"], [num(vendors.counts.listings), "things they sell"], [num(world.mailboxes.length), "mailboxes"]]],
    ["Training", [[num(trainers.counts.trainers), "trainers"], [num(trainers.counts.classServices), "class skills with a level or price"], [num(trainers.counts.professionServices), "profession recipes and ranks taught"], [num(trainers.counts.weaponServices + trainers.counts.ridingServices), "weapon and riding lessons"]]],
    ["Travel", [[num(transport.counts.nodes), `flight points (${sideOf("Alliance")} Alliance, ${sideOf("Horde")} Horde)`], [num(transport.counts.edges), "flight connections"], [num(transport.counts.timedEdges), "with a recorded flight time"], [num(transport.counts.pricedEdges), "with a recorded price"]]],
    ["The world", [[num(world.rares.length), "rare enemies"], [num(world.rares.filter((r) => r.positions.length).length), "of them with a place"], [num(world.nodes.reduce((s, n) => s + n.positions.length, 0)), `herb and ore spots (${world.nodes.length} kinds)`], [num(world.chests.reduce((s, n) => s + n.positions.length, 0)), "chest spots"]]],
    ["Dungeons and enemies", [[num(boss.length), "dungeons and raids"], [num(boss.reduce((s, i) => s + i.bosses.length, 0)), "bosses"], [num(boss.reduce((s, i) => s + i.bosses.filter((b) => b.items.length).length, 0)), "bosses with recorded loot"], [num(Object.keys(creatures.creatures).length), "enemies with level and type"]]],
  ];
  const tiles = totals.map(([title, rows]) => `<section class="bfx-total"><h3>${esc(title)}</h3><dl>${rows.map(([n, label]) => `<div><dt>${n}</dt><dd>${esc(label)}</dd></div>`).join("")}</dl></section>`).join("");
  const builds = (data.source.builds || []).map((b) => (typeof b === "string" ? b : b.build)).filter(Boolean);
  return page(c, { file: "coverage.html", title: "Data coverage", description: "How much Backstage Forever knows about WoW Forever, zone by zone and for each faction: quest givers, trainers, vendors, flight points, rares and more.",
    eyebrow: "Help · Data coverage", heading: "How much we know, <em>zone by zone.</em>", lead: "Where the app's advice is rich and where it is still thin, for each faction. The same count the app shows under Help → Data coverage.",
    body: `<div class="wrap section bfx-coverage"><nav class="bfx-jump" aria-label="On this page"><a href="#totals">Totals</a><a href="#alliance">Alliance</a><a href="#horde">Horde</a></nav>
<section id="totals"><h2>What the app carries</h2><div class="bfx-totals">${tiles}</div></section>
${table("Alliance")}
${table("Horde")}
<p class="bfx-foot">Counts come from community observations bundled with the app (${esc(data.source.attribution || "Efficient Games, CC BY 4.0")}${builds.length ? `; game builds ${esc(builds.join(", "))}` : ""}${data.source.observedThrough ? `; observed through ${esc(data.source.observedThrough)}` : ""}). A zero means nobody has recorded it yet, not that it does not exist. Item names, talents and recipes are read from your own game files and are not counted here.</p></div>` });
}

// ---------- the block on the download page ----------
function indexBlock() {
  const latest = stableReleases()[0];
  const cards = [
    ["tour.html", "Feature tour", "Real screens of every part of the app."],
    ["whats-new.html", "What's new", latest ? `Latest: ${tagline(latest)}.` : "What changed in each release."],
    ["commands.html", "Commands", "Everything you can type in game, in plain words."],
    ["coverage.html", "Data coverage", "How much the app knows, zone by zone, for each faction."],
  ];
  return `<!-- bf:more (generated by scripts/build-site.cjs; do not edit by hand) --><section class="bfx-more-band" id="more"><div class="wrap section"><p class="eyebrow">03 / Look around</p><h2>See it <em>before you install.</em></h2><div class="bfx-cards">${cards.map(([href, title, text]) => `<a class="bfx-card" href="./${href}"><strong>${esc(title)} <span aria-hidden="true">→</span></strong><span>${esc(text)}</span></a>`).join("")}</div></div></section><!-- /bf:more -->`;
}
function patchIndex(index) {
  const css = '<link rel="stylesheet" href="./tour.css">';
  let out = index.replace(/<!-- bf:more[^]*?<!-- \/bf:more -->/, "").replace(css, "");
  if (!out.includes("</main>") || !out.includes('<link rel="stylesheet" href="./landing.css">')) throw new Error("index.html: no </main> or landing.css link to anchor the generated block.");
  out = out.replace('<link rel="stylesheet" href="./landing.css">', `<link rel="stylesheet" href="./landing.css">${css}`);
  return out.replace("</main>", `${indexBlock()}</main>`);
}

const CSS = `/* Generated by scripts/build-site.cjs in the Backstage Forever repo. Same palette as landing.css. */
.bfx-page{background:#121922;color:#ede2d0}
.bfx-page :is(h1,h2,h3,h4,dt,strong,th){color:#fff6e4}
.bfx-page :is(p,li,dd,td,figcaption,small){color:#ede2d0}
.bfx-page a:not(.btn){color:#f2ca94}
.bfx-page code{font-family:ui-monospace,Consolas,monospace;font-size:.92em;background:#0c1118;color:#f2d4a6;border:1px solid #4e4237;border-radius:4px;padding:1px 6px;overflow-wrap:anywhere}
.bfx-page .eyebrow{color:#e6d3b7;display:flex;align-items:center;gap:10px}
.bfx-page em{color:#f2ca94;font-style:normal}
.bfx-hero{background:linear-gradient(180deg,#191421,#121922);border-bottom:1px solid #4e4237;padding-block:54px 34px}
.bfx-hero h1{font-size:clamp(40px,6vw,76px);line-height:1;margin-block:16px;overflow-wrap:anywhere}
.bfx-lead{max-width:60ch;font-size:17px}
.bfx-nav,.bfx-jump{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
.bfx-nav a,.bfx-jump a{display:inline-block;padding:8px 14px;border:1px solid #705b46;border-radius:999px;background:#121923;color:#fff5e8;text-decoration:none;font-size:14px;line-height:1.2}
.bfx-nav a:hover,.bfx-jump a:hover{background:#303641}
.bfx-nav a[aria-current="page"]{background:#f2d4a6;border-color:#f2d4a6;color:#201b19}
.bfx-jump{margin-block:26px 0}.bfx-jump a{border-color:#4e4237;font-size:13px}
.bfx-band{background:#191421;border-block:1px solid #4e4237}
.bfx-pillar h2{max-width:26ch;margin-block:14px 26px}
.bfx-shots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:26px 22px}
.bfx-shot{margin:0;min-width:0}
.bfx-shot .screen-frame{display:block;border-color:#705b46}
.bfx-shot img{display:block;width:100%;height:auto;background:#1b1413}
.bfx-shot figcaption{margin-top:10px;font-size:14px;line-height:1.55}
.bfx-shot figcaption strong{display:block;font-size:15px}
.bfx-get{background:#191421;border-top:1px solid #4e4237;padding-block:54px;text-align:left}
.bfx-get h2{margin-bottom:10px}.bfx-get .actions{margin-top:20px}.bfx-get .fine{margin-top:13px}
.bfx-get .btn{background:#f2d4a6;color:#201b19;border-color:#f2d4a6}.bfx-get .btn:hover{background:#ffe5b9}
.bfx-get .btn.light{background:#121923;color:#fff5e8;border-color:#e6d3b7a1}.bfx-get .btn.light:hover{background:#303641}
.bfx-release{border:1px solid #4e4237;border-radius:10px;background:#191421;padding:24px 26px;margin-bottom:22px}
.bfx-release h2{margin:4px 0 6px;font-size:clamp(24px,3vw,34px)}
.bfx-version{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#e6d3b7}
.bfx-kind{font-size:14px;letter-spacing:.08em;text-transform:uppercase;margin:20px 0 8px;color:#f2ca94}
.bfx-release ul{margin:0;padding-left:20px;line-height:1.6}.bfx-release li+li{margin-top:8px}
.bfx-where{display:inline-block;margin-left:4px;padding:0 8px;border:1px solid #705b46;border-radius:999px;font-size:12px;color:#e6d3b7;white-space:nowrap}
.bfx-more{margin:18px 0 0}.bfx-older{margin-top:8px}
.bfx-cmd-group{margin-top:44px}.bfx-cmd-group h2{font-size:clamp(24px,3vw,34px);margin-bottom:16px}
.bfx-cmds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:0}
.bfx-cmd{border:1px solid #4e4237;border-radius:10px;background:#191421;padding:16px 18px;min-width:0}
.bfx-cmd dt{font-weight:700;font-size:16px;margin-bottom:8px}.bfx-cmd dd{margin:0}
.bfx-cmd p{margin:0;line-height:1.55;font-size:15px}.bfx-cmd p+p{margin-top:8px}.bfx-when{font-size:14px}
.bfx-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:18px}
.bfx-total{border:1px solid #4e4237;border-radius:10px;background:#191421;padding:16px 18px}
.bfx-total h3{font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#f2ca94;margin:0 0 10px}
.bfx-total dl{margin:0}.bfx-total div{display:flex;gap:12px;align-items:baseline;padding:5px 0;border-top:1px solid #2c2530}
.bfx-total div:first-child{border-top:0}.bfx-total dt{min-width:5.2ch;text-align:right;font-weight:700;font-variant-numeric:tabular-nums}.bfx-total dd{margin:0;font-size:14px}
.bfx-cov{margin-top:48px}.bfx-cov h2{margin-bottom:8px}
.bfx-scroll{overflow-x:auto;margin-top:16px;border:1px solid #4e4237;border-radius:10px}
.bfx-table{width:100%;min-width:760px;border-collapse:collapse;background:#191421;font-size:14px}
.bfx-table th,.bfx-table td{padding:9px 12px;border-top:1px solid #2c2530;text-align:right;vertical-align:middle}
.bfx-table thead th{border-top:0;background:#24201d;font-size:12px;letter-spacing:.04em;text-transform:uppercase}
.bfx-table th:first-child,.bfx-table td:last-child,.bfx-table thead th:last-child{text-align:left}
.bfx-table tbody th{font-weight:700}.bfx-table tbody th small{display:block;font-weight:400;font-size:12px;color:#c9bca8}
.bfx-n{font-variant-numeric:tabular-nums}
.bfx-page td.bfx-rich{color:#a9e6a0}.bfx-page td.bfx-some{color:#f2d4a6}.bfx-page td.bfx-thin{color:#f0a37e}.bfx-page td.bfx-none{color:#9a8f86}
.bfx-verdict{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}
.bfx-verdict.bfx-good{background:#1f4a25;color:#d6f5d0}.bfx-verdict.bfx-mid{background:#5a4418;color:#ffe9b8}.bfx-verdict.bfx-low{background:#4a231c;color:#ffd3c4}
.bfx-foot{margin-top:26px;font-size:13px;line-height:1.6;max-width:90ch}
.bfx-more-band{background:#121922;color:#ede2d0;border-top:1px solid #4e4237}
.bfx-more-band h2{color:#fff6e4;margin-block:14px 24px}.bfx-more-band em{color:#f2ca94;font-style:normal}.bfx-more-band .eyebrow{color:#e6d3b7}
.bfx-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.bfx-card{display:flex;flex-direction:column;gap:8px;padding:18px;border:1px solid #705b46;border-radius:10px;background:#191421;text-decoration:none;min-width:0}
.bfx-card strong{color:#f2ca94;font-size:17px}.bfx-card span{color:#ede2d0;font-size:14px;line-height:1.5}
.bfx-card:hover{background:#24201d;border-color:#f2d4a6}
.bfx-page a:focus-visible,.bfx-card:focus-visible{outline:2px solid #ffe3af;outline-offset:3px}
@media(max-width:980px){.bfx-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.bfx-totals{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.bfx-shots,.bfx-cmds{grid-template-columns:1fr}.bfx-hero{padding-block:38px 26px}.bfx-release{padding:18px}}
@media(max-width:520px){.bfx-cards,.bfx-totals{grid-template-columns:1fr}.bfx-get .actions{flex-direction:column;align-items:stretch}}
`;

// ---------- links ----------
function checkLinks(site, files) {
  const problems = [];
  for (const [file, html] of Object.entries(files)) {
    if (!file.endsWith(".html")) continue;
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const url = m[1];
      // Site-wide files and outside links are not this folder's to check.
      if (/^(https?:|mailto:)/.test(url) || url.startsWith("/")) continue;
      if (url.startsWith("#")) { if (url.length > 1 && !ids.has(url.slice(1))) problems.push(`${file}: no element with id ${url}`); continue; }
      if (!url.startsWith("./")) { problems.push(`${file}: ${url} is not written as a relative ./ link`); continue; }
      const [target, hash] = url.slice(2).split("#");
      const name = target === "" ? "index.html" : target.split("?")[0];
      const text = files[name] ?? (fs.existsSync(path.join(site, name)) ? (name.endsWith(".html") ? fs.readFileSync(path.join(site, name), "utf8") : "") : null);
      if (text === null) problems.push(`${file}: ${url} does not exist`);
      else if (hash && !new RegExp(`\\sid="${hash}"`).test(text)) problems.push(`${file}: ${url} has no such anchor`);
    }
    if (/<script(?![^>]*\ssrc="(?:\/|\.\/)[^"]*")/.test(html) || /https?:\/\/[^"']*\.(?:js|css|woff2?)\b/.test(html)) problems.push(`${file}: loads a script, style or font from another site`);
    if (/no desktop app required/i.test(html)) problems.push(`${file}: says the desktop app is optional`);
  }
  return problems;
}

function build(site) {
  const indexPath = path.join(site, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error(`${indexPath} not found. Copy the live backstage-forever folder there first.`);
  const index = fs.readFileSync(indexPath, "utf8"), c = chrome(index), missing = [];
  const files = { "index.html": patchIndex(index), "tour.css": CSS, "whats-new.html": whatsNew(c), "tour.html": tour(c, site, missing), "commands.html": commands(c), "coverage.html": coverage(c) };
  return { files, problems: [...missing.map((f) => `${f} is missing: run scripts/site-screenshots.cjs --webp ${path.join(site, "tour")}`), ...checkLinks(site, files)] };
}

if (require.main === module) {
  const args = process.argv.slice(2), check = args.includes("--check"), site = args.find((a) => !a.startsWith("--"));
  if (!site) { console.error("Usage: node scripts/build-site.cjs SITE_DIR [--check]"); process.exit(2); }
  const { files, problems } = build(path.resolve(site));
  if (check) for (const [name, text] of Object.entries(files)) {
    const file = path.join(site, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) problems.push(`${name} is stale: run node scripts/build-site.cjs ${site}`);
  } else for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(site, name), text);
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  console.log(check ? "Website pages are current and every link resolves." : `Wrote ${Object.keys(files).join(", ")} to ${path.resolve(site)}`);
}
module.exports = { build, chrome, patchIndex, checkLinks, stableReleases, tagline, TOUR };
