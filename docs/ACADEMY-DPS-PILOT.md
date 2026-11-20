# BF-A01 — Frost Mage single-target pilot

**Qualified for a bounded desktop teaching guide, not a live rotation.** Characters → Talents supports solo, single-target Frost Mage at levels 23–25 on WoW Forever `1.60.1.70959`. The band stays below Frostbolt Rank 5 (26) and Ice Lance Rank 2 (28); the community spellbook identifies Rank 4 as `7322` and Rank 1 as `1312002` respectively, on entries dated 19 Nov 2026.[2][3]

- **Opener and filler:** the Forever Mage guide uses Frostbolt to open and describes damage plus a movement slow; the reviewed rank has a cast time and mana cost. Practice using it from range and when you can safely stand still.[1][2]
- **Priority exception:** the same guide favors Ice Lance on a frozen target; the exact rank is instant, costs mana, and has a frozen-target damage bonus. This pilot only teaches the visible freeze case and leaves disputed damage shorthand, damage numbers, other procs and exact timing out.[1][3]
- **Mana trade-off:** saving Ice Lance for a frozen target avoids spending its mana on the weaker unfrozen hit.[2][3]

The class guide corroborates the practice priority from an older beta build. The spell effects and ranks used here are supported by the listed pilot-build spellbook rows; this is not a live test of the priority. The shared cooldown described in pre-launch notes is outside the pilot because it was not independently verified on this build.

**Eligibility and privacy:** an imported active character must match the class, saved build, and level band. The desktop does not read the spellbook or use the talent planner as evidence of learned ranks. The player must check both exact learned entries in their current spellbook; if either is unknown, unlearned, or a different rank, the guide stays hidden. These are temporary self-checks, not verified observations, and are cleared when the view is abandoned or the active character changes. No addon capture, network/API/provider path, auto-cast, live cue, or persisted permission was added. No AoE, raid priority, best-DPS claim, or live client validation is included. This is separate from Practice Lab.

## W4 4C — Manual Spellbook review

In Characters → Talents, confirm both exact ranks as above, then open **Just learned this?** for a manual two-slot solo Frost layout. The one reviewed spell is Ice Lance Rank 1 (`1312002`). Compare the Spellbook entry with the in-game action-bar tooltip. Placement and binding start **unknown**; only an explicit manual check produces a **self-reported** result. The binding question applies to the same slot and resets to unknown when placement is no longer confirmed. The template doesn't assign keys, inspect or edit game settings, or give live cues. The answers are temporary and follow the Academy card's existing character-switch and navigation lifetime. Other ranks, forms, and pets are outside this case.

Run `node --test tests/academy-dps.test.cjs` and `node scripts/academy-dps-smoke.cjs` for saved-fixture coverage. This is not live-client validation.

## Sources

[1] https://wow4ever.quest/en/articles/guia-mago-wow-forever
    > "Frostbolt (level 4) to open: damage and slow."
[2] https://wow4ever.quest/en/spellbook/mage-frostbolt
    > "4 Launches a bolt of frost at the enemy, causing 70 Frost damage and slowing movement speed by 40% for 7 sec."
[3] https://wow4ever.quest/en/spellbook/mage-ice-lance
    > "1 Deals 28 Frost damage to an enemy target. Deals 300% increased damage to Frozen targets."
