# Compatibility and evidence

Evidence date: **2026-11-08**. Local manual profiles and notes work without a game connection or AI. Automated fixtures establish tested behavior, not live account entitlement or game-client acceptance.

## Optional Forever addon

Local files identify product `wowf`, client `1.60.1.70862`, with Interface `16001` evidence in client configuration. The addon declares Interface 16001 and guards public API availability. This is loader/configuration evidence, not proof that the running client loaded every feature successfully.

Choose **Set up my companion**. Bounded common-folder/registry discovery falls back to a native folder picker. A validated Forever folder is prepared automatically, all three owned files are read back, and missing/outdated owned files are repaired. Folder discovery/preparation is distinct from actual addon loading. Only this app's addon files are changed. Enable it in the game; a running game may require a voluntary restart or UI reload. No account credentials are needed. See [Game Connection](GAME-CONNECTION.md).

**Levelled up or changed areas? Type `/reload` in WoW to refresh your companion.** Logout also writes SavedVariables. The desktop checks saved exports every five seconds while open. It cannot see unsaved changes, discover unvisited characters through an account API or provide a continuous live feed. The newest account snapshot identifies the last played character; deliberate selection pauses default following until its checkbox is restored.

Actual client acceptance must verify addon loading, public race/faction and quest/XP APIs, observed turn-ins, provided waypoints, in-game Adventure Compass pixels/drag/collapse/combat hiding, level/zone changes, reload/logout writes, character switching, timestamp freshness, disconnect and preservation of notes/goals. The in-game HUD can update out of combat while the desktop still waits for reload/logout disk saves. Quest history is limited to 25 observed recent turn-ins and optional public completed-count (bounded to 20,000 entries), not complete historical quest names. Schema version 1 retains compatibility through optional fields. Synthetic addon-runtime and parser tests cannot replace this. No code execution, input automation, combat decisions, memory reads or protected-value bypass is supported.

## AI connections

Local Ollama can operate offline with locally available models. Ollama Cloud is separate: fixed `https://ollama.com`, its own Bearer key and native chat. API and subscription modes remain explicit, with no silent fallback.

ChatGPT's authenticated account catalog determines listed subscription visibility. API model catalogs and Claude's official CLI initialization do not prove that every listed model is entitled to your plan. Catalog refreshes do not run paid inference. Claude subscription uses a separately installed official CLI and app-private profile; managed administrator policies may affect that external executable. Live OAuth/consent, account limits and paid inference remain acceptance gates.

Grok subscription remains unavailable because the tools/hooks isolation boundary is unresolved. xAI API mode remains available. The local off-topic gate and shared specialist policy reduce unrelated requests; neither guarantees perfect model behavior.

## Windows distribution

The public GitHub preview release channel is independent of app-store testing tracks. Update manifests use pinned Ed25519 integrity and installer hash/size checks. The installer is still unsigned with Windows Authenticode. Clean-machine installation, real installed self-upgrade/uninstall, keyboard and screen-reader acceptance remain separate gates. No publication or successful live upgrade is certified by this page.
