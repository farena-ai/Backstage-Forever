# Optional character snapshot addon

Use Start my adventure in the desktop app to prepare and verify this addon's twelve owned files automatically. The reference, public normalizers, profession/map planners, gathering collector, map provider and owned pin XML load before capture and HUD. Enable Backstage Forever in WoW if needed. Interface 16001 matches inspected Forever client configuration; runtime guards handle unavailable or restricted APIs. Synthetic Lua tests do not certify actual in-client loading. See [Compatibility](../../docs/COMPATIBILITY.md).

Once installed, local guidance can work with the desktop app closed. Supported public events update the native plan outside combat; no routine reload is needed after quest progress, levels or zone changes. Visit characters you want captured and let logout/game exit save naturally. The desktop reads the resulting snapshots while open. Voluntary reload remains available when you specifically want fresh desktop data or need to load an update. No input automation, memory access, combat calculation or forced reload is used.

The native Adventure Compass shows a short local next-step plan, current character/XP/quest information, source labels and per-character focus/session controls. Its waypoint button is an explicit player action and rechecks the supported guide guards. Drag its title, use - to collapse and X to hide, or `/bf show`, `/bf hide` and `/bf status`. It hides during combat. Unknown/protected data stays unavailable; the reference is not a complete historical guide or travel graph.

In 0.8 a quiet preparation line uses existing supported bag observations when two or fewer slots remain. Missing/invalid or zero capacity does not trigger a warning. The line clears with improved space, missing current facts or a changed session/character; it has no sound, repeated notification or automatic action. Desktop Company plans use last-saved evidence and remain separate from this live native cue.

The compiled reference derives from the bundled Efficient Games data, source commit 156f29c9af78b1586883e8eb94a13467eb89638c. Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), filtered and compiled by Backstage Coding. Approximate observations are not guaranteed spawns. Blizzard retains rights to its game content; the application/addon code is MIT licensed. The generated file header preserves attribution and source links.

In 0.6 the desktop Quest Guide can prepare a numeric `/bf guide` command from compatible reference evidence. Copy it in BF and paste it into WoW yourself. The addon checks the client build, combat state and active quest phase before using a supported map marker API; if unavailable, it prints coordinates. Reference-only markers do not mean the quest is available. Invalid commands show help. No movement, targeting, combat, interaction, map opening or automatic reload is performed.

Capture includes optional client build, locale, addon capture version, public objective counts/types and a bounded complete completed-quest ID set when available. Completed IDs stay local to the desktop and its private backups. Missing, protected or incomplete reads remain unknown. After an upgrade, the first reload loads the new addon; a second reload or logout may be needed to write its first new capture to disk. See [Forever data](../../docs/FOREVER-DATA.md).

## Beginner assist (0.19)

`BackstageForeverAssist.lua` adds plain-language help using public API only:
- a danger line above the target frame (skull, elite, world boss, much higher level, rare, no XP)
- pop-ups for level-ups, finished quests and deaths, with a waypoint to your body while you're a ghost
- a **Sell junk** button on vendor windows that sells grey items only when clicked, never in combat
- `/bf train` (waypoint to your class trainer), `/bf xp` (XP per hour, time to level, rested XP) and `/bf hearth`
- `/bf help`, plus `/bf toasts`, `/bf danger` and `/bf junk` to switch each helper on or off (saved per character in `BackstageForeverAssistSettings`)

## Optional profession and material observations

The 0.10 collector observes owned professions, learned recipes and fixed basic item requirements where Forever's public APIs expose them safely. Carried material counts cover only the backpack and four bags (0–4), with bounded reads and explicit partial/unknown coverage. It never opens profession windows, changes filters, adopts another player's linked/guild recipes, reads account/bank/mail storage, crafts or buys. Core character, quest, XP and native guidance continue when optional data is unavailable.

Recipe caches retain their actual dates and reset on character/build/session or relevant skill changes. Desktop Preparation uses the resulting saved observations; its shopping checklists are manual Company plans, not game-completion proof. No workshop details are added to automatic AI context. WoW's normal save boundary still applies to the desktop; native guidance needs no routine reload.

Exports stay within both the byte and parser-value limits. Optional gathering history is trimmed first, then workshop detail before older quest/history details when needed, preserving character identities and treating dropped observations as unknown.

## Native world-map layers and private finds

Open the world map normally. **BF Layers** adds same-map quest help, relevant Herbs/Ore/Supplies references and **My finds**. Auto follows owned gathering professions and the native Compass profession goal; native and desktop goals remain independent. Expand **Layers & recording** to filter, hide/show, pause recording, or deliberately confirm **Clear my recorded history**. A marker click chooses a supported public waypoint; it never moves, targets, gathers or buys. The game's own player arrow remains authoritative.

Native coverage is the existing quest reference plus seven acquisition relations and supported personal observations. Desktop reference browsing has broader seller history; the addon does not claim complete merchant/trainer/node coverage. Build 70862 references on 70888 appear only with **Older references**, explicitly labelled for browsing. Positions are approximate contributor/player standing points, never active nodes, exact objects, spawn timers, requirements or safe routes.

Recording initially supports readable English (`enUS`) Mining 2576 and Herbalism 2368 only when a known exact target name, matching own cast, one actual GameObject loot source and observed material ID agree. It skips unknown sources/locales, absent herbalism targets, ambiguous loot, combat and protected data. A loot window proves an interaction, not items collected. The actual Herbalism event shape and all map pixels/zoom/combat behavior still need owner acceptance in the current client.

The private per-character store retains at most 128 records and exports at most 64 recent records; optional export history is trimmed before quest/readiness data if needed. Pause persists without deleting history. Confirmed clear removes only this character's addon observations and pending correlations. Changes reach the desktop after WoW saves normally; old private backups may still contain dated history. Cast/object/owner GUIDs are ephemeral and are never saved in discovery records. An empty new schema receipt proves only that a new-format capture was saved, not live API or rendering support. Load the updated addon once if the game is already running; ordinary native updates need no repeated reload.

## Painted zone banners (0.37)

Entering a new zone shows a painted banner (`BackstageForeverZoneBanner`, 560×74 at the top of the screen) with the zone name and its level range and quests for your level, plus one line in chat. The paintings are `Art/Zones/<mapId>.tga` (1024×128) for 46 zones and capitals, and `Art/Zones/default.tga` for any other zone; the desktop app installs the whole `Art/Zones` folder with the other addon files. Textures and font strings only; never in combat, skipped for the first zone after login, and off with the other pop-ups via `/bf toasts`. Original art by Backstage Coding made with local ComfyUI.

## Hidden live link (0.38)

`BackstageForeverLive.lua` now draws the live link as a "hairline" by default (strip version 6): one physical pixel tall along the top edge of the game, starting at the left, 892 pixels wide, in near-black shades (each colour channel either 0 or 36 of 255), so it reads as a thin dark border. It is one frame (`BackstageForeverLiveStrip`, `TOOLTIP` strata, scaled so one unit is one physical pixel) with 446 textures of 2×1 pixels: six header cells (dark magenta, dark green, magenta, green, black, dark grey) from which the app measures each channel's off and on, then 165 bytes — the usual 27-byte live frame, five 27-byte page slots (quest log, turned in, moments and question pages in their existing formats), the page count and a CRC-16 over all of it, so a frame captured mid-repaint is refused rather than misread. One bit per channel because the real client bends near-black colours (a gamma curve, saturated colours boosted, a little bleed between channels) too much for the four shades of the first test build (version 5). Frame and pages are painted together, once per update, and only cells that changed are repainted. Five pages go up at a time: quest pages once a second (every two seconds when idle), a question four pages per 0.4-second frame with one quest page riding along, three passes. In combat the pages hold and any question page is taken off the line.

`/bf live hairline` (the default), `/bf live compact` (the 84×4 corner strip) and `/bf live safe` (the larger one-bit corner strip that survives remote desktop, HDR and colour filters) choose the mode, are saved, and turn the link on. `/bf live pos topleft|topright|bottomleft|bottomright` moves only the compact and safe strips; the hairline always runs along the top edge. A saved safe mode stays safe; a saved pre-0.38 default (compact) becomes the hairline. The addon still cannot hear from the app: when the app sees WoW but cannot read the line, it tells you in the app to type `/bf live safe`.

## Ask the companion from inside the game (0.38, one window since 0.39.1)

An owl crest on the edge of the minimap (`BackstageForeverAskButton`, our own painting in `Art/Buttons/ask.tga`; drag it around the edge, its place is saved per character) and `/bf ask` send a short "open" signal on the live strip; the desktop app then opens its panel over the game with the cursor in its question box, and the question and answers stay in that one window. The addon never receives the answer and has no question box of its own any more. `/bf ask QUESTION` (up to 200 characters, links become their names) still sends a question straight from chat. Nothing is sent until you click the owl or type the command; in combat it waits until combat ends (`/bf ask cancel` drops it). `/bf ask hide|show` hides or shows the button. The live link must be on (`/bf live on`).

## Party sync (0.42)

`BackstageForeverParty.lua` registers the addon-message prefix `BFParty` and talks to your `PARTY` only (never raids, guilds or whispers). When you join a party it asks (`R`) and sends your quest log as quest IDs with objective counts: `Q|seq|i/n|101:3/8,0/1;202!;303` (`!` = ready to hand in), at most 40 quests in up to four messages of 255 bytes or less, and again at most every 10 seconds when the log changes. Messages from others are put back together per sender and sequence; leaving the group forgets them. `/bf party` lists each member's quests next to yours (shared quests with both progress lines, and quests only they have); `/bf party way` sends `W|x|y|map|label` (your user waypoint, otherwise where you stand) and `/bf party go` passes the last one received to `/bf way`. `/bf party off` (saved in `BackstageForeverPartySettings`) stops sending and reading. Names, levels, positions and anything else stay out of it. Not yet checked with two real players.

## Painted frames (0.49)

The Adventure Compass and the BF Route step frame are drawn from our own painting in `Art/Frames` (made locally with ComfyUI): the Compass is a nine-piece leather-and-brass frame (`compass.tga`, a 512×512 atlas with 64-pixel corners, shown with 40-pixel corners and a 14-pixel inner edge) with a compass crest on top (`compass-crest.tga`), and the step frame is a parchment scroll between two rods (`step.tga`, 256×128: rod, parchment, rod) with the text in dark ink. `BackstageForeverPaintNineSlice` and `BackstageForeverPaintScroll` in `BackstageForeverHUD.lua` guard every call, so a missing texture leaves a frame plain instead of breaking it. A new art folder is only seen after quitting and restarting WoW.

## Quality of life helpers (0.41)

`BackstageForeverQoL.lua` holds four small helpers, each off until you switch it on with `/bf qol NAME on` (saved per character in `BackstageForeverQoLSettings`; `/bf qol` lists them):

- **coords:** your map coordinates (`C_Map.GetPlayerMapPosition`) under the minimap, five times a second; blank where the game gives no position.
- **loot:** faster auto-loot. On `LOOT_READY`, only when the game itself is auto-looting (the event's flag, or the `autoLootDefault` setting flipped by your auto-loot key), every slot is taken at once with `LootSlot`. Bind-on-pickup confirmations are left to you.
- **dismount:** `Dismount()` when a flight master's map opens, or when the game says you can't fly while mounted. Never in combat. Not yet checked in the real client.
- **questtext:** sets the game's own `questFadingDisable` setting so quest text shows at once, and puts your earlier setting back when you switch it off. If the client has no such setting, it says so.

It never accepts, completes or chooses quests, picks flight paths or confirms loot, and it never replaces Blizzard functions.

## Enemy player alerts (0.40)

`BackstageForeverEnemy.lua` watches your target, the unit under your mouse and new nameplates. When one is an enemy player who can attack you right now (`UnitIsPlayer`, `UnitCanAttack(unit, 'player')`, a different faction), it shows "Alliance level 32 Rogue nearby" (or Horde) for five seconds at the top of the screen and puts the name and zone in chat. The same player alerts again only after five minutes out of sight, alerts are at least four seconds apart, and battlegrounds and arenas are left alone. The last 20 sightings (name, faction, level, class, zone, when, how often) are kept per character in `BackstageForeverEnemySettings`. `/bf enemy` lists them; `/bf enemy on|off`, `/bf enemy sound on|off` (a warning sound, off by default) and `/bf enemy clear`. It only reads public unit info: it never targets, marks, reports or tells anyone.
