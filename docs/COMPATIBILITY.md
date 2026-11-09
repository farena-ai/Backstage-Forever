# Compatibility and evidence

Evidence date: **2026-11-09**. Local manual profiles and notes work without a game connection or AI. Automated fixtures establish tested behavior, not live account entitlement or game-client acceptance.

## Optional Forever addon

Local files identify product `wowf`, client `1.60.1.70862`, with Interface `16001` evidence in client configuration. The addon declares Interface 16001 and guards public API availability. This is loader/configuration evidence, not proof that the running client loaded every feature successfully.

Choose **Start my adventure**. Bounded common-folder/registry discovery prepares one validated Forever folder automatically, offers choices for several, or lets you choose a folder. All five owned files are read back, and missing/outdated owned files are repaired. Preparation is distinct from actual addon loading and an initial desktop snapshot. Enable the addon in the game if needed; a running game may require a voluntary restart or UI reload to load new files. No account credentials are needed. See [Game Connection](GAME-CONNECTION.md).

The 0.7 native Compass updates its short local plan outside combat from supported public events, without routine reloads or the desktop app running. Logout/game exit writes SavedVariables; an optional voluntary UI reload can save sooner. The desktop checks saved exports every five seconds while open and combines valid account exports. It cannot see unsaved character changes, discover unvisited characters through an account API or provide a continuous live feed. The latest valid saved active character controls following; deliberate selection pauses following until its checkbox is restored.

Actual client acceptance must verify addon loading, public race/faction and quest/XP APIs, observed turn-ins, provided waypoints, in-game Adventure Compass pixels/drag/collapse/combat hiding, level/zone changes, reload/logout writes, character switching, timestamp freshness, disconnect and preservation of notes/goals. The in-game HUD can update out of combat while the desktop still waits for reload/logout disk saves. Recent named history is limited to 25 observed turn-ins. In 0.6 a complete supported public read may additionally save up to 20,000 completed quest IDs locally; unavailable, protected, partial or oversized history stays unknown. These IDs do not create a complete historical quest-name database. Schema version 1 retains compatibility through optional fields. Synthetic addon-runtime and parser tests cannot replace this. No code execution, input automation, combat decisions, memory reads or protected-value bypass is supported.

## Forever reference compatibility

The 0.7 addon includes an offline, safely escaped Lua compilation of the pinned bundled reference plus a pure local planner. This is packaged with the app, not generated from runtime public downloads. Exact build/ID and current-title compatibility still gate community directions; current game observations take priority. Native planner and frame/timer behavior are verified with synthetic runtime fixtures, not blanket certification of all APIs in the running client.

The initial 0.6 quest pack is pinned to live product `wowf`, build `1.60.1.70862`, English `enUS`, with a November 7–8 collection window. It is a community compilation of observations and server-cache answers, not a Blizzard-endorsed complete guide. Exact IDs distinguish same-title quests. Reference-only records do not establish playability, and reported next links do not establish all prerequisites. A known unsupported client build does not borrow the bundled pack for character guidance. Manual or unknown-build profiles may browse explicitly labelled reference details; those details do not enable automatic compatible destinations. See [source and coverage](FOREVER-DATA.md).

The updated addon exports optional client build, locale, capture version, objective counts/types and completed IDs through guarded public APIs. These additions and `/bf guide` have isolated Lua and desktop acceptance gates; they still require real-client acceptance after installation. Missing waypoint APIs print coordinates rather than forcing map behavior. No real-client acceptance of a new 0.6 field is implied by older 0.4.1 capture evidence.

## AI connections

Local Ollama can operate offline with locally available models. Ollama Cloud is separate: fixed `https://ollama.com`, its own Bearer key and native chat. API and subscription modes remain explicit, with no silent fallback.

ChatGPT's authenticated account catalog determines listed subscription visibility. API model catalogs and Claude's official CLI initialization do not prove that every listed model is entitled to your plan. Catalog refreshes do not run paid inference. Claude subscription uses a separately installed official CLI and app-private profile; managed administrator policies may affect that external executable. Live OAuth/consent, account limits and paid inference remain acceptance gates.

Grok subscription remains unavailable because the tools/hooks isolation boundary is unresolved. xAI API mode remains available. The local off-topic gate and shared specialist policy reduce unrelated requests; neither guarantees perfect model behavior.

## Windows distribution

The public GitHub preview release channel is independent of app-store testing tracks. Update manifests use pinned Ed25519 integrity and installer hash/size checks. The installer is still unsigned with Windows Authenticode. Clean-machine installation, real installed self-upgrade/uninstall, keyboard and screen-reader acceptance remain separate gates. No publication or successful live upgrade is certified by this page.
