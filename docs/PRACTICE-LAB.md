# BF-A02 — Practice Lab

In Backstage Forever, open **Adventure → Practice Lab**. Setup can be skipped; no game, character import, account or provider is needed. Pick a drill, choose an action, read its simulated consequence and the single practice tip, then retry or select another drill. Tab moves through controls; Enter or Space activates choices. The result receives focus after answering and retry returns focus to the first choice. Use **Next step** to go back to Adventure; leaving the page clears the exercise.

The six exercises include the original opener, resource, defensive and heal-target decisions, plus two role lessons with longer scenarios: [Tank first pull](ACADEMY-TANK-PILOT.md) covers readiness, positioning, defensive timing and recovery; [Healer triage](ACADEMY-HEALER-PILOT.md) covers heal choice, mana and the dispel deadline. The lesson appears when you select its drill. Scenario numbers and rules are fictional, not Forever build, class or spell data. Attempts exist only in memory; there is no telemetry, persistence, score or live/dummy review.

## Integration boundary

The desktop route and the standalone `src/renderer/practice-lab.html` share the same bundled view and model. The exercises use no desktop bridge, server or additional permissions. The desktop [Deadmines Fieldbook](DUNGEON-FIELDBOOK.md) can open the original opener with a scoped return; a regular visit to the Lab offers all six drills. Any reviewed class guide (BF-A01) or live evidence workflow is separate and must not use simulated results as observed play.

## Verification

- Model: `node --test tests/practice-lab.test.cjs`
- Desktop smoke: `npm run test:practice-lab` (real Electron with an isolated journal and network blocked).
- Browser smoke: `node scripts/practice-lab-smoke.cjs` with Playwright Chromium installed, or set `BF_PRACTICE_BROWSER=msedge` to use an installed Edge. Set `BF_PRACTICE_SCREENSHOTS` to an output directory to capture both viewport sizes.
