# Desktop Adventure Map — task 1 implementation report

Date: 2026-11-11. Base `ef6f8928dfe89daf6b63ceb37692446130817a86`, branch `codex/pre-1.0-product-polish`. Binding desktop design/plan, umbrella design and reviewed native report were read. This task did not spawn agents. Parent owns independent SPEC/QUALITY, final integrated full suite/build/copied Windows package and owner handoff. Source remains **0.12.3 / 1.0 held**.

## Delivered behavior and scope

Adventure now has **Next step / Professions / Map** within the unchanged five-primary shell. All eleven old routes plus the new Map route are reachable; Plans retains its Professions shortcut, correct group/breadcrumb and single current subtab. Map uses an original coordinate-grid/compass frame and existing original class artwork with faction palettes. It has a compact hero, top controls and visible legend, dated source caption, mouse/keyboard markers, numbered accessible list and concise source dossier. The global broad setup banner/group introduction are suppressed only on Map. Compact 984×635 checks require an actual saved quest marker (not merely the Professions shortcut) to fit the initial viewport and at least 160 pixels of map geometry. The legend stays above the chart. Native 200% captures include both initial view and scrolled map detail.

There is no desktop terrain, route line, ETA, live node detector, trainer promise, game command, targeting/movement or game-control bridge. WoW owns the full live terrain map. Unknown location never acquires a center marker; actual zero coordinates remain valid. Other maps retain honest numeric labels, except the observed saved zone name. All source text is escaped; SVG geometry uses finite numeric attributes, static classes and external CSS under the unchanged self-only CSP.

Map preferences contain only bounded area/layer choices, at most 128 local character entries. Profession choices are read through the existing public `Preparation.options(profileId)` getter, with no duplicate goal parser. The same Professions plan supplies material relevance. Source/profile/route/options/epoch/read ownership fences retire stale models, selection and dossier navigation. Ordinary refresh preserves actual native controls and held physical presses. Accepted import/reset/delete/recovery clear matching preferences and retire old geometry; cancelled replacement preserves saved data. Imported/restored records remain saved history.

Settings activation wording separates **prepared files** from **new-format game save received** and explicitly says the receipt does not certify live rendering/gathering APIs. The old game-sync status string “All five companion files” became “All owned companion files”; this is the only game-sync change. No native implementation/schema/command, data pack, dependency lock, version or protocol bytes changed. Earlier released historical docs and sealed/failed receipts were preserved.

## Exact core, IPC and renderer contracts

- `src/core/adventure-map.cjs` exports `validateAdventureMapOptions(value={})`, `buildAdventureMap(state, profileId, options={}, dependencies={})`.
- Options are only `mapId?` (safe positive integer ≤2147483647), `layers?` (plain object of strict booleans `quest/herbs/ore/supplies/finds/olderReferences`), `goal?` (existing strict `validateProfessionOptions`: skillLineId?/recipeId? positive safe ordinary integers ≤2147483647, crafts 1–20/default1). Null/arrays/nonplain prototypes/unknown keys/coerced numeric IDs/coerced booleans fail. Coordinates, profiles, refs, URLs, tokens, commands and receipt flags are never accepted from renderer.
- Trusted pure-model dependencies: `{ acquisitionPack?, vendorPack?, knowledge?, now?, formatReceived? }`. The model validates cloned state and optional reference packs, reuses `buildGuidance(...).candidates` (the complete ≤25 quest pool), `buildProfessionCoach`, `acquisitionFacts`, `sellerFacts`, `validateGatheringProfile`, and `snapshotFreshness`. Optional invalid history is discarded atomically for the projection; valid core observations survive. Optional damaged references produce unavailable status without deleting observed quest/find points. No file/network/key/provider/write operations occur in the projection.
- `src/core/adventure-map-ipc.cjs` exports `registerAdventureMapHandlers({handle,getState,knowledge,gatheringReceipt=()=>false})`. It loads optional immutable bundled references in main. `adventureMap(profileId,options)` is exactly **two arguments**. Preload forwards extras so main rejects them; undefined options are rejected. Raw current `activeProfileId` is checked before any validation fallback. Null is permitted only for the genuinely empty selected journal. An arbitrary/noncurrent/missing profile cannot be read.
- Main's `gatheringReceipt(profile)` grants true only if `game.status().connected`, `loadedGatheringSchema===1`, the current main-owned saved profile source matches `game.lastSnapshot.activeId`, and that matching normalized character has the same saved timestamp and schema1. Import/recovery/disconnect clear the GameSync authority; imported schema presence alone never grants receipt. Unavailable-but-valid empty native blocks retain the reviewed receipt meaning, not live API proof.
- `window.AdventureMap` exports `init/page/mounted/refresh/paint/invalidate/beginRender/endRender/options/save/remove/deferRender`. Its host supplies API/root/esc/portrait/active/profileId/sourceSignature/epoch/open. Source signature includes selected profile and source status; it is never embedded in the DOM or public DTO. Selection actions carry only a bounded local read token and a public stable point ID. A root render cannot briefly republish an old model after a source change, even before refresh is called. Internal dossier destinations are only Quests or Professions; no new clipboard/shell/web capability.

## Exact detached public DTO

Top-level keys: `version:1`, `status:'available'|'no-character'|'no-location'`, `character|null`, `source`, `view`, `playerPosition|null`, `points`, `counts`, `layers`, `goal`, `references`, `gathering`, `limitations`.

- `character`: `{id,name,className,faction:null|string,level}`. ID is the selected local profile ID, not private source identity.
- `source`: `{kind:'saved-addon'|'manual',build:null|string,savedAt:null|ISO,freshness:'fresh'|'stale'|'unknown',live:false}`. Even fresh data is always last-saved.
- `view`: `{mapId:null|integer,label,kind:'saved'|'reference',maps:[{mapId,label}]<=128}`. Default is actual saved map; absent saved map may choose a clearly labelled reference area. Unknown numeric maps are never assigned invented Classic names.
- `playerPosition`: null or `{mapId,x,y,label:'Last-saved position'}` only for a valid saved position on the selected map. Both x/y are finite 0..1 including0.
- Each point: `{id,kind:'quest'|'material'|'find',mapId,x,y,title,detail,evidence,precision,qualification,layer,itemIds,sources}`. ID is a stable 24-hex SHA256 prefix over typed public kind/entity/phase/build/coordinate identity, never a source GUID. `precision`: game-marker / approximate-reference / recorded-standing-point. `qualification`: game / qualified-historical / browse-only / own-recorded. Common layer names match options. No native `questStep` or command is copied. At most128 final same-map points; personal records at most64.
- Source entries: `{authority,build,observedAt,qualification}`, with authority saved-game / quest-reference / personal-journal / acquisition-reference / seller-reference. Personal entries add `method`. Material authorities add `itemIds`, `context`, `limitedStock:true|false|null`, `contributorFiles`, `reason`. This preserves which material each stock/context observation describes. Identical entity/build/coordinates are deduplicated independently of source position ordering; material IDs union, both authorities and independent qualifications/dates remain. Evidence arrays are not sorted in place.
- `counts`: `{quest,material,find,total,omitted}`; these are displayed observations, never current spawn or gathered-quantity counts.
- `layers`: all six strict effective booleans. Defaults use owned Mining/Herbalism and selected recipe materials, saved quests, personal finds; older/uncertain references default off.
- `goal`: existing Coach selection `{skillLineId:number|null,recipeId:number|null,crafts,automatic}`. It is a numeric local plan choice, never the profile's private goals.
- `references.acquisition`: `{status:'available'|'unavailable',relations,build:null|string,attribution:null|string}`; `references.sellers`: `{status,scope,build}`. Acquisition is the existing7relations/17positions build1.60.1.70862; desktop additionally uses the broader existing seller catalog. Native coverage is explicitly the seven-relation subset. 70862 references on70888 are browse-only; old browsing does not bypass actual quest build/title/phase guards. Exact-ID source absence never becomes unobtainability.
- `gathering`: `{status:'missing'|'invalid'|'available'|'unavailable',recording,limited,totalRecords,shown,formatReceived}`. Missing/invalid/empty/unavailable-retained/limited are distinct. Personal observations stay own-recorded even when historical; they never become active node claims.
- `limitations`: short fixed honest explanations covering last-saved status, absent/elsewhere position, approximate references and unknown current access/stock/rank, no terrain/routes/respawn/safety promises, private local finds.

The public object does not spread a profile or reference pack. Private source IDs, full GUIDs, notes/goals, paths, credentials, unrelated characters, arbitrary URLs and commands are excluded. No material inventory quantities or exact shortage are invented from incomplete bags. Personal history is not appended to AI or support payloads.

## RED → GREEN evidence (failed/intermediate receipts retained)

1. `node --test tests/adventure-map.test.cjs tests/adventure-map-ipc.test.cjs tests/adventure-map-renderer.test.cjs` — initial combined run0/9 (`work/adventure-map-red.txt`): **8 meaningful missing-model/IPC assertions**, plus one renderer-file parser failure. That parser failure is not claimed as behavioral RED. Corrected renderer tests were run against the absent renderer with its draft withheld: `node --test tests/adventure-map-renderer.test.cjs`, **0/3**, `work/adventure-map-renderer-red-corrected.txt`; implementation then restored and combined actual tests passed11/11 (`work/adventure-map-first-green-2.txt`).
2. `node scripts/adventure-map-smoke.cjs` — actual initial Electron **Adventure Map tab missing, 0!==1**, `work/adventure-map-gui-red-tab.txt`. The earlier setup-screen timeout was a fixture error and is preserved separately in `work/adventure-map-gui-red.txt`, not counted as missing-tab evidence.
3. `node --test tests/adventure-map-ipc.test.cjs` — connected receipt regression **3 pass/1 fail**, `work/adventure-map-receipt-red.txt`; main-owned receipt implementation then green.
4. `node --test tests/adventure-map-renderer.test.cjs tests/adventure-map.test.cjs` — actual whole-root source ownership regression **12 pass/1 fail**, `work/adventure-map-source-owner-red.txt`; page now requires the current source signature, not merely an older matching internal signature.
5. `node --test --test-name-pattern="per-source material" tests/adventure-map.test.cjs` — **0/1**, `work/adventure-map-material-identity-red.txt`; added per-source material identity to preserve stock/context mapping through unions.
6. Actual full Profession GUI caught a same-character native-select replacement (`work/adventure-map-profession-green.txt`). A missing brace introduced during integration unconditionally invalidated Preparation on every source poll. `node --test --test-name-pattern="ordinary same-character profession" tests/renderer-updates.test.cjs` reproduced **0/1**, `work/adventure-map-profession-owner-red.txt`. Scoped bracing fix restored conditional invalidation. The new unit fixture initially shared its returned snapshot object; changed it to a detached clone for the second genuine owner-change assertion (`work/adventure-map-profession-owner-green.txt` retains that fixture failure). Final renderer-updates **23/23** in `work/adventure-map-profession-owner-green-corrected.txt`, and the complete actual Profession GUI passed afterward.
7. Adding a real second map option exposed selected native-option contrast below3:1 in actual Chromium (`work/adventure-map-gui-final-green.txt`). The map-specific ordinary option CSS had overridden the selected surface. An explicit selected option surface fixed it; final real light/dark native-menu contrast checks pass. An earlier native-select test pressed ArrowDown on a closed multi-option select (committing a change, therefore no longer holding its menu); it was corrected to test the actually open native menu. Original failed receipts remain.
8. Raw reusable fixture first omitted the parser-required empty `location.subZone`; actual parser test caught it in `work/adventure-map-final-model-fixture.txt`. Fixed the fixture, not production validation. The final raw fixture is parser/profile-merge verified.

## Focused verification

Actual covering source command:

```powershell
node --test --test-concurrency=1 tests/adventure-map.test.cjs tests/adventure-map-ipc.test.cjs tests/adventure-map-renderer.test.cjs tests/player-navigation.test.cjs tests/renderer-updates.test.cjs tests/renderer-interaction.test.cjs tests/refresh-renderer.test.cjs tests/preparation.test.cjs tests/preparation-ipc.test.cjs tests/preparation-renderer.test.cjs tests/profession-coach.test.cjs tests/profession-coach-ipc.test.cjs tests/adventure-coach.test.cjs tests/adventure-coach-ipc.test.cjs tests/guidance.test.cjs tests/gathering-data.test.cjs tests/gathering-sync.test.cjs tests/profile-sync.test.cjs tests/backup-limits.test.cjs tests/readiness.test.cjs tests/vendor-facts.test.cjs tests/knowledge.test.cjs
```

**231/231, zero fail/skip/cancel**, `work/adventure-map-covering.txt`. Subsequent focused deltas: new map/source/diagnostics command `node --test tests/adventure-map.test.cjs tests/adventure-map-ipc.test.cjs tests/adventure-map-renderer.test.cjs tests/diagnostics.test.cjs tests/diagnostics-ipc.test.cjs` **33/33** (`work/adventure-map-final-focused.txt`); final actual map/model/IPC/renderer including64-record bounds, raw fixture and setup wording **21/21** (`work/adventure-map-final-model-green.txt`); renderer integration regression **23/23** as above. These are separate run counts, not a claimed full-suite aggregate. No full `npm test`, build, package or native reimplementation sweep was run.

The pre-existing renderer fixture was migrated to load actual AdventureCoach/PlayerNavigation/AdventureMap dependencies and its saved-workshop stub now targets actual professionCoach, retaining the original build-change assertion. Real route fixtures gained Map/Adventure ownership and the Profession GUI's Adventure count changed2→3. No legacy assertions were weakened.

Serial actual Electron commands, each with its own new capture root:

- `node scripts/adventure-map-smoke.cjs` — **13 gates,12 native captures**, `work/adventure-map-gui-final-qualified.txt`. Actual SVG geometry .5027/.4874→502.7/487.4, zero player coordinate, same-map counts, escaped/whitelisted DTO, keyboard/list dossier selection and focus; area/filter/goal persistence; native menu/root/heldEnter/heldPointer; late source/navigation/character; old build/no coordinate/missing format/empty; actual import/preview-confirmed restore/reset; bad optional refs; fiveprimary/threeAdventure/all11legacyroutes/Plansshortcut; bothfactions1440×960/984×635; first-viewport actual marker; reduced motion, native selected-menu contrast, no horizontal overflow/broken image/CSP/renderer errors. Final native captures use Electron `webContents.capturePage()` after a compositor barrier. Earlier200% screenshots were stale cached compositor frames despite zoom metrics; the final method and visibly doubled captures correct that, and the earlier receipts are retained.
- `$env:BF_SMOKE_CAPTURE_ROOT=...covering-player-shell-2026-11-11-0904; node scripts/player-shell-smoke.cjs` — PASS, `work/adventure-map-player-shell.txt`. It iterates all12 route-helper entries while preserving every original shell, custom-class, disclosure, keyboard, first-Send and faction check. The old printed “11” summary was corrected afterward to12/all11legacy; no assertion changed in that print-only correction.
- `$env:BF_SMOKE_CAPTURE_ROOT=...covering-profession-2026-11-11-0909; node scripts/profession-coach-smoke.cjs` — complete normal source GUI PASS, `work/adventure-map-profession-final.txt` (held menus/physical presses/source and default replacement, R1 delayed recipe/crafts ownership, source qualification, retry, partial/unknown supplies, private drafts, navigation/selection/restart/import/reset).
- `$env:BF_SMOKE_CAPTURE_ROOT=...covering-director-2026-11-11-0912; node scripts/director-smoke.cjs` — complete source GUI PASS, `work/adventure-map-director.txt`, including finalR2 physical dispatch/root/source/focus continuity.
- `$env:BF_SMOKE_CAPTURE_ROOT=...covering-command-center-2026-11-11-0914; node scripts/command-center-smoke.cjs` — PASS, `work/adventure-map-command-center.txt`; new full/compact first-view captures added without changing original assertions.

All GUI instances use temporary fictional journals/client directories. External key/model/provider/game/audio/shell/clipboard surfaces are faked before bootstrap, with automatic app/reference starts off. Map replacement tests additionally fake native dialogs and global credential clearing before bootstrap. No actual player/game/auth/audio/paid inference, OS setting, installer, watcher or publication action occurred. Each Electron process is closed in its finalizer. Source/GUI ownership is released after scoped commit below.

## Capture receipts

Authoritative final Map directory: `.superpowers/sdd/adventure-map-captures/2026-11-11T09-11-01-028Z`. Visual inspection confirmed compact quest marker and visible legend, original class/faction styling, native200% initial and map-detail readability. Bounds are measured by the actual GUI assertions; the screenshot files preserve pixels. Complete passed capture index: `.superpowers/sdd/adventure-map-captures/2026-11-11-desktop-task-capture-index.json`, SHA256 **3a78dae46719fda1a42cdafe6a2bed31ff5e95e37330ea4d3fc52b21f5bd151e**. It contains byte count and SHA256 for every passed PNG and existing manifest in these new roots:

| Capture root | PNGs |
|---|---:|
| .superpowers/sdd/adventure-map-captures/2026-11-11T09-11-01-028Z | 12 |
| .superpowers/sdd/adventure-map-captures/covering-player-shell-2026-11-11-0904 | 26 |
| .superpowers/sdd/adventure-map-captures/covering-profession-2026-11-11-0909 | 22 |
| .superpowers/sdd/adventure-map-captures/covering-director-2026-11-11-0912 | 7 |
| .superpowers/sdd/adventure-map-captures/covering-command-center-2026-11-11-0914 | 2 |

Final Map image SHA256 values:

| Image | SHA256 |
|---|---|
| alliance-compact.png | b1ef871d8259a868cc546df4677a5b01433417565fc1602614b04cd66d4ba62a |
| alliance-full.png | 18cee1933491bd542d9c522db50c91fe85a0c7fd4f1b02a5e2b6c81a5a3f9a44 |
| damaged-reference-keeps-observations.png | 13eb12b30b75d37054db13eb3249a320f027a242a3434ba4f5322e03a57d8967 |
| horde-compact.png | 0d05437525f8b6987a13b88c7c5fb421686fc7e13aa4d62905ae41b0216289d3 |
| horde-full.png | 702da746f3beed82639cef1c795c9e0517499b78245372fc597f4f52d22dc368 |
| horde-native-200-percent-map-detail.png | 73c4180cbc9aedd62060ce080ad3bb3c1a9984c5fc1a540c2dcace6300e4ca96 |
| horde-native-200-percent-reduced-motion.png | 66d4f7699b3eaf58c06302f145b31dd53ddfde5b7f8e7dda6810a2c808f22e96 |
| missing-coordinate.png | e0ec707dab7538b0e381022feac9b030f432f4c448b23b891ebb3a9fa6368121 |
| missing-format.png | 3215e93dadb2d464a555bfe712ff3eca7ac6323de2b767f78319150cbe475680 |
| no-location-empty.png | 1abe613401c7e639d7959b208bff31c601471bb20900c5b464d7a06e521f1ab0 |
| older-build-browse.png | 1d563e7d4b5aa6dfb8e97659ce2325307e9b97565d9a16b1280ddf694302b964 |
| restored-private-journal.png | ed558d259761d1205a5aa21143d42173213d5f63d5e7cc857c039f59ff7ee921 |

## Reusable final-package fixture

`tests/adventure-map-fixture.cjs` exports **seed()**, **capture(now=Math.floor(Date.now()/1000), faction='Alliance')**, `at`, `col`.

`seed()` is a strict normalized private state with active local ID`p`, fictional Hunter/Alliance Aeralyn, build1.60.1.70862, saved map1411/x0/y.4, an actual saved quest destination(.2,.3), Mining186/rank20/75, empty recipes and known empty bags0–4, plus a valid schema1 mining standing observation at map1411/.5027/.4874 with entity1731 and itemIds2770/2835. Private notes/source/path/GUID canaries are intentionally present in the input only. The exported record ID is `wowf:mining:1731:1411:5027:4874:1.60.1.70862`, precision recorded-standing-point, evidence observed-gathering-loot, approximate true. Parent can add an observed Alchemy171 recipe/reagents using the existing Profession report contract for its combined acceptance; do not invent `learned` or use private source IDs as local profile IDs.

`capture(now,faction)` returns a genuine raw schema1 addon export with epoch timestamps, synthetic source ID`Synthetic-Map-Alliance` or`Synthetic-Map-Horde`, correct current captureVersion and enUS locale, explicit empty location.subZone, workshop collection epochs, and gathering record/block epochs. Horde variant is fictional Mage Vaelric. Encode it into the synthetic SavedVariables file as:

```js
const raw = require('./tests/adventure-map-fixture.cjs').capture();
const text = 'BackstageForeverExport = ' + JSON.stringify(JSON.stringify(raw));
```

The final test actually runs this through `parseSavedVariables`, `mergeSnapshot(defaultState(), snapshot)`, and `buildAdventureMap`; exact personal geometry survives. The resulting local profile ID is assigned by normal merge; select `state.activeProfileId`, not the raw synthetic source ID. The fixture is a test input, not shipped app data or actual-client proof.

## Self-review, bounds and remaining gates

Reviewed exact diff, actual module boundaries, private allowlists, source qualifications, source/epoch ownership, per-source stock/context mapping, native select stability, all route migrations and new docs. Node syntax checks passed for main/app/new core/renderer/smoke/fixture. `git diff --check` passed. `git diff -- addon data package-lock.json` is empty; package.json changes only add the focused test command, with version/dependency values unchanged. No old artifact or failed receipt was overwritten. The status-only wording correction and whitespace-only CSS formatting after final GUI do not change behavior or pixels.

No known unresolved task implementation defect is claimed. Independent parent review remains required and can find additional issues. Actual WoW native rendering/pins/gathering-event compatibility, normal game-save behavior, real provider/audio, installed updater, and long-session performance remain owner hands-on gates. Final integrated full-suite/raw reference/offline checks, full current12-file installation/repair, source-owned build, outside-checkout copied Windows app/SDK/resource parity, new review ZIP decoded-file SHA validation and final strong source/artifact review are **parent-owned and not claimed here**. Keep1.0held, no installer/publication; close regular BF before opening a separate review copy to avoid competing addon repairs.


## Review correction wave — mounted retirement and time authority (2026-11-11)

Base: `ecfe704a2326e7babe619a5172bd8d0e3c25d1dd`. Addressed both Important/P2 findings in `work/desktop-map-review.md` as one scoped wave. The earlier conclusion of no known unresolved implementation defect was superseded by that independent review; its two concrete findings are now covered below. Original receipts, capture directories and index remain unchanged.

### Production changes and unchanged contracts

Only `src/renderer/adventure-map.js` changes product behavior. A source/options/profile replacement now calls the existing guarded `paint()` immediately after retiring its model and incrementing its read owner, before awaiting IPC. With no physical owner, the **mounted** old markers, position, dossier and freshness text disappear immediately and the mounted map says “Opening your saved map…”. While a pointer/key/native menu owns the controls, the shared InteractionGuard queues this paint until dispatch completes. Old mounted action tokens are already invalid during this hold; the paint evaluates the current model on release, so a newer resolved replacement wins. No global render, navigation or interaction hook changed.

The unchanged-source branch now checks the saved timestamp on the existing Map refresh/poll. Guidance's existing authority (`snapshotFreshness`) uses floored minutes and `ageMinutes > 15`, so the first stale boundary is savedAt + **16 minutes**, not 15:00. At the first existing refresh on/after that boundary, a fresh model gets one main-owned `adventureMap(profileId, options)` reread. The renderer's clock schedules the read; it does **not** declare a new freshness status. The accepted status comes from the actual main model. While waiting, only the mounted age span's `textContent` changes to “Checking saved age…”. On acceptance only `model.source.freshness` and that caption update. Geometry, selected marker, dossier, current native select and physical action owner stay intact. Already stale/unknown/manual sources cause no age rereads; repeated refreshes while pending cause none. Failed/mismatched reads show “Saved age unavailable” and are retried no more than once per minute. An authoritative still-fresh response may likewise retry after one minute, covering clock disagreement without a read storm.

Age replies retain active route, read generation, source/options/profile signature and mutation-epoch fences, plus matching returned character ID/source kind/saved timestamp/build. Source replacement resets age ownership. A delayed old age reply cannot repaint the pending replacement or its later geometry. `data-map-age` is a renderer-only span hook. Public DTO/schema/API/arity, strict main ownership, `Preparation.options(profileId)` goal reuse, preferences, source qualification and private-data allowlist are **unchanged**. No native/addon, core model/IPC, Guide, data, dependencies, package/version, global hooks or parent packaging helpers changed.

### Genuine mounted DOM regression and RED → GREEN

Added `tests/fixtures/adventure-map-dom.cjs`: an isolated **hidden/offscreen Electron BrowserWindow** loading a scratch HTML document, production `interaction.js` and production `adventure-map.js`. It does not load product main/bootstrap or initialize providers/updaters/GameSync. Network requests other than local file loads are blocked. Test data, storage and userData are temporary synthetic paths and the fixture closes its own app. Existing Electron/Playwright dependencies are reused. Assertions query actual Chromium DOM elements/attributes/text and retained node identity; they do not use `AdventureMap.page()` as mounted evidence. Actual `buildAdventureMap` supplies the models with an injected test clock, matched to the renderer clock; the normal IPC serialization boundary is represented by Playwright's detached arguments.

Exact commands and preserved receipts:

1. RED: `node --test --test-concurrency=1 tests/adventure-map-renderer.test.cjs tests/adventure-map.test.cjs` → **18/21 pass, 3 expected failures**, `work/adventure-map-review-fix-red.txt`. Confirmed four retired mounted nodes still present, held native release failing to paint pending, and unchanged-source boundary still at one read instead of two.
2. Initial GREEN, same command → **21/21**, `work/adventure-map-review-fix-green.txt`.
3. Added bounded failure/retry/late-age-source coverage, then exact focused + required covering command: `node --test --test-concurrency=1 tests/adventure-map-renderer.test.cjs tests/adventure-map.test.cjs tests/renderer-updates.test.cjs tests/renderer-interaction.test.cjs tests/refresh-renderer.test.cjs tests/player-navigation.test.cjs` → **90/90** (22 model/renderer + 68 covering), `work/adventure-map-review-fix-covering.txt`. Zero failures, cancellations or skips.
4. One final visible source acceptance: `node scripts/adventure-map-smoke.cjs` → **13 gates / 12 native captures**, `work/adventure-map-review-fix-gui.txt`. This is the only visible Map acceptance run in this correction wave. No repeated full231, four unrelated covering GUI runs, full suite, build or package.

Mounted regressions cover delayed same-character replacement and new numeric geometry, cleared/malformed history, selected-dossier retirement, native menu identity through pointer-up and Escape, retired action rejection, the actual core fresh/stale millisecond boundary, pending and authoritative updated captions, unchanged selected marker/dossier/native node identity, dozens of irrelevant refreshes with no extra reads, 12-hour stale retention without reads, failed age read with one-minute bounded retry, and an old age reply arriving during source replacement. Core boundary tests compare Map directly with `snapshotFreshness` at 0, 15:59.999, 16:00 and 24 hours. Existing exact covering suites stayed green; no extra global-hook cover was needed because none changed.

### Final actual Electron acceptance and capture hashes

The smoke now asserts mounted pending geometry/caption/dossier before releasing delayed IPC, then verifies current replacement geometry (`cx=630`) and title. Its former pure-page delayed-reply assertion now queries mounted DOM. All original 13 gates remain, including held pointer/Enter/native select/whole-root ownership, profile/route/import/restore/reset fences, all legacy routes and Plans, qualified source conditions, actual native capturePage 200% (with compositor barrier), both factions/compact first-viewport marker, reduced motion, contrast, keyboard and CSP. Synthetic external surfaces are still replaced before product bootstrap and automatic update/reference starts remain off. No actual game/player/provider/account/audio surface was exercised.

New immutable capture root: `.superpowers/sdd/adventure-map-captures/2026-11-11T09-27-37-170Z`. `manifest.json` records **errors: []**, 13 gates and the 12 captures. SHA-256: `bc441298f972c1f709ede2291382fefc490350692a8a1f041175037bb11bd0c1`. All capture hashes were independently recomputed against the manifest. Visually inspected the new Horde compact and actual200% map-detail PNGs: compact visible quest marker, readable source/legend, stable responsive frame/sidebar and doubled native text remain intact.

| Capture | SHA-256 |
| --- | --- |
| alliance-compact.png | 7815c8e5816bc57e5f994deff50a77424dbe6aa679ac2be92c07a46647c8ff0b |
| alliance-full.png | e038c010ca30a1d241b0a0b5a9c6f808e221b24cb9d9a19b49f28d8536f79d97 |
| damaged-reference-keeps-observations.png | 13eb12b30b75d37054db13eb3249a320f027a242a3434ba4f5322e03a57d8967 |
| horde-compact.png | bcd7e54b08662d6283492e309f978c1757e6d1ebca6eeefbaf64348f9c9bc69d |
| horde-full.png | 4c4db6527efa86761048e04adaaf122541dd09b872cf774f035cf7fa3ae32d2c |
| horde-native-200-percent-map-detail.png | 73c4180cbc9aedd62060ce080ad3bb3c1a9984c5fc1a540c2dcace6300e4ca96 |
| horde-native-200-percent-reduced-motion.png | 66d4f7699b3eaf58c06302f145b31dd53ddfde5b7f8e7dda6810a2c808f22e96 |
| missing-coordinate.png | c1a15c40dc2d434e2a88c5fce1d97db1824c5c2d3853d160dfd1039cd625742a |
| missing-format.png | f14a45172b146a64c76dcef8a05a3b9a1cba891d65a369592bef830faba36133 |
| no-location-empty.png | e2fda44b53024354e6a516a9421519b2f52bceba6ea0b8b0659e4697b48eac6f |
| older-build-browse.png | e6a4d6d591d2c5e759b44424867ee5a06cf4a9f7d8163f6f60dc5fc36190689b |
| restored-private-journal.png | 7d8d8721b1eaaa33e654a59debadac8a00cf293154abadf8a4372ab07193491a |

### Correction self-review and ownership release

Reviewed the complete scoped production/test/smoke diff, asynchronous owner fences, text-only caption mutation, boundary/retry cadence, fixture isolation and absence of unrelated edits. `git diff --check` passed. The exact protected-path diff is empty for core/native/addon/data/package/version/global app/interaction/navigation sources. Existing reusable `seed()`/`capture()` fixture and public DTO/helper contracts above remain valid for the parent's final package acceptance.

No known unresolved correction defect is claimed; independent parent re-review is still required. The local Electron fixtures establish mounted behavior, not real WoW, live provider/audio or long-session owner acceptance. Source remains0.12.3 and1.0held. Final whole-series review, full suite, build, outside-checkout copied Windows acceptance and new review ZIP remain exclusively parent-owned. Source/GUI ownership releases with the scoped commit returned to the parent; all test-owned Electron processes have closed.
