# Adventure Company 0.8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task: one implementer at a time, independent task SPEC/QUALITY review, final whole-branch review. Steps use checkbox syntax. Continue under the user's authorization without an execution-choice approval stop.

**Goal:** Make collected characters and shared plans useful together, recognize newly observed quest progress safely, and add a quiet live bag-space cue.

**Architecture:** Pure bounded journey validation/reconciliation at state ownership boundaries; pure company summaries; narrow synchronous trusted IPC; focused renderer; existing native planner/HUD readiness data. Desktop remains last-saved, native cue live outside combat.

**Tech Stack:** Existing Electron/Node, vanilla JS/CSS, Lua, node:test/Fengari and Playwright. No new production dependencies.

## Global constraints

Read the full `docs/superpowers/specs/2026-11-09-adventure-company-v08-design.md`; its data/proof/privacy/lifecycle/resource and UX constraints bind every task. Reuse current checkout/feature branch. No user files/game inputs/paid inference/real launch/installer execution. Keep exact data pack, update key and provider protocols unchanged. RED precedes production changes. Use canonical temporary fixture roots and bounded deferred hooks; normal plus real Windows short-path variations are required for touched lifecycle tests. Do not weaken existing gates or add scheduled release watchers.

## Task 1: Journey state, mutations and durable observed completion

Files: create `src/core/journeys.cjs`; modify `src/core/validation.cjs`, `src/core/store.cjs`, narrowly `src/core/profile-sync.cjs` only if preservation needs it; create `tests/journeys.test.cjs`, extend `tests/store.test.cjs`, `tests/profile-sync.test.cjs` as necessary. No main/preload/UI/native changes.

Interfaces: `validateJourneys(value)->journeys` (undefined => []); `reconcileJourneys(journeys, profiles)->newJourneys`; `applyJourneyAction(state, action, {now=Date.now(),id=crypto.randomUUID}={})->newState`. Inputs to action/reconciliation use validated root state/profiles; validator has no root-validation dependency (avoid cycles). Reconciliation owns no I/O and never mutates inputs. State validation normalizes optional journeys. Store load/write/export/import/reset preserves/reconciles them at its existing ownership boundaries.

- [ ] Add initial failing validation/migration test before module implementation:

```js
const {validateJourneys} = require('../src/core/journeys.cjs');
assert.deepEqual(validateJourneys(undefined), []);
assert.throws(() => validateJourneys(Array(21).fill({})));
assert.deepEqual(validateState(oldState).journeys, []);
```

- [ ] Run `node --test tests/journeys.test.cjs`; observe missing-module/feature RED, not an incidental fixture error.
- [ ] Implement strict shape/caps from spec. Action types are `create`, `rename`, `remove`, `add-note`, `add-quest`, `edit-step`, `set-done`, `remove-step`; each accepts only its relevant keys. IDs/timestamps/proof are server-generated. `create` accepts title, optional template (`blank|quest-session|dungeon-prep`) and optional profileId. Other actions identify journeyId, and stepId where relevant; add-note takes text/profileId, add-quest takes profileId/questId, edit-step takes text/profileId, set-done takes boolean done.
- [ ] Add failing progression cases before reconciliation: baseline ID known-absent then known-present in a newer same-build/source save => observed proof; ready quest alone => pending/ready; baseline known-present repeatable => no new proof without a later turn-in; unknown-to-known membership => no proof; older/equal timestamps, other character/hash/build, disappearance, future/inconsistent turn-in and missing history => no proof; history pruning after proof => proof remains.

```js
const tracked = applyJourneyAction(stateWithSavedQuest, {
  type:'add-quest',journeyId,profileId,questId:1061
}, {now:1700000000000,id:()=>'tracked-step'});
assert.equal(tracked.journeys[0].steps[0].quest.id,1061);
assert.equal(tracked.journeys[0].steps[0].observed,undefined);
const next = reconcileJourneys(tracked.journeys, newerCompletedProfiles);
assert.equal(next[0].steps[0].observed.via,'completed-id');
assert.equal(tracked.journeys[0].steps[0].observed,undefined);
```

- [ ] Implement exact spec baselines and durable latching. Use binary search on validated sorted completedIds or per-profile reuse; do not copy complete histories into each step. Do not latch a turn-in timestamp beyond the newer saved source timestamp. Manual reassignment of quest tracking explicitly converts to a manual step and clears incompatible quest/proof/done state; orphan references survive.
- [ ] Wire validation/Store migration and reconciliation. Preserve old backups, invalid-import safety, journals and provider credentials; reset yields empty journeys. Export has journeys, never keys. Store central writes prevent proof loss when recent history rotates.
- [ ] Run focused journey/store/profile suites; self-review diff; commit only owned files. Report exact contract/actions/schema/status semantics and RED/GREEN in `work/v08-task1-report.md`; independent task review closes all important findings.

## Task 2: Company model and trusted IPC

Files: create `src/core/company.cjs`, `src/core/company-ipc.cjs`; modify `src/main.cjs`, `src/preload.cjs` and saveState preservation; create `tests/company.test.cjs`, `tests/company-ipc.test.cjs`, `scripts/company-backend-smoke.cjs`; extend provider/privacy fixture if required. No renderer/native/version changes.

Interfaces: consume Task1 action/reconciliation contract. `buildCompany(state,{now=Date.now()}={})->{characters,totals,journeys,recommendation,limitations}`. `companyBrief()` noargs returns model; `journeyAction(action)` returns `{state,company}`. Read exact Task1 report before coding and publish field shapes in Task2 report.

- [ ] Write model/IPC RED first: absent/manual/unknown quest data distinct from known-empty; totals cover observed profiles only; deterministic ready/goals recommendations do not select a character; strict action validation; notes/source IDs/paths/keys absent from read model; root journey data never enters public AI request context.

```js
const company = buildCompany(state,{now:1700000000000});
assert.equal(company.characters.length,state.profiles.length);
assert.doesNotMatch(JSON.stringify(company), /PRIVATE_NOTE_SENTINEL/);
const before=structuredClone(state);
buildCompany(state);
assert.deepEqual(state,before);
```

- [ ] Implement bounded local card facts and journey states, including manual versus observed completion, ready-not-turned-in, unknown history, old save, orphan and changed build/identity. Historical proof stays labelled historical if current identity/build differs. No optimal route, dungeon eligibility or gear-upgrade assertion.
- [ ] Register trusted handlers through existing handle/reset guard. Mutations operate synchronously on latest store state. Ordinary saveState (base or legacy no-base) cannot modify journeys or main-owned captured source/history/quest/build/readiness fields; preserve existing imported evidence and reject new renderer-defined captured fields. The legacy route can use current server state as its merge base. Only GameSync/explicit confirmed backup import introduce captured evidence; import/reset may replace plans. Existing profile edits and snapshots retain plans and reconcile proof. If an older smoke fixture seeds captured data through saveState, adapt that fixture to a main-owned synthetic save/backup restore without removing its existing assertion intent.
- [ ] Add a real source Electron backend RED before main/preload wiring. Use isolated userData and synthetic saves; test create/template/add-quest/new saved completion/pruning, private-journal and credential preservation, stale ordinary save, manual selection/follow, backup/restore/reset and malformed action. Stub process/launch; no actual game/paid call.
- [ ] Run `node --test tests/company*.test.cjs tests/journeys.test.cjs tests/profile-sync.test.cjs` and `node scripts/company-backend-smoke.cjs`; focused normal/true alias variation as relevant. Self-review/commit/report `work/v08-task2-report.md`; independent review.

## Task 3: Company page and easy shared journeys

Files: create `src/renderer/company.js`, `src/renderer/company.css`, optionally focused `company-controller.js`; modify `src/renderer/app.js`, `src/renderer/index.html`; create `scripts/company-smoke.cjs`; update actual helper loading in `tests/renderer-updates.test.cjs` and only genuinely affected old smoke selectors. No core/main/native/provider/version changes.

Interfaces: consume exact Task2 `companyBrief()`/`journeyAction()` report. Return/draft/epoch behavior must use existing renderer state mutation machinery, not a second root state store.

- [ ] Add actual Electron RED for missing Company navigation/first useful content before production. Retain old source flow assertions.
- [ ] Implement original-art company hero, labelled totals, class/faction cards, explicit open-character Adventure action, private goals and saved timestamps, useful no-profile/offline states. Company viewing never changes selection/follow.
- [ ] Add one create-plan path with editable templates, note steps and character/saved-quest choices. Explain tracking starts from the selected saved capture. Autosave text edits on blur; immediate checkbox/assignment updates; preserve drafts and show retryable errors. Observed completion is distinct from manual completion; orphan conversion/reassignment is explicit, not silent rebinding.
- [ ] Exercise delayed reads/actions after navigation/reset/import/selection, dirty fields during newer snapshots, stale mutation responses, pending duplicate clicks, follow-off and private notes. Update actual helper dependencies in renderer VM, not stubs. No background/implicit AI sends.

```js
await page.getByRole('button',{name:'Company',exact:true}).click();
await page.getByRole('heading',{name:/company/i}).waitFor();
assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).state.activeProfileId,originalId);
```

- [ ] Run new source company smoke and affected existing flows; verify keyboard/reduced motion/1000x700 first action/no horizontal overflow/native dropdown contrast. Capture and inspect fictional Alliance/Horde/compact/zero-profile/error previews in `work/v08-ui-evidence/`.
- [ ] Self-review/commit/report `work/v08-task3-report.md`, including actual final command outcomes and screenshot paths; independent review.

## Task 4: Quiet live native preparation cue

Files: modify `addon/BackstageForever/BackstageForeverPlan.lua`, `BackstageForeverHUD.lua`, focused `tests/addon-plan.test.cjs`/`tests/addon-live.test.cjs`. No capture/TOC/version/resources/main/UI changes; parent versions later.

Interface: add pure global `BackstageForeverBuildPreparation(character)->nil|{kind='bag-space',free,total,text}`; nil for missing/invalid/zero-total/non-low bags. HUD consumes existing current capture readiness, genuine current identity and lifecycle.

- [ ] Write Lua-VM RED for missing function and threshold boundaries before changing production:

```lua
assert(BackstageForeverBuildPreparation({readiness={bags={free=0,total=0}}})==nil)
assert(BackstageForeverBuildPreparation({readiness={bags={free=3,total=16}}})==nil)
local p=BackstageForeverBuildPreparation({readiness={bags={free=2,total=16}}})
assert(p.kind=='bag-space' and p.free==2 and p.total==16)
```

- [ ] Implement bounded raw/type checks without API calls. Add one reserved quiet HUD line, no sound/toast/repeated notification/marker/AI. Clear on improved space, missing facts, session/character change and failed new capture; honor combat/hide/collapse/coalescing.
- [ ] Add native geometry/source-phase/action assertions and character/combat lifecycle tests. Existing source rows remain visible with long quest titles/details. No increase to five managed resources or change to reference compiler.
- [ ] Run affected Lua and resource tests, self-review/commit/report `work/v08-task4-report.md`; independent review. Actual current-client pixels/API support remain player-led acceptance.

## Task 5: Parent integrated release

- [ ] Version package/lock/TOC/captureVersion to 0.8.0; gate `test:company-backend` and `test:company` in npm and both CI/release workflows alongside the existing eight flows and offline compiler check.
- [ ] Update beginner/company/journey/privacy/compatibility/addon documentation, roadmap (partial 0.8 delivery versus further data work), changelog/validation and versioned release notes. Use versioned absolute guide links in public notes. No promise of live desktop, all characters/professions, inferred completion or performed live acceptance.
- [ ] Run full unit/audit, ten source Electron gates, real Windows short-path coverage for touched lifecycle paths and new flows, fresh NSIS and packaged exact source/data/key/five-addon checks. Record actual counts only after execution.
- [ ] Strongest available final broad review; one consolidated important-fix wave, focused re-review and rebuild if production changes. Fresh task implementers one at a time and task reviews per SDD.
- [ ] Fast-forward main/tag v0.8.0 and publish via existing signed pipeline under standing public MIT farena-ai/Backstage-Forever authorization; monitor this run in foreground only. Never overwrite a published tag/assets.
- [ ] Download public installer/source/manifest/checksums to sibling `outputs/Backstage-Forever-0.8.0-release`, authenticate pinned signature/exact version/URL/full size/SHA, write beginner activation/verification. If existing BF is open, prepare its normal update and independently rehash its ready cache, leaving restart/installation to the player.

Self-review: every spec section maps to a task; core/IPC/UI names and baseline/proof fields agree; no placeholders, new data sources, gameplay actions or implicit AI. Task1 state proof is independently testable before IPC/UI, native cue is independently testable, final release covers their integration.
