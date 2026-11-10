# Correction Task 4 — assessment and integration checkpoint

Status: assigned integration artifacts complete; parent-owned whole-branch review, targeted genuine-Windows-8.3 regressions and build/package acceptance remain pending. Remote CI is not run in this local pre-1.0 review; no push or PR is planned. Base/tested application-source HEAD: `6b8de7dad49d156b73564ea0530c3779b51eff92`, branch `codex/pre-1.0-product-polish`. Version 0.12.3, dependencies, public release and tags are unchanged; 1.0 remains held.

## Changes

- Finalized the parent-drafted `docs/PRODUCT-READINESS.md`: twelve surfaces, nine journeys, ranked future features with data/API/license/consent/maintenance requirements, current primary-provider spot-check qualifications and separate owner acceptance gates. Every selected bounded correction is complete with its reviewed source commit. Source/static evaluation is distinguished from measured dynamic behavior, synthetic captures, genuine path evidence and unverified real acceptance.
- Recorded Task 1's reviewed completed-memory-draft Stop correction and Task 3's reviewed compact source/availability qualifier correction, rather than treating their initial passes as final evidence. Task reviews are bounded approvals; they do not certify the whole product.
- Added `test:companion-recovery` and `test:product-polish` npm aliases and separate serial steps in both CI workflows. Existing script implementations and product behavior are unchanged. Both workflows now contain 21 source Electron fixture commands plus the packaged command; no watcher or scheduled task was added.
- Documented exact reusable commands and serial-GUI requirements in README and a new dated VALIDATION checkpoint, preserving historical release claims. The existing local bounded unit wrapper remains working evidence rather than a required distributed script.
- Updated completed Tasks 1–3 and the assessment substep in the plan; retained unchecked parent-owned candidate/review portions. Included the parent's explicitly authorized isolated review-only launcher clarification; no launcher, installer or application was executed in this task.
- Created the previously absent owned sibling `../Backstage-Forever-Readiness-2026-11-10/` with identical `ASSESSMENT.md`, concise `START-HERE.md`, six selected synthetic captures and `synthetic-screenshots/EVIDENCE.json`. No application binary or installer has been supplied at this checkpoint. The parent later added the unexecuted `Launch-Review.cmd` for its pending isolated candidate; this task did not overwrite or execute it. The candidate is explicitly pending in both guides; remote CI is explicitly not run for this local pass.

## Verification actually performed

1. `node work/run-v08-unit-suite.cjs readiness-integrated` — **594/594 passed**, zero failed/cancelled/skipped/todo, **78,792.6849ms**. Full suite ran once against application-source HEAD `6b8de7dad49d156b73564ea0530c3779b51eff92`; only this task's docs/config edits were in progress. Log: `work/readiness-integrated.log` (SHA256 `866dd7f07dfb0ec9c238454229dc2b90c2816244f59912bddd0e2d7dfa3f26b0`). This run was the normal source environment, not a new genuine-8.3 or packaged run.
2. `node --check scripts/companion-recovery-smoke.cjs` and `node --check scripts/product-polish-smoke.cjs` — PASS.
3. Parsed `package.json` and `package-lock.json`; checked the two new aliases and unchanged version 0.12.3 — PASS. Lockfile/dependency bytes are not changed.
4. Parsed both workflows with the already installed `js-yaml`; reviewed their run sequence and resolved every exact `npm run` script name against `package.json` — PASS. This is syntax/command review, not a new mirrored configuration test or remote CI result.
5. Visually inspected final `ai-baseline-compact-viewport.png`, `quest-saved-baseline-compact-viewport.png` and `skip-keyboard-focus.png`. Send and qualified saved-game copy action fit the original compact viewport; skip is visibly fixed with a focus ring. The full task evidence includes the separate reference/unknown state and actual Electron zoom. Selected copied captures are byte-identical to their local sources; assessment copy and local Markdown targets checked.
6. `git diff --check` — PASS (repository line-ending notices only).

The two new GUI scripts already passed as their actual commands in Tasks 1 and 3, together with affected existing flows. No already-green GUI suite was repeated just to exercise an npm alias. No behavioral code was changed, so no new RED test or implementation-mirroring test was added for this registration/documentation task.

## Files owned

- `package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `README.md`
- `docs/VALIDATION.md`
- `docs/PRODUCT-READINESS.md`
- `docs/superpowers/plans/2026-11-10-readiness-corrections.md`
- `.superpowers/sdd/progress.md`
- `.superpowers/sdd/correction-task-4-report.md`

User-facing sibling outputs are intentionally outside the repository commit. The large ignored progress journal is local bookkeeping; the concise Task 4 report is included in the commit. Ignored unit log/source reports/review reports remain local evidence. No installer or other large build output was added to Git.

## Pending and limitations

Parent owns final strongest independent whole-branch review of the full evaluation/correction range, any resulting focused fixes/re-review, targeted genuine-Windows-8.3 regressions, final unpacked candidate build/package verification, isolated review ZIP and final delivery. Remote CI is not run in this local pre-1.0 review; no push or PR is planned. CI registration is retained for future authorized pushes/releases. This report does not claim those have run. The plan's Task 4 candidate/review checkboxes therefore remain open.

Task 1/2/3 independent final approvals are recorded in `work/readiness-ai-review.md`, `work/readiness-startup-review.md`, and `work/readiness-ui-review.md`; the final approval heads are `fc8a942`, `7fb5603`, and `6b8de7d`. Consolidated assessment keeps real-client/native API, real provider access/terms/billing, real speech, assistive technology/Windows DPI, native dialog/Explorer, installed upgrade and long-session performance acceptance separate from synthetic evidence. No real profiles/game files, game input, audio, sign-in, paid request, OS settings, publication/version/tag/dependency changes or watcher was used. These corrections do not authorize or establish 1.0 readiness.

## Parent final integration — November10

The previously pending source/candidate conditions are resolved. Whole-branch source including fixture-only42da057 and post-review documentation1f9e471 passed strongest independent review, final disposition ReadyMergeYES for the local branch/candidate, with no Critical/Important findings. 1.0/live-owner gates remain held; no public release/version/push/PR/remoteCI occurred.

Parent first ran 50 targeted units under a verified genuine Windows8.3 alias: all pass. A serialized recovery fixture then failed its admission-before-presentation assumption, disproving overlap as a sufficient explanation. Deterministic held Enter RED/GREEN fixed only that fixture and preserved exact original-node/lifecycle assertions. Full recovery normal/actual aliased BF_USER_DATA passes and the product-polish short-environment pass are independently reviewed; the latter canonicalizes its own app-data path and does not prove retained alias input.

Fresh npm run pack built source1f9e471. The derived original packaged fixture retains all original source/reference/SDK/five-file addon installation/readback/repair assertions and adds seeded review automatic=false/installOnQuit=false checks on startup/restart:79 byte matches PASS. An initial parent instrumentation probe queried the first closed page after restart; corrected to reopened window, complete final fixture PASS. Failed logs retained/uncredited.

The external review launcher now seeds ONLY its named review profile update preferences false on every launch. Actual batch prelude under temporary LOCALAPPDATA plus production packaged Updater RED/GREEN proves no automatic timers/network/install. Final Windows start command was inspected, not executed. Actual packaged executable startup/restart with matching isolated argv/preferences passed. Owner should use the launcher and keep explicit review update controls off; normal installed updates are unchanged.

All78 copied app files/438861876bytes SHA256-match fresh dist;ASAR0115e2d495fe33aa3539ccc566278d8f5d21cc2154da0cf128eac68494a66c83. Final sibling START-HERE/ASSESSMENT/VERIFICATION/SOURCE/APP-FILES and synthetic evidence are present. Reviewer wording fix limits skip coverage to eleven main pages. ZIP creation/content/hash verification is the final mechanical parent delivery step, reported alongside the ZIP; no source/app binary changes are involved.
