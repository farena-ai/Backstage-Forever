# Compatibility and evidence

Evidence date: **2026-11-09**. Local manual profiles and notes work without a game connection or AI. Automated fixtures establish tested behavior, not live account entitlement or game-client acceptance.

## Adventure Company and shared journeys

Company uses the characters and observations BF has already collected. Preparation adds bounded observations of owned professions, learned recipes and carried materials; it does not introduce an account API, external recipe database or continuous desktop feed. Editable templates are player checklists, not class-role assignments, gear scores or dungeon eligibility verdicts. Manual and unknown observations remain distinct from saved game facts.

A tracked quest can gain durable observed completion only from newer, same-identity/build saved evidence relative to its baseline. Ready objectives or removal from the log alone are insufficient. Repeatables already in completed history require a new observed turn-in; missing history can leave progress unconfirmed. Restored backups and removed characters retain honest source/orphan labels. See [Adventure Company](ADVENTURE-COMPANY.md).

The native bag-space cue consumes existing guarded readiness data, adding no new game API. Zero/unavailable capacity produces no warning. Actual native rendering and live bag/combat/character transitions still require player-led acceptance in the current client; fixtures are separate evidence.

## Optional Forever addon

Local files identify product `wowf`, client `1.60.1.70862`, with Interface `16001` evidence in client configuration. The addon declares Interface 16001 and guards public API availability. This is loader/configuration evidence, not proof that the running client loaded every feature successfully.

Choose **Start my adventure**. Bounded common-folder/registry discovery prepares one validated Forever folder automatically, offers choices for several, or lets you choose a folder. All five owned files are read back, and missing/outdated owned files are repaired. Preparation is distinct from actual addon loading and an initial desktop snapshot. Enable the addon in the game if needed; a running game may require a voluntary restart or UI reload to load new files. No account credentials are needed. See [Game Connection](GAME-CONNECTION.md).

The native Compass updates its short local plan outside combat from supported public events, without routine reloads or the desktop app running. Logout/game exit writes SavedVariables; an optional voluntary UI reload can save sooner. The desktop checks saved exports every five seconds while open and combines valid account exports. It cannot see unsaved character changes, discover unvisited characters through an account API or provide a continuous live feed. The latest valid saved active character controls following; deliberate selection pauses following until its checkbox is restored.

Actual client acceptance must verify addon loading, public race/faction and quest/XP APIs, observed turn-ins, provided waypoints, in-game Adventure Compass pixels/drag/collapse/combat hiding, level/zone changes, reload/logout writes, character switching, timestamp freshness, disconnect and preservation of notes/goals. The in-game HUD can update out of combat while the desktop still waits for reload/logout disk saves. Recent named history is limited to 25 observed turn-ins. In 0.6 a complete supported public read may additionally save up to 20,000 completed quest IDs locally; unavailable, protected, partial or oversized history stays unknown. These IDs do not create a complete historical quest-name database. Schema version 1 retains compatibility through optional fields. Synthetic addon-runtime and parser tests cannot replace this. No code execution, input automation, combat decisions, memory reads or protected-value bypass is supported.

## Forever reference compatibility

The addon includes an offline, safely escaped Lua compilation of the pinned bundled reference plus a pure local planner. This is packaged with the app, not generated from runtime public downloads. Exact build/ID and current-title compatibility still gate community directions; current game observations take priority. Native planner and frame/timer behavior are verified with synthetic runtime fixtures, not blanket certification of all APIs in the running client.

The 0.12 quest pack is pinned to live product `wowf`, build `1.60.1.70862`, English `enUS`, with observations through November 9, 2026 at immutable source commit `23f9636486d3d60479dc0bcee2356053c33faf2c`. It is a community compilation of observations and server-cache answers, not a Blizzard-endorsed complete guide. Exact IDs distinguish same-title quests. Reference-only records do not establish playability, and reported next links do not establish all prerequisites. A known unsupported client build does not borrow the bundled pack for character guidance. Manual or unknown-build profiles may browse explicitly labelled reference details; those details do not enable automatic compatible destinations. See [source and coverage](FOREVER-DATA.md).

The updated addon exports optional client build, locale, capture version, objective counts/types and completed IDs through guarded public APIs. These additions and `/bf guide` have isolated Lua and desktop acceptance gates; they still require real-client acceptance after installation. Missing waypoint APIs print coordinates rather than forcing map behavior. No real-client acceptance of a new 0.6 field is implied by older 0.4.1 capture evidence.

## Additional game destination observations

0.12 preserves a valid direct game waypoint before considering complementary map-specific queries. New fallbacks use actual validated map identities, guarded public values and bounded per-capture caches. An unambiguous in-progress quest-area observation is only an unfinished-objective fallback; it never becomes a ready turn-in location. The text explicitly says that a quest area is not an exact NPC or spawn location, including in the native Compass's shortened preview.

Missing, protected, malformed or contradictory optional observations leave the new fallback unavailable. They do not justify guessed conversions or map/input automation, and an unavailable new optional map API does not erase an otherwise valid direct point. These are independently implemented generated-API-shape/Lua tests, not real-client certification. The owner must compare actual destinations in the running client before 1.0.

## Preparation, Party and optional voice

Recipe and material observations retain their own dates and complete/partial coverage. Exact shortfalls require complete applicable carried counts; missing data is not zero, and other characters are never silently pooled. Historical seller facts are separate offline observations, qualified by exact build and observed faction reactions. No stock, price, access or purchase guarantee is inferred. Missing faction evidence stays unknown.

Party roles are chosen by the player, not inferred. Portable plans contain only reviewed title/step text; opening an imported file does not add it. Explicitly added imports receive new local IDs and manual, unchecked, unassigned steps without completion proof. There is no party service or automatic messaging.

Compatible installed local Windows speech engines are optional. Capability enumeration and fake-worker lifecycle tests do not establish microphone permission, recognition accuracy or audible stop quality. Typed questions remain available. Saved character memory is explicit readable local data, excluded from backups; future sharing requires a separate per-question selection. See [the owner check before 1.0](OWNER-CHECK-012.md).

## AI connections

Local Ollama can operate offline with locally available models. Ollama Cloud is separate: fixed `https://ollama.com`, its own Bearer key and native chat. API and subscription modes remain explicit, with no silent fallback.

ChatGPT's authenticated account catalog determines listed subscription visibility. API model catalogs and Claude's official CLI initialization do not prove that every listed model is entitled to your plan. Catalog refreshes do not run paid inference. Claude subscription uses a separately installed official CLI and app-private profile; managed administrator policies may affect that external executable. Live OAuth/consent, account limits and paid inference remain acceptance gates.

Grok subscription remains unavailable because the tools/hooks isolation boundary is unresolved. xAI API mode remains available. The local off-topic gate and shared specialist policy reduce unrelated requests; neither guarantees perfect model behavior.

## Windows distribution

The public GitHub preview release channel is independent of app-store testing tracks. Update manifests use pinned Ed25519 integrity and installer hash/size checks. The installer is still unsigned with Windows Authenticode. Clean-machine installation, real installed self-upgrade/uninstall, keyboard and screen-reader acceptance remain separate gates. No publication or successful live upgrade is certified by this page.
