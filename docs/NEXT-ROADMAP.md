# Backstage Forever — what gets built next

Written 2026-11-24, after 1.25.0. Three parts, in build order:

1. **Backstage Desk** — bug reports with two-way replies, anonymous statistics, and an admin area.
2. **Buildables** — work left over that needs no one at the computer.
3. **The long list** — what would make this the all-in-one addon for WoW Forever.

The things that need a person are in `Backstage-Forever-Human-Roadmap.md`.

---

## Part 1 — Backstage Desk (support, statistics, admin)

### What already exists
A small service runs at `https://bf.backstagecoding.com` (Node, SQLite, behind the web server).
The app already talks to it: it shares gathering spots, NPC places, vendor stock and drops for the
live map, downloads a daily community pack, and can send a one-way problem report that only a
command-line tool can read. Each install has a random id made on first run; the server keeps only
a salted hash of it. Desk extends this service; it does not add a second one.

### The privacy line (never crossed)
**Never sent:** account name, character name, realm, guild, chat, file paths, file contents,
screenshots, IP addresses in storage, hardware ids, anything typed outside the report box.

**Sent, and only this:**
- the random install id (stored only as a salted hash);
- app version, addon version, release channel;
- operating system family (Windows / macOS / Linux) and its major version;
- app language;
- game build number;
- coarse yes/no usage flags (below);
- what the player types into a report, and a diagnostics block they can read before sending.

The server uses the caller's IP address in memory for rate limiting and never writes it down.
Country is not derived. Every field is on a fixed list; the server rejects anything else.

### 1A. Report a bug, and hear back
**In the app (Help → Report a problem, and a "Report this" link on error messages):**
- A short form: what happened, what you expected, where (a list of the app's screens and in-game
  commands), how often. Plain text, length-capped.
- "What will be sent" is shown in full before sending: the text, plus a diagnostics block (versions,
  OS family, language, game build, which screen, the last error message with paths removed). A tick
  box leaves diagnostics out.
- A scrubber runs before sending: anything that looks like a path, a `Name-Realm`, an e-mail
  address or a long token is replaced, and the player sees the result.
- On send the app gets a ticket number ("BF-1042") and keeps a secret key for it locally. The key,
  not the install id, is what lets this app read replies, so a ticket cannot be read by anyone else.
- **Inbox:** Help → My reports lists your tickets with status (Received, Looking into it, Question
  for you, Fixed in 1.26.0, Closed), the whole conversation, and a reply box. An unread dot shows on
  Help when a reply arrives. The app checks for replies at start and every few hours, only while it
  has open tickets.
- "Fixed in 1.26.0" lights up once the installed version is that or newer: "This is fixed in the
  version you are running."
- Optional desktop notification for a reply (off by default). In game, `/bf reports` says "1 reply
  waiting on the desktop" after a reload, through the hand-off file.
- Works offline: a report written with no connection waits in an outbox and is sent later.
- Delete my reports: removes them from the server and the app.

**Automatic error reports (separate switch, off by default):** when the app hits an unexpected
error it can send the error type, message and stack with paths removed, grouped by signature. No
text from the player, no data files.

### 1B. Admin area (`https://bf.backstagecoding.com/admin/`)
- **Sign-in:** named admin accounts, long passwords stored with scrypt, mandatory authenticator-app
  codes (TOTP), short sessions in Secure/HttpOnly/SameSite=Strict cookies, CSRF tokens on every
  form, lock-out after repeated failures, an audit log of every admin action. No public sign-up;
  accounts are made with the command-line tool on the server.
- **Tickets:** inbox with filters (new, waiting on us, waiting on player, fixed, closed), search,
  tags, severity, version and OS facets, duplicate merge, internal notes the player never sees,
  saved replies, "fixed in version" field, link to a GitHub issue, assign to an admin, bulk close.
  Each ticket shows the diagnostics block and the same install's other tickets (by hash only).
- **Reply:** plain text back to the player's app. Statuses drive what the player sees.
- **Error groups:** automatic error reports grouped by signature with counts per version, first and
  last seen, and "make a ticket from this".
- **Announcements:** a short message to every app, or only to a version range / OS / language
  ("1.25.0 has a problem with X; 1.25.1 is out"). Shown once in the app's What's New area. Expiry date.
- **Abuse controls:** block an install hash, rate limits per install and global, size caps, the
  existing "inbox full" guard.
- **Notify admins:** a new ticket or reply sends an e-mail from the server and/or a Discord webhook
  message containing only the ticket number, version and first line.
- **Data tools:** export tickets, delete a ticket, purge an install on request (already exists).

### 1C. Statistics
**From the app:** one small "heartbeat" at most once a day while the app is used.
Fields: install hash, app version, addon version, channel, OS family + major version, language,
game build, first-seen week, and yes/no flags: game folder connected, addon installed, live link
used, community sharing on, and which main areas were opened today (Now, Route, Map, Dungeons,
Professions, Ledger, Talents, Journey, Companion). No counts of clicks, no timings, no names.

**Dashboard graphs (drawn by the page itself, no outside scripts):**
- Installs: new per day, total ever seen.
- Active: daily, weekly, monthly; stickiness (daily ÷ monthly).
- Retention: of installs first seen in week N, how many came back in weeks N+1…N+8.
- Versions: share per version over time; how fast a release is adopted; who is stuck on old ones.
- Platforms, languages, game builds.
- Setup funnel: installed → game connected → addon installed → first save read → live link used.
- Feature reach: share of active installs that opened each area this week.
- Community data: submissions per day by kind (herb/ore spots, NPC places, vendor stock, drops),
  distinct contributors, coverage growth per zone — the professions and map data already collected.
- Support: tickets opened/closed per week, time to first reply, open by age, tickets per 1,000
  actives per version (a release-quality number), top error groups.
- Releases: download counts per asset pulled from GitHub's public release data.

**Honesty rules:** numbers are counts of installs that chose to send, and the page says so.
Aggregates only; no per-install browsing outside a ticket. Heartbeat rows older than 13 months are
rolled up into monthly totals and deleted.

### 1D. Player controls and wording
- Settings → Privacy & sharing: three switches with plain sentences — Share map discoveries
  (exists), Send anonymous usage statistics, Send automatic error reports — plus "See exactly what
  is sent" (a live preview of the next heartbeat) and "Forget me" (deletes server data, new id).
- First run after the update shows one card explaining statistics and the switch.
- The website, README and in-app privacy text change from "nothing leaves your computer" to the
  true statement: what is shared, that it is anonymous, how to turn it off.
- A public `privacy.html` on the site listing every field.

### 1E. How it is built
- Server: new tables (heartbeats, daily rollups, tickets, messages, admins, sessions, audit,
  announcements, error groups) in the existing SQLite store; new `/v1` endpoints with the same
  strict validation and rate-limit pattern; admin pages rendered by the server with a strict content
  security policy; backups of the database file nightly, kept 14 days.
- App: `src/core/desk.cjs` (outbox, ticket keys, polling with backoff), Help screens, privacy
  switches, hand-off line for the game.
- Tests: validators, privacy scrubber, ticket key checks (one install cannot read another's
  ticket), admin auth (lock-out, CSRF, session expiry), rollup maths, and an end-to-end test against
  a local server.
- Rollout: server first (old apps keep working), then the app release, then the website wording.

### 1F. Later, on the same rails
- Feature voting: the admin posts a question, apps answer once, anonymously.
- "Known issues" list in the app, fed by tickets marked as known.
- Scout notes inbox: review player scout exports in the admin area and promote them into the data.
- Translation suggestions from players ("this German line is wrong") as a ticket type.
- A public status line on the website (service up, last data refresh, latest release).

---

## Part 2 — Buildables (no one needed at the computer)

| # | What | Why |
|---|---|---|
| B1 | Translation catch-up: every string added after the translations (route variants, challenge evidence, attunement directions, Commands page texts) in German, French, Spanish. | Mixed-language screens look unfinished. |
| B2 | Boats and zeppelins in `/bf fly` in game. | Desktop has them; the game side does not. |
| B3 | Read the unused upstream files: `hunter_pets`, `encounters`, `quest_prerequisites`, `hotfixes`, `item_uses`. | May unlock the hunter pet book, better chains and boss lists. |
| B4 | Refresh the hand-pinned travel, encounter and acquisition packs through the one-command refresh. | Three packs still sit on old data. |
| B5 | Spell and talent hotfixes from the game's cache (items are done). | Tooltips and the talent planner can be stale after a hotfix. |
| B6 | Journey view switch wraps to two rows at small sizes; mixed date formats; flat vs brass buttons. | Left over from the quality pass. |
| B7 | Tests: finish removing the flaky window tests' causes (voice capture focus, packaged startup). | CI needs a re-run about one time in five. |
| B8 | Regenerate and upload the website automatically after each release. | Today it is a manual step. |
| B9 | Scheduled data refresh: check upstream weekly, open a pull request with the before/after table. | Data went 2 days stale between passes. |
| B10 | Addon size and load time budget: the addon grew to ~60 files and 390 KB of translations; split translations per language, lazy-load windows. | Login time and memory on older PCs. |

---

## Part 3 — The long list: an all-in-one addon for WoW Forever

Marked **[S]** needs the Desk service, **[H]** needs human review or play, **[P]** needs a client
probe in game first.

### One addon instead of ten
- Unit frames, raid frames and nameplates with a painted BF skin, each optional. **[P]**
- Action bar helpers: range and out-of-mana colouring, cooldown numbers, keybind text. **[P]**
- Bags as one window with search, categories, new-item glow, "junk / upgrade / wish / quest" marks.
- A built-in damage/threat readout if the client ever exposes it; until then, an honest note. **[P]**
- Cast bars, buff timers and a swing timer for melee and hunters. **[P]**
- Chat: tabs presets, timestamps, class colours, link copy, a filter for spam and gold sellers.
- Auction house: full shopping window, snipe list from your own price history, post helper that
  fills prices (you press the button), mail collection summary. **[P]**
- A profile system: export/import all BF settings as one code; per-character and account-wide.
- An "installed addons" doctor: which are out of date, which clash with BF, which BF can replace.

### Leveling and questing
- Reviewed routes for every race to 60 with speed, solo, duo and dungeon variants. **[H]**
- A live "what now" that weighs rested XP, bag space, quest density, travel time and your hearth.
- Automatic turn-in/accept behind a held key and a per-quest allow list (player-pressed). **[P]**
- Class quest and key-ability reminders at the right level; weapon-skill catch-up plans.
- Death review: what killed you, level gap, a tip, and the safest way back.
- Hardcore-style mode: danger ratings per quest and mob, "run now" warnings, a safe-spot list. **[H]**
- XP per hour by activity, time-to-level forecast, and a comparison with your other characters.

### Dungeons and raids
- Boss pages for every instance with roles, positioning diagrams and loot. **[H]**
- Pull planner: draw routes on dungeon maps and share them with the party.
- Raid tools: roster, assignments, consumable and buff checks, attendance, loot history. 
- Loot council / soft-reserve / DKP ledgers with import and export; nothing awarded automatically.
- Lockout and reset calendar across all characters; world buff timers if Forever has them. **[P]**
- Group finder with roles, gear check and a "ready when you are" list shared between addon users.

### Character and gear
- Best-in-slot lists per phase and spec, editable, with "how far am I" per slot. **[H]**
- A simulator-lite: stat weights from your own gear and talents; "what if" for an item swap.
- Enchant, gem-equivalent and consumable planner with cost from your own prices.
- Talent builds from the community with votes and notes. **[S]**
- Rotation and ability tips per class and level band (Academy for all classes). **[H]**
- Outfit and gear-set manager with one-click swap out of combat. **[P]**
- Pet and mount collection with sources; hunter pet book and stable planner.

### Economy and professions
- Reviewed 1–300 guides per profession with live cost from your prices. **[H]**
- Realm price sharing between addon users who opt in: medians only, never who. **[S]**
- Farming planner: best gold per hour for your level from your own and shared results. **[S]**
- Crafting queue: what to make for profit, materials to buy, where to sell.
- Cooldown trading board for guilds; bank-alt organiser; mail routing rules you confirm.
- Fishing: pools, zone skill, tournaments and timers if present. **[P]**

### World and map
- Full world database search: any NPC, item, quest, object, spell — in game and on the desktop.
- Live community map layers: herbs, ore, rares, chests, with freshness and how many saw it.
- Rare spawn timers and "seen 4 minutes ago" pings between addon users who opt in. **[S]**
- Danger heat map from anonymous deaths. **[S]**
- Exploration and achievements-style goals invented by BF (titles and badges, clearly ours).
- Weather, time-of-day and event calendar for anything Forever adds.

### Social and guild
- Guild page on the desktop: roster, professions, who can craft, events, attendance, notes.
- Events and sign-ups shared between addon users, with roles and reminders.
- Mentor programme: veterans opt in, new players get matched; privacy by default. **[S]**
- Friends' progress feed (opt-in), leveling races, shared screenshots journal.
- Community builds, routes and pull plans library with ratings. **[S]**

### Companion (the part nobody else has)
- Ask anything, answered from your character's real state and the bundled data, offline first.
- Voice in and out while the game has focus. **[P]**
- "Explain this" on anything you hover, in game.
- Session coach, weekly goals, and a plan that adapts when you play differently than it expected.
- Screenshot understanding on your own PC ("what is this debuff?") if a local model is available.

### Desktop, phone and web
- Second screen for a tablet or phone on your home network (opt-in).
- A read-only web profile you choose to publish: character, journey, badges, builds. **[S]**
- Phone companion: auction watch-list alerts from your own data, cooldown reminders, calendar. **[S]**
- Stream tools: overlay themes, alerts for level-ups and drops, chat commands.
- Controller and handheld layout, radial menu, big-text mode.

### Trust, quality and reach
- Backstage Desk (Part 1) and public known-issues and changelog pages.
- A public data coverage page per zone and faction, and a "help fill this zone" call for scouts.
- Native-reviewed translations; then Portuguese, Russian, Korean, Chinese.
- Addon store listings everywhere, winget, a notarized Mac app, a tested Linux build.
- A plugin point so others can add data packs or panels without forking.
- Performance budgets enforced in CI; an in-game "BF is using X ms" readout that stays green.
- Accessibility: colour-blind marks everywhere, screen-reader labels on the desktop, sound cues.

### Suggested order after Desk
1. In-game verification round with the owner (human roadmap), fixing what it finds.
2. Buildables B1–B10.
3. One-addon-instead-of-ten basics that need no probes: bags window, chat tools, profile export.
4. Full world database search and live community map layers.
5. Guild page, events and sign-ups.
6. Probed features, one probe at a time: unit frames, auction window, cast/swing timers.
7. Reviewed content with a human: routes, boss pages, class guides.
