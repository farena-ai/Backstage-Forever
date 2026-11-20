# W4 4A / LIVE-A03 — First tank pull

One offline introductory lesson and one fictional Practice Lab case. Learn to confirm readiness and agree on a signal and fighting spot, keep the group in view, cover a known hit with a defensive, and communicate when an enemy leaves the pack without chasing into another group. Enemy movement is a visible cue, not proof of a threat ranking or a recommendation to taunt. The five choices are alternative plans for the same pull, not five live recommendations.

## Content review and evidence boundary

- **General group-play guidance:** agree on the pull and the signal and make a simple recovery plan. This builds on the group-signal opener in [Practice Lab](PRACTICE-LAB.md) and keeps player decisions manual, as in [Party Plans](PARTY-PLANS.md).
- **Fictional exercise rules:** the alcove, line of sight, extra pack, beat-two hit, one-beat guard and stray are explicit scenario inputs, not facts about any dungeon, class, spell or Forever build. The guard reuses the teaching premise of the existing defensive drill. The preferred response avoids adding another pack and communicates the visible change; it does not promise that the stray returns or that the group survives.
- **Withheld:** no exact-build cooldowns, spell or rank instructions, damage or threat arithmetic, target or taunt recommendations, live readiness or performance evaluation. The pack uses no profile, game reads, provider, IPC, network, persistence, permissions or automation.

## Read-only integration contract

`src/renderer/academy-tank-pack.js` exports the same frozen `{ lesson, drill }` via CommonJS and `globalThis.BFAcademyTankPack`. `lesson` provides plain-text `title`, `scope`, `preparation`, `positioning`, `threat`, `defensive` and `recovery`. `drill.id` is `tank-first-pull`, with `evidence: 'simulated'`. Open **Adventure → Practice Lab → First pull: Set up, hold position, recover**. The shared Lab displays the lesson and simulation label, and uses the existing selection, feedback and retry.

Run `node --test tests/academy-tank.test.cjs tests/practice-lab.test.cjs tests/academy-dps.test.cjs` for the branch replay, browser-context parity and existing Academy regression checks. This is fixture coverage, not a live-client result.
