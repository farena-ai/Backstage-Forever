# Backstage Forever roadmap

Where the companion goes next. Written 2026-11-12, after 0.20.0; updated 2026-11-13 after 0.25.0 (Tier 2.6 best-addon features, Tier G graphics program). Ordered by value to a player: a beginner should feel guided, and a veteran should feel faster.

**Sizes:** S = a day or less · M = a few days · L = a week or more · XL = a multi-release program.
**Where:** Game = the addon · App = the desktop app · Both.

**Ground rules for every item:**
- Public WoW API only.
- No automated game input.
- No paid services.
- Game art is read locally, never bundled.
- Horde and Alliance get equal coverage.
- Every new command or helper goes on Help → Commands; a test enforces it.
- **Information is the lifeline.** Every place the app names a quest, NPC, item, zone or step should lead to the richest, most visual detail we can source. Every "Show on map" or "Open" link should land on exactly the thing you asked about.

---

## Shipped so far (0.16 – 0.20)

- **Live link:** follows you in real time, including over remote access (0.18.2).
- **Now page:**
  - Do this next, where to level, training, quest log.
  - Get set up checklist.
  - This session card: XP pace, rested, deaths.
  - Level-up celebration.
- **World Map:**
  - Distinct icons.
  - NPC cards with quests and training.
  - Your path this session.
- **In game:**
  - BF Guide layer on the world map.
  - `/bf next`, `/bf train`, `/bf find`, `/bf xp`, `/bf hearth`.
  - Danger warnings, death help with an arrow to your body.
  - Level-up and quest pop-ups, Sell junk button.
- **Alliance coverage:** four game builds merged (0.20.0).
- **Help:** Field guide with glossary; Help → Commands.
- **0.21.0:**
  - Repair reminder and `/bf repair`.
  - Flight path tracking and `/bf flights`.
  - Alliance vendors.
  - A `/reload` prompt.
  - Art pass 1.
  - Two flaky checks fixed.
  - This finished roadmap items 1.1, 1.2, 1.4, 1.6 and 1.8 and graphics step 1.

---

## Tier 1 — Quick wins (next 1–2 releases)

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| 1.3 | **Grey-quest cleanup.** Flag quests in your log that no longer give much XP, with a one-line "safe to abandon" hint. Hint only; never auto-abandon. | S | Both | Full quest logs confuse beginners. |
| 1.5 | **Helper switches in the app.** Settings → Game shows the in-game helpers (pop-ups, danger, Sell junk, live strip) and how to toggle them. | S | App | Discoverability. |
| 1.9 | **Verify live link over remote access** in a real remote session, and add a capture-based regression test. | S | Both | Confirms 0.18.2 in your actual setup. |

## Tier 1.5 — Depth and focus (Frank's priority, start in 0.22)

These come from hands-on use. Clicking through from Now must take you straight to the answer, and the answer must be complete.

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| D1 | **Dialed-in "Show on map".** Every link from Do this next, Where to level, training, the quest log and NPC cards opens the map in a focus mode: zoomed to that one target, with other pins dimmed, a line from you to it with distance and direction, and a "what to do here" card (talk to X, kill 6 of Y around here, hand in to Z). For multi-step targets it shows the steps in order. One click returns to the full map. | M | App | Today the map opens near the target but doesn't show what to do there. |
| D2 | **Link audit.** Every clickable reference across Now, Quests, World Map, Characters and Commands is checked to open the specific thing. Each gets an automated test that clicks it and asserts the focused target. | S–M | App | No link should land on a generic page. |
| D3 | **Rich quest pages.** Objectives with where to do each one (mini map), giver and turn-in with mini maps, level and required level, the chain (previous/next quest), and full **rewards**: item names, quality colours, stats and icons, plus "upgrade for you?", money, XP at your level and reputation. Graphical layout, not a list. | M–L | App | "Open quest" currently shows objectives but little about rewards. |
| D4 | **Keep everything the community data already has.** Today we drop quest money, reputation, XP difficulty (which gives real XP at your level) and reward spells. 1,456 quests have item rewards, but only 274 have every reward item named. Import those fields and resolve every item name. | S–M | App | Quick, large gain in detail. |
| D5 | **Read item, spell and creature details from your own game install.** Item stats, quality, icons, sell price and required level; spell names and icons; creature levels and elite flags. Read locally at runtime from your WoW Forever files, the same way the map art is today, and never bundled or uploaded. This powers D3, the reward picker (2.1), gear hints (2.2) and enemy levels (2.5). | L | App | The richest, most accurate source, and always matches your build. |
| D6 | **Data coverage view.** A small Help page listing how much we know per zone and per faction (quest givers, objectives, trainers, vendors), where data is thin, and when it last refreshed. | S | App | Honest about gaps; guides where to improve. |
| D7 | **Visual consistency for detail cards.** Quest, NPC, item and zone cards share one visual system: portrait or crest, colour-coded chips, icons and mini maps. This is art pass 2's companion work. | M | App | Keeps "lots of information" beautiful rather than busy. |

## Tier 1.6 — Quest intel: "how do I actually do this?" (top priority, 0.24)

From play: on "That Shadowvale Green Elixir" the companion knew where to go but not how. Are the bottles dropped by enemies or lying in the ruins? A web search answered it at once. The answer was in the quest's own text ("Travel to the ruins of Shadowvale... recover some bottles"), which the app never had. Every quest should get a plain **How to do it**.

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| Q1 | **Your quest log's full text.** The addon saves the description and objectives of quests in your log (your own data, kept locally). Quest pages show them, and the companion reads them. | S–M | Both | The quest text often says exactly what to do and where. |
| Q2 | **Learn item sources from your own play.** When you loot a quest item, the addon notes whether it came from a creature or an object, and which one and where. The app then says "found in crates and bottles in the ruins" or "dropped by Rot Hide Gnolls". | M | Both | Covers Forever-only quests that no shared data knows. |
| Q3 | **Community drop data.** Use the shared loot and object datasets: "dropped by Southsea Brigand (31%)", "loot from Food Crate objects". | M | App | Most classic quests are covered. |
| Q4 | **How to do it box.** Built from objective type (kill / collect from enemies / pick up objects / use an item / talk / explore), the item sources, the area, levels and elites, plus the quest text. It shows on quest pages, Now and the map's goal card. | M | App | One clear answer instead of guesswork. |
| Q5 | **Smarter companion answers.** The companion gets tools for quest text and item sources. When local knowledge is thin, it can do an opt-in web lookup through your own AI provider, with sources cited. | M | App | Matches what a quick web search gives, inside the app. |
| Q6 | **`/bf how` in game.** The How to do it answer for your tracked or nearest quest, in chat. | S | Game | Answer without alt-tabbing. |

## Tier 1.7 — Always current, without /reload

Frank asked whether Refresh on Now could do the `/reload` itself. It can't: the app never sends keys or commands to the game. That would be game automation, which Backstage Forever doesn't do and Blizzard's rules forbid. What we can do is make reloads unnecessary for staying current:

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| R1 | **Live strip v4 with pages.** The strip cycles through extra pages a few times per second: the quest log (ids and completion), objective progress counts, money, bag space, equipped item ids. Now, the quest log and the gear review then update while you play, with no `/reload` needed. Saved files still fill in the rest at logout. | M–L | Both | Now never falls behind during play. |
| R2 | **Clear freshness.** Each Now card shows whether it is live or from your last save, and when that save was. Refresh re-reads the save and live state at once. | S | App | You can see at a glance what's current. |
| R3 | **Smarter update timing.** After an app update, the reload banner names the exact moment the new addon landed, so a reload done a few seconds too early is obvious. | S | App | Removes "I reloaded but it's still there". |

## Tier 1.8 — A free companion for everyone, one click to start

Frank asked for a companion that costs players nothing, and it must be **one click to install and super easy to get running**: no accounts, no terminals, no separate installs. Backstage Forever won't host an AI service itself (that would be a paid service run by us). The plan:

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| F1 | **Quick answers, zero setup.** Always on, with nothing to install: the most common questions are answered instantly from the app's own knowledge ("how do I do this quest", "where is X", "what should I do next", "what do I train", "how do I get to Y"). Works offline. NPC and travel answers already work this way; this extends it to quests, how-to, training and next steps. | M | App | Every player has a useful companion from the first launch. |
| F2 | **"Turn on free AI": one click.** A single button in the Companion. The app checks the PC, downloads a small free model that suits it (a progress bar, about 2–5 GB, resumable), and runs it with a local AI engine built into the app. Then it says "Ready" and the chat just works. No Ollama, no account, no key, and nothing leaves the PC. It includes a one-click remove that frees the disk space. | L | App | The free, private, full AI companion, as easy as installing an app. |
| F3 | **Slow PC? Free cloud option, guided.** If the PC can't run a local model well, the same button offers a free hosted tier instead (for example Google's Gemini API or Groq), opening the provider's own page to get a free key and pasting it back automatically where possible. The app is upfront about rate limits and that some free tiers may use questions for training. | M | App | A free option for every computer. |
| F4 | **Advanced: Ollama and paid providers.** These stay available in Settings for players who already use them; they're no longer the main path. | S | App | Nothing is taken away. |

## Tier 1.9 — Now page fixes (Frank's report, 0.25)

| # | Fix | Size | Where | Why it matters |
|---|---|---|---|---|
| N1 | **Done is done.** Quests this character has already turned in never show up as something to pick up or do. If a finished quest has to appear (a chain, a hand-in history), it wears a clear green **Completed** tag and is dimmed. The completed list comes from the addon's saved quest history, plus the live strip once R1 lands. | S–M | Both | Old quests on Now confuse players about what's left. |
| N2 | **Tidy right column.** Fix the odd gap between the two boxes in Now's centre-right column, so the cards stack evenly at every window size. A layout check in the Now test keeps it from coming back. | S | App | A neat page reads at a glance. |
| N3 | **Sidebar fits on open.** At the default window size, the top seven links on the left menu fit without a scroll bar. That means tighter spacing, a compact header, and the scroll area starting below the main links. | S | App | The first thing a new player sees shouldn't need scrolling. |

## Tier 2 — Core guidance upgrades (next 2–4 releases)

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| 2.1 | **Quest reward picker.** On the reward screen, highlight the best choice for your class and spec using public item stats, with a short reason ("+3 Agility, an upgrade over your Ragged Leather Vest"). The player still clicks. | M | Game | One of the most-loved features of leveling addons; beginners guess badly. |
| 2.2 | **Gear upgrade hints.** "This is an upgrade" on items in bags and from vendors, using the same scoring. The app's Characters page lists weakest slots and where to fix them (quest rewards, vendors, dungeon drops). | M | Both | Turns loot into decisions. |
| 2.3 | **Zone route stepper.** An ordered plan per quest hub: pick up these, do objectives in this order, hand in here. `/bf route` and a compact in-game step frame tick off steps from quest events. Built from our quest, giver and objective data. | L | Both | The real "tell me exactly what to do" experience. |
| 2.4 | **Objective areas on the map.** Shade where kill and collect objectives happen. Learn from your own play: record where objective progress ticks, locally, and merge with community data. | M | Both | "Where do I find 8 Plainstriders?" is the #1 beginner question. |
| 2.5 | **Enemy levels on the map.** Show level ranges and elite camps per zone from creature data, colored the way the game colors levels. | M | App | Avoids wandering into red zones. |
| 2.6 | **Talent coach.** Per-class leveling talent suggestions (solo-friendly builds we write ourselves), with a "spend your point" reminder on level-up. Talent data is read from the local client. | M–L | Both | Talents are confusing at level 10. |
| 2.7 | **Dungeon readiness.** For each dungeon: the right level band, quests to pick up first and where, what to bring, and a "you're ready" check against your level and gear. | M | App | Dungeons are where new players get lost or underprepared. |
| 2.8 | **Profession leveling helper.** Skill-up color for each recipe (orange/yellow/green), the cheapest next recipe, a materials shopping list, and gathering routes from the find index. | M–L | Both | Professions are a maze without guidance. |
| 2.9 | **Hearthstone advice.** "Your hearth is in Razor Hill, but your quests are in the Barrens. Set it at the Crossroads inn." | S | Both | Saves long runs. |

## Tier 2.5 — Everything about where you are and what you can do

The goal: open the app (or type `/bf`) and know everything useful about your spot in the world, as pictures first and words second. Every item is one click, needs no setup, and covers Horde and Alliance equally.

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| E1 | **Zone briefing.** A "You are here" card for the current zone: level band, quest hubs and how many quests are open to you, flight master, inn, trainers for your class and professions, repair and ammo/food vendors, dangerous elites and rares, and herb/ore/fishing spots. Each one opens the map dialed in on it. | M | App | One glance answers "what's around me?" |
| E2 | **Shopping and supplies.** Knows your class: arrows/bullets, food and water at the right level, reagents, poisons, soul shards. Says when you're running low and the nearest vendor that sells them. | M | Both | Running out mid-quest is a classic beginner trap. |
| E3 | **Trainer planner.** What you'll learn at the next trainer visits, what it costs, and whether you can afford it, along with weapon skill trainers worth visiting. | S–M | Both | No surprise trips back to town. |
| E4 | **Mount and gold goals.** A savings tracker for the level 40 mount (and later epic mount): gold per hour this week, whether you're on pace, and which grey items or crafts to sell. | M | App | The biggest money goal in leveling, made visible. |
| E5 | **Class quest chains and key unlocks.** Class quests, weapon and totem quests, pets, forms, dungeon attunements: when they open, where they start, and the full chain on one page with steps and rewards. | L | App | These are easy to miss and hard to piece together. |
| E6 | **Reputation and factions.** Where your reputations stand, the fastest quests and turn-ins to raise them, and what each standing unlocks. | M | App | Rewards most players never notice. |
| E7 | **Death review.** After a death: what killed you (from the combat log your addon already sees), its level and elite status, and one plain tip. | M | Game | Turns deaths into lessons, not frustration. |
| E8 | **Professions, deep.** Building on 2.8: recipe trainers and vendor recipes on the map, gathering routes for your skill level, what to craft for profit or for your own gear, and a skill-up countdown. | L | Both | "Essentially everything" for professions. |
| E9 | **Rested and play-time planner.** Rested XP, where to log off (inn or city), and how many levels tonight's session should give you. | S | Both | Small, satisfying, and very useful. |
| E10 | **One-click setup, all the way.** The first launch finds WoW automatically, installs and updates the addon, turns on the live link, and checks everything with green ticks. No folders, no files, no terminals. Problems are fixed with a "Fix it" button, not instructions. | M | App | Super easy for every player, from the first minute. |
| E11 | **Info everywhere.** Hover any quest, NPC, item, zone or spell anywhere in the app to get a rich card (icon, level, where, rewards, who drops it), consistent across pages (the D7 card system). | M–L | App | Information is the lifeline. |
| E12 | **Over-the-top extras.** Animated zone arrival banners in the app, a level-up replay reel for the session, a "story so far" chapter page per character with zone art, and achievement-style badges painted locally with ComfyUI. | M per item | App | Fun keeps people playing. |

## Tier 2.6 — What the best addons do, built into one companion

Players today stitch together a dozen addons. Each item below takes what players love about a well-known *kind* of addon and builds it into Backstage Forever. It's our own design, public WoW API only and free, and it works together with Now, the map and the companion. Wherever a player already runs one of these addons, we stay out of its way.

| # | Feature | Like… | Size | Where | Why players want it |
|---|---|---|---|---|---|
| A1 | **Quest objectives everywhere.** Mobs and objects you need show a small icon over their heads and a "3/8 Bottle" line in their tooltip. Objective areas glow on the world map and minimap. | Quest-helper addons | M–L | Game | The most-installed kind of leveling addon: you never wonder "is this the right mob?" |
| A2 | **Step-by-step guide with an arrow.** One step at a time in a small frame ("Accept Raptor Thieves", "Kill raptors here", "Turn in at Gazrog"), with an arrow pointing to it. It ticks off from quest events and skips what you've already done. This is 2.3 and 4.1 in game form. | Leveling-guide addons | L–XL | Both | The #1 reason players buy leveling guides. Ours is free, for both factions, and built from real data. |
| A3 | **Speed splits.** Time per level against your own best and against your other characters, a pace line on Now, and "you're 12 minutes ahead" at each level-up. | Speed-leveling guides | M | Both | Experienced players love racing their own records. |
| A4 | **Dungeon loot browser.** Every boss's drops with icons and stats. "Upgrade for you" badges, a wish list, and a "this dungeon has 3 upgrades for you" score on dungeon cards. | Loot-browser addons | M–L | App | The first thing players check before a dungeon. |
| A5 | **Boss tips.** Short plain-words tips per boss ("interrupt the heal", "kill the adds first") shown when you target the boss, plus a pull checklist. Text, not timers. | Boss-warning addons | M | Both | New players wipe less, and veterans get reminders. |
| A6 | **Gathering memory.** Every herb, ore and chest you open is remembered with its spot. The app shows a heat map per zone, and the in-game map shows remembered nodes, with routes for your skill level (feeds E8). | Gathering-map addons | M | Both | Turns gathering from wandering into a route. |
| A7 | **Price memory.** When you browse the Auction House yourself, the addon remembers the prices it saw. Tooltips then show "about 1g 20s at auction" and "vendor for 35s", and bags flag what's worth selling. There are no automated scans or buying; it reads only pages you open. | Auction helper addons | M–L | Both | Gold matters for training and the mount (E4). |
| A8 | **Session stats.** Damage and healing per fight from your own combat log, a "best fight" card, and kills, deaths and gold earned per session on Now. | Damage-meter addons | M | Both | Fun numbers, and they help tune talents. |
| A9 | **Hunter, warlock and rogue helpers.** Pet happiness and feeding reminders, ammo and soul shard counters, poison reminders and class-quest alerts (E5). | Class helper addons | S–M | Game | Small, constant help that classes need. |
| A10 | **Enemy player alerts (PvP servers).** "Alliance level 32 rogue nearby" from targets and nameplates you see, with a short history. Public data only. | PvP alert addons | M | Game | Safety on contested ground; Horde and Alliance alike. |
| A11 | **Quality of life pack.** Sell junk and repair (done), plus: skip quest dialog text you've already read, an auto-dismount option for flight masters, a faster loot window and a coordinates readout. Each one is off by default and switched on with `/bf`. | QoL bundle addons | S each | Game | The little things players expect. |
| A12 | **Gear sets.** Save and swap sets (leveling, gathering, dungeon) with one click outside combat. The app shows each set's score. | Gear-set addons | M | Both | Swapping gear by hand is tedious. |
| A13 | **Social and party.** Party members running the addon see each other's quest needs (3.6), a "who needs what" list, and shared waypoints. | Party-sync addons | L | Both | Grouping goes smoother. |
| A14 | **Unified tooltip.** One rich tooltip in game and in the app, built from everything above: quest use, drop sources, price, upgrade, who sells it. | Tooltip addons | M | Both | Information is the lifeline. |

**Rules for this tier:**
- These are original designs, not copies.
- Public API only, and nothing done for the player: no automated buying, no automated quest accepting, nothing in combat that the game doesn't allow.
- Each feature is switchable on Help → Commands and in Settings.

## Tier G — The graphics program: heavily graphical and impressive

Backstage Forever should look like a premium fantasy companion on every page. All art is original and made locally with ComfyUI (native 2K, upscaled where needed). Nothing imitates Blizzard art, characters, logos or landmarks. Each pass adds to one shared style guide so the whole app stays consistent.

| # | Item | Size | What players see |
|---|---|---|---|
| G1 | **Living heroes.** Page headers become short, looping painted scenes: drifting clouds, embers, water shimmer. These are layered parallax stills (ComfyUI layers) with optional tiny video loops, and they're off in reduced-motion mode. | M | The app feels alive on first open. |
| G2 | **Zone arrival banners.** A painted vista and the zone name sweep in when you enter a new zone (app and in-game toast), with the zone's level band and quest count. | M | Every new zone feels like an arrival. |
| G3 | **Painted map pins and legend.** Every World Map pin kind gets its own painted icon (giver, hand-in, trainer, flight, vendor, herb, ore, elite, rare, dungeon), with hover glow and animated focus rings. | M | The map reads at a glance and looks crafted. |
| G4 | **Animated routes.** Route lines on the map flow toward the next step, with footprints for your journey and a pulsing target. | S–M | You can see where to go next. |
| G5 | **Character sheet.** A full-page painted portrait per class and race (original art), with gear slots drawn around it like a paper doll, glowing upgrades, and a talent tree view. | L | The page players will screenshot. |
| G6 | **Dungeon and boss art.** A painted card per dungeon (original scenes inspired by each dungeon's theme), boss silhouettes, and loot shown on velvet trays. | L | Dungeons feel epic before you even zone in. |
| G7 | **Badges and milestones.** A full set of painted badges for levels, firsts, zones completed, professions and speed splits, with a badge wall on Characters. | M | Collecting keeps people playing. |
| G8 | **Celebrations, part 2.** Level-up, quest-chain completion, dungeon clear and new mount moments, each with its own animation and sound. | M | Big moments feel big. |
| G9 | **In-game frames reskin.** The Adventure Compass, step frame and toasts get painted frames that match the app, and stay readable and small. | M | One look, in game and out. |
| G10 | **Splash and onboarding.** A short cinematic first-launch splash and a three-card painted tour for new players. | S–M | A great first impression. |
| G11 | **Faction themes.** Horde and Alliance colour sets, crests and ornaments that switch with your character, equal in quality. | M | Alliance is just as important. |
| G12 | **Art review before 1.0.** One pass over every page against the style guide: spacing, contrast, motion and dark-room readability. | M | Polish everywhere. |

## Tier 3 — Delight and depth

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| 3.1 | **Session history and milestones.** Keep past sessions: levels per day, deaths, zones, time to each level. Celebrate milestones (first dungeon, level 10/20/30/40, mount, first flight path). | M | App | Progress you can see keeps people playing. |
| 3.2 | **World tracker.** A 1–60 world view colored by zone level band, with per-zone progress rings ("Durotar 18/22 quests") and badges for completed zones. | M | App | A satisfying overview and a natural next-zone picker. |
| 3.3 | **Journey replay and share card.** Replay a session's path on the map with level-up and death markers. Export a PNG of your own hand-drawn-style map. | M | App | Fun to share; no game art involved. |
| 3.4 | **Always-on-top mini Now.** A small window beside the game showing your next step and pace, like the radar. | S–M | App | Live help without alt-tabbing. |
| 3.5 | **Spoken next steps.** Optional local voice: "Hand in Call of Water to Islen Waterseer, south-east." Uses the existing local voice runtime. | M | App | Hands-free and accessible. |
| 3.6 | **Party sync.** Party members running the addon share which quest objectives they still need (addon messages). The app's Party page shows shared quests and who needs what. | L | Both | Grouping is easier when everyone sees the same plan. |
| 3.7 | **Alt dashboard.** Every character's rested XP, level, professions, gold and bag space at a glance, with "who to play tonight" suggestions. | M | App | For players with several characters. |

## Tier 4 — Exhaustive / long-term programs

| # | Program | Size | Notes |
|---|---|---|---|
| 4.1 | **Full 1–60 guided route per race and faction.** A complete, curated, step-by-step leveling route, generated from our data and then hand-reviewed. It runs in the in-game step frame (2.3) with auto-advance, skip and "I'm behind or ahead" re-planning. | XL | The flagship. Needs 2.3 and 2.4 first. |
| 4.2 | **Community data loop.** Opt-in, privacy-reviewed export of your own observations (positions of quest givers, objectives and trainers you met), to share with the community dataset. Closes Alliance gaps faster. | L | Must stay opt-in, contain no personal data, and be reviewed. |
| 4.3 | **Accessibility and localization.** Screen-reader-friendly app and colorblind-safe icons. Localize the app and addon text (deDE, frFR, esES…) as data allows. | L | Data is enUS today. |
| 4.4 | **Smarter AI companion.** The companion gets tool access to everything above: routes, gear, dungeons and session history. It answers "what should I do tonight?" with a concrete plan. | L | Works with the user's own provider; no paid services by default. |
| 4.5 | **Graphics pass.** Original art for class portraits, page heroes, map pins, celebration effects and the in-game frames, kept consistent across the app. | M–L per pass | See below. |
| 4.6 | **Other platforms.** macOS support (the live link is Windows-only today). | L | Only if wanted. |

---

## When to do a graphics pass

Frank offered ChatGPT/OpenAI, Grok and the local ComfyUI for art. Suggested timing:
1. **Done in 0.21:**
   - Painted heroes for Now and Help.
   - Level-up crest.
   - Commands crests.
   - Generated locally with ComfyUI (Qwen-Image 2.1, native 2K).
   - Next: World Map legend icons and class portraits.
2. **After 3.1/3.2:** milestone badges and zone badges, which are art-heavy by nature.
3. **Before 1.0:** a full visual review of every page against one style guide.

Rule: generated art must be original. No Blizzard assets, and nothing that imitates their art or logos.

## Suggested release sequence

- **0.21 (shipped):** repair, flight paths, version check, Alliance vendors, flaky checks, art pass 1.
- **0.22 (shipped):**
  - D1 dialed-in Show on map, D2 link audit (Now).
  - D4 community quest fields.
  - D3 rich quest pages, first pass.
  - Art pass 2: step crests and zone vistas.
  - Still to do: class crests, and auditing links outside Now.
- **0.23 (shipped):**
  - D5 local item, spell and talent details.
  - D3 rewards with stats and icons.
  - D6 data coverage.
  - 2.1 reward picker, 2.2 upgrade tooltips, 2.6 talent coach.
  - 2.9 hearth advice, 1.3 no-XP quest hints, 1.5 helper switches, class crests.
  - Moved to 0.24: D7 card system, gear review with icons on Characters, 1.9 remote live-link check.
- **0.24 (shipped):** Quest intel Q1–Q6, 2.4 objective areas, 2.5 enemy levels, 2.7 dungeon readiness, gear review with icons. D7 card system moves to 0.25.
- **0.25 (shipped):** N1–N3 Now fixes, R1–R3 always current without /reload (live quest log pages), F1 quick answers with no AI, E10 one-click setup (first part: Set it all up on Now). 2.3 route stepper moves to 0.26.
- **0.26 (shipped):** 2.3/A2 route stepper (`/bf route`, step frame, arrow), A1 objective progress in enemy tooltips (overhead icons come later), E1 zone briefing, G2 zone arrival banners, G3 painted map pins and city banners.
- **0.27 (shipped):** F2 one-click free AI (llama.cpp engine and Qwen models, pinned and checked), F3 free cloud keys (Gemini, Groq), E3 trainer planner with spell icons, E2/A9 supplies and class helpers, G1 living headers.
- **0.28:** 2.8 + E8 professions with A6 gathering memory, D7/E11/A14 card and tooltip system, E9 rested planner, A3 speed splits, G7 badges.
- **0.29:** A4 dungeon loot browser, A5 boss tips, G6 dungeon art, E7 death review, A8 session stats, G8 celebrations part 2.
- **0.30:** E4 mount and gold goals with A7 price memory, E5 class quest chains, E6 reputation, A12 gear sets, G5 character sheet.
- **0.31+:** A10 PvP alerts, A11 QoL pack, A13/3.6 party sync, the rest of Tier 3, G9–G11, then the 4.1 full guided route and the G12 art review.
- **1.0:** after Frank's hands-on acceptance.

Keep this file and Help → Commands updated with each release.
