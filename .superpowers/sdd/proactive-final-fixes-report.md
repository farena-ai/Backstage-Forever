# Proactive Adventure final scoped fixes — I1 / M1

Date: 2026-11-11. Branch: `codex/pre-1.0-product-polish`.
Reviewed/fixed base: `6fb8907891484dd846f58f16d97ca29a5dc58948`.
Scope: the complete I1/P2 and M1/P3 findings in `work/proactive-final-review.md`, under the existing binding Profession design. Sole source/GUI ownership; no delegated agents.

## Design and implementation

The smallest robust correction is to carry the established training qualification in each affected craft's `reason`: the real Adventure renderer displays that field on both its primary and alternative cards. Adding only a detail would miss alternatives; changing all rendering or composing a new planner would expand scope unnecessarily. The existing owner lookup, authority/readiness gates and ordering remain intact.

`src/core/profession-coach.cjs` now exports the internal pure `professionCapQualification(profession)` helper, extracted from its existing policy without changing its public model. It returns the exact existing text, `Check training before expecting rank progress.`, only for positive observed trained caps with `rank === maxRank`. Its callers establish saved-source/date authority before use. Profession retains its existing dated gate and the same recommendation fields/values. This is an internal CommonJS helper export, with no new IPC, preload, DTO, schema or native interface.

`src/core/adventure-coach.cjs` uses that helper on the actual owner of each ready recipe and appends the result to the reason. Under-cap owners retain the exact old reason. The craft detail still says skill-up/output are not guaranteed and asks players to verify current bags. No trainer eligibility, cost, unlock, higher cap or guaranteed progress is claimed. No mode rank, quest authority/order, signature inputs, material/recipe readiness or partial-catalog semantics changed. The separate cap opportunity is unchanged and is not relied upon by the regression.

Renderer source is unchanged. No broad planner refactor, API/DTO/schema/native/dependency/data/version change was made.

## RED → GREEN evidence

Tests were written before production edits. Exact RED command:

```powershell
node --test --test-concurrency=1 --test-name-pattern="each visible craft|mounted Adventure primary" tests/adventure-coach.test.cjs tests/adventure-coach-renderer.test.cjs
```

RED exit 1: **2 tests, 0 pass, 2 fail**. Both failed for the intended missing cap qualification, not setup or syntax: core `adventure: craft-ready:100` and actual mounted renderer `adventure: card 0` both received only `Saved carried materials cover one learned skill-up-capable recipe attempt.` where the explicit check-training qualification was required. The mounted Electron/Chromium host launched successfully and the actual visible card assertion failed.

After the minimal production change, the exact same command exited 0: **2 tests, 2 pass, 0 fail**.

Exact covering command:

```powershell
node --test --test-concurrency=1 tests/adventure-coach.test.cjs tests/adventure-coach-ipc.test.cjs tests/profession-coach.test.cjs tests/profession-coach-ipc.test.cjs tests/addon-coach.test.cjs tests/adventure-coach-renderer.test.cjs
```

Result: exit 0, **43 tests, 43 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**. Existing native/desktop quest ordering, bounded quest pools, rank/date/readiness/partial catalog, native command ownership and strict IPC checks remain green. No full suite, repeated historical GUI suite, build or package gate was run.

## Per-card regression coverage

`tests/fixtures/adventure-coach-cap.cjs` supplies three fresh learned skill-up-capable recipes (100–102), each needing one item 765, ten complete fresh carried units, and an owned Alchemy observation at 75/75. The known recipe catalog is deliberately partial; valid entries remain useful. There are no quests and no bag pressure. Both core and real DOM tests require exactly the same three craft IDs/kinds, so a fourth separate cap row cannot rescue the check.

Each test covers Adventure, Professions and Questing, the full set of applicable modes. For every mode it checks:

- 75/75: primary and both alternative craft reasons include the explicit cap qualification.
- 74/75 control: primary and both alternatives remain craft-ready without the cap qualification; ordinary crafting remains available.
- Mixed owned professions: recipe 101 belongs to 50/75 Blacksmithing and stays unqualified while recipes 100 and 102 remain 75/75 Alchemy and each retain the qualification.

This is nine model/DOM scenarios and 27 card assertions per matrix, including both positive and negative owner-specific qualification checks. All retain the no-guarantee craft detail.

`tests/adventure-coach-renderer.test.cjs` runs the actual `interaction.js` and `adventure-coach.js` in a mounted, isolated hidden Electron/Chromium DOM using the existing `fixtures/adventure-map-dom.cjs` host. It feeds actual core outputs through AdventureCoach's asynchronous host interface, checks the requested mode, and asserts each primary/alternative card and its displayed reason are visible, using `innerText`. It does not inspect source patterns or replace the renderer with a mock. The host blocks non-file requests, uses a temporary synthetic user-data folder, and never starts the product bootstrap, provider, updater or real game. Since the renderer itself did not change and this actual DOM matrix exercises the affected visible fields, no additional focused Compass GUI run was necessary. Full product GUI/layout and actual in-client acceptance are not claimed.

## Current operational documentation

Verified `src/core/game-sync.cjs` OWN and the actual addon TOC: twelve files (TOC, Reference, Plan, Coach, Acquisition, Profession, Gathering, MapPlan, Map Lua, Map XML, capture, HUD).

- `README.md`: both current eight-file claims now say twelve.
- `docs/GUIDANCE.md`: Open Professions / Adventure → Professions replaces Open Preparation under Plans; six-file claim now says twelve.
- `docs/LIVING-COMPANION.md`: eight-file claim now says twelve.
- `docs/PREPARATION.md`: current ownership is twelve, with the complete manifest-aligned list.
- `docs/GETTING-STARTED.md`: current six-file claim now says twelve.
- `docs/FOREVER-DATA.md`: acquisition is the offline reference now consumed by bounded desktop/native profession/map models, and its data-only Lua export is loaded through the TOC and owned install/repair manifest; historical/unknown qualifications remain explicit.
- `docs/THIRD-PARTY-NOTICES.md`: the matching bounded consumers/load-list connection is current; attribution/license/source facts are retained.

A focused search of these seven files found none of the identified stale six/eight managed ownership, Open Preparation, following-consumer or no-runtime/load-list phrases. Historical dated specs/plans/reports/failed receipts were retained unchanged. Data, raw originals, acquisition export, locks, licenses, attribution-pack bytes and all native files were untouched.

## Self-review and release of source/GUI ownership

Reviewed the exact production diff, all test/fixture additions and all seven current-help edits. Confirmed each craft uses its own owner, source/date authority remains outside the helper, public model shapes remain stable, the separate cap row is not used to satisfy the regression, and there is no new action/provider path. `git diff --check` passed; Git reported only pre-existing Windows line-ending normalization notices for touched source/test files, with no whitespace errors.

No real player/game/input/auth/accounts/audio/paid/OS/installer/watchers/publication operation occurred. No parent `work/proactive*` packaging helper was edited. Source stays **0.12.3 preview/local** and **1.0 held**. Existing sealed and failed artifacts remain immutable.

This report is included in the scoped fix commit by explicit force-add because `.superpowers/` is ignored. Final commit identity and tracked worktree cleanliness are reported in the handoff. Source/GUI ownership is released after that commit. Independent bounded delta review and the parent's one final full-suite/raw/offline/genuine-8.3/Windows-build/outside-repo SDK-peer/twelve-file/new-feature-review-ZIP gates remain outstanding; these focused passes do not approve those gates or actual client behavior.
