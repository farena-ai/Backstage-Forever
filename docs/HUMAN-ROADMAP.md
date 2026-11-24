# Backstage Forever — human roadmap

Things that need a person at the computer. Nothing here can be done by the build agents: it needs
the real game, an account only the owner has, or a judgement call.

Written 2026-11-24, after release 1.25.0. Tick a box when done; write what went wrong next to it.

## 1. First in-game pass (about 30 minutes)

Install 1.25.0, let it prepare the addon, log in on one character, then go down this list. For each
line the question is only: **does it appear, does it look right, does it say something sensible?**
Anything silent, ugly, overlapping or wrong: note the command and what you saw.

### Start here
- [ ] `/bf status` — names your game build and says the data is checked or carried.
- [ ] `/bf help` — a short index; `/bf help 1` … `/bf help 7` and `/bf help all` page through.
- [ ] `/bf options` — five pages (Quests, Alerts, Comfort, Panels, Sharing); switches click; the
      three presets (Quiet, Leveling, Veteran) change them. Also in the game's own Options → AddOns.
- [ ] Right-click the owl button — opens the settings window.
- [ ] Esc → Key Bindings → Backstage Forever — six bindings listed; bind one and press it.
- [ ] First login on a fresh character — the welcome card appears once.

### Finding your way
- [ ] `/bf minimap` — quest pins near you on the minimap; do they sit where the NPCs are?
- [ ] `/bf available` — quests you can pick up here, nearest first.
- [ ] `/bf chain` on a tracked quest; hover a quest link in chat for "Step 3 of 7".
- [ ] `/way 45.2 61.8 Test` — a waypoint appears (skipped on purpose if TomTom is loaded).
- [ ] `/bf find <npc or item>` and the small find box at the bottom left of the world map.
- [ ] `/bf tracker` — quest list nearest first; click a row for a waypoint; drag it.
- [ ] `/bf route guide` — walks your route; if you edited the route on the desktop, your note shows.
- [ ] `/bf fly <place>` — flight route with legs, time and price. `/bf flights times` after one flight.
- [ ] `/bf loop` after "Send loop to game" on the desktop World Map, then `/reload`.
- [ ] `/bf explore`, `/bf rested`, `/bf weapons`, `/bf durability`.

### Dungeons and groups
- [ ] `/bf atlas` — window opens; banners, boss lists, loot with icons on hover; "Wish" and green
      "Upgrade" marks after starring items on the desktop and one `/reload`; counts in the list.
- [ ] Inside a dungeon: `/bf run on` — bosses left, quests, wishes, time. Kill a boss: does it tick off?
- [ ] Loot a wished item (or have a party member loot it) — banner appears after combat.
- [ ] `/bf lfg` — board fills from LookingForGroup lines; click a row puts `/w Name ` in chat.
- [ ] With a second player running the addon: `/bf check`, `/bf mentor Name`, `/bf sr add`, `/bf note`.
- [ ] In a raid group with the raid switch on: `/bf raid note Boss: text`, `/bf raid assign`.
- [ ] In a guild with a second addon user: `/bf guild on`, `/bf guild`, `/bf guild craft <item>`.

### Character and economy
- [ ] `/bf talents` — your next planned point after choosing "Use in game" on the desktop.
- [ ] `/bf train` at a trainer level — list with prices; open a trainer and compare.
- [ ] `/bf kit`, `/bf ready` at a dungeon door, `/bf bags`, `/bf bags marks on` (watch for errors
      opening bags afterwards — this is the one most likely to upset the game's own bag code).
- [ ] Auction house open: `/bf shop` panel beside it; click a line fills the search box.
- [ ] Mailbox with mail expiring soon — one line. Merchant window — prices are remembered.
- [ ] `/bf answers`, `/bf explain` on a target, `/bf wish`, `/bf scout on` then talk to a few NPCs.
- [ ] `/bf perf on`, play five minutes, `/bf perf` — any module far above the others?

### After one `/reload` — check on the desktop
- [ ] Characters → Talents → My plan shows "In game now" with your real talents.
- [ ] Adventure → Professions → Recipe book marks all your known recipes (no "100 recipes" warning).
- [ ] Dungeons & raids → Keys & attunements sees keys on your key ring.
- [ ] Ledger → Gold & prices lists this play session with coin per hour.
- [ ] Adventure → Travel shows real flight point names and offers boats/zeppelins across continents.
- [ ] Dungeons & raids → Run history shows the run you just did with time and bosses.

### Known risky ones (off by default until you say they work)
Run panel, quest tracker, bag marks, raid notes, guild sharing, scout mode, screenshot-on-event.
Tell me which work and I will turn the safe ones on in the Leveling and Veteran presets.

## 2. Other addons side by side
- [ ] With Questie or pfQuest loaded: `/bf addons` says it stepped aside for minimap pins.
- [ ] With TomTom loaded: `/way` belongs to TomTom, no double waypoint.
- [ ] With Auctionator/TSM: `/bf shop` panel steps aside.
- [ ] With ElvUI or another UI overhaul: do BF windows still look right and stay on screen?

## 3. Languages
- [ ] Switch the app to Deutsch, Français, Español: anything cut off, obviously wrong, or rude?
- [ ] A native reader for each language (French first: menu and tab words, "maître" for trainer).

## 4. Accounts and submissions (owner only)
- [ ] WoWInterface: accept the terms so the addon can be listed.
- [ ] Wago: create the account.
- [ ] CurseForge: confirm the submitted listing went live.
- [ ] winget: submit `packaging/winget/` (run `node scripts/build-winget.cjs --sums` first).
- [ ] Discord: create an application id (turns on Discord status) and a webhook (release posts).
- [ ] Apple: decide on a paid developer account for a notarized Mac app.

## 5. Decisions waiting on you
- [ ] Website screenshots show item and spell icons from your game install. Keep, or retake without?
- [ ] Second-screen feature (serves pages on your home network): build it or leave it out?
- [ ] Stream overlay binds to this computer only. OK as built?
- [ ] Hunter pet book: upstream now has a `hunter_pets` file nobody reads. Worth a pass?

## 6. Other platforms
- [ ] Linux: start the AppImage once on a real Linux system.
- [ ] Mac: open the zip build on Apple silicon and Intel; does saved-only mode work?

## 7. Play-and-review work (people, not code)
- [ ] Alliance zones: play or scout Dun Morogh, Loch Modan, Westfall, Darkshore, Teldrassil with
      `/bf scout on`, then Help → Data coverage → "Save my scout notes…".
- [ ] Leveling routes 55–60: generated, never played. One run-through per faction.
- [ ] Boss tips for Blackrock Depths, Lower/Upper Blackrock Spire, Dire Maul, the 40-player raids.
- [ ] Rogue trainer: open a Rogue trainer window with the addon running (data has 5 skills).
- [ ] Time a few flights and rides (`/bf flights times`) — 112 of 207 connections are untimed.

## How to report what you find
Until the in-app "Report a bug" inbox is live: paste the command, what you expected and what you saw
into the chat with the build agent, or open a GitHub issue. A screenshot helps for layout problems.
