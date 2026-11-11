# Native adventure map Task 1 - implementation and evidence

Base `842e00d77282ac7e5292bd6828f1679b80866ce9`, existing checkout. Source **0.12.3**, local preview; **1.0 and actual client acceptance held**. Written before the scoped commit. No subagents, full-suite run, build/package/installer, real player/game input, authentication, audio, paid inference, OS setting, watcher or publication action. Parent owns independent SPEC/QUALITY review and the following desktop Map task.

## Delivered and limits

The native world map has an owned passive provider, engine-created virtual pin XML and compact BF Layers controls. Auto uses relevant current quest markers, owned gathering professions or the native selected recipe's outstanding/unknown materials, plus own recorded finds. Quest planning drains all bounded 25 quests before same-map filtering, without changing Plan ordering/reference/title/phase/build authority. Copper/Rough Stone identical source places become three source pins with both exact material IDs. Current markers, qualified historical places, explicitly enabled older browsing references and own past interactions retain separate evidence labels. No terrain, pathfinding, active-node, exact-node, quantity-collected, minimum-rank or availability inference.

Native minimum coverage is **existing quest references + seven acquisition relations + supported private finds**. Desktop already has broader seller history. There is no native complete merchant/trainer coverage, generated vendor slice, new dataset or desktop/native goal bridge. No placeholder desktop Map route, endpoint or view was introduced.

Recording requires readable own SENT + matching SUCCEEDED cast/spell, exact known enUS target-name/object/spell correspondence, one actual GameObject source across all loot slots, and matching observed material IDs at LOOT_READY. Mining2576 and Herbalism2368 are the only methods. SENT expires after10seconds; success/loot must be within2seconds in either plausible order. Same owner/build/map, actual clocks, conservative normalized displacement<=0.005, combat/secret/clear/session/competing cast/loot guards apply. No LOOT_OPENED requirement. Unknown targets/locales/sources, corpse/container/multiple GUID loot and protected observations skip recording. Full source/cast/owner GUIDs exist only in transient correlation state; the per-character discovery DB contains no GUID. Existing core character capture identity is unchanged.

Private store retains128 records, snapshot exports64 recent records, deterministic public spot identity deduplicates recurrences/materials. Recording pause survives login; clear requires deliberate native two-stage confirmation and retires pending casts, old confirmations and map actions. Clear also retires the previous captured map until the coalesced replacement, preventing an intervening map refresh from resurrecting old findings. Native DB is separate from trimmed exports. Transient missing login/APIs do not destroy retained valid history. Unsupported event shapes remain unavailable; synthetic herbalism success is not real-client certification.

## Exact contracts for the desktop task

### Source/profile gathering schema

Independent `src/core/gathering-data.cjs`, no import of root state validation:

- `normalizeGatheringCapture(value,capturedAt)` accepts undefined or the exact raw block; `capturedAt` is a canonical ISO character-capture date. Raw block/record observedAt are integer epoch seconds0..253402300799. Returns a detached profile block with canonical ISO dates. Throws on malformed present values; parseSavedVariables catches only this optional block and omits it atomically, retaining valid core character data.
- `validateGatheringProfile(value)` accepts undefined or the exact profile block with canonical ISO dates. Returns detached normalized fields; malformed backup/state data is rejected strictly. Root validation additionally requires block date<=profile.source.updatedAt when a source exists.
- Additional focused helper `intersectGatheringProfiles(left,right)` is used only by equal-second profile/roster merge. Missing on either side yields undefined. Otherwise it retains only identical shared records and marks limited when history was reduced. This prevents a same-second clear/missing block from being undone by an old tie. New ambiguous same-second records may wait for a later capture. Newer captures replace the whole optional block; no stale-row merge.

Exact raw/profile block keys:

```text
{ schemaVersion:1, status:'available'|'unavailable', recording:boolean,
  observedAt:epoch|ISO, limited:boolean, totalRecords:integer0..128,
  records:Record[] (dense, <=64) }
```

Exact Record keys:

```text
{ id:string<=160, method:'mining'|'herbalism', entityId:positiveInt,
  itemIds:positiveInt[] (dense, 1..8 unique), mapId:positiveInt,
  x:finite0..1, y:finite0..1, observedAt:epoch|ISO,
  clientBuild:digits.digits.digits.digits, name:string1..120,
  evidence:'observed-gathering-loot', precision:'recorded-standing-point',
  approximate:true }
```

Public IDs are ordinary positive integers<=2147483647. Build components are1..3digits/1..3digits/1..3digits/1..8digits. Text rejects control characters. Unknown keys, accessors/nonplain objects, sparse/extra-key arrays, duplicate IDs/materials and invalid bounds/enums fail atomically. Every record date<=block date<=character capture. totalRecords>=exported length; a difference requires limited=true. Available/empty, unavailable/empty, unavailable with dated retained history, limited history and a missing block are distinct; none means no resources exist.

Record ID is exactly:

```text
wowf:<method>:<entityId>:<mapId>:floor(x*10000+0.5):floor(y*10000+0.5):<clientBuild>
```

No name, character/source ID, GUID, command, quantity, active/spawn flag or private metadata in this identity. Native DB is per-character `{schemaVersion:1,recording:boolean,records:Record[]<=128}` with epoch dates; it does not persist the ephemeral owner identity.

### Pure native map DTO

`BackstageForeverBuildMap(character,{mapId,layers?,goal?})` is data-only. `layers` boolean keys are exactly **quest,herbs,ore,supplies,finds,olderReferences**; first five default on, olderReferences defaults off. `goal` uses the existing native flat numeric **skillLineId,recipeId,crafts** options. Native map reads `BackstageForeverHUDSettings.profession`; desktop settings are independent.

Result: `{version:1,status:'ready'|'empty'|'unavailable',mapId,points,counts,limitations}`. Native absent values are nil, not JS null. `counts={quest,material,find,total}`. Points are detached, <=128, exact same-map only, ordered reviewed quest-plan results, relevant sources, then recent own finds.

Each point has `id,kind('quest'|'material'|'find'),mapId,x,y,title,detail,evidence,precision,qualification,itemIds,sources`. Optional `layer` is herbs/ore/supplies/finds; quest has no layer field. Optional `clientBuild,observedAt` (native epoch) / `observedOn` (historical YYYY-MM-DD), and **only quest points** have the unchanged existing `questStep`. Precision is game-marker/approximate-reference/recorded-standing-point; qualification is game/qualified-historical/browse-only/own-recorded. No generated material/find command or private ID.

- Quest point ID `quest:<questId>:<phase>:<mapId>`. questStep remains Plan's authoritative DTO/command; reference-title/phase/build/area/clue qualifications are preserved.
- Material identity includes kind/entity/method-spell/build/map/exact serialized coordinate tuple. Identical Copper positions union sorted2770/2835, <=8material IDs. `sources` contains whitelisted `sourceKey,kind,entityId,referenceName,gatherSpellId,clientBuild,observedOn,qualification,reason,positionEvidence,exactObjectPosition,limitedStock,positionCountInOriginal,contributingFiles,observedLootWindows,lastSeen,context` where established. No raw pack/template/code/URLs. Historical material qualification comes unchanged from actual Profession acquisition DTOs.
- Find ID `find:<public record id>`, qualification own-recorded even for older dated own history; `sources=[{entityId,method}]`. History is never promoted to active/current resource presence.

Dependencies: reviewed `BackstageForeverPublicFacts={public,field,number,text,sequence,collection,stamp}`, unchanged `BackstageForeverBuildPlan`, actual `BackstageForeverBuildProfessionCoach` shoppingRows.acquisition/ownedProfessionChoices/gatheringReference, existing Acquisition pack and the data-only gathering validator. No invented profession/recipe DTO or extra data compatibility source.

### Native session/UI helper additions

- `BackstageForeverGatheringSnapshot(character)` returns the raw whitelisted block; capture marks records/itemIds as JSON arrays, including empty records.
- `BackstageForeverGatheringSession(event)` handles central capture login/logout retirement/rebinding.
- `BackstageForeverGatheringValidateSnapshot(value,capturedAtEpoch)` is the pure strict native block validator shared by MapPlan; returns detached block or nil.
- `BackstageForeverGatheringSetRecording(boolean)` changes the current owned preference and requests an ordinary capture.
- `BackstageForeverGatheringClearAction()` returns an owner/generation/combat-guarded confirmation closure or nil. Native map supplies the visible confirmation step.
- `BackstageForeverRequestCapture()` is a focused **no-argument** signal sharing the existing0.25second/generation/combat coalescer. No raw character injection, recursion or forced disk save.
- `BackstageForeverMapUpdate(character)` consumes each current capture; nil retires all owned actions/pins. Failed capture calls nil. `BackstageForeverMapGoalChanged()` refreshes internal current facts after a native HUD save, without a desktop bridge.
- Global `BackstageForeverMapPin_OnLoad(frame)` is defined before XML. XML engine OnLoad mixes **complete MapCanvasPinMixin + owned pin methods before the pool returns**, so native SetOwningMap exists before explicit native pin OnLoad. Native OnLoad then creates visuals. No invented MapCanvasPinTemplate or XML enter/leave scripts. Owned release calls native base first, then discards row/actions/tooltip; only a tooltip still owned by that pin is hidden. Right-click map navigation remains native.

`BackstageForeverMapSettings` per-character stores bounded enabled/details/layers preferences. The passive provider checks frame/base/template availability, attaches idempotently, explicitly refreshes already-visible maps, and refreshes on natural map/show/goal/capture events. Hide/combat/logout/source invalidity retire owned pins; no polling/forced map/addon opening. Deliberate callbacks recheck owner/build/map/generation/point identity. Quest actions reuse Guide unchanged; historical/personal markers use supported public C_Map/UiMapPoint only, otherwise tooltip coordinates remain visible. Native labels preserve UTF-8 and escape pipes after truncation. Gold/native controls, class/faction border accent and readable layer initials use only in-client resources.

### GameSync receipt and twelve-file installation

Status adds **loadedGatheringSchema:null|1**. It is1 only when a valid schema1 block for the selected active saved character was actually read from a connected source in the current refresh. Cached unreadable data, missing/malformed blocks, disconnect/reset/source loss and arbitrary imported/restored profile state cannot grant it. An available or unavailable empty block may grant1: this proves **new-format saved capture**, not native rendering/API support. Existing captureVersion0.12.3 remains unchanged.

Actual owned files in order: TOC, Reference.lua, Plan.lua, Coach.lua, Acquisition.lua, Profession.lua, **Gathering.lua, MapPlan.lua, Map.lua, Map.xml**, capture BackstageForever.lua, HUD.lua (all use full BackstageForever prefixes). TOC adds per-character GatheringDB/MapSettings. XML is in extraResources, LF policy, exact installer/current/repair source/setup/package lists. Temporary GameSync removes all four new files, restarts, compares restored contents and preserves Foreign.lua. Packaged acceptance fixture now removes/rechecks all four; **not executed/built here**.

## RED -> GREEN evidence

All logs below are preserved under `work/`; old failures were not overwritten.

1. `node --test tests/gathering-data.test.cjs tests/gathering-sync.test.cjs tests/addon-gathering.test.cjs tests/addon-map.test.cjs`: initial **1pass/13fail**,14tests (`native-map-red.txt`), missing native/schema/XML/connected receipt behavior. Existing privacy allowlist passed. Initial full foundation GREEN **15/15** (`native-map-initial-green.txt`).
2. `node --test --test-name-pattern="actual capture emits" tests/addon-gathering.test.cjs`: **0pass/1fail** before source session/snapshot/coalescer/failed-map retirement integration (`native-map-capture-red.txt`). Covered in later GREEN.
3. `node --test tests/gathering-sync.test.cjs tests/addon-gathering.test.cjs tests/addon-map.test.cjs`: **14pass/3fail**,17tests (`native-map-retirement-red.txt`), competing loot before success, same-second clear resurrection and unreadable cached feature receipt. All four feature files subsequently **20/20** (`native-map-retirement-green.txt`).
4. `node --test --test-name-pattern="actual character capture accepts" tests/addon-gathering.test.cjs`: **0/1fail ->1/1pass** (`native-map-vector-red.txt`, `native-map-vector-green.txt`). Both the new collector and existing current capture now use guarded vector properties or supported GetXY, rather than a table-only method assumption.
5. `node --test --test-name-pattern="native clear requires" tests/addon-map.test.cjs`: **0/1fail** (`native-map-clear-red.txt`): confirmed clear could redisplay the old capture before its replacement. Clearing now invalidates current map facts. That test plus three schema tests **4/4pass** (`native-map-clear-green.txt`).
6. `node --test --test-name-pattern="native base releases" tests/addon-map.test.cjs`: **0/1fail** for base-release ordering (`native-map-release-text-red.txt`); after that correction, **0/1fail** for an escaped pipe pair split by truncation (`native-map-tooltip-red.txt`). Both corrected before the final safety GREEN below.

Expanded actual affected suite (before only the final two narrow native release/text regressions) **208/208 PASS**,0fail/skip/cancel,58504.5265ms (`native-map-final-green.txt`):

```powershell
node --test --test-concurrency=1 tests/gathering-data.test.cjs tests/gathering-sync.test.cjs tests/addon-gathering.test.cjs tests/addon-map.test.cjs tests/addon.test.cjs tests/addon-live.test.cjs tests/addon-lifecycle.test.cjs tests/addon-coach.test.cjs tests/addon-profession-coach.test.cjs tests/addon-preparation.test.cjs tests/game-sync.test.cjs tests/core.test.cjs tests/companion-request.test.cjs tests/companion-service.test.cjs tests/game-roster.test.cjs tests/company-ipc.test.cjs tests/recovery-store.test.cjs tests/recovery-ipc.test.cjs tests/recovery-checkpoints.test.cjs tests/startup-recovery.test.cjs
```

The brief's `tests/companion-context.test.cjs` does not exist. Parent explicitly approved actual **companion-request.test.cjs + companion-service.test.cjs**, which exercise CompanionContext/request ownership. No phantom test was created. Earlier covering pass of the same expanded command was206/206; the vector and confirmed-clear cases bring it to208.

Final affected native/schema/session safety suite after release/text fixes and synthetic positive/negative herbalism probe: **41/41 PASS**,0fail/skip/cancel,19371.6797ms (`native-map-final-safety-green.txt`):

```powershell
node --test --test-concurrency=1 tests/gathering-data.test.cjs tests/gathering-sync.test.cjs tests/addon-gathering.test.cjs tests/addon-map.test.cjs tests/addon-live.test.cjs tests/addon-lifecycle.test.cjs
```

Tests execute actual Fengari modules and assert **both status0 and empty stderr**. The native map fixture uses AddDataProvider->OnAdded(no implicit draw), explicit refresh, engine callback->SetOwningMap->OnLoad->OnAcquired->SetPosition/SetPinPosition, release/base cleanup/reuse, right-click passthrough, map/hide/show/combat/source/goal changes and stale actions. Actual XML is parsed with System.Xml namespace/template/OnLoad/load-order checks. It is not only a list projection test.

Collector tests cover both event orders/no OPENED, repeat and competing READY, unknown/corpse/multi-source/locale/method/name/material, secret/missing vector APIs/clocks, owner/map/build/displacement/combat/failure/timeout/session/clear,128store/64export/dedup and pause. Actual source capture budget test retains all26character identities/current100recipe workshop/older quests/XP/bags, trims optional history first, verifies actual parseable block schemas and unchanged<1MiB/<=200000parsed-value budgets. Retained native history is not trimmed. Privacy probes use unique discovery name, material2770, GUID and unique history coordinates0.123456/0.654321 against actual approvedProfile/profileContext/support projections. Strict backup/checkpoint restore/import/delete/reset/source guards are covered; no restore creates a connected receipt.

## One isolated source GUI gate

`node scripts/setup-smoke.cjs` **PASS** (`work/native-map-setup-green.txt`). Actual Electron main/preload/renderer with prebootstrap provider/model/key/voice/game-process/clipboard/shell fakes and app/reference starts off. Verifies first-run preparation, exact12file readback, files-prepared receipt=null, synthetic saved empty capability-unavailable gathering receipt=1, valid character/quest/XP UI, existing navigation/unsent draft/reduced-motion/setup flow, source replacement receipt=null. Counters **providers0/keys0/game0/external0**. No native game was opened.

Dated final folder `.superpowers/sdd/native-adventure-map-captures/2026-11-11T08-29-13-928Z/`: two PNGs + manifest. The saved-character screenshot was visually inspected; existing art, readable source/quest/progress and existing Adventure tabs remain, no Map placeholder. The first prebootstrap fixture attempt used app.getAppPath after moving its wrapper to a temporary directory; its postlaunch test require failed. Corrected the fixture's explicit repository require path, retaining the failed dated directory and `native-map-setup-initial-fixture-failure.txt`. This was not a product failure or live-service fallback. Only owned resolved temporary test directories were removed.

SHA256 final receipts:

- manifest.json: `fd080b7b42b933de88a753f8ff37078c68b99e1c9bc7d28e6ab2ba45d558bd8f`
- setup-files-prepared.png: `1a2608b1f8330868457b02bfaf7e7dc2f6d4fc60dde5f8569efffdbb9ddf4402`
- setup-new-format-saved-character.png: `4e2d6684053d1eb29ad68ca1615c49c68047ab92145e8693395139e14176994b`

## Primary evidence, preservation and remaining gates

Primary70862 UI/API evidence remains the locally inspected `work/proactive-research` files pinned to Gethe/wow-ui-source **9dc84f0d3bbae1768ac3405b3716000bd93eda06**, especially MapCanvas_DataProviderBase.lua, Blizzard_MapCanvas.lua, MapDocumentation.lua, UnitDocumentation.lua and LootDocumentation.lua. The research report `work/proactive-data-research.md` records newer70888 drift and the firsthand Mining2576/Copper observation from ForeverPlusPlus **76bcfd777dedbb2dc098e18349f725d409209007**. These are reference data, not shipped client code/assets or operational instructions. Acquisition keeps the approved existing EG source pin **23f9636486d3d60479dc0bcee2356053c33faf2c** and CC-BY attribution. Current own event identity may establish a dated current-build record independently of older reference coordinate sets; no old position/context/rank is imported into it.

`native-adventure-map-captures/task-1-immutable-receipts.json` rechecks **22 existing data/generated reference files byte-for-byte** against the previous exact byte manifest. Plan and package-lock Git blobs unchanged; exact Guide command body unchanged; package version/dependencies unchanged. Native XML resource filter/TOC/owned parity, strict independent module imports, source diffs and `git diff --check` reviewed. JS syntax checks passed. No acquisition/reference bytes or SDK dependencies changed.

Owner must still naturally open the actual current-client map and inspect pixels, positions/zoom/tooltips/filters/persistence/combat/source behavior; observe real supported mining and herbalism; assess performance and normal SavedVariables writes. Synthetic source/provider fixtures and a saved-format receipt do not establish these facts. Parent owns fresh independent native SPEC/QUALITY review, desktop Map implementation and final comprehensive/full-suite/build/packaged/outside-checkout release gates. Source0.12.3/1.0held. Sole source/GUI ownership releases only after this report is force-added and the scoped commit succeeds.

## Native review correction wave — 2026-11-11

Base `90092e5fa86b5f245803005aea782e45ac3b0c3c`; addressed both P1 findings from `work/native-map-review.md` in one scoped wave.

- **Quest action boundary:** Map now validates the selected quest command against the exact row identity, quest ID/phase, destination/map/coordinates and current captured build, then removes only the `/bf ` prefix before calling the actual Guide. The existing Plan command format and Guide implementation/protocol remain byte-for-byte unchanged. Existing owner/map/build/generation checks and Guide's fresh quest/phase/combat checks remain active. Tests load the real Guide and dispatch the actual pin click: a valid click sets the selected waypoint; forged command identities/coordinates/build and stale quest/owner/build/generation/combat paths do not. A fresh replacement pin recovers.
- **Complete collector context and persistence fence:** Each event gathers and validates its required owner, build, monotonic clock, epoch and map/vector once before owner/store mutation or correlation math. The candidate record is independently validated before reading retained history and revalidated after material union, before the single retained-record assignment. A nil/secret/malformed required observation retires that interaction without appending or resetting valid history. An unexpected nonempty owner in the same Lua session also retires correlation and cannot adopt or erase the existing per-character journal; restoring the valid owner permits later recording. No schema, public helper, point DTO, resource ownership, data-pack, dependency or source version contract changed.

Focused regression command, run against the unfixed source first and again after the fixes:

```powershell
node --test --test-name-pattern="review P1" tests/addon-map.test.cjs tests/addon-gathering.test.cjs
```

**RED: 0/5 pass, 5 fail**, 652.1863ms (`work/native-map-review-fix-red.txt`). **GREEN: 5/5 pass, 0 fail/skip/cancel**, 599.9371ms (`work/native-map-review-fix-green.txt`). Both real-Guide regressions and all three actual-collector regressions check Fengari status and empty stderr. Collector coverage begins with valid retained history, reproduces the second-read nil epoch, verifies one required API read per event, exercises nil/secret/malformed epoch/GetTime/build/owner/map/vector observations, and proves later valid recording recovery. The intermediate 4/5 run is retained in `work/native-map-review-fix-intermediate-tie-fixture.txt`: its remaining assertion assumed insertion order after a same-epoch snapshot, although the existing validator sorts ties by canonical ID. The corrected assertion checks that the original ID survives anywhere in the retained records, plus exact total and valid epoch values.

Requested covering run:

```powershell
node --test --test-concurrency=1 tests/addon-map.test.cjs tests/addon-gathering.test.cjs tests/gathering-data.test.cjs tests/gathering-sync.test.cjs tests/addon-live.test.cjs tests/addon-lifecycle.test.cjs
```

**46/46 pass, 0 fail/skip/cancel**, 24823.1927ms (`work/native-map-review-fix-covering-green.txt`), consisting of the prior41 plus5 new regressions. Source/test diff self-review and `git diff --check` passed. This wave modifies only Map.lua, Gathering.lua, their two test files and this report; the existing Plan, Guide/capture, HUD, schema, data/reference, XML/TOC, package/dependency and artifact files remain unchanged from the base. No repeated208/full-suite/GUI/build/packaged or live-client operation occurred. Source0.12.3 and1.0held remain unchanged; actual-client acceptance limits above still apply. Parent retains independent re-review and downstream desktop/final delivery gates. Source/GUI/build ownership releases after this report is force-added and the scoped correction commit succeeds.
