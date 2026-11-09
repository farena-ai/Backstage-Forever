# Capture lifecycle and character selection repair

Live 0.6 acceptance found a saved hunter profile with activeProfileId null and followGameCharacter false. The native select visually displays the first option, but no active profile reaches Adventure. Selecting the roster card restores identity/location/quest data. A previous game-owned SavedVariables backup has valid XP and complete IDs; a newer snapshot replaces these with zeros at logout. The current warrior is visible in the native HUD but has not yet reached the desktop disk snapshot.

Approaches considered: repair only the user's selection (immediate relief, no prevention); infer missing fields from older captures (risks false completion/history); repair lifecycle and canonical selection (recommended). Do not treat a zero API observation as proof of teardown outside the lifecycle boundary.

Design: normalize null selection with a nonempty validated roster to the first profile while preserving any explicit valid selection and the follow preference. Empty rosters retain null; dangling non-null IDs still fail validation. Addon must not capture or overwrite saved export before PLAYER_LOGIN restores its bounded roster. At logout, preserve the latest prepared export and stop further capture rather than querying torn-down APIs. PLAYER_ENTERING_WORLD can refresh once ready. Keep supported APIs, combat guards, data bounds, privacy and manual reload/logout disk semantics unchanged.

Tests must reproduce blank-selection/follow-off and pre-login/teardown corruption with synthetic data before source changes; cover two characters across reload/login and existing size/security assertions. No real game reload, character switching, gameplay inputs, paid inference or publication of player data. Release a signed 0.6.1 repair after tests/review/build/public verification. User performs installation and reload.

Self-review: scope is the demonstrated selection and capture lifecycle failure, not unknown APIs or quest guidance expansion. Never-visited characters remain unavailable.

## Added user requirement: readable themed dropdowns

The user reports opened session/focus and other dropdowns have white backgrounds with faint text. Include a global dropdown contrast repair in 0.6.1. Prefer themed native selects/options with explicit dark menu backgrounds, warm readable text and a clear selection cue, preserving the existing fantasy style, keyboard operation, focus and disabled states. A full custom combobox replacement adds unnecessary behavior risk to this repair. Native platform menus may limit decorative images; do not promise unsupported popup styling. Verify all select contexts in real Electron using computed contrast and inspect an actual expanded Windows popup. No edits to the player's app data or OS accessibility settings.
