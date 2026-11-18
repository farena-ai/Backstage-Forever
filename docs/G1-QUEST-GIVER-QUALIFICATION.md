# G1: local quest-giver qualification

**Disposition:** fixture-only foundation, based on `18d7d4ac7217d99298a7eb033dafc1d204563602`. The [v1 contract](../community-server/CLIENT-CONTRACT.md), sharing defaults, and all live client, addon, route, pack and server paths are unchanged. No new preferences are persisted, and this module neither opens a connection nor reads or writes files.

## Local fact contract

`src/core/community-quest-givers.cjs` exposes two pure functions. `validateQuestGiverFact(fact, supportedBuilds)` accepts only the six own fields below and returns a canonical copy or `null`. `projectQuestGiverFact(observation, { shareQuestGivers, supportedBuilds })` produces the same fact or `null`:

| Fields | Validation |
| --- | --- |
| `questId`, `npcId`, `mapId` | Exact positive integer quest, creature entry and UI map IDs, each at most 2,147,483,647. No strings or substitute IDs. |
| `build` | Exact four-part client build, in an explicit allowlist. No prefix, latest-build fallback, or production allowlist in this slice. |
| `x`, `y` | Finite map fractions in `[0,1]`, rounded to the existing 0.005 grid. |

The projector requires explicit `shareQuestGivers: true` independently of legacy community sharing. Its only qualifying input is an observation with its own `clientBuild`, `q`, `n`, `m`, `x`, `y` and the proposed `evidence: "quest-accept-exact"` marker from a future qualified producer. No raw input, local marker, character, realm, GUID, timestamp, history, install ID, or free text is returned. This validates shape and provenance requirements at the projection boundary; the marker is not proof of event authenticity.

**No current observation is qualified.** The existing addon remembers an NPC from `QUEST_DETAIL` and pairs it with a later `QUEST_ACCEPTED`, records a player standing point, and does not attach an observation-time build to the giver row. A profile's latest build, an NPC position by itself, a quest title, or a reference lookup cannot repair those omissions. Do not relabel or backfill those rows. A future producer needs a validated public-API link between the accepted quest ID and the interacting creature, a supported build at observation time, and a defensible position on the exact UI map. If those cannot be established, omit the fact.

## Gates before contract integration or promotion

1. Qualify the producer on each approved build and review the exact outgoing fields and separate default-off consent. No presets, setup flows, or existing community switch may enable it. Revocation must prevent queued or retried sends; the current foundation has no queue or transport.
2. Qualify the server first, using an explicit version/capability boundary. An old server rejects an unknown v1 submission key; a new client must omit it unless support is known and consent is on. Old clients must continue to submit and read unchanged. Keep quest-giver facts out of `npcs`; a format-1 reader ignores unknown sections, so repurposing a known section would break that isolation. Specify batch/body limits, exact-build aggregation and per-install deduplication, scoped deletion, rate limits/backoff and offline fallback before wiring. Test the version matrix and rollback on isolated fixtures before requesting operator approval.
3. Treat agreement as a review lead, not as truth: require at least three distinct installations agreeing on the exact build/quest/NPC/UI map/rounded location, deduplicate repeat reports and investigate conflicting locations or identities. Prior to any static-pack change, record the exact build and IDs, immutable source and digest/attribution, corroborate the quest-to-NPC offer and map independently, document coordinate uncertainty and exclusions, and check faction/race and prerequisite gates separately. Community reports alone cannot establish eligibility or produce an automatic waypoint. Unresolved evidence stays browse-only; this slice promotes nothing.

The new tests run without HTTP: `node --test tests/community-quest-givers.test.cjs`. They cover the fact and consent boundary, actual legacy journal normalization, and the existing v1 client collector, server validator and pack reader. Live producer, service staging/rollback, and deployment are deferred.
