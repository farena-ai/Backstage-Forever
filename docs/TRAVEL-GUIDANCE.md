# Forever travel guidance

This local, unreleased reference answers a small set of Forever trips with dated evidence. Ask a trip in Companion to see conditional route cards, source details and a manual Save trip plan action. Recognized travel works without a model or provider connection and makes no inference or credential request. Public 0.12.3 and the held 1.0 release are unchanged.

## A beginner's Orgrimmar to Thunder Bluff trip

If a shared, dated addon snapshot identifies the matching build and Horde faction, the first suggestion is to check Doras for Thunder Bluff. Take that flight only if he actually offers the destination. Someone else's published flight observation does not tell us which routes your character has learned.

The separate published road fallback leaves Orgrimmar's main gate, heads south toward Razor Hill, west across Southfury bridge past Far Watch Post, south toward Crossroads and Camp Taurajo, west into Mulgore toward Bloodhoof Village, then north to the Thunder Bluff lifts. These are broad landmarks, not turn-by-turn navigation, a level recommendation or a safety assessment.

The November 6 guides explicitly say there is no direct **Orgrimmar to Thunder Bluff zeppelin**. That is a claim about this direction and mode only. Other Horde zeppelins are covered. The reverse negative was not independently established and is not generated.

An offered flight may save walking, but the planner does not know your actual fastest route, prices, travel times, available hearthstone or current service operation.

## What is covered

The pack contains 17 distinct city/boarding nodes, 16 directed transport segments, one road itinerary and one explicit negative:

- Six independently observed flights between Orgrimmar, Thunder Bluff and Crossroads, in both directions. Efficient Games published these for build `1.60.1.70862`, observed November 9, 2026. Doras, Tal and Devrak are the three proven masters. Every suggestion is conditional on the destination being offered.
- Six separately documented zeppelin directions among the Orgrimmar, Tirisfal/Undercity and Grom'gol towers.
- Stormwind/Ironforge tram in each direction, and Stormwind Harbour/Auberdine boat in each direction.
- The Org to TB road itinerary and direct-zeppelin negative, from general November 6 guides.

The scheduled transport segments come from Method's **October 14, 2026 prelaunch general guide**, not an exact-build observation. The source date and qualification remain in each returned answer. Boarding stops are separate from cities: the Orgrimmar tower is outside the main gate and Tirisfal's tower is north of Undercity. Other city approaches and onward journeys are explicitly not mapped. The planner never silently joins these into a continent-wide path.

Ratchet to Booty Bay is deliberately excluded: its direction was documented, but the examined evidence did not establish neutral Forever eligibility. Its reverse was not explicitly enumerated. The named cities remain recognizable so both queries honestly return uncovered. This does not mean either trip is impossible.

Node 77/Camp Taurajo flight locality, skycutters, temporary incident portals, the contradictory Theramore example and all other observed flight entries are excluded. Camp Taurajo remains a road landmark only. No route is rejected merely because it is missing from this small pack.

## Saved information and unknowns

Explicitly named origins take priority. When sharing is enabled, a dated addon snapshot's recognized zone/subzone can supply an origin, always labeled **last saved, not live**. With sharing off, the caller must omit the profile entirely. Manual locations are not used as observed positions. Saved faction alone does not establish flight unlocks or exact-build flight evidence.

Unknown faction asks for faction before offering restricted transport; opposing faction does not receive it as usable. Missing, manual, undated or different-build snapshots cannot promote the exact-build flights, though a qualified general road alternative may remain. A named unknown endpoint is retained in the response rather than silently replaced with saved location. Multiple destinations ask for one trip. `if` is ordinary grammar; use `Ironforge`, not `IF`.

An explicit “This is for wow forever, not retail” correction can recover a previous original user travel question. It cannot recover a route from an AI answer or unrelated earlier topic. Conversation ownership and privacy checks belong to the companion caller. Invalid or missing reference data returns an unavailable result for recognized travel instead of sending an unsupported route guess to a provider.

## Offline reference and contributions

The app ships `data/forever-travel/` and performs no public-source fetch or update in this subsystem. Check it offline with:

```powershell
npm run check:forever-travel
npm run test:travel
```

For reproduction, place the three original-byte pinned files `flights.json`, `npcs.json` and `quests.enUS.json` in one developer-owned directory, then run:

```powershell
node scripts/build-forever-travel.cjs --source-dir "C:\path\to\travel-inputs" --check
```

Without `--check`, the explicit source-directory command writes the compiled pack and lock. It never downloads anything. Normal checks use only shipped resources and immutable descriptors, never those raw files. Optional raw reproduction tests run when `TRAVEL_SOURCE_DIR` names that directory; otherwise that one test is explicitly skipped.

Contributions must establish named endpoints, independently supported direction, boarding point, mode, faction scope, source dates and limits. Provide immutable raw bytes/hash/metadata where an actual public dataset supports the fact, and a license/attribution assessment. Keep original wording; do not copy guide prose, maps, images or client Lua. Do not generate reverse edges, player unlocks or an unavailable-route claim from absence. Reproduction and review must deliberately update the canonical compiled identity in `travel-data.cjs`; adjusting a file-local checksum alone cannot authorize different factual wording.

Bounds: compiled pack 256 KiB, raw files 4 MiB each/5 MiB total, at most 64 nodes, 128 edges, 32 sources, 16 negatives, 16 itineraries, 12 steps, 8 sources per fact and 4 aliases per node. All facts are validated atomically; malformed or altered provenance disables this reference.

## Attribution

Data from Efficient Games (https://efficient.games), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The compilation and observations are pinned at `23f9636486d3d60479dc0bcee2356053c33faf2c`; raw metadata remains in the source lock. Selected master IDs, normalized positions, six direct flight observations and tiny factual locality mappings are transformed. Costs, times and quest narrative are omitted. The publisher's license does not grant rights to Blizzard content, and this data is not relicensed as MIT.

Original factual curation cites [GamerBlurb](https://gamerblurb.com/articles/how-to-get-to-thunder-bluff-from-orgrimmar-in-wow-forever), [How To Video Game](https://howtovideogame.com/wow-forever-thunder-bluff-get-to/) and [Method](https://www.method.gg/wow-forever/all-travel-routes-in-wow-forever-boats-zeppelins). Their authored prose and assets are not redistributed. See the shipped NOTICE, full CC BY license and [third-party notices](THIRD-PARTY-NOTICES.md).

## Using the companion

Ask “what is the fastest way from org to tb”. A Forever correction or “can I walk instead?” keeps the original user trip. Missing starting place, destination or faction gets a focused clarification; unrelated questions retire that pending trip. Reporting “Horde” applies only to this trip and cannot manufacture an observed matching client build.

The **Forever travel reference · local** badge distinguishes these replies from AI suggestions. Expand **How we know** for source scope, publication/observation dates and reviewed dates. Source buttons open only the fixed published reference registry. No live availability or globally fastest route is claimed. Copy full guidance retains all conditions and citations, using only the current completed main-owned route token. Stale choices are refused; other local replies offer selectable full guidance. No browser clipboard permission is requested.

**Save trip plan** creates a local manual checklist in Plans (currently Company). It does not track quests, infer completion, issue waypoints or control the game. Repeating the same unchanged plan reuses it. Existing limits of 20 plans and 50 steps apply atomically; a failed save leaves the journal unchanged. Ask again after character/provider/sharing/source changes, Clear, Stop or journal replacement. Ordinary page navigation and saving reviewed memory retain the completed choice.

Character sharing off excludes the entire saved profile from local resolution. When on, only faction, client build, saved location and observation kind/date qualify travel; private notes, goals and source paths never do. Last-saved location is not a live position. Local replies can be explicitly reviewed and saved as memory under the same rules as any exchange.

Integration verification: `npm run test:travel-companion` runs focused unit checks followed by the isolated synthetic Electron fixture serially.
