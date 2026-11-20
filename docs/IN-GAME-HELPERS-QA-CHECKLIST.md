# In-Game Helpers QA — local only

Base: public 1.16.0 (`51137d0`). Helper source: develop integration `e7bc5bd`, with only the native Compass dependencies needed for the helper loop. This candidate reserves numeric `1.16.901` for the addon/capture-version parser; it is not a release identifier. No update feed, desktop installer, signing, or publishing is part of this candidate. The original integration qualification is background, not this candidate’s test receipt.

The delta excludes post-stable Companion/Workshop work, DPS coaching, starter/triage views, new general Compass presets/mute, and unrelated route data. The existing Compass collapse and baseline junk-sale protections remain.

## Manual live check (not run)

Use a disposable WoW Forever installation/profile. Back up that **test** profile’s addon folder and SavedVariables with the client stopped. Record the exact build, locale, character, test ZIP SHA-256 and outcome per row. Extract the ZIP into the disposable client’s `Interface/AddOns`; verify that the client loads `BackstageForever` version `1.16.901`. Start with the desktop closed. A missing API/data shape is a blocked row, not a pass. Do not use a real account’s valuables for merchant/reward tests.

| Check | Steps and expected result |
| --- | --- |
| Native preferences | Open `/bf helpers panel` in English and German; check all 11 labels fit. Disable `questTracker` with a checkbox, query `/bf helpers questTracker`, `/reload`, and query again. Verify a fresh alt defaults on and returning to the first character preserves explicit off. Test with desktop still closed. |
| Compass | Watch a quest with visible unfinished counts; verify title and counts. Try `/bf compass track QuestID`, `/bf compass missing`, then `/bf compass track clear`. A missing current-map marker must not offer a waypoint. Use `/bf compass review` beside a ready local hand-in; it is independent of the tracker. On `1.60.1.70888`, browse a noninitial route step before taking the offered local detour. Acceptance must not place a waypoint; click the waypoint explicitly. Cancel once; then repeat and turn in the exact quest. Verify the browsed step resumes or the route advances only for real route progress. Recheck after a map transition and combat. |
| Objective hints and vendor | On `1.60.1.70862` or `1.60.1.70888`, verify a reviewed watched objective on the correct target; a lookalike or completed objective must not produce a hint. For Lazy Peons, treat “sleeping” as a condition to check yourself. At a vendor with disposable items, confirm preview excludes protected or unreadable-status items and protection remains with optional hints off. Never authorize a sale merely to clear the check. |
| Gathering | On `1.60.1.70862`, manually gather a supported node; verify the map shows an approximate last-seen spot, not a live spawn. Switch map or character and check the spot does not follow. Toggle the helper off/on. |
| Quest rewards | Check a real reward choice with known stats and usability, then a mixed or uncached comparison. Only qualifying evidence should glow, and no reward should be selected or equipped by the addon. Close/reopen the same quest and toggle off while item data may still load; an old callback must not repaint. Prior gear opt-out still wins. |
| Spell rank | On `1.60.1.70959` with a Mage who knows Frostbolt ranks 3 and 4, place rank 3 in a real spell action slot. Verify the narrow reminder; replace it manually and verify no stale recommendation. An unlearned rank, wrong build, wrong action kind or combat must not produce a new reminder. No automatic casting, equipment or rebinding. |
| Desktop handoff | In isolated desktop Settings → Game connection → In-Game Helpers, open a row by keyboard and verify the literal `/bf helpers` commands. The desktop must neither apply the setting nor report it applied; the in-game chat/panel is the authority. |

Rollback only in the test environment: close WoW, restore the backed-up addon and test SavedVariables, and confirm the original addon version loads. Do not use the QA ZIP as a production upgrade.
