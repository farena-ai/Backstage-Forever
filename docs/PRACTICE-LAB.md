# BF-A02 — Practice Lab

In Backstage Forever, open **Adventure → Practice Lab**. Setup can be skipped; no game, character import, account or provider is needed. Pick a drill, choose an action, read its simulated consequence and the single practice tip, then retry or select another drill. Tab moves through controls; Enter or Space activates choices. The result receives focus after answering and retry returns focus to the first choice. Use **Next step** to go back to Adventure; leaving the page clears the exercise.

The four exercises teach planning an opener around a group signal, reserving resources for the next action, covering a hit with a defensive, and accounting for incoming danger when choosing a heal target. Their numbers and rules are fictional. They do not represent a Forever build, class or spell. Attempts exist only in memory; there is no telemetry, persistence, score or live/dummy review.

## Integration boundary

The desktop route and the standalone `src/renderer/practice-lab.html` share the same bundled view and model. The lab uses no desktop bridge, server or additional permissions. Any reviewed class guide (BF-A01) or live evidence workflow is separate and must not use simulated results as observed play.

## Verification

- Model: `node --test tests/practice-lab.test.cjs`
- Desktop smoke: `npm run test:practice-lab` (real Electron with an isolated journal and network blocked).
- Browser smoke: `node scripts/practice-lab-smoke.cjs` with Playwright Chromium installed, or set `BF_PRACTICE_BROWSER=msedge` to use an installed Edge. Set `BF_PRACTICE_SCREENSHOTS` to an output directory to capture both viewport sizes.
