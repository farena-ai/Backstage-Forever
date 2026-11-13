# Backstage Forever roadmap

Where the companion goes next. Written 2026-11-12, after 0.20.0. Ordered by value to a player: a beginner should feel guided, and a veteran should feel faster.

**Sizes:** S = a day or less · M = a few days · L = a week or more · XL = a multi-release program.
**Where:** Game = the addon · App = the desktop app · Both.

**Ground rules for every item:**
- Public WoW API only.
- No automated game input.
- No paid services.
- Game art is read locally, never bundled.
- Horde and Alliance get equal coverage.
- Every new command or helper goes on Help → Commands; a test enforces it.

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

---

## Tier 1 — Quick wins (next 1–2 releases)

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| 1.1 | **Repair reminder.** Pop-up when gear durability drops below 25%, plus `/bf repair` for an arrow to the nearest repair vendor. | S | Game | New players don't notice red gear until it breaks mid-fight. |
| 1.2 | **Flight path tracker.** Remember which flight paths you know (read when the flight map opens). Say "You haven't learned this flight path, talk to Devrak" when you pass an unknown one. Show known and unknown paths on the World Map. | S–M | Both | Missing a flight path costs long runs later. |
| 1.3 | **Grey-quest cleanup.** Flag quests in your log that no longer give much XP, with a one-line "safe to abandon" hint. Hint only; never auto-abandon. | S | Both | Full quest logs confuse beginners. |
| 1.4 | **Addon-version check.** If the game is running an older addon than the app installed, say so in game and on Now ("type /reload"). | S | Both | Removes the most common "it isn't working" cause. |
| 1.5 | **Helper switches in the app.** Settings → Game shows the in-game helpers (pop-ups, danger, Sell junk, live strip) and how to toggle them. | S | App | Discoverability. |
| 1.6 | **Alliance vendors.** Refresh the vendor pack the same way as 0.20 (needs a raised input cap and a merge step). | S–M | Both | Alliance players still see only Horde vendors. |
| 1.8 | **Fix the flaky voice-backend test.** | S | Dev | Faster, calmer releases. |
| 1.9 | **Verify live link over remote access** in a real remote session, and add a capture-based regression test. | S | Both | Confirms 0.18.2 in your actual setup. |

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
1. **Now-ish (before 2.1/2.3 add new UI):**
   - A consistent icon set for map pins and Commands groups.
   - A celebration badge.
   - Hero art for Now and Help.
2. **After 3.1/3.2:** milestone badges and zone badges, which are art-heavy by nature.
3. **Before 1.0:** a full visual review of every page against one style guide.

Rule: generated art must be original. No Blizzard assets, and nothing that imitates their art or logos.

## Suggested release sequence

- **0.21:** 1.1 repair, 1.2 flight paths, 1.4 version check, 1.6 Alliance vendors, 1.8, plus the first graphics pass.
- **0.22:** 2.1 reward picker, 2.2 gear hints, 2.9 hearth advice, 1.3 quest cleanup.
- **0.23:** 2.4 objective areas, 2.5 enemy levels, 2.7 dungeon readiness.
- **0.24–0.26:** 2.3 route stepper, 2.6 talent coach, 2.8 professions.
- **0.27+:** Tier 3, then the 4.1 full guided route.
- **1.0:** after Frank's hands-on acceptance.

Keep this file and Help → Commands updated with each release.
