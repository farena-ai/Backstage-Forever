# 0.8 Adventure Company design

## Outcome and choice

Provide an attractive company overview of collected characters, persistent shared journeys across alts, quest steps that recognize new observed completion evidence, and a quiet live native bag-space cue. No additional sign-in or AI is needed. Compared approaches: account APIs add authorization/service uncertainty; full crafting guidance lacks verified profession/item acquisition coverage; planning over already collected observations provides useful automation now. Choose the third. This delivers the account-wide planning foundation of milestone 0.8, not all profession/crafting/auction research.

Reuse the 0.7 artwork, safe setup, saved-character imports, native lifecycle and signed update pipeline. Version 0.8.0. Reuse this checkout and a feature branch. No new production dependency or generated art is required.

## Boundaries

- No gameplay inputs, movement, targeting, combat decisions, automatic markers, purchases, messages, game memory, protected API bypass, forced reload/logout or paid background AI.
- Native cues use existing supported readiness observations outside combat and work with the desktop closed. The desktop and shared journeys remain last-saved, not a continuous feed.
- Preserve source priority, build qualification, unknown data, private notes/goals, intentional selection/follow-off, reset/import cancellation, provider credentials and all 0.7 acceptance guards.
- No new account linking, inventory/profession collection, recipe/price database or gear-upgrade assertions. Existing equipment and bag observations may be displayed as facts.
- All tests use synthetic temporary characters/game folders, fake process launches and local protocol fixtures. No user game/profile/credential edits, paid inference or installer execution. No scheduled release watchers.

## A. Journeys and progression core

Add focused `src/core/journeys.cjs` for strict journey validation, deterministic mutations and reconciliation; `src/core/company.cjs` for a pure local company read model. Keep root state schemaVersion 1, adding optional `journeys`, normalized to an empty array for old states/backups. Limit to 20 journeys, 50 steps each; strict keys, bounded nonblank titles/text, unique parent/step IDs, finite timestamps and validated profile references. A missing referenced profile is an orphan to explain/reassign, not grounds to drop the plan or attach it to another character with the same name.

Journey shape: `{id,title,createdAt,steps}`. Step shape: `{id,text,done,profileId,quest?,observed?}`. `profileId` is nullable for manual steps. IDs are generated in the main process. Journey titles <=100 characters, step text <=300. Stored journey timestamps (`createdAt`, `baselineAt`, non-null `baselineTurnInAt` and `observed.at`) are canonical ISO UTC; numeric capture-history seconds are normalized at the boundary. Manual completion is explicit. Quest completion evidence is distinguished from manually checked steps.

Quest metadata records `{id,build,sourceHash,baselineAt,baselineCompleted,baselineTurnInAt}`: exact positive quest ID; validated client build; SHA256 of the profile's stable addon source identity; baseline saved source timestamp; completed-ID membership only if a full known list exists (otherwise null); newest observed turn-in time for this ID, or null. Quest steps can only be added from the chosen current saved addon quest log with a known build/source/time. Server selects title and baseline; renderer cannot forge evidence. Existing pending/completed quests remain separate from the shared checklist.

Reconcile using the same profile ID, stable source hash and exact build, only after a strictly newer saved source timestamp. Latch automatic completion only from (1) a new observed recent turn-in for this ID after both baseline snapshot/time and prior turn-in, or (2) a transition from known-absent to known-present in complete sorted completed-ID lists. Unknown-to-known membership is not a transition. A ready-to-turn-in quest is not yet turned in. Missing active quests, stale/older/equal saves, other characters, changed identity/build or merely historical completion never prove a new completion. Repeatable quests already completed at baseline require a new turn-in event. Do not use app wall-clock time as the game baseline.

`observed` is a durable latch `{at,via:'turn-in'|'completed-id'}`. It survives later history pruning or unavailable observations and is labelled with its build/date; do not claim current-build completion from old proof. Manually unchecking cannot erase observed evidence. Remove/re-add a quest to track another run. Reconciliation must run at the owning state-write/load boundary so proof does not disappear when bounded history rotates; avoid full-history scans per step (sorted membership or per-profile reuse). Never mutate caller input or acknowledge unknown evidence.

Existing profile goals remain unchanged. Shared journeys are local/private and included in deliberate backup export/import, never automatic AI/public context. Old backups import with empty journeys after the existing replace confirmation; malformed plans preserve current state/credentials. Deleting a character preserves its orphaned steps; manual reassignment clears incompatible quest tracking rather than rebinding evidence silently.

## B. Narrow desktop integration

Expose `companyBrief()` (no arguments) and `journeyAction(input)` through isolated preload and trusted main handlers. A focused company IPC module may own validation/mutation wiring. Mutations are synchronous against latest validated state; existing reset guard applies. Actions: create (blank, quest-session or dungeon-prep template), rename/remove journey, add manual/observed-quest step, edit manual text/assignment, set manual done, remove step. Reject extra/invalid fields and renderer-created IDs/proof. Templates are editable user checklists, not factual dungeon eligibility, gear scores or class-role claims.

Return `{state,company}` after mutation, with `companyBrief()` returning the company read model. Profile/ordinary saveState edits cannot overwrite journeys, including the legacy no-base call. Snapshot merges, provider changes and deliberate selection retain them; explicit confirmed backup import/reset are the replacement boundaries. Restore/load must reconcile safely with its own current validated evidence. No implicit AI call.

The company model contains bounded cards: local profile ID, identity/class/faction, level, saved timestamp/freshness, known quest and ready counts, known bag-space/equipment facts, pending private-goal counts and up to three goal previews; no notes, source IDs, paths, credentials or account identifiers. Totals state coverage (observed quest logs versus unknown/manual profiles). Character recommendations are deterministic explanations such as ready turn-ins or unfinished goals, not optimal-route or account completeness claims. Include journey steps with computed pending/ready/observed/manual/orphan/build-mismatch states and source labels. A suggested character never changes the active selection until an explicit player click.

## C. Beginner company interface

Add **Company** navigation and a focused `company.js`/`company.css` renderer using existing original class/faction/citadel art and readable dark controls. Keep the common first-screen action visible at 1000x700. Show company totals, actionable character cards, source/save labels and shared journeys. Cards open that character's Adventure through the existing intentional-selection path, pausing following as appropriate; merely viewing Company does not change following.

One simple create-plan action offers a blank plan, quest-session checklist or dungeon-preparation checklist. Add a note or choose a character then a quest from its saved log; no numeric quest ID entry or AI vocabulary required. Checkbox/assignment changes save immediately; existing text edits save on blur, with visible errors/retry and drafts retained. Product removal confirmation should follow existing UX without introducing an agent approval gate. Completed observations have a clear source badge and cannot be mistaken for manual checks. Unknown/build mismatch/orphaned tracking gives an honest next action, not a reload demand. Offline/manual use remains useful with no profiles/provider/game connection.

Preserve dirty drafts and focused fields on timestamp-only/poll updates; actual state changes refresh evidence without stealing another character's text. Guard async company reads/mutations against navigation, selection, import, reset and stale replies. Use the existing state-mutation epoch/queue and don't replace newer state with delayed results. Load actual new renderer helpers in VM fixtures. Do not grow the main renderer with a second planning system; extract focused display/interaction helpers.

## D. Quiet native preparation

Extend existing planner/HUD files without adding managed resources. Use validated current `readiness.bags` only: total must be >0, integer free must satisfy 0<=free<=total; at <=2 free slots show one quiet, source-honest bag-space line. Missing/invalid/0-of-0 data produces no warning. No toast, sound, repeated reminder, automated action or new cloud inference. Current character/lifecycle/combat/hide/collapse behavior remains. Clear immediately when valid space improves or identity/session changes; a failed new capture cannot retain the previous character's cue.

Reserve its own native line so long quest titles/details cannot hide existing waypoint source/phase labels or controls. Do not weaken three-step bounds, source qualification or five-resource staging/repair. Existing bag events feed the normal coalesced out-of-combat capture. No new API compatibility claim; actual client rendering remains a player-led acceptance step. Parent versions TOC/capture to 0.8.0 after native task.

## Acceptance and release

TDD for state migration/strict bounds, newer-evidence completion, repeatables, unknown history, build/identity changes, pruning/durable latches, orphan handling, concurrent profile/import/reset edits and private context exclusions. Real Electron company flow covers templates, notes, quest selection, saved-progress reconciliation, actual character switching, follow-off, dirty drafts, keyboard/reduced motion, compact layout, malicious text, no-profile use, export/import/restart and late-result reset/restore races. Lua fixtures cover bag cue bounds/clear, character switches, missing APIs, combat/coalescing and reserved source/phase geometry.

Run full unit/audit, offline reference reproduction, all existing eight source flows plus company flow, normal and true Windows short-path variations for touched lifecycle/IPC fixtures, fresh NSIS and packaged exact source/data/key plus five-addon byte readback/repair. Independent task reviews and a final whole-branch review precede signed publication. Public installer/source/manifest/checksum downloads are independently authenticated. If BF is already open, prepare its normal update but leave installation to the player. All real-client/paid-provider/installed-upgrade limits remain explicit.

Self-review: user benefit is cross-character planning with evidence-driven saved progress and a minimal live prep cue. No new data source, autonomous game action or hidden desktop transport is implied. All source/clock/privacy constraints are explicit; no placeholders or mandatory design-approval stop remain.
