# Whole-product readiness assessment

Assessment started November 10, 2026 against published 0.12.3 (975df45). The review branch remains a pre-1.0 candidate. **1.0 is held for real-player acceptance.** The earlier selected corrections were implemented and independently task-reviewed through `6b8de7dad49d156b73564ea0530c3779b51eff92`; their whole-branch source review, including the subsequent fixture-only correction `42da057`, was approved. Local candidate/package results are recorded separately in the delivered review bundle's VERIFICATION.md. Remote CI is not run in this local pre-1.0 review, and no push or PR is planned for this pass.

## Local resilience and verified-guidance follow-up

The four selected follow-up priorities are now implemented in this local review branch: allowlisted diagnostics, automatic recovery, richer bundled reference facts and initial class/race/loadout guidance. Each component passed independent spec/quality review after its identified defects were corrected. The final application-source gate at `35d8ca4228e24166c6f1ad8343e0edd5b6674252` passed **716/716 unit tests**, with zero failures, cancellations or skips. All four actual app-level suites passed 53 checks at that same source, including genuine Windows short-path recovery. Fresh whole-series source review is approved with no unresolved findings; packaged-artifact acceptance is recorded separately in the delivered review bundle. This pass is local; no public update, installer or 1.0 release was published.

Character guidance needs no AI or extra setup. It uses the selected saved profile, preserves custom races literally, qualifies every historical training suggestion and opens manual plans or editable drafts only. Source absence stays visible: there is no verified Sunborn racial optimizer, complete quest graph or continuous desktop feed. The seven owner gates below remain in force.

## Product decision

Backstage Forever already offers useful local planning without AI: character journals, source-aware quest guidance, session plans, Company checklists, preparation calculations, portable Party plans and native in-game Compass guidance. The strongest next improvement is dependable, understandable use of those features. Another service integration is less valuable than fixing waiting, recovery and discoverability.

The fantasy/class/faction presentation is coherent and the Quest Guide has a distinct graphical identity. Preserve it. Improve hierarchy, compact action placement, keyboard access and legibility instead of adding more ornament between the player and the task.

## Evidence and limits

- Source evaluation covered all twelve surfaces and nine player journeys below, tracing renderer, main, core, addon, documentation and relevant test definitions.
- Baseline unit run: **571 passed**, zero failed, skipped, cancelled or todo; 91.95 seconds. Command: `node work/run-v08-unit-suite.cjs product-readiness-baseline`.
- Actual isolated Electron/main/preload/renderer evaluation: **29 captures**, synthetic Alliance/manual and Horde/Sunborn observed profiles, fresh onboarding, every shell page, reference quest detail and 200% Electron content zoom. Outer windows 1440×960 and 1000×700 yielded content 1424×895 and 984×635. Zoom content was 712×447 with DPR2; this is not Windows DPI certification.
- Sampled captures showed no horizontal overflow, broken images or unlabelled form inputs under a simple label heuristic. That does not establish full accessibility or contrast compliance. Tiny functional Quest Guide text and compact chat action displacement were visually confirmed.
- No actual player files, game input, microphone/audio, account sign-in, paid inference, installer execution or OS setting was touched. Fixtures blocked inference and game launch. No recurring watcher was created.
- Dependency advisory checks on November 10: both `npm audit --omit=dev --json` and full `npm audit --json` reported zero known vulnerabilities. These are advisory-database results, not security certification or a code review of every dependency.
- Detailed source assessment: ignored `work/product-readiness-source-report.md`; screenshot index: `work/product-readiness-ui/manifest.json`. These are local evaluation evidence, not distributed game data or proof of provider entitlement.
- Evaluation checkout e7a5737 differs from published 975df45 only by the evaluation design/plan documents; application code was identical. The manifest records both identities. Baseline screenshots cover normal/manual/known-empty/reference/onboarding states, not dynamic loading/error/retry/stale interactions; those were source-assessed and require targeted regression evidence when corrected.

## Corrections selected before 1.0

| Finding | Why it matters | Bounded correction | Status |
|---|---|---|---|
| No AI response Stop; view retirement does not stop transport | UI appears idle while provider remains busy; clearing destroys useful transcript | Main-owned abortable request, explicit Stop, reject late results and memory drafts | Complete; independent task review approved fc8a942 |
| Failed question has no direct edit route | Long questions require retyping after setup/network failure | Explicit Edit question, preserve newer draft, never automatic resend | Complete; independent task review approved fc8a942 |
| Startup failure tells player to restore through an app that cannot open | Files preserved but recovery instruction is unusable | Actual data path, safe Open folder action and precise preservation-first instructions | Complete; independent task review approved 7fb5603 |
| Field Guide trails current features and privacy contract | Existing useful workflows stay hidden; backup/memory expectations can be wrong | Task-oriented guide with direct navigation and exact sharing/import consequences | Complete; independent task review approved 2326f6a / 6b8de7d |
| No keyboard navigation bypass | Repeated traversal through eleven destinations | Focus-visible Skip to content, stable main focus, unchanged trusted URL | Complete; independent task review approved 2326f6a / 6b8de7d |
| Optional voice precedes typed-chat actions | Core Send is displaced at compact sizes | Keep input/context/Send/Stop together; voice follows without hiding its live controls | Complete; independent task review approved 2326f6a / 6b8de7d |
| Compact functional quest qualifiers authored at 9–10px | Source uncertainty and waypoint caveats are hard to read | Readable functional text, wrapping and spacing; retain source distinctions | Complete; independent task review approved 2326f6a / 6b8de7d |
| Manual source duplicated, disconnected dot green, Windows updates ambiguous | Small inconsistencies dilute source and action clarity | Single manual label, state-specific indicator, app-specific update title | Complete; independent task review approved 2326f6a / 6b8de7d |

No new critical security or destructive-data defect was established by the source evaluation. This is not a security certification or a reason to skip release gates. Implementation must preserve the existing source ownership, explicit sharing, held-control/focus and update-integrity protections.

## Correction evidence and integration status

Evidence below is measured separately from the baseline source audit and static screenshots. Passing a source audit or a normal-state image does not stand in for a loading, error, stop, stale-result or focus interaction.

- **AI ownership/recovery — complete through `fc8a9423feae2de013c6f6af1f8c8762c0047d52`:** 59 focused unit checks and actual isolated Electron recovery, memory-backend and voice-memory fixtures passed. The new recovery fixture covers Stop, old success/error rejection, context changes, explicit editing, newer-draft/sharing preservation and original input focus/caret. Independent review found that Stop during completed-response memory review could leave a saveable backend draft. A real held `memoryDraft` IPC reproduced it before the follow-up; the corrected fixture and 11 focused checks passed, including no old-draft save or newer-request retirement. Final independent result: SPEC compliant, QUALITY approved, no remaining Critical/Important findings. Synthetic CLI workers establish local lifecycle behavior, not live subscription cancellation or reversal of provider processing/charges.
- **Startup recovery — complete at `7fb560330aa55daa73774ce45ef333ca33cb09c1`:** 14 new tests and 28 existing Store/core/memory checks passed. Tests run the actual helper/main startup path with injected native surfaces, actual invalid Store fixtures and unrelated initializer failure. State, credential and binary-sentinel bytes and directory entries remain unchanged. Quit/open ordering, exact main-owned path, safe fallback and guaranteed quit are covered. Independent SPEC compliant / QUALITY approved. Native Windows dialog rendering and Explorer still require owner acceptance.
- **Interface/help — complete through `6b8de7dad49d156b73564ea0530c3779b51eff92` (initial `2326f6a`):** final product-polish fixture passed; affected recovery, voice-memory, knowledge, UI and living-setup fixtures also passed serially after their respective corrections. Physical first Tab/Enter bypass works across all eleven shell destinations with a stable main label and unchanged trusted URL. At the original 984×635 content boundary, configured Send ends at 620.45px; source/availability and covered functional quest qualifiers measure 12px. Independent review caught one omitted 10px `.atlas-owner` qualifier; an actual computed-size RED and focused GREEN corrected it. A bounded saved-game compact check retains the qualified copy action at bottom 586.70px. Final independent SPEC approved / QUALITY approved, no remaining findings.
- **UI evidence:** `work/product-polish-ui/manifest.json` indexes 15 final captures, distinct from the earlier 29 baseline captures. Content-size tests distinguish 1000×700 from the original 984×635 renderer; actual Electron 200% zoom yields a 720×480 CSS viewport and native capture. Reference and saved-game captions retain different meanings. Final selected compact images were visually inspected. These are synthetic profiles and observations, not evidence that demonstration quests exist or that a real game/client/account works. A preliminary overlapping recovery run was discarded; its suspected focus conflict was not proven and it is not passing evidence.
- **Integrated unit gate — passed once:** `node work/run-v08-unit-suite.cjs readiness-integrated` passed **594/594**, zero failed/cancelled/skipped/todo, in **78.79 seconds**. Log: `work/readiness-integrated.log`. Tested application-source HEAD: `6b8de7dad49d156b73564ea0530c3779b51eff92`; only Task 4 documentation/configuration edits were in progress. This is the full normal-path unit suite, not a new genuine-8.3, live-client or packaged acceptance run.
- **CI registration:** `npm run test:companion-recovery` and `npm run test:product-polish` now run as separate serial steps in both Windows validation and production-release workflows. This is registration and local command review, not a remote CI success. Existing passing GUI fixtures were not rerun merely to exercise aliases for unchanged commands.
- **Final fixture/path validation:** a serialized short-environment recovery run reproduced the earlier initial Stop assertion failure, so GUI overlap was not a sufficient explanation. Deterministic held Enter proved main request admission can precede legitimately deferred presentation while the original control remains current. Fixture-only `42da057` waits for visible Stop after release, preserving exact count, original-node and lifecycle assertions. Full normal and genuine-8.3 recovery runs passed; Electron retained the aliased BF_USER_DATA input and directory identity was verified. An additional 50 targeted unit checks passed under the genuine alias. Product-polish also passed with TEMP/TMP set to that alias; that fixture canonicalizes its app-data directory, so this is short-environment coverage, not an aliased BF_USER_DATA claim.
- **Independent whole-branch source review:** approved through `42da057`, with no remaining Critical/Important source findings. The separate local unpacked candidate must still prove resource parity, isolated startup and update preferences; final artifact results/hashes belong to the delivered VERIFICATION.md, not an implied consequence of source approval. The review launcher uses only a separate named review-data folder and disables its automatic checks/install-on-exit at every launch. Keep explicit update controls off during review. Normal installed-app update behavior is unchanged. No real profile is copied and no installer is executed.

Task reports: `.superpowers/sdd/correction-task-{1,2,3}-report.md`; independent local reviews: `work/readiness-{ai,startup,ui}-review.md`. These are bounded task approvals, not whole-product certification. The consolidated user-facing copy is `../Backstage-Forever-Readiness-2026-11-10/ASSESSMENT.md` with selected explicitly synthetic captures.

## Every surface

| Surface | Assessment and priority |
|---|---|
| Welcome/setup | Useful automatic preparation, deliberate folder choice and manual/offline alternatives already exist. Keep prepared distinct from addon loaded. Test actual first useful action and no-install/error recovery on a clean machine. |
| Adventure | Strong character-focused presentation and local Director. Preserve clear saved date, unknown observations and explicit session choice. Compact density should favor next action. |
| Company | Useful local multi-character plans, loading/retry and edit recovery. Preserve manual checks versus newer compatible observed completion, orphan labels and edit drafts. |
| Party | Existing explicit roles and reviewed portable plan files are useful without an online service. Imports remain manual, unchecked and unassigned; no eligibility or automatic messaging promise. |
| Preparation | Source-dated recipes/materials, unknown shortfalls and separated alts are correct. Keep historical sellers qualified; do not imply bank access, purchasing or transfers. |
| Quest Guide | Strong graphical atlas and source hierarchy; partial references remain partial. Compact functional qualifiers now measure at least 12px in the covered states. Keep game destination, approximate reference and clue distinct. |
| Characters | Mature manual/observed identity and journal ownership. The duplicated manual source label is corrected. Never invent race/faction or import never-visited alts. Large-roster filtering is a later convenience. |
| AI Companion | Correct game specialization and optional context/memory review, and the pass adds Stop, explicit failed/stopped-question editing, compact action ordering and inline connection setup. Actual provider acceptance remains separate. |
| Connections | Provider access modes, model refresh/manual fallback and encrypted keys exist. No silent paid fallback. Actual sign-in/plan entitlement needs account acceptance; model metadata alone proves neither inference nor vendor support. |
| Game Connection | Automatic preparation, managed-addon repair, follow/pause and disk refresh exist. Desktop disk saves remain separate from native guidance. Loaded addon and actual APIs require client acceptance. |
| Field Guide | Rebuilt around six existing tasks with direct page actions and accurate backup/import/memory boundaries. Synthetic navigation/copy checks passed; owner usability acceptance remains. |
| Updates | Signed manifest, installer hash/size verification, ready-cache reuse, retries and manual fallback exist. The heading now names Backstage Forever. Real installed upgrade and Windows publisher signing remain release decisions. |

## Nine journeys

1. **Install/update → first useful action:** offline journal/Company/reference guidance must work without AI. Preserve setup alternatives and manual update fallback. Real clean install/upgrade remains unverified.
2. **Collect/switch characters:** preserve stable source IDs, newer captures, notes/goals, drafts and explicit selection pausing follow. Never-visited characters cannot be assumed available.
3. **Understand live versus saved:** native Compass can update from supported client events; desktop sees written SavedVariables, normally on reload/logout. Refresh reads disk and does not force the game to save. Do not promise a continuous desktop feed.
4. **Choose next quest:** deterministic guidance uses observed quests and qualified references. Unknown/mismatched/conflicting data remains visible. A copied waypoint is a deliberate supported command, not automatic travel.
5. **Plan session/materials/party:** existing Director, Company, Preparation and Party form a useful local workflow. Help should connect them without inventing pooled inventory or observed completion.
6. **Connect and recover optional AI:** explicit provider/access/model and billing mode; no automatic fallback. Stop, edit and clear must have distinct effects. Cancellation cannot reverse already-sent data or charges.
7. **Use voice/memory deliberately:** local audio controls, typed alternative, no retained audio; only explicit reviewed saved exchanges can be selected for a later question. Real recognition/playback remains unverified.
8. **Protect/move private data:** backups include profiles/plans, exclude credentials and saved conversation memory. Replacement import clears memory and disconnects observation. Party files are a smaller reviewed projection, not private backups.
9. **Recover without losing work:** preserve drafts, source ownership and actionable retry states; preserve original startup files and show an actual recovery path. No silent reset or hidden resend.

## Feature priorities after the correction pass

Relative effort includes maintenance, not just initial coding: local filtering/pins are low to medium; redacted diagnostics and memory portability are medium with continuing privacy/schema review; reference enrichment, maps and client-storage observations are high recurring compatibility/curation work; online synchronization and new subscription adapters are high service/provider maintenance. External feasibility is unverified until researched against current primary sources.

| Feature | Priority/value | Requirements and acceptance |
|---|---|---|
| Allowlisted support diagnostics | Implemented in local review | Main-owned five-minute preview, exact copy/save and canonical destination guards; no keys, character identity, prompts, notes, source IDs or private paths. Nothing uploads automatically. See [Support and recovery](SUPPORT-AND-RECOVERY.md). |
| Local recovery checkpoints | Implemented in local review | Automatic bounded memory-free protection, deliberate preview/restore, usable prior history through interrupted rotation and strict persisted source retirement. Raw damaged originals have separate disclosed private retention/clear rules. Real disposable-copy acceptance remains an owner gate. |
| Roster/plan filtering and recent-plan return | After 1.0, medium | Existing local data; preserve selection, drafts and source ownership. Test large bounded rosters and clear empty results. |
| Favorite quests/personal reminders | After 1.0, medium | Manual preference separate from observed completion; no scheduler required. Pins survive refresh without claiming quest availability. |
| Deliberate saved-memory portability | After 1.0, medium | New opt-in private format with schema/limits and preview; never silently add memory to ordinary backups or party files. |
| Better quest/vendor coverage | Ongoing; initial enrichment implemented locally | Separate pinned licensed pack adds sharing, static time limits, starting items, drops and historical trainers/items. Quest count remains 3,884; missing destinations/prerequisites stay unknown. Matching build/locale/title/source and attribution remain required. |
| Verified class/race/loadout guidance | Initial evidence tier implemented locally | Automatic exact identity and saved gear, general class overview, qualified historical training and reusable manual checklist. Custom races stay literal. Verified racial mechanics, talents, equip permissions, stat priorities and optimization still require permitted matching-build evidence; no automatic game changes. |
| Map visualization | Research, medium | Licensed or original maps and verified transforms; omit unknown points, expose provenance, support accessible/offline use. No automatic movement. |
| Bank/account-storage planning | Deferred pending client research | Only actually supported public APIs and explicit observations; unknown when unavailable, separate dates/sources, no assumed transfer eligibility. |
| Online party synchronization | Later, uncertain versus file exchange | Separate service/auth/consent/deletion/conflict/operational design. Existing reviewed file exchange remains sufficient for 1.0. |
| Grok subscription access | Deferred pending official supported integration | Verify current vendor sign-in/inference terms and entitlement first; isolated lifecycle and no hidden API billing. Existing API access is distinct. |

A complete quest graph, optimal live route, always-current desktop inventory or gameplay automation is not a justified promise from partial saved/public observations. More imagination does not manufacture missing APIs or licensed data.

## Owner gates before 1.0

1. Clean-machine Windows install, launch, uninstall/data preservation and previous-installed-version upgrade; real interrupted updater recovery/manual fallback. Decide publisher signing: update-manifest authentication is distinct from Windows Authenticode identity.
2. Actual Forever client with two visited characters: natural saves, follow/pause, addon activation, Compass outside combat, combat hide/recovery, partial API states and representative quest/waypoint/material facts.
3. Real keyboard/screen reader, usual Windows display scaling, content zoom and reduced motion. Synthetic layout checks do not certify assistive technology.
4. Deliberate speech recognition/playback/Stop acceptance with real engines, names and focus changes; typed use stays available without speech.
5. Optional provider sign-in, available models, entitlement/billing limits and cancellation on real accounts. No provider is required for local planning.
6. Disposable-copy backup/restore/delete rehearsal, confirming excluded memory and credential implications. Preserve real originals.
7. Record desktop/addon resource use at idle, minimized and during a representative extended play session, including game frame-time impact. Investigate sustained busy CPU, growing memory or orphan workers. This pass did not benchmark real-game performance or certify a hardware-independent resource budget.

These gates require actual acceptance evidence; passing mocks and a prettier button cannot certify them.

## Provider documentation spot-check, November 10

Current primary documentation was re-opened separately from source/tests. [OpenAI's registration guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) describes the direct open-source-client registration route with issued client identity, host identity, PKCE and validated plan permission. This supports the documented integration approach; it does not establish this installation's granted access or model entitlement.

[Anthropic's plan guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) currently describes subscription-limit use for the official CLI/headless and third-party usage, while some plans can separately include linked Console API credits. Do not promise that a subscription automatically funds every API request. [Claude Code's legal/compliance page](https://code.claude.com/docs/en/legal-and-compliance) distinguishes prohibited credential/token intermediation from end-user login to the unmodified official binary and imposes conditions on offering that binary through products, including applicable commercial terms. BF's adapter invokes the separately installed official tool rather than extracting its tokens; that architectural fact is not legal certification. Before 1.0 distribution, the owner must confirm the applicable product/distribution terms and any unresolved provider branding requirements. Do not infer permission merely because a test or login works.

This spot-check does not validate Grok subscription inference, all provider terms, account eligibility or billing. Those remain separate, explicit acceptance/research items; no authentication or paid call was performed.
