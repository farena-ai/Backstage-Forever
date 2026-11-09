# Build roadmap

## 0.4.0 implementation

- Guided first-run and migration setup, bounded Forever discovery, automatic addon preparation/readback and repair, visible phases and next actions.
- Local quest/objective, ready-turn-in and XP dashboard; optional out-of-combat Adventure Compass; actual public-API waypoints and bounded observed turn-in history.
- Bounded approved AI context with exact preview and persistent opt-out; no journal/private identifiers and no background inference.
- Automatic provider/model/character/note saving, visible retryable status, encrypted key saving on blur, Enter to send and Shift+Enter for a newline.
- Existing original paintings plus sculpted SVG/CSS controls, gems/runes and ambient motion, with reduced-motion and hidden-window handling.
- Schema version 1 remains compatible through optional snapshot fields. Private journals survive newer imports and stable form targets preserve the intended character.

## Next: supported full-client acceptance

1. Confirm addon loading, public race/faction/quest/XP APIs, observed turn-ins, waypoint availability, in-game HUD appearance, combat hiding, reload/logout saves, switching characters and partial-file recovery in the actual Forever client.
2. Exercise real ChatGPT/Claude consent, prompts, refresh/logout/reset, cancellation and limits using authorized accounts. Catalogs do not certify entitlement or billing coverage.
3. Verify clean Windows install/upgrade/uninstall and actual self-update with data preservation. Add Authenticode when a publisher certificate is available; Ed25519 update integrity is separate.
4. Continue keyboard, compact-layout, reduced-motion and screen-reader acceptance.

## Later, with verified data

Expand quest guidance only around supported APIs and verified quest-guide data. Current observed quests and a bounded recent-history window are not a complete quest database or an optimal route planner. Never invent NPCs, destinations, completed quest names or a realtime desktop feed.

Grok subscription needs a verified isolated official route and private credential lifecycle before enablement; xAI API mode remains available. Intentional sharing and optional voice remain possible later work.

No automated play, combat computation, credential sharing, unsupported live bridge or external release watcher jobs. See [Validation](VALIDATION.md) for evidence and remaining gates.
