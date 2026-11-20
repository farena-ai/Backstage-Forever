# W4 4B — Offline healer pilot (LIVE-A04 / BF-A04)

This pack teaches pre-pull mana and dispel preparation, judging urgency by incoming damage, and reserving enough mana for the next necessary action. All numbers and effects are fictional. No class, spec, rank, build or actual encounter mechanics are asserted. No live client validation was performed. The pack reads no party health, auras, character state or other game data; it cannot recommend a real heal target or execute an action.

## Content review

One action is available before each beat’s damage. With 6 mana and no regeneration, the first ally starts at 30% and must survive a 40-point hit. The second ally is safe until beat two, when a separate, dispellable effect would kill even at full health.

| First action | Outcome under the stated rules |
| --- | --- |
| Efficient heal (2 mana, +10) | 30 + 10 − 40 = 0%: mana efficiency cannot save the first ally. |
| Dispel (2 mana) | Removes the second threat but does not change the first hit. |
| Emergency heal (3 mana, +25) | 30 + 25 − 40 = 15%; a 2-mana dispel on beat two leaves 1 mana. This is the only offered plan that covers both deadlines. |
| Group heal (5 mana, +25) | The first ally survives, but only 1 mana remains, below the dispel’s cost. More healing cannot prevent the lethal effect. |

## Lab integration contract

`src/renderer/academy-healer-pack.js` exports the same frozen `{ lesson, drill }` via CommonJS and `globalThis.BFAcademyHealerPack`. The `lesson` has a title, scope, preparation, triage and mana/dispel teaching text. `drill` is a standard Practice Lab descriptor (`healer-mana-triage`, evidence `simulated`) with authored branches and one practice takeaway. It works with the existing `choose` attempt shape; it does not register itself.

Open **Adventure → Practice Lab → Healer: Survive the hit, then stop the effect**. Both Lab entry points load the pack before the shared registry. Selecting the drill displays its lesson and uses the usual choice, result and retry controls. Selecting another exercise clears the healer lesson.

Run `node --test tests/academy-healer.test.cjs tests/practice-lab.test.cjs tests/academy-dps.test.cjs` for the content and existing Academy/Lab contract tests.
