# LIVE-P02 · Compare two options in Sheet

Open **Characters → Sheet → Compare two options**. Choose Leveling, Tank, Healer, or Caster damage explicitly. Enter two distinct exact item IDs (including quest rewards), or choose two gear sets saved on the active character. Item suggestions include exact, verified chest IDs from LIVE-P01 and IDs on this character’s wish list. An Atlas item handoff can prefill the first ID. A reward ID names an item to inspect; it does not establish reward eligibility or current availability.

The estimate uses base item data from the matching installed WoW Forever build. The class’s leveling weights are the starting point, then the selected role overrides its relevant weights. The result shows each stat’s weight, both amounts, and the signed contribution to **B minus A**. Set scores sum the recorded combat slots; they do not fill unlisted slots from equipped gear. Different set slot coverage, missing base facts, and known equip blockers prevent a ranked result. This is not a simulation: random affixes, enchants, procs, sockets, set bonuses, and other instance effects are not scored.

Wish-list intent is separate from score and does not imply ownership. This view does not equip gear, claim rewards, change wishes, or write to the journal or game. Selections are temporary and scoped to the current Sheet and saved character.

Verification: `node --test tests/sheet-comparison.test.cjs` and `node scripts/sheet-comparison-smoke.cjs`. The latter uses the real Electron shell and IPC with synthetic installed item facts; it is not a live-client check.
