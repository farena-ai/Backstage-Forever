# BF-A02 — Practice Lab

Open `src/renderer/practice-lab.html` directly in a browser. No server, game, character import, account or provider is needed. Pick a drill, choose an action, read its simulated consequence and the single practice tip, then retry or select another drill. Tab moves through controls; Enter or Space activates choices. The result receives focus after answering and retry returns focus to the first choice.

The four exercises teach planning an opener around a group signal, reserving resources for the next action, covering a hit with a defensive, and accounting for incoming danger when choosing a heal target. Their numbers and rules are fictional. They do not represent a Forever build, class or spell. Attempts exist only in memory; there is no telemetry, persistence, score or live/dummy review.

## Integration boundary

The standalone page loads `practice-lab-model.js` then `practice-lab.js`. A future Academy launcher can open the page as its own local renderer surface without a preload bridge or game connection. The deterministic model exposes `drills`, `createAttempt`, `choose` and `retry` for later UI reuse; the standalone page needs no changes to the shared desktop shell. Any reviewed class guide (BF-A01) or live evidence workflow is a separate integration and must not use simulated results as observed play.

## Verification

- Model: `node --test tests/practice-lab.test.cjs`
- Browser smoke: `node scripts/practice-lab-smoke.cjs` with Playwright Chromium installed, or set `BF_PRACTICE_BROWSER=msedge` to use an installed Edge. Set `BF_PRACTICE_SCREENSHOTS` to an output directory to capture both viewport sizes.
