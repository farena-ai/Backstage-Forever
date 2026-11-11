# Compatibility and evidence

Evidence date: **2026-11-11**. Local manual profiles and notes work without a game connection or AI. Automated fixtures establish tested behavior, not live account entitlement or game-client acceptance.

## Adventure Company and shared journeys

Company uses the characters and observations BF has already collected. Preparation adds bounded observations of owned professions, learned recipes and carried materials; it does not introduce an account API, external recipe database or continuous desktop feed. Editable templates are player checklists, not class-role assignments, gear scores or dungeon eligibility verdicts. Manual and unknown observations remain distinct from saved game facts.

A tracked quest can gain durable observed completion only from newer, same-identity/build saved evidence relative to its baseline. Ready objectives or removal from the log alone are insufficient. Repeatables already in completed history require a new observed turn-in; missing history can leave progress unconfirmed. Restored backups and removed characters retain honest source/orphan labels. See [Adventure Company](ADVENTURE-COMPANY.md).

The native bag-space cue consumes existing guarded readiness data, adding no new game API. Zero/unavailable capacity produces no warning. Actual native rendering and live bag/combat/character transitions still require player-led acceptance in the current client; fixtures are separate evidence.

## Optional Forever addon

Local files identify product `wowf`, client `1.60.1.70862`, with Interface `16001` evidence in client configuration. The addon declares Interface 16001 and guards public API availability. This is loader/configuration evidence, not proof that the running client loaded every feature successfully.

Choose **Start my adventure**. Bounded common-folder/registry discovery prepares one validated Forever folder automatically, offers choices for several, or lets you choose a folder. All twelve owned files are read back, and missing/outdated owned files are repaired. Preparation is distinct from actual addon loading and an initial desktop snapshot. Enable the addon in the game if needed; a running game may require a voluntary restart or UI reload to load new files. No account credentials are needed. See [Game Connection](GAME-CONNECTION.md).

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

## Native adventure map foundation (0.13 preview)

The own pin XML mixes the complete native map-pin base during engine frame creation, before the native pool calls `SetOwningMap`. The provider attaches passively when the real world-map frame/base/template are available, explicitly refreshes an already-visible map, and removes only its own pins. No map opening, addon forcing, polling, input simulation or tracking changes are used. Synthetic fixtures cover actual provider/acquire/release order, properties-backed vectors, late attachment, same-map points, filters and stale callbacks. This is source-contract evidence against the inspected 70862 UI mirror; current 70888 client rendering, zoom, interaction and performance remain unverified owner gates before 1.0.

The native minimum is current/qualified quest markers, the existing seven acquisition relations and supported private finds. The desktop's existing seller pack is broader; complete merchant/trainer/gathering coverage is not claimed in game. Exact 70862 historical coordinates remain older browse references on 70888. A new own interaction may carry the actual current build when all current cast/source/name/material evidence agrees; that does not promote old coordinates, ranks or availability to current facts.

Recording is intentionally narrow: known English target-name/object relations, own Mining 2576 or Herbalism 2368 cast, a single readable GameObject loot source and material evidence within bounded time/map/displacement checks. Unknown locales, missing targets, corpses, containers, competing sources and protected values are skipped. Saved findings are approximate past standing points, never active resource presence or quantity collected. Real mining and herbalism capture each need owner-led observation; a synthetic fixture does not certify the client.

`loadedGatheringSchema: 1` is a connected valid saved-format receipt only; `null` means no such current receipt. It can be 1 with an empty or capability-unavailable gathering block. Missing/invalid/unreadable saved data cannot claim feature loading, and imported backups do not reconnect a source. Files prepared, saved format received and live client acceptance are three different facts. Preview version is 0.13.7; 1.0 is held.

## Desktop Map qualification

Adventure → Map is an offline last-saved coordinate projection, bounded to 128 same-area points, including at most 64 exported personal observations. It uses all 25 bounded saved quest candidates before the final display cap. Current saved quest markers, compatible approximate quest references, historical material/seller standing points and personal standing interactions retain separate labels. Missing or invalid optional history cannot resurrect old points; damaged optional references preserve valid game markers and personal observations.

The seven selected acquisition relations target build 1.60.1.70862. A 1.60.1.70888 character can browse them only as older references. Existing quest build/title/phase checks are preserved even when older browsing is on. The desktop can also show the broader existing seller catalog, with independent faction, stock and date qualifications; this is explicitly broader than the native seven-relation subset. No trainer coverage, exact spawn coordinates, rank requirement, active spawn, route safety or ETA is inferred.
