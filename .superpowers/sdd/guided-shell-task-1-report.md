# Guided player shell task 1 report

Prepared before the scoped implementation commit. Base `9f428fe2233afd9b5e0022aafb04b94927f62c0c`; branch `codex/pre-1.0-product-polish`. Sole implementation and synthetic Electron GUI owner; no child agents. Binding shell design/plan, task brief, umbrella, integration report, and TDD/frontend instructions were read in full.

## Completed presentation scope

- [x] Five primary sections, in exact order: Adventure, Quests, Companion, Characters, Plans.
- [x] Two separate secondary actions: Settings and Help. Settings keeps its stable name while its adjacent status reports update state.
- [x] All eleven existing routes remain accessible through visible player controls. Plans contains My plans / Party / Preparation; Settings contains Game connection / AI connection / Updates; Help contains Field guide and the existing support/recovery tools.
- [x] Focused navigation module, original class/faction art and fonts, group emblems, materials, keyboard focus/current states, compact layouts and reduced motion.
- [x] Optional Voice, Memory, quest filters, and reference details; retained disclosure state, visible provider/cost/sharing/memory count, honest pending/error/draft behavior.
- [x] Nine confirmed manual classes plus Other; existing imported/custom values remain selected and unchanged.
- [x] Travel road alternative discoverable at the top, publisher names in ordinary source captions, technical evidence inside How we know, original source/copy/manual-plan ownership preserved.
- [x] Both authorized Task 3 Minor follow-ups resolved: exact stale-choice message allowlist and focused travel module readability.
- [x] Beginner documentation, shared visible-navigation fixture helper, affected legacy fixture migration, and serial CI/release registration of `test:player-shell`.
- [x] Final serial sweep, narrow covering rerun, visual review and precommit verification receipt.

No source display version, release channel, dependencies, artwork, reference facts, addon/native protocol, signing/publication, or installer changes. Version remains 0.12.3; 1.0 is held for owner review. No actual player files, game input, auth, real audio, paid inference, installation, OS settings, watcher jobs, or remote actions were used.

## Interfaces and preservation

`PlayerNavigation` exports `primary`, `group(route)`, `current(route)`, `main(route)`, `secondary(route)`, `subtabs(route)`, `remember(container)`, `disclosure(tool,label,content)`, `reveal(container,tool)`, and `mounted(container)`. `current` returns `{group,label,pageLabel}`. Existing route IDs and `data-nav` actions continue through the original router; its cancellation, queued autosave, source, and owner checks were not replaced. Primary IDs remain adventure / quest-guide / assistant / characters / company. Buttons have explicit accessible names and stable `data-shell-control` identities; native buttons with `aria-current` avoid partial tab semantics. The main landmark and page-heading/skip target remain stable.

`scripts/player-navigation.cjs` exports `navigate(page,legacyId)`, `ensureCompanionTools(page,tool)`, and `routes`. Navigation clicks a visible primary/secondary section and its visible subtab, then checks the actual route and heading. Old display labels are accepted only by this test helper. No hidden legacy navigation, forced clicks, direct route assignment, or production test-only navigation exists. Deliberately queued navigation race fixtures use the actual visible Help/Quests buttons before releasing held saves; awaiting a settled helper there would deadlock the original race, so their existing subsequent route/owner assertions remain.

Voice/Memory/reference disclosure state is volatile and survives ordinary paints/navigation. Current provider/cost and character-sharing controls remain visible; the selected-memory count is also printed beside the composer and in the folded Memory summary. A current reviewed memory draft opens Memory; errors and unsaved review are called out in its summary. Retained chat does not generate a new save token. Folding Voice uses the existing stop lifecycle, fences pending startup and acknowledgement work, stops active fake workers, preserves a visible dictated-draft badge, and reopens an unconfirmed stop error. A focused regression also covers a root paint happening before the browser's queued native toggle event, without letting removed panels cancel a replacement owner.

Adventure's Character guidance shortcut remains available below the Director recommendation so the recommended Start action fits the compact viewport. Group headers and the Preparation/Party compact spacing were adjusted with the original first-viewport assertions intact. Existing destructive dialogs, billing/credential details, manual plan controls, saved source qualifications, native selects, and original held-control/caret protections remain.

`CompanionTravel.render(travel,index,text)` / `mounted(container,messages)` and `CompanionReply.render(text)` / `escape(value)` remain the interfaces. The road jump targets only a card with the current rendered trusted option ID and changes reading position/focus locally. It invokes no game, network, inference, or main action. New-answer start positioning, unchanged-paint/navigation scroll, and expanded evidence retention remain tested. Main-owned opaque choices, source IDs, copying, and atomic manual journey construction are unchanged.

The exact string `This trip choice is no longer current. Ask again.` is allowed only for createTravelPlan/copyTravelGuidance. No arbitrary errors, paths, or message prefixes were exposed. `src/core/travel-companion.cjs` is formatter-only equivalent to the baseline: formatting the old source with the same locally cached formatter produced an exact normalized-text match. The renderer's conventional blocks and split template lines retain escaping and ownership while adding the separately authorized presentation changes. See the two Minor findings in `work/guided-integration-review.md`.

## RED → GREEN evidence

1. `node scripts/player-shell-smoke.cjs`: real Electron RED `11 !== 5` before navigation changes; GREEN after five primary/two secondary grouping. All eleven legacy destinations are exercised through visible controls, with group state and active-character preservation.
2. Same actual fixture: RED `Voice has a discoverable optional disclosure` (`0 !== 1`); GREEN with tool disclosures, initial folded state, open-state retention across paint/navigation, visible costs and selected count, and confirmed/custom class behavior.
3. Same actual fixture: RED `Advanced quest reference controls have a visible disclosure` (`0 !== 1`); GREEN with optional filters/details and ordinary coverage still visible.
4. `node scripts/travel-companion-smoke.cjs`: strengthened real trusted IPC stale-choice assertion RED because it received the generic action/file error; GREEN after only the exact static recovery string was allowlisted. The actual restored/imported same-ID owner retirement still rejects stale choices.
5. Same actual travel fixture: RED `Road alternative has a visible top-level jump` (`0 !== 1`); GREEN after graphical Show road guide. A one-pixel geometric tolerance accounts for fractional browser scroll rounding; the test still requires the alternative's top inside the chat viewport. Original primary-option-at-start, preserved scroll, evidence, source/copy/save and ownership assertions remain.
6. `node scripts/voice-memory-smoke.cjs`: new folded-stop-error RED timed out because closing discarded the unresolved error; GREEN after routing closure through the existing stop lifecycle. Separate RED expected `draft to review` but saw only the generic Voice summary; GREEN with the visible unsaved-draft badge. Original actual physical hold/release, pending readiness/ack, native select, exact node/range, late reply, memory privacy and explicit-send/save assertions remain, with added folded selected-count and retained-chat/no-new-save checks.
7. `node --test tests/player-navigation.test.cjs`: RED 2/3 because a paint between native closure and queued toggle did not retire audio (`0 !== 1`); GREEN 3/3. Repeated closed paints do not repeatedly cancel; removed panel events cannot cancel a replacement owner. Deep links retain readable group/page identities.
8. Visual/legacy regression iterations found fragmented Settings/Help text, the Companion Send and Director Start actions slipping below the original compact bounds, extra grouped header height in Preparation/Party, and extra quest reference row height. They were corrected in layout/copy; all original action/qualification assertions remain. Fixture-only stale label/ambiguous navigation selectors and queued-race waits were adapted to the actual visible groups rather than bypassed.

9. Parent visual review found unconfigured local travel has both the setup dock and no-model hint, unlike the configured-model polish case. The new actual 984×635 shell assertion was RED because Send was below the viewport; GREEN for both factions after only compact Companion spacing, heading sizing and composer height were tightened. Provider/cost, sharing, source review, privacy exclusions and selected-memory count remain above Send. The full semantic conversation notice remains unchanged. The shell fixture also physically activates every Settings/Help subtab with Enter/Space. The earlier compact Party identity-bound RED was corrected by reducing its hero top inset six pixels; its original create-action bound and all native checks remained green.

## Verification

Focused final unit gate:

```powershell
node --test tests/player-navigation.test.cjs tests/renderer-updates.test.cjs tests/renderer-interaction.test.cjs tests/refresh-renderer.test.cjs tests/travel-companion.test.cjs tests/companion-reply.test.cjs
```

**87/87 passed**, zero failures/skips/cancellations. The travel/formatting subset was separately green at **21/21**. Full `npm test` and packaging remain parent-owned.

**21/21 affected registered GUI commands passed in a strictly serial sweep** after the initial navigation/disclosure/layout changes stabilized:

```powershell
node scripts/smoke.cjs
node scripts/setup-smoke.cjs
node scripts/autosave-smoke.cjs
node scripts/integration.cjs
node scripts/living-setup-smoke.cjs
node scripts/company-smoke.cjs --setup-races
node scripts/director-smoke.cjs
node scripts/preparation-smoke.cjs
node scripts/voice-memory-smoke.cjs
node scripts/travel-companion-smoke.cjs
node scripts/conversation-smoke.cjs
node scripts/companion-recovery-smoke.cjs
node scripts/product-polish-smoke.cjs
node scripts/support-smoke.cjs
node scripts/recovery-smoke.cjs
node scripts/party-smoke.cjs
node scripts/command-center-smoke.cjs
node scripts/knowledge-smoke.cjs
node scripts/insights-smoke.cjs
node scripts/character-guidance-smoke.cjs
node scripts/player-shell-smoke.cjs
```

The parent then identified a distinct unconfigured-Companion first-viewport gap in a capture. The fixture was strengthened before the narrow correction; the final covering rerun is recorded below. The earlier 21-command sweep is not represented as occurring after that last compact-only correction.

**8/8 final covering GUI commands passed strictly serially** after the last compact Companion correction and formatting, with no runtime/fixture edits during the run:

```powershell
node scripts/product-polish-smoke.cjs
node scripts/voice-memory-smoke.cjs
node scripts/travel-companion-smoke.cjs
node scripts/conversation-smoke.cjs
node scripts/companion-recovery-smoke.cjs
node scripts/knowledge-smoke.cjs
node scripts/character-guidance-smoke.cjs
node scripts/player-shell-smoke.cjs
```

The exact final rerun timings/results are in `compact-final-manifest.json`; all entries exit 0. The prior full sweep manifest is `final-manifest.json` (21 entries, all exit 0). New shell captures record actual `innerWidth: 984`, `innerHeight: 635`; 969-pixel full-page PNG width excludes the scrollbar. Both faction unconfigured Send assertions use the actual 635-pixel viewport. The parent requested only the narrow covering rerun after this visual finding; no broader redesign occurred.

Each GUI process settles/closes before the next starts. The final serial manifest and stdout receipts are local review evidence under `.superpowers/sdd/player-shell-logs/`. Support retains 10 checks, Recovery 15, Insights 11, Character guidance 17; the remaining fixtures retain their detailed scenario/assertion sets. No original native-control/caret/source/privacy/race assertion was removed to obtain GREEN.

The unregistered `scripts/preview.cjs` asset generator has its navigation migrated but was deliberately not executed: it overwrites original source artwork previews. It is not a registered test gate. Its original assets remain byte-identical; the new independent shell capture fixture supplies current review images without replacing them.

## Visual and artifact evidence

`.superpowers/sdd/player-shell-captures/manifest.json` records **26 actual Electron screenshots** and measured dimensions/overflow/image state:

- All five primary destinations at 1440×960 and 984×635, for both Alliance and Horde (20 captures).
- Settings Game connection / AI connection / Updates and Help Field guide (4).
- Expanded optional tools (1), and actual Electron 200% zoom with reduced motion (1).

Every capture checks zero horizontal overflow, zero broken images, actual select/option contrast under light/dark OS preference, and unbroken Settings/Help labels. Existing original class/faction bitmap assets and bundled fonts are the source. Captures use only Alpha/Beta fictional profiles, including a custom imported class and no real journal. A pre-bootstrap fixture replaces provider/model/CLI status, game-runtime probing, voice capability, clipboard and external opener; automatic app/reference starts and preferences are disabled. Owned temporary profile cleanup verifies its resolved parent and fixture prefix.

Full key captures and all capture tops/contact sheets were visually inspected; final compact Companion includes the previously missed unconfigured local-travel first-use state. Additional current travel images and synthetic outgoing/source/copy evidence remain in `.superpowers/sdd/travel-companion-captures/`; legacy compact/physical controls and native selected-dropdown evidence remain under their existing `work/` fixture directories. The parent must perform independent visual/source review; these are implementer observations, not owner acceptance.

## Scope and handoff

`git diff --exit-code 9f428fe2233afd9b5e0022aafb04b94927f62c0c -- assets data addon src/native package-lock.json` passes. Eleven changed JavaScript syntax checks and `git diff --check` pass. The original reference packs, fonts, illustrations, native bytes, credential model, app-owned data schema, and public release state are unchanged. Local ignored evidence/failed receipts remain preserved. No historical review ZIP/folder was rewritten.

Parent-owned remaining gates: independent SPEC/QUALITY review, full integrated tests, strongest fresh whole-series source/artifact review, NEW isolated Windows review bundle, and owner hands-on acceptance. No production release is claimed. GUI ownership is released only with the final scoped commit SHA.
