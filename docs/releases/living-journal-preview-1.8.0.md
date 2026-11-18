# Backstage Forever 1.8.0 — Living Journal preview

Opt-in public preview for Windows x64 and the standalone WoW Forever addon. The Windows installer is timestamped and signed by Frank Arena through Azure Artifact Signing. This is not an automatic update; v1.7.0 remains the stable release. The desktop installer is not a side-by-side installation: back up your journal before upgrading. A macOS preview is not included.

- **Now, Map, and Ledger:** next-action-first dashboard, character-specific artwork, recorded progress, clearer map controls, and more readable inventory tables.
- **Badge Case:** find it from Now or the character journal. Search 54 character and 7 account badges. The new desktop-only awards are labeled. In the addon, `/bf badges pin` shows supported Compass goals.
- **Goals and professions:** pin one desktop quest, profession checkpoint, or reputation goal per character, then resume it from Now. Material estimates distinguish saved bags, last-seen alt stock, missing, and unknown. Desktop pins do not sync back into WoW.
- **Compass and Dungeon Atlas:** one optional ready hand-in on the current map, plus dungeon preparation and saved encounter defeats. The Atlas does not infer dungeon clears or personal loot drops.

Automated tests, Lua save/reload replays, and packaged Windows smoke checks cover the preview. The live WoW Forever leveling and profession workflows still need real-client validation before stable promotion.

## Next on the roadmap

1. Validate leveling and profession sessions in the live client, including reload, interrupted live link, and combat behavior. Then qualify stable installation, updates, and rollback.
2. Add quest-chain, dungeon-victory, and faction-specific badges where saved evidence supports them. Finish and review the remaining raid boss tips.
3. Verify party sync with two players and localization in a German client. Pursue the opt-in macOS live link and addon-site publishing once the relevant test access and publisher setup are available.
4. Expand opt-in shared quest-giver observations after the community service can accept that evidence. Keep reference leads distinct from player-confirmed observations.
