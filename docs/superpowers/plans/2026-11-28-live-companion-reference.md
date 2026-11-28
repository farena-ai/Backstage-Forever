# Live Companion reference implementation

1. Recompile the existing quest and NPC packs from locked source bytes. Verify added observations and generated references with the existing build tools.
2. Extend the travel catalog and add Blizzard-sourced lore. Cover natural questions and qualifiers with deterministic tests.
3. Project a matching live frame into local travel, NPC and quest lookups. Keep sharing, identity and saved fallback behavior under test.
4. Run the player-question benchmark, live/fallback service tests and native Companion checks. Inspect the running game only through BF's existing read-only live link.
