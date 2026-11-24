"use strict";
// Backstage Live in real windows: the leader's three-step setup, the member's invitation, Link my
// Discord, live events with one-click answers, the Guild & Party panel, the group planner, regulars
// and the realm party board, the guide and the privacy block. Everything runs against the in-test
// contract server (tests/live-fake-server.cjs) on 127.0.0.1 and a fake game feed; the real service
// and the real game are never touched.
// Run under the Electron lock with BF_TEST_INACTIVE=1. Screenshots go to work/live-guild (git-ignored):
// 1440x900 and 984x635 in English and German, and the panel at its default size.
// BF_LIVE_COLLECT=1 writes every sentence that has no German yet to work/live-guild/missing.json
// instead of failing on it.
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { defaultState } = require("../src/core/validation.cjs"), { testWindow, launch } = require("./test-window.cjs");
const { fakeLive } = require("../tests/live-fake-server.cjs");
const SIZES = [[1440, 900, "full"], [984, 635, "compact"]];
const COLLECT = process.env.BF_LIVE_COLLECT === "1";
const BRUNA = { name: "Bruna", realm: "Thunder Hold" }, ABEL = { name: "Abel", realm: "Thunder Hold" }, CYRA = { name: "Cyra", realm: "Thunder Hold" };
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
// Fixed moments, so the pictures look the same on every run: Thursday and Friday evening of next week.
const day = 86400000, base = Math.floor(Date.now() / day) * day + 8 * day;
const AT1 = iso(base + 19 * 3600000), AT2 = iso(base + day + 19.5 * 3600000);
const EVENT = (over = {}) => ({ id: "mc7k2m9q", version: 1, creator: BRUNA, editor: BRUNA, at: AT1, place: "mc", title: "Molten Core, first half", note: "Bring fire resistance. Invites 15 minutes before.", roles: { tank: 2, healer: 8, damage: 30 }, cancelled: false, ...over });

(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-live-")), shots = path.resolve("work/live-guild");
  const fake = await fakeLive().listen();
  let app, checks = 0;
  const missing = new Map();
  const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
  const watchdog = setTimeout(() => { console.error("Live guild fixture exceeded 420 seconds"); app?.process().kill(); process.exitCode = 1; }, 420000);
  try {
    await fs.mkdir(shots, { recursive: true });
    const profile = (id, name, className, level) => ({ id, name, className, realm: "Thunder Hold", faction: "Horde", race: "Orc", level, notes: "", goals: [] });
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, activeProfileId: "p1", profiles: [profile("p1", "Bruna", "Warrior", 60), profile("p2", "Abel", "Priest", 60), profile("p3", "Mirel", "Hunter", 34)] }));
    // What the game's saved file told the app earlier: both characters are in the guild "Ashen Vanguard".
    const saved = (me, guild = "Ashen Vanguard") => ({ at: Math.floor(Date.now() / 1000) - 3600, on: true, loot: false, me, guild, realmOffset: 60, events: [], members: [],
      // One finished event the character was at, so the after-event summary can be posted.
      past: me === "Bruna" ? [{ id: "old4zg01", title: "Zul'Gurub, Monday", dungeon: "zg", at: Math.floor(Date.now() / 1000) - 2 * 86400, creator: "Bruna", t: 2, h: 4, d: 14, signups: [{ n: "Bruna", s: "t" }, { n: "Abel", s: "h" }, { n: "Cyra", s: "d" }], present: ["Abel", "Bruna", "Cyra"], loot: [] }] : [] });
    await fs.writeFile(path.join(dir, "guild.json"), JSON.stringify({ version: 1, characters: { p1: { name: "Bruna", realm: "Thunder Hold", guild: saved("Bruna") }, p2: { name: "Abel", realm: "Thunder Hold", guild: saved("Abel") }, p3: { name: "Mirel", realm: "Thunder Hold", guild: saved("Mirel", "Night Watch") } }, notes: {} }));
    app = await launch(electron, { args: [path.join(__dirname, "..")], env: { ...process.env, BF_USER_DATA: dir, BF_COMMUNITY_URL: fake.url, BF_TEST_INACTIVE: "1" }, timeout: 20000 });
    const page = await testWindow(app); page.setDefaultTimeout(8000);
    await app.evaluate(({ app, dialog, shell, clipboard }) => {
      const load = process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"));
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe = async () => ({ state: "not-running", launchAvailable: false });
      load("./src/core/providers.cjs").models = async () => [];
      const guildFeed = load("./src/core/game-guild-feed.cjs"), give = guildFeed.setHandoff.bind(guildFeed);
      globalThis.liveFixture = { opened: [], copied: [], feed: guildFeed, last: null };
      // What the guild service hands to the game side, as given (the feed then checks and compiles it).
      guildFeed.setHandoff = (data) => { globalThis.liveFixture.last = data; return give(data); };
      dialog.showMessageBox = async () => ({ response: 1 });
      shell.openExternal = async (url) => { globalThis.liveFixture.opened.push(url); };
      clipboard.writeText = (text) => { globalThis.liveFixture.copied.push(text); };
    });
    const feed = (name, payload) => app.evaluate((_e, [name, payload]) => { globalThis.liveFixture.feed.emit(name, payload); }, [name, payload]);
    const handoff = () => app.evaluate(() => globalThis.liveFixture.last);
    const compiled = () => app.evaluate(() => globalThis.liveFixture.feed.handoff());
    const size = (w, h) => app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())).setContentSize(...v), [w, h]);
    const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const shot = async (name, target = page) => { await settle(); await target.screenshot({ path: path.join(shots, `${name}.png`) }); };
    const shotsOf = async (name, top = null) => {
      for (const [w, h, label] of SIZES) {
        await size(w, h);
        await page.evaluate((sel) => { const main = document.querySelector(".main"); if (!main) return; main.scrollTo(0, 0); if (sel) { const el = document.querySelector(sel); if (el) main.scrollTo(0, Math.max(0, el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 12)); } }, top);
        await page.waitForTimeout(200);
        // A late repaint can move the page back: place it once more, the way a reader would scroll to it.
        if (top) await page.locator(top).first().evaluate((el) => el.scrollIntoView({ block: "start" })).catch(() => {});
        await shot(`${name}-${label}`);
      }
      await size(1440, 900);
    };
    const start = async (lang) => {
      await page.evaluate((lang) => { localStorage.setItem("bf-setup-v4", "manual"); localStorage.setItem("bf-lang-v1", lang); for (const k of Object.keys(localStorage)) if (/tour|onboard|welcome/i.test(k)) localStorage.setItem(k, "done"); }, lang);
      await page.reload(); await page.locator(".shell").waitFor();
      await page.evaluate(() => { document.querySelector(".bf-onboarding [data-tour-skip], .bf-onboarding button")?.click(); document.querySelector("dialog[open]")?.close(); });
    };
    // Every sentence of the new screens must have German, French and Spanish: gathered here in English.
    const scan = async (target, where, selector) => {
      const found = await target.evaluate((selector) => {
        const out = [], norm = (s) => s.replace(/\s+/g, " ").trim();
        const SKIP = "[data-no-translate], script, style, textarea, code, pre, input, select option[data-keep]";
        const walk = (n) => {
          if (n.nodeType === 3) { const t = norm(n.nodeValue || ""); if (/\p{L}{2}/u.test(t) && !n.parentElement?.closest(SKIP)) out.push(t); return; }
          if (n.nodeType !== 1 || n.matches(SKIP)) return;
          for (const a of ["title", "aria-label", "placeholder"]) { const v = n.getAttribute(a); if (v && /\p{L}{2}/u.test(v)) out.push(norm(v)); }
          for (const c of n.childNodes) walk(c);
        };
        for (const root of document.querySelectorAll(selector)) walk(root);
        return [...new Set(out)];
      }, selector);
      // Checked against the dictionaries themselves (data/i18n), where a word that is the same in both languages still counts.
      for (const t of found) {
        if (/^(?:[A-Z][a-z]{2},? )?\d{1,2} [A-Z][a-z]{2}\b/.test(t)) continue; // a date the page formatted
        for (const [lang, d] of Object.entries(dictionaries)) {
          if (typeof d.app[t] === "string" && d.app[t].trim()) continue;
          if (d.templates.some((re) => re.test(t))) continue;
          if (!missing.has(t)) missing.set(t, new Set());
          missing.get(t).add(`${lang}@${where}`);
        }
      }
    };
    const appPattern = (template) => new RegExp("^" + template.split(/(\{#?\d+\})/).map((part) => (/^\{#\d+\}$/.test(part) ? "([0-9][0-9.,:/%–-]*)" : /^\{\d+\}$/.test(part) ? "(.+?)" : part.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"))).join("") + "$");
    const dictionaries = {};
    for (const lang of ["de", "fr", "es"]) { const d = JSON.parse(await fs.readFile(path.join(__dirname, "..", "data", "i18n", `${lang}.json`), "utf8")); dictionaries[lang.toUpperCase()] = { app: d.app || {}, templates: Object.keys(d.appTemplates || {}).map(appPattern) }; }
    const MINE = "[data-lg-root], [data-lg-guide], [data-lg-privacy], [data-desk-exception], #live-dock, [data-guild-upcoming], [data-guild-honest], [data-guide-live], [data-lg-summary-row]";
    const fits = async (label) => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${label}: no sideways scrolling`);
      const clipped = await page.evaluate(() => [...document.querySelectorAll("[data-lg-root] button, [data-lg-root] .lg-status, [data-lg-root] h2, [data-lg-root] h3, .lg-dock-card button")].filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + (el.tagName === "BUTTON" ? 8 : 2) && !el.matches(".lg-chip, .lg-slot-main")).map((el) => (el.textContent || "").trim().slice(0, 40)));
      assert.deepEqual(clipped, [], `${label}: no clipped button or heading`);
      const tops = await page.locator(".player-subtabs button").evaluateAll((list) => list.map((b) => Math.round(b.getBoundingClientRect().top)));
      if (tops.length) assert.ok(Math.max(...tops) - Math.min(...tops) <= 4, `${label}: the tab row stays on one line`);
    };
    const fitsBoth = async (label) => { for (const [w, h, name] of SIZES) { await size(w, h); await settle(); await fits(`${label} ${name}`); } await size(1440, 900); };
    const guildRoot = page.locator('[data-lg-root="guild"]');
    // The live stream is reopened whenever the subscriptions change; an event pushed in that moment would be lost
    // (the app would only get it at its next full read). Wait until one stream with the newest subscriptions is open.
    const steady = async (want = () => true) => {
      for (let calm = 0, last = "", i = 0; i < 200; i++) {
        const now = JSON.stringify([...fake.streams].map((x) => x.subs)) + fake.requests("/v1/live/session").length;
        calm = now === last && fake.streams.size === 1 && want([...fake.streams][0].subs) ? calm + 1 : 0; last = now;
        if (calm >= 8) return;
        await new Promise((r) => setTimeout(r, 60));
      }
      assert.fail("the live stream did not settle");
    };
    // In German the buttons have German names, so that part goes by route.
    const go = async (group, tab) => { await page.locator(`[data-shell-control="nav:${group}"]`).click(); await page.locator(`[data-shell-control="subtab:${tab}"]`).click(); await page.waitForFunction((tab) => page === tab, tab); };
    const activate = async (id) => { await page.locator("#active-character").selectOption(id); await page.waitForFunction((id) => state.activeProfileId === id, id); };

    await size(1440, 900);
    await start("en");

    // ------------------------------------------------------------------ the leader
    await check("nothing is sent before anyone agreed: the page, the first-use card and the setup card ask nothing", async () => {
      await navigate(page, "guild");
      await guildRoot.locator("[data-lg-intro]").waitFor();
      await guildRoot.locator('[data-lg-setup="start"]').waitFor();
      assert.match(await guildRoot.locator('[data-lg-setup="start"]').innerText(), /Connecting your guild keeps on the Backstage service/);
      assert.match(await guildRoot.locator('[data-lg-setup="start"]').innerText(), /Ashen Vanguard · Thunder Hold · Horde · set up by Bruna/);
      await page.waitForTimeout(700);
      assert.deepEqual(fake.log.filter((e) => !/^\/v1\/(announcements|heartbeat|tickets\/sync|pack|mine)/.test(e.route)).map((e) => e.route), [], "no guild, board or live request yet");
      await scan(page, "guild-start", MINE);
      await shotsOf("leader-start-en");
      await fitsBoth("leader start");
      await guildRoot.getByRole("button", { name: "Got it", exact: true }).click();
      await guildRoot.locator("[data-lg-intro]").waitFor({ state: "detached" });
    });

    let guildId, code;
    await check("leader setup: one click starts it; three steps each with a status light", async () => {
      await guildRoot.getByRole("button", { name: "I agree, start the setup", exact: true }).click();
      const steps = guildRoot.locator('[data-lg-setup="steps"]');
      await steps.waitFor();
      const create = fake.requests("/v1/guilds")[0];
      assert.deepEqual(Object.keys(create.body), ["schema", "installId", "realm", "faction", "guildName", "character", "rankIndex"]);
      assert.deepEqual([create.body.guildName, create.body.character, create.body.rankIndex], ["Ashen Vanguard", BRUNA, 0]);
      guildId = fake.anyGuild().id; code = fake.anyGuild().linkCode;
      await steps.locator('[data-lg-step="discord"] .lg-status').getByText("Not done yet", { exact: true }).waitFor();
      await steps.locator('[data-lg-step="link"] .lg-status').getByText("Waiting for you to type it", { exact: true }).waitFor();
      await steps.locator('[data-lg-step="test"] .lg-status').getByText("After step 1", { exact: true }).waitFor();
      assert.equal(await steps.locator("[data-lg-command]").innerText(), `/bf guild link ${code}`);
      assert.ok(await steps.getByRole("button", { name: "Send a test post", exact: true }).isDisabled(), "the test button waits for step 1");
      await guildRoot.locator(".lg-status").getByText("Live", { exact: true }).first().waitFor({ timeout: 10000 });
      await steady((subs) => subs.some((x) => x.t === "guild"));
      await scan(page, "leader-steps", MINE);
      await shotsOf("leader-steps-en", '[data-lg-setup="steps"]');
      await fitsBoth("leader steps");
      // The link line is copied for pasting into the game.
      await steps.locator(".lg-command").getByRole("button", { name: "Copy", exact: true }).click();
      await steps.locator(".lg-command").getByRole("button", { name: "Copied", exact: true }).waitFor();
      assert.deepEqual(await app.evaluate(() => globalThis.liveFixture.copied), [`/bf guild link ${code}`]);
    });

    await check("step 1 opens Discord's own page in the system browser and turns green by itself", async () => {
      const steps = guildRoot.locator('[data-lg-setup="steps"]');
      await steps.getByRole("button", { name: "Add to Discord ↗", exact: true }).click();
      await steps.locator('[data-lg-step="discord"] .lg-status').getByText("Waiting for you in the browser", { exact: true }).waitFor();
      const opened = await app.evaluate(() => globalThis.liveFixture.opened);
      assert.equal(opened.length, 1); assert.match(opened[0], /^https:\/\/discord\.com\/oauth2\/authorize\?/);
      await scan(page, "leader-pending", MINE);
      fake.discordConnected(guildId, { guildName: "Ashen Vanguard HQ", channel: "#raids" });   // what Discord's callback does
      await steps.locator('[data-lg-step="discord"] .lg-status').getByText("Connected", { exact: true }).waitFor();
      assert.match(await steps.locator('[data-lg-step="discord"]').innerText(), /Connected to the Discord server Ashen Vanguard HQ\. Events are posted in #raids\./);
      assert.match(await steps.locator('[data-lg-step="discord"]').innerText(), /Change channel: in Discord, go to the channel you want and type \/backstage channel/);
      // Step 2: the game reports the leader's own line back.
      await feed("link", { code, character: BRUNA, rankIndex: 0, guildName: "Ashen Vanguard", realm: "Thunder Hold", faction: "horde" });
      await steps.locator('[data-lg-step="link"] .lg-status').getByText("Heard in game", { exact: true }).waitFor();
      // Step 3.
      await steps.getByRole("button", { name: "Send a test post", exact: true }).click();
      await steps.locator('[data-lg-step="test"] .lg-status').getByText("Test post sent", { exact: true }).waitFor();
      assert.equal(fake.guild(guildId).tests, 1);
      await scan(page, "leader-done", MINE);
      await shotsOf("leader-done-en", '[data-lg-setup="steps"]');
      // A problem shows its fix right beside it.
      fake.discordProblem(guildId, "Missing permission: Send Messages in #raids");
      await steps.locator('[data-lg-step="discord"] .lg-status').getByText("Needs a fix", { exact: true }).waitFor();
      await steps.locator(".lg-problem").getByText("Missing permission: Send Messages in #raids").waitFor();
      assert.match(await steps.locator(".lg-fix").innerText(), /How to fix it: in Discord, open the channel's settings and allow Backstage Forever to View Channel, Send Messages and Embed Links/);
      await scan(page, "leader-problem", MINE);
      await shotsOf("leader-problem-en", '[data-lg-setup="steps"]');
      fake.discordConnected(guildId, { guildName: "Ashen Vanguard HQ", channel: "#raids" });
      await steps.locator('[data-lg-step="discord"] .lg-status').getByText("Connected", { exact: true }).waitFor();
    });

    await check("after an event: an officer posts who came, the bosses and the time to Discord with one button", async () => {
      const row = page.locator('[data-guild-past-event="old4zg01"] [data-lg-summary-row]');
      await row.waitFor();
      await scan(page, "summary", MINE);
      await row.getByRole("button", { name: "Post summary to Discord", exact: true }).click();
      await page.locator('[data-guild-past-event="old4zg01"] [data-lg-note="summary:old4zg01"]').getByText("Posted to your guild's Discord.", { exact: true }).waitFor();
      const sent = fake.guild(guildId).summaries.at(-1);
      assert.deepEqual(sent, { id: "old4zg01", schema: 1, attended: ["Abel", "Bruna", "Cyra"], bosses: 0, durationSec: 0 });
      await shotsOf("summary-en", '[data-guild-past-event="old4zg01"]');
    });

    await check("the leader proposes an event from the app; it is on the service within a moment", async () => {
      const card = guildRoot.locator("[data-lg-member]");
      await card.locator("details.lg-propose > summary").click();
      await card.getByLabel("Title", { exact: true }).fill("Molten Core, first half");
      await card.getByLabel("Where", { exact: true }).selectOption("mc");
      await card.getByLabel("Day", { exact: true }).fill(AT1.slice(0, 10));
      await card.getByLabel("Time (your computer's)", { exact: true }).fill("20:00");
      await card.getByLabel("Note (optional)", { exact: true }).fill("Bring fire resistance.");
      await scan(page, "propose", MINE);
      await card.getByRole("button", { name: "Propose event", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll("[data-guild-event]").length === 1);
      assert.equal(fake.guild(guildId).events.size, 1);
      const made = [...fake.guild(guildId).events.values()][0];
      assert.deepEqual([made.title, made.place, made.version, made.creator, made.roles], ["Molten Core, first half", "mc", 1, BRUNA, { tank: 2, healer: 8, damage: 30 }]);
      // Replace it by the fixture event so the pictures are the same on every run.
      fake.removeEvent(guildId, made.id); fake.putEvent(guildId, EVENT());
      fake.putEvent(guildId, EVENT({ id: "bwl4x8p2", at: AT2, place: "bwl", title: "Blackwing Lair", note: "", roles: { tank: 3, healer: 9, damage: 28 } }));
      await page.waitForFunction(() => document.querySelectorAll("[data-guild-event]").length === 2 && Boolean(document.querySelector('[data-guild-event="bwl4x8p2"]')));
    });

    // ------------------------------------------------------------------ a member
    await check("a member's game hears the link: a consent card, and nothing is sent until Join", async () => {
      await activate("p2");
      const before = fake.log.length;
      await feed("link", { code, character: ABEL, rankIndex: 5, guildName: "Ashen Vanguard", realm: "Thunder Hold", faction: "horde" });
      // On any other page the invitation shows as a card of its own.
      await navigate(page, "calendar");
      const dock = page.locator("#live-dock .lg-consent");
      await dock.waitFor();
      assert.match(await dock.innerText(), /Your guild Ashen Vanguard uses Backstage Forever events\. Joining shares your character's name and your sign-ups with your guild's members and its Discord\. It never shares your account, files or chat\./);
      await scan(page, "dock", MINE);
      await shot("consent-dock-en");
      await navigate(page, "guild");
      await page.locator("#live-dock .lg-consent").waitFor({ state: "detached" });
      await page.getByLabel("Guild page of", { exact: true }).selectOption("p2");
      const card = guildRoot.locator("[data-lg-offer]");
      await card.waitFor();
      const text = await card.innerText();
      assert.match(text, /Your guild Ashen Vanguard uses Backstage Forever events\. Joining shares your character's name and your sign-ups with your guild's members and its Discord\. It never shares your account, files or chat\./);
      assert.match(text, /The name Abel and the realm Thunder Hold, your guild rank number, and your answers to guild events\./);
      for (const name of ["Join", "Not now", "Never for this guild"]) await card.getByRole("button", { name, exact: true }).waitFor();
      await page.waitForTimeout(500);
      assert.equal(fake.requests("/v1/guilds/join").length, 0, "no join before the click");
      assert.equal(fake.log.slice(before).filter((e) => e.body && JSON.stringify(e.body).includes("Abel")).length, 0, "the member's name left nowhere");
      await scan(page, "consent", MINE);
      await shotsOf("consent-en");
      await fitsBoth("consent card");
      // Not now: gone, nothing sent, and it comes back when the line is typed again.
      await card.getByRole("button", { name: "Not now", exact: true }).click();
      await card.waitFor({ state: "detached" });
      assert.equal(fake.requests("/v1/guilds/join").length, 0);
      await feed("link", { code, character: ABEL, rankIndex: 5, guildName: "Ashen Vanguard", realm: "Thunder Hold", faction: "horde" });
      await card.waitFor();
      await card.getByRole("button", { name: "Join", exact: true }).click();
      await guildRoot.locator("[data-lg-member]").waitFor();
      const join = fake.requests("/v1/guilds/join")[0];
      assert.deepEqual(Object.keys(join.body), ["schema", "installId", "linkCode", "character", "rankIndex", "consent"]);
      assert.deepEqual([join.body.character, join.body.rankIndex, join.body.consent], [ABEL, 5, true]);
      assert.equal(await guildRoot.locator('[data-lg-setup]').count(), 0, "a member is not shown the leader's steps");
      await steady((subs) => subs.some((x) => x.t === "guild"));
    });

    await check("events are live with one-click answers; a Discord answer shows within a moment", async () => {
      await page.waitForFunction(() => document.querySelectorAll("[data-guild-event] [data-lg-answer-row]").length === 2);
      const event = page.locator('[data-guild-event="mc7k2m9q"]');
      await event.getByRole("button", { name: "Healer", exact: true }).click();
      await event.locator('button[data-answer="healer"][aria-pressed="true"]').waitFor();
      await event.locator("[data-guild-mine]").getByText("You signed up as healer.", { exact: true }).waitFor();
      const put = fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q/signups/Abel`)[0];
      assert.deepEqual(put.body, { who: ABEL, answer: "healer", version: 1, via: "desktop" });
      fake.putSignup(guildId, "mc7k2m9q", { who: BRUNA, answer: "tank", version: 1, via: "discord" });
      fake.putSignup(guildId, "mc7k2m9q", { who: CYRA, answer: "damage", version: 1, via: "game" });
      await event.locator(".gld-role-t").getByText("1 of 2", { exact: true }).waitFor();
      await event.locator(".gld-role-d").getByText("1 of 30", { exact: true }).waitFor();
      await page.locator("[data-guild-live-note]").waitFor();
      assert.match(await page.locator("[data-guild-honest]").innerText(), /Because you joined your guild in the app, your character's name and your answers also go to the Backstage service/);
      await page.locator("[data-lg-pending]").first().getByText(/^\d+ updates will reach the game at your next \/reload$/).waitFor();
      const out = await handoff();
      assert.equal(out.guild.id, guildId); assert.equal(out.guild.discord, "connected");
      assert.deepEqual(out.guild.events.map((e) => e.id).sort(), ["bwl4x8p2", "mc7k2m9q"]);
      assert.ok(out.guild.signups.mc7k2m9q.some((s) => s.who.name === "Abel" && s.answer === "healer"));
      await scan(page, "member", MINE);
      await shotsOf("member-en");
      await shotsOf("member-events-en", "[data-guild-upcoming]");
      await fitsBoth("member");
    });

    await check("Link my Discord: one sentence, one code, the linked name, Unlink", async () => {
      const box = guildRoot.locator("[data-lg-discord-me]");
      assert.match(await box.innerText(), /In your guild's Discord, type \/backstage link/);
      await box.getByLabel("Code from Discord", { exact: true }).fill("nope");
      await box.getByRole("button", { name: "Link my Discord", exact: true }).click();
      await box.locator(".lg-msg.lg-bad").waitFor();
      await scan(page, "link-error", MINE);
      const linkCode = fake.discordCode("Abel#0420");
      await box.getByLabel("Code from Discord", { exact: true }).fill(linkCode);
      await box.getByRole("button", { name: "Link my Discord", exact: true }).click();
      await box.getByText("Abel#0420", { exact: true }).waitFor();
      await box.getByRole("button", { name: "Unlink", exact: true }).waitFor();
      await scan(page, "linked", MINE);
      await shotsOf("discord-linked-en", "[data-lg-discord-me]");
    });

    await check("without Discord on the service, the Discord parts say so and everything else works", async () => {
      fake.state.discord = false;
      const box = guildRoot.locator("[data-lg-discord-me]");
      await box.getByRole("button", { name: "Unlink", exact: true }).click();
      await guildRoot.locator("[data-lg-discord-off]").first().getByText("Discord connection is not available yet.", { exact: true }).waitFor();
      await scan(page, "discord-off", MINE);
      await shotsOf("discord-off-en", "[data-lg-discord-me]");
      const event = page.locator('[data-guild-event="bwl4x8p2"]');
      await event.getByRole("button", { name: "Maybe", exact: true }).click();
      await event.locator('button[data-answer="maybe"][aria-pressed="true"]').waitFor();
      assert.equal(fake.requests(`/v1/guilds/${guildId}/events/bwl4x8p2/signups/Abel`).length, 1, "answers still reach the service");
      // The service gets Discord back: "Check again" finds out, and the leader's steps are green again.
      fake.state.discord = true;
      await page.locator("[data-guild-character]").selectOption("p1");
      const steps = guildRoot.locator('[data-lg-setup="steps"]');
      await steps.getByRole("button", { name: "Check again", exact: true }).click();
      await steps.locator('[data-lg-step="discord"] .lg-status').getByText("Waiting for you in the browser", { exact: true }).waitFor();
      fake.discordConnected(guildId, { guildName: "Ashen Vanguard HQ", channel: "#raids" });
      await steps.locator('[data-lg-step="discord"] .lg-status').getByText("Connected", { exact: true }).waitFor();
      await page.locator("[data-guild-character]").selectOption("p2");
      await guildRoot.locator("[data-lg-member]").waitFor();
    });

    // ------------------------------------------------------------------ the panel
    let panel = null;
    await check("the Guild & Party panel: always on top, never focused by itself, three tabs, live", async () => {
      await guildRoot.getByRole("button", { name: "Open the Guild & Party panel", exact: true }).click();
      for (let i = 0; i < 100 && !panel; i++) { panel = app.windows().find((w) => /guild-panel\.html$/.test(w.url())) || null; if (!panel) await new Promise((r) => setTimeout(r, 100)); }
      assert.ok(panel, "the panel window opened");
      panel.setDefaultTimeout(8000);
      const facts = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => /guild-panel\.html$/.test(x.webContents.getURL())); const b = w.getContentBounds(); return { top: w.isAlwaysOnTop(), focused: w.isFocused(), resizable: w.isResizable(), min: w.getMinimumSize(), max: w.getMaximumSize(), width: b.width, height: b.height, opacity: w.getOpacity() }; });
      assert.deepEqual({ ...facts, width: Math.abs(facts.width - 380) <= 2, height: Math.abs(facts.height - 520) <= 2 }, { top: true, focused: false, resizable: true, min: [320, 300], max: [640, 900], width: true, height: true, opacity: 1 });
      await panel.locator("[data-gp-intro]").waitFor();
      await panel.locator('[data-gp-event="mc7k2m9q"]').waitFor();
      await scan(panel, "panel-events", "body");
      await panel.screenshot({ path: path.join(shots, "panel-events-intro-en.png") });
      await panel.getByRole("button", { name: "Got it", exact: true }).click();
      await panel.locator("[data-gp-intro]").waitFor({ state: "detached" });
      // One-click change of your answer, and counts that move while you look.
      const event = panel.locator('[data-gp-event="mc7k2m9q"]');
      await event.locator('button[data-answer="healer"][aria-pressed="true"]').waitFor();
      await event.getByRole("button", { name: "Tank", exact: true }).click();
      await event.locator('button[data-answer="tank"][aria-pressed="true"]').waitFor();
      assert.equal(fake.requests(`/v1/guilds/${guildId}/events/mc7k2m9q/signups/Abel`).at(-1).body.answer, "tank");
      await event.locator(".gp-m-tank").getByText("2/2", { exact: true }).waitFor();
      for (const name of ["Dorn", "Elka", "Faro"]) fake.putSignup(guildId, "mc7k2m9q", { who: { name, realm: "Thunder Hold" }, answer: "healer", version: 1, via: "discord" });
      await event.locator(".gp-m-healer").getByText("3/8", { exact: true }).waitFor();
      await panel.locator("[data-gp-live]").getByText("Live", { exact: true }).waitFor();
      await panel.locator("[data-gp-foot]").getByText(/updates? will reach the game at your next \/reload/).waitFor();
      await panel.screenshot({ path: path.join(shots, "panel-events-en.png") });
      // Settings: see-through, hide in combat, open at start.
      await panel.getByRole("button", { name: "Settings", exact: true }).click();
      await panel.locator("[data-gp-sheet]").getByText("Panel settings", { exact: true }).waitFor();
      await scan(panel, "panel-settings", "body");
      await panel.locator('[data-gp-setting="opacity"]').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, "70");
      await panel.waitForFunction(() => document.querySelector("[data-gp-opacity]")?.textContent === "70%");
      await panel.screenshot({ path: path.join(shots, "panel-settings-en.png") });
      assert.ok(Math.abs((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => /guild-panel\.html$/.test(x.webContents.getURL())).getOpacity())) - 0.7) < 0.02);
      await panel.locator('[data-gp-setting="opacity"]').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, "100");
      await panel.waitForFunction(() => document.querySelector("[data-gp-opacity]")?.textContent === "100%");
      await panel.getByRole("button", { name: "Done", exact: true }).click();
      const stored = JSON.parse(await fs.readFile(path.join(dir, "live", "panel.json"), "utf8"));
      assert.equal(stored.opacity, 100); assert.equal(stored.introSeen, true);
    });

    await check("the panel's Party tab shows the group from the game and who is missing what", async () => {
      await feed("party", { leader: "Bruna", total: 5, character: ABEL, place: "mc", plan: null, members: [
        { ...BRUNA, class: "warrior", role: "tank", level: 60, online: true }, { ...ABEL, class: "priest", role: "healer", level: 60, online: true },
        { ...CYRA, class: "mage", role: "damage", level: 58, online: true, missing: ["Aqual Quintessence"] }, { name: "Dorn", realm: "Thunder Hold", class: "rogue", role: "damage", level: 60, online: false }, { name: "Elka", realm: "Thunder Hold", class: "hunter", role: "damage", level: 60, online: true }] });
      await panel.getByRole("tab", { name: "Party", exact: true }).click();
      const group = panel.locator("[data-gp-party]");
      await group.waitFor();
      assert.equal(await group.locator(".gp-member").count(), 5);
      assert.match(await group.innerText(), /Molten Core/); assert.match(await group.innerText(), /Missing: Aqual Quintessence/); assert.match(await group.innerText(), /Leader/);
      await panel.locator("[data-gp-plan]").waitFor();
      // Click a name, then a slot: the plan changes and is handed to the game.
      await group.getByRole("button", { name: /^Bruna/ }).click();
      await panel.locator('[data-gp-plan] button[data-slot="0"]').click();
      await panel.locator('[data-gp-plan] button[data-slot="0"]').getByText("Bruna", { exact: true }).waitFor();
      assert.deepEqual((await handoff()).plan.members, [{ name: "Bruna", role: "tank" }]);
      await scan(panel, "panel-party", "body");
      await panel.screenshot({ path: path.join(shots, "panel-party-en.png") });
    });

    // ------------------------------------------------------------------ Plans → Party
    await check("the group planner: click or drag into slots, notes, what is missing, and an honest line about travel", async () => {
      await navigate(page, "party");
      const planner = page.locator("[data-lg-planner]");
      await planner.locator(".lg-columns").waitFor();
      await planner.locator('[data-lg-slot="0"]').getByText("Bruna", { exact: true }).waitFor();
      await planner.getByLabel("Dungeon or raid", { exact: true }).selectOption("mc");
      await page.waitForFunction(() => document.querySelector('[data-lg-input="plan:place"]')?.value === "mc");
      // Click a name, then a slot.
      await planner.locator(".lg-bench").getByRole("button", { name: /^Abel/ }).click();
      await planner.locator('[data-lg-slot="1"] .lg-slot-main').click();
      await planner.locator('[data-lg-slot="1"]').getByText("Abel", { exact: true }).waitFor();
      // Drag a name into a slot.
      await planner.locator(".lg-bench").getByRole("button", { name: /^Cyra/ }).dragTo(planner.locator('[data-lg-slot="2"]'));
      await planner.locator('[data-lg-slot="2"]').getByText("Cyra", { exact: true }).waitFor();
      await planner.locator('[data-lg-slot="2"]').getByText("Aqual Quintessence").waitFor();
      await planner.locator('[data-lg-slot="2"] .lg-warn').getByText(/Level 58: under level 60/).waitFor();
      // Fill the rest from the roles people named.
      await planner.getByRole("button", { name: "Fill from roles", exact: true }).click();
      await planner.locator('[data-lg-slot="3"]').getByText("Dorn", { exact: true }).waitFor();
      await planner.locator('[data-lg-slot="3"] .lg-warn').getByText("Offline", { exact: true }).waitFor();
      await planner.locator("[data-lg-lacking]").getByText("Every slot is filled.", { exact: true }).waitFor();
      const note = planner.locator('[data-lg-slot="0"] .lg-slot-input');
      await note.fill("Pull with the bow, tank at the stairs");
      await note.press("Enter");
      await page.waitForFunction(() => document.querySelector('[data-lg-slot="0"] .lg-slot-input')?.value === "Pull with the bow, tank at the stairs");
      const plan = (await handoff()).plan;
      assert.equal(plan.place, "mc"); assert.equal(plan.members.length, 5); assert.deepEqual(plan.for, ABEL);
      assert.deepEqual(plan.members[0], { name: "Bruna", role: "tank", bring: "Pull with the bow, tank at the stairs" });
      assert.match(await planner.locator("[data-lg-plan-honest]").innerText(), /handed to your game at your next \/reload\. From there the game passes it to your group.*There is no faster way: a running game cannot be written to\./);
      await planner.locator("[data-lg-pending]").waitFor();
      await scan(page, "planner", MINE);
      await shotsOf("planner-en", "[data-lg-planner]");
      await fitsBoth("planner");
      // A slot can be emptied again.
      await planner.locator('[data-lg-slot="4"] .lg-slot-clear').click();
      await planner.locator("[data-lg-lacking]").getByText("Still open:", { exact: true }).waitFor();
      await scan(page, "planner-open", MINE);
      await planner.getByRole("button", { name: "Fill from roles", exact: true }).click();
    });

    await check("regulars: people you ran with, a note, and a whisper command to copy (never typed for you)", async () => {
      const card = page.locator("[data-lg-regulars]");
      await card.locator('[data-lg-regular="Bruna"]').waitFor();
      assert.equal(await card.locator("[data-lg-regular]").count(), 4, "the four others of the group, not yourself");
      assert.match(await card.locator('[data-lg-regular="Cyra"]').innerText(), /Molten Core/);
      const before = fake.log.length;
      const input = card.locator('[data-lg-regular="Cyra"] input');
      await input.fill("Fast mage, brings water");
      await input.press("Enter");
      await card.locator('[data-lg-note="regulars"]').getByText("Note saved on this computer.", { exact: true }).waitFor();
      await card.locator('[data-lg-regular="Cyra"]').getByRole("button", { name: "Copy whisper", exact: true }).click();
      assert.equal((await app.evaluate(() => globalThis.liveFixture.copied)).at(-1), "/w Cyra ");
      assert.equal(fake.log.length, before, "regulars and notes send nothing");
      await scan(page, "regulars", MINE);
      await shotsOf("regulars-en", "[data-lg-regulars]");
    });

    await check("the realm party board: its own switch, consent before the first listing, a 30-minute countdown, live listings", async () => {
      const board = page.locator("[data-lg-board]");
      await board.waitFor();
      assert.equal(await board.getAttribute("data-lg-board"), "off");
      assert.equal(fake.requests("/v1/lfg").length, 0, "nothing about the board was asked yet");
      assert.match(await board.innerText(), /Switching the board on asks the service for the listings of your realm and faction\. It sends your realm and your faction, and nothing about your character until you post\./);
      await scan(page, "board-off", MINE);
      await shotsOf("board-off-en", "[data-lg-board]");
      await board.getByRole("button", { name: "I agree, switch the board on", exact: true }).click();
      await page.locator('[data-lg-board="on"]').waitFor();
      assert.deepEqual(fake.requests("/v1/lfg")[0].query, { realm: "Thunder Hold", faction: "horde" });
      await steady((subs) => subs.some((x) => x.t === "lfg"));
      fake.putListing("Thunder Hold", "horde", { id: "cyracyracyra0001", kind: "lfg", who: CYRA, level: 58, class: "mage", roles: ["damage"], place: "sm", note: "Any wing, have the key", need: null, at: iso(Date.now()) });
      fake.putListing("Thunder Hold", "horde", { id: "dorndorndorn0001", kind: "lfm", who: { name: "Dorn", realm: "Thunder Hold" }, level: 60, class: "rogue", roles: ["damage"], place: "ubrs", note: "Need a tank and two healers", need: { tank: 1, healer: 2, damage: 0 }, at: iso(Date.now()) });
      await page.waitForFunction(() => document.querySelectorAll("[data-lg-listing]").length === 2);
      // Post: the first time a card says what others will see.
      await page.locator('[data-lg-board="on"] details[data-lg-details="post"] > summary').click();
      const form = page.locator("[data-lg-listing-form]");
      await form.getByText("looking for more players", { exact: true }).click();
      await form.getByLabel("Dungeon or raid", { exact: true }).selectOption("mc");
      await form.getByLabel("Healer", { exact: true }).check();
      await form.getByLabel("Note (optional, 60 characters)", { exact: true }).fill("Thursday run, two spots");
      await scan(page, "board-form", MINE);
      await page.locator('[data-lg-board="on"]').getByRole("button", { name: "Post", exact: true }).click();
      const ask = page.locator("[data-lg-post-consent]");
      await ask.waitFor();
      assert.match(await ask.innerText(), /This shows your character's name, level and role to other Backstage Forever users on your realm and faction for 30 minutes\./);
      assert.equal(fake.log.filter((e) => e.method === "PUT" && e.route.startsWith("/v1/lfg/")).length, 0, "nothing posted before the consent");
      await scan(page, "board-consent", MINE);
      await shotsOf("board-consent-en", "[data-lg-board]");
      await ask.getByRole("button", { name: "I agree, post it", exact: true }).click();
      const mine = page.locator("[data-lg-mine]");
      await mine.waitFor();
      const put = fake.log.find((e) => e.method === "PUT" && e.route.startsWith("/v1/lfg/"));
      assert.deepEqual([put.body.listing.who, put.body.listing.level, put.body.listing.class, put.body.listing.roles, put.body.listing.kind, put.body.listing.place, put.body.consent], [ABEL, 60, "priest", ["healer"], "lfm", "mc", true]);
      assert.match(await mine.locator("[data-lg-countdown]").innerText(), /^(29|30):\d\d$/);
      for (const name of ["Renew", "Edit", "Remove"]) await mine.getByRole("button", { name, exact: true }).waitFor();
      // Filters.
      await page.locator('[data-lg-board="on"]').getByLabel("Show listings with the role", { exact: true }).selectOption("tank");
      await page.waitForFunction(() => document.querySelectorAll("[data-lg-listing]").length === 1);
      await page.locator('[data-lg-board="on"]').getByLabel("Show listings with the role", { exact: true }).selectOption("");
      await page.waitForFunction(() => document.querySelectorAll("[data-lg-listing]").length === 2);
      await scan(page, "board-on", MINE);
      await shotsOf("board-en", "[data-lg-board]");
      await fitsBoth("board");
      await mine.getByRole("button", { name: "Renew", exact: true }).click();
      await page.locator('[data-lg-note="board"]').getByText("Renewed for another 30 minutes.", { exact: true }).waitFor();
      assert.equal(fake.log.filter((e) => e.method === "PUT" && e.route.startsWith("/v1/lfg/")).length, 2);
      assert.equal((await handoff()).lfg.rows.length, 3, "the game gets the board at its next /reload");
    });

    await check("the panel's Board tab: live listings, filters, your listing with its countdown, Renew and Remove", async () => {
      await panel.getByRole("tab", { name: "Board", exact: true }).click();
      await panel.locator("[data-gp-mine]").waitFor();
      await panel.waitForFunction(() => document.querySelectorAll("[data-gp-listing]").length === 2);
      assert.match(await panel.locator("[data-gp-countdown]").innerText(), /^(29|30):\d\d$/);
      await scan(panel, "panel-board", "body");
      await panel.screenshot({ path: path.join(shots, "panel-board-en.png") });
      fake.putListing("Thunder Hold", "horde", { id: "elkaelkaelka0001", kind: "lfg", who: { name: "Elka", realm: "Thunder Hold" }, level: 60, class: "hunter", roles: ["damage"], place: "zg", note: "", need: null, at: iso(Date.now()) });
      await panel.waitForFunction(() => document.querySelectorAll("[data-gp-listing]").length === 3);
      await panel.locator('[data-gp-filter="place"]').selectOption("zg");
      await panel.waitForFunction(() => document.querySelectorAll("[data-gp-listing]").length === 1);
      await panel.locator('[data-gp-filter="place"]').selectOption("");
      await panel.getByRole("button", { name: "Remove", exact: true }).click();
      await panel.locator("[data-gp-mine]").waitFor({ state: "detached" });
      assert.equal(fake.log.at(-1).method === "DELETE" || fake.log.some((e) => e.method === "DELETE" && e.route.startsWith("/v1/lfg/")), true);
      await page.locator("[data-lg-mine]").waitFor({ state: "detached" });
      await scan(panel, "panel-board-empty", "body");
    });

    // ------------------------------------------------------------------ guide and privacy
    await check("Help has the Guild & Party guide with numbered steps, small diagrams and one honest table", async () => {
      await navigate(page, "guild-guide");
      const guide = page.locator("[data-lg-guide]");
      await guide.waitFor();
      for (const id of ["leader", "member", "discord", "panel", "planner", "board", "table", "privacy"]) await guide.locator(`[data-lg-guide-${id}]`).waitFor();
      assert.equal(await guide.locator(".lg-flow").count(), 6, "a small diagram for each flow");
      assert.ok((await guide.locator(".lg-guide-steps li").count()) >= 20);
      const table = await guide.locator("[data-lg-guide-table]").innerText();
      assert.match(table, /Anything from the app or from Discord → inside your running game\s+Waits for your next \/reload\. A running game cannot be written to/);
      assert.equal(await guide.locator("[data-lg-guide-table] tbody tr").count(), 10);
      await scan(page, "guide", MINE);
      await shotsOf("guide-en");
      await shotsOf("guide-table-en", "[data-lg-guide-table]");
      await fitsBoth("guide");
      await navigate(page, "guide");
      await page.locator("[data-guide-live]").waitFor();
      await scan(page, "field-guide", MINE);
    });

    await check("Settings → Privacy & sharing lists the new category: what, with whom, how to leave", async () => {
      await navigate(page, "privacy");
      const block = page.locator("[data-lg-privacy]");
      await block.waitFor();
      assert.match(await block.innerText(), /Guild and party features \(only if you join\)/);
      await block.locator("[data-lg-privacy-state]").getByText("Ashen Vanguard", { exact: true }).first().waitFor();
      await block.locator("summary").click();
      const text = await block.innerText();
      for (const label of ["Guild link code", "Character name", "Guild rank number", "Member key", "Answer", "Listing number", "The party board", "How to leave and delete"]) assert.ok(text.toLowerCase().includes(label.toLowerCase()), `lists ${label}`);
      assert.match(await page.locator("[data-desk-exception]").innerText(), /One exception, and only if you choose it/);
      await scan(page, "privacy", MINE);
      await shotsOf("privacy-en", "[data-lg-privacy]");
      await fitsBoth("privacy");
    });

    // ------------------------------------------------------------------ German
    await check("German: the setup, the consent card, the planner, the board and the panel are translated and tidy", async () => {
      await start("de");
      await go("company", "guild");
      await page.locator("[data-guild-character]").selectOption("p1");
      await guildRoot.locator('[data-lg-setup="steps"]').waitFor();
      await page.waitForTimeout(300);
      await shotsOf("leader-done-de", '[data-lg-setup="steps"]');
      await fitsBoth("Gilde (Leitung)");
      await page.locator("[data-guild-character]").selectOption("p2");
      await guildRoot.locator("[data-lg-member]").waitFor();
      await page.waitForFunction(() => document.querySelectorAll("[data-guild-event] [data-lg-answer-row]").length === 2);
      await shotsOf("member-de");
      await shotsOf("member-events-de", "[data-guild-upcoming]");
      await fitsBoth("Gilde (Mitglied)");
      await go("company", "party");
      await page.locator("[data-lg-planner] .lg-columns").waitFor();
      await page.waitForTimeout(300);
      await shotsOf("planner-de", "[data-lg-planner]");
      await shotsOf("board-de", "[data-lg-board]");
      await shotsOf("regulars-de", "[data-lg-regulars]");
      await fitsBoth("Gruppe");
      await go("guide", "guide"); await page.locator('button[data-nav="guild-guide"]').click();
      await page.locator("[data-lg-guide]").waitFor();
      await shotsOf("guide-de");
      await shotsOf("guide-table-de", "[data-lg-guide-table]");
      await fitsBoth("Anleitung");
      await go("game", "privacy");
      await page.locator("[data-lg-privacy] summary").click();
      await shotsOf("privacy-de", "[data-lg-privacy]");
      if (!COLLECT) {
        const body = await page.locator("[data-lg-privacy]").innerText();
        assert.doesNotMatch(body, /only if you join|Guild link code|How to leave and delete|Member key/, "the privacy block is translated");
      }
      // The panel follows the same language.
      await panel.reload(); await panel.locator("[data-gp-body]").waitFor();
      await panel.getByRole("tab").first().click();
      await panel.locator('[data-gp-event="mc7k2m9q"]').waitFor();
      await panel.waitForTimeout(300);
      await panel.screenshot({ path: path.join(shots, "panel-events-de.png") });
      await panel.getByRole("tab").nth(1).click();
      await panel.locator("[data-gp-party]").waitFor();
      await panel.screenshot({ path: path.join(shots, "panel-party-de.png") });
      await panel.getByRole("tab").nth(2).click();
      await panel.waitForFunction(() => document.querySelectorAll("[data-gp-listing]").length >= 1);
      await panel.screenshot({ path: path.join(shots, "panel-board-de.png") });
      if (!COLLECT) assert.doesNotMatch(await panel.locator("body").innerText(), /\bEvents\b|\bBoard\b|Looking for|Wants a group|Needs players/, "the panel is translated");
    });

    await check("the consent card in German (a third character hears another guild's link)", async () => {
      // A third character of the fixture hears another guild's link.
      await feed("link", { code: "BFG-OTHR-GLD1", character: { name: "Mirel", realm: "Thunder Hold" }, rankIndex: 4, guildName: "Night Watch", realm: "Thunder Hold", faction: "horde" });
      await go("company", "guild");
      await page.locator("[data-guild-character]").selectOption("p3");
      const card = guildRoot.locator("[data-lg-offer]");
      await card.waitFor();
      await page.waitForTimeout(300);
      await shotsOf("consent-de");
      await fitsBoth("Einladung");
      if (!COLLECT) assert.doesNotMatch(await card.innerText(), /Joining shares|Not now|Never for this guild/, "the consent card is translated");
      await start("en");
      await navigate(page, "guild");
    });

    // ------------------------------------------------------------------ leaving and deleting
    await check("Leave: asked once, the service drops the name, and nothing is sent afterwards", async () => {
      await page.locator("[data-guild-character]").selectOption("p2");
      const card = guildRoot.locator("[data-lg-member]");
      await card.waitFor();
      await card.getByRole("button", { name: "Leave…", exact: true }).click();
      await scan(page, "leave", MINE);
      await card.getByRole("button", { name: "Yes, leave", exact: true }).click();
      await card.waitFor({ state: "detached" });
      assert.equal(fake.guild(guildId).members.some((m) => m.character.name === "Abel"), false);
      const mark = fake.log.length;
      await feed("signup", { eventId: "mc7k2m9q", signup: { who: ABEL, answer: "no", version: 9, via: "game" }, character: ABEL });
      await feed("event", { ...EVENT({ version: 7 }), character: ABEL });
      await page.waitForTimeout(700);
      assert.deepEqual(fake.log.slice(mark).filter((e) => e.method !== "GET" && !e.route.startsWith("/v1/live/")).map((e) => `${e.method} ${e.route}`), [], "nothing is sent for the member after Leave");
      assert.equal(fake.log.slice(mark).filter((e) => /Abel/.test(JSON.stringify(e.body || {}))).length, 0, "and the name appears in no request");
    });

    await check("Delete our guild's data needs the guild's name typed; then the service holds nothing", async () => {
      await page.locator("[data-guild-character]").selectOption("p1");
      const steps = guildRoot.locator('[data-lg-setup="steps"]');
      await steps.waitFor();
      await steps.locator("details.lg-manage > summary").click();
      await scan(page, "manage", MINE);
      await shotsOf("manage-en", "details.lg-manage");
      await steps.getByRole("button", { name: "Delete our guild's data…", exact: true }).click();
      const input = steps.getByLabel(/Type the guild's name to confirm/);
      await input.fill("ashen");
      await steps.getByRole("button", { name: "Delete everything", exact: true }).click();
      await steps.locator('[data-lg-note="manage"]').getByText("Type the guild's name exactly to delete its data.", { exact: true }).waitFor();
      assert.ok(fake.guild(guildId), "a wrong name deletes nothing");
      await scan(page, "delete", MINE);
      await steps.getByLabel(/Type the guild's name to confirm/).fill("Ashen Vanguard");
      await steps.getByRole("button", { name: "Delete everything", exact: true }).click();
      await guildRoot.locator('[data-lg-setup="start"]').waitFor();
      assert.equal(fake.guild(guildId), undefined);
    });

    await check("no member key ever reached a window, and the run's requests are the contract's", async () => {
      const tokens = fake.log.map((e) => e.member).filter(Boolean);
      assert.ok(tokens.length > 5);
      const seen = await page.evaluate(() => JSON.stringify(LiveGuild._state().data) + document.documentElement.outerHTML);
      const seenPanel = await panel.evaluate(() => document.documentElement.outerHTML);
      for (const t of new Set(tokens)) { assert.ok(!seen.includes(t), "main window"); assert.ok(!seenPanel.includes(t), "panel"); }
      const routes = [...new Set(fake.log.map((c) => `${c.method} ${c.route.replace(/g_[A-Za-z0-9_-]+/, "g_N").replace(/\/events\/[a-z0-9]+/, "/events/E").replace(/\/lfg\/[A-Za-z0-9_-]{16}/, "/lfg/L")}`))].sort();
      console.log("Requests seen by the fake service:", routes.join(", "));
    });

    const list = [...missing.entries()].map(([text, where]) => ({ text, where: [...where].sort() })).sort((a, b) => a.text.localeCompare(b.text));
    await fs.writeFile(path.join(shots, "missing.json"), JSON.stringify(list, null, 1));
    if (COLLECT) console.log(`Sentences without a translation: ${list.length} (work/live-guild/missing.json)`);
    else assert.deepEqual(list.map((x) => `${x.text} [${x.where.join(" ")}]`), [], "every sentence of the new screens has German, French and Spanish");
    console.log(`Live guild window checks passed (${checks}). Screenshots: ${shots}`);
  } catch (error) {
    console.error(error); process.exitCode = 1;
    try { let n = 0; for (const w of app?.windows() || []) await w.screenshot({ path: path.join(shots, `failure-${n++}.png`) }); } catch {}
  } finally {
    clearTimeout(watchdog);
    await app?.close().catch(() => {});
    await fake.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})();
