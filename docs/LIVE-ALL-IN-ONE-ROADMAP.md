# Backstage Forever — Live All-in-One roadmap

**Product goal.** The native Adventure Compass is where a new or veteran player looks for “What should I do now?” Desktop is for deeper planning, practice, comparisons and history. The addon remains useful with the desktop closed, and the desktop remains useful offline with last-saved evidence. Improve the existing Compass, Guided Route, Map, Talents, Atlas, Party, Workshop, Ledger, Sheet, Journal and Companion instead of duplicating them. Give one action with a reason; let players dismiss or decline it without losing their goal.

**Baseline.** [v1.12.1](https://github.com/farena-ai/Backstage-Forever/releases/tag/v1.12.1) is the public baseline. It includes scoped offline dungeon/raid fact answers and the existing native Compass, routing, map, gear and profession foundations. The offline Practice Lab, narrow Frost Mage guide, Deadmines Fieldbook and local Guild Run Pack are implemented on the development branch, not released or live-client qualified by this document. Broader offline quest pickup and turn-in is held: 75/81 facts (92.6%) on the main bank versus a 95% gate; no evidence substitution or threshold reduction. The four existing priorities—Forever-only Companion, actionable answers, verified route coverage, planning and polish—remain active. See [All-in-One foundations](ALL-IN-ONE-ROADMAP.md), [Companion delivery and evidence gates](FOREVER-COMPANION-NEXT-ROADMAP.md), and [expansion backlog](FOREVER-EXPANSION-BACKLOG.md).

## Delivery order

1. **Qualify what is built.** Freeze an Academy desktop cut (Practice Lab plus the reviewed Frost Mage two-spell lesson) separate from unqualified quest advice and the other later features. Then qualify the Deadmines Fieldbook and the local Guild Run Pack in order. Don’t hold these offline/local features for rotation cues or hosted sync, and don’t represent fixture results as live WoW results.
2. **Make the native Compass the next live flagship.** Prove a single goal → justified next action → deliberate detour → resume path on one early route and one veteran prep workflow before making it generic. Implement independent components in parallel; keep release scope narrow.
3. **Connect planning to play.** Add exact actions, goal prerequisites, one profession or gear decision, and reviewed leveling legs alongside. Keep unsupported broader quest facts withheld while building unrelated workflows.
4. **Deepen role and group work.** Add one tank and healer lesson at a time, more Fieldbooks, local officer run planning, and personal debriefs. Live combat cues and sharing are independently gated.
5. **Make it survive patches.** Qualify capability gates, patch impact, portable packs, compatibility and rollback. Release small end-to-end cuts rather than waiting for the complete backlog.

## 1. Live Adventure Compass

| ID | Feature and reuse | Acceptance witness |
| --- | --- | --- |
| LIVE-C01 | One justified next action. Extend the native HUD and plan projection; fold other suggestions away. | Real HUD replay shows one compatible action and a reason, not a list of speculative alternatives. |
| LIVE-C02 | Session intent and optional time budget: leveling, gear, reputation, gathering, prep or exploration. Reuse session focus. | Changing intent does not replace the active goal, toggle permissions or promise unverified travel times. |
| LIVE-C03 | Detour and resume: one relevant same-map hand-in, trainer stop or material lead; preserve the original plan and dismissal state. | Pick a detour, dismiss or finish it, and resume the same step. Old actions cannot revive after a switch. |
| LIVE-C04 | Plan B for missing prerequisite, wrong faction, unavailable location or stale evidence. | One supported alternative or a clear unknown; no auto-navigation or invented route. |
| LIVE-C05 | Event-led progress from supported quest, level, zone and bag observations, without routine reload. | Registered event replay updates only affected state, skips never count as completion, and current identity wins over late observations. |
| LIVE-C06 | Beginner, compact and minimal layouts over the same facts; quiet combat, stale and disconnected modes. | Existing combat suppression remains, optional future role cue is separate, and standalone guidance recovers without desktop. |

## 2. Questing, leveling and travel

| ID | Feature and reuse | Acceptance witness |
| --- | --- | --- |
| LIVE-Q01 | First-hour guide: first quest loop, trainer, settings, contextual glossary. | One verified starter path can be completed with the desktop closed; jargon appears where needed. |
| LIVE-Q02 | Returning-player briefing: last chosen goal, observed progress and one resume action. | Last save age is visible; stale or missing evidence doesn’t masquerade as live progress. |
| LIVE-Q03 | Quest chains: exact prerequisites, optional branches and next verified action. | Same-title IDs don’t merge; in-log, objectives complete, turned in and unknown remain distinct. |
| LIVE-Q04 | Quest triage: ready turn-ins, shared routes, repeatables and work to defer. | A deferred quest remains available and nothing is auto-abandoned. |
| LIVE-Q05 | Flexible verified leveling routes for fewer trips, easy solo play or exploration; qualify faction/race legs incrementally. | Each edge has build/side/ID proof; no promise of continuous 1–60 from endpoints. |
| LIVE-Q06 | Compare public walking, flight, boat, zeppelin and hearth legs. | Missing links, unlocks and time estimates are labeled; no invented fastest route. |
| LIVE-Q07 | Field Map provenance, verified pins, approximate objective areas and private finds. | “Why is this pin here?” explains build, source and geometry; a reference pin is not a live spawn. |
| LIVE-Q08 | Co-op questing using the existing party path: exact shared quests and different stages. | A real two-player test proves character identity, scope, departure and quiet fallback before making new live claims. |

## 3. Class & Role Academy

| ID | Feature and reuse | Acceptance witness |
| --- | --- | --- |
| LIVE-A01 | Level-band class playbooks based on reviewed Forever spell/rank evidence and an explicit ownership check. | Unsupported build, unknown rank or wrong character withholds the advice; a manual spellbook check is labeled self-reported. |
| LIVE-A02 | DPS single-target first, then manual cleave/AoE, movement, resources and cooldown planning one verified spec at a time. | A reviewed lesson explains trade-offs, is offline and makes no optimal-DPS guarantee. |
| LIVE-A03 | Tank pull prep, positioning, threat concepts, defensive sequencing and recovery drills. | Useful without hidden threat or automatic taunt recommendations. |
| LIVE-A04 | Healer mana, triage, efficient/emergency choices, dispels and proactive prep. | Simulated scenarios work without reading protected party data or selecting a heal target. |
| LIVE-A05 | Spellbook/keybind coach for new ranks, detectable unplaced spells and manual layout templates. | Unknown ownership or binding stays unknown; never changes binds or bars. |
| LIVE-A06 | Practice Lab deeper scenarios and feedback; separate real dummy observations if sufficient evidence exists. | Several defensible choices explain consequences; simulation is never shown as measured play. |
| LIVE-A07 | Optional, gated native bar outline or icon: start with one reviewed spec. | Exact live build proves correctness, no blocked actions, quiet failure and acceptable frame cost. No cast, targeting, rebinding, protected-state inference or automation. |

## 4. Dungeons, raids and post-run coaching

| ID | Feature and reuse | Acceptance witness |
| --- | --- | --- |
| LIVE-D01 | Atlas Fieldbook: entrance, quest pickups, supplies, role duties, wishlist. Start with the Deadmines. | End-to-end run prep opens the exact destinations and distinguishes reference from Forever proof. |
| LIVE-D02 | First-run explanation and veteran compact view; reviewed role cards before pulls. | Same facts and actions in both, core prep stays visible, historical/Classic content is labeled separately. |
| LIVE-D03 | Personal progression journal: observed encounters, gear goals, unfinished quests. | Another character’s defeat, a boss kill, and missing observations cannot assert a clear, lockout or personal drop. |
| LIVE-D04 | After-action timeline with attributable evidence, manual notes and one actionable improvement. | Never asserts a speculative cause of death, invented score, or exact timing from incomplete coverage. |
| LIVE-D05 | Fieldbook → relevant Academy drill → same run plan and focus. | Keyboard round-trip keeps exact identity without moving/casting or losing private work. |
| LIVE-D06 | Native cooldown and combat display integration only where supported and qualified. | Use native display first; no duplicate analyzer built from inaccessible combat data. |

## 5. Gear, professions, bags and economy

| ID | Feature and reuse | Acceptance witness |
| --- | --- | --- |
| LIVE-P01 | Gear by slot: exact quest/vendor/craft/dungeon leads with build and requirements. | One slot opens specific eligible sources; unavailable data never becomes a best-in-slot claim. |
| LIVE-P02 | Role-based loadout, quest reward and wishlist comparison through Sheet. | Explains weights, assumptions and unknown modifiers; no automatic equip or reward checkout. |
| LIVE-P03 | Activity packing: supported bags, durability and consumable checks; personal presets. | Known empty and unknown differ; presets do not change inventory or consent. |
| LIVE-P04 | Recipe dependency/batch plan using Workshop and Ledger, aggregate duplicate ingredients. | One recipe family replays correctly, cycles are withheld, carried stock alone proves immediate readiness. |
| LIVE-P05 | Gather/vendor/buy/already have and personal price notebook with dated observations and break-even estimates. | Historical prices and alt/bank leads never become current market or carried inventory; no unattended scans or transactions. |
| LIVE-P06 | Local alt logistics: cooldowns, active projects and voluntary capabilities; manual handoff where verified. | No inferred transfer or stock exposure; opt-out removes the lead without deleting the journal. |

## 6. Guild and group operations

| ID | Feature and reuse | Acceptance witness |
| --- | --- | --- |
| LIVE-G01 | Guild Run Pack and member inbox: local time, changed/cancelled plan, private prep, optional local calendar export. | Two isolated profiles exchange reviewed copies; DST, identical export preview, stale revisions, private checks and reset pass. |
| LIVE-G02 | Local officer run board: manual RSVPs, coverage, bench, backups, recurring templates and handoff. | Event signup, membership and attendance are independent; editing never invites, promotes or changes game state. |
| LIVE-G03 | Casual nights and mentorship: first-dungeon groups, leveling partners, profession mentors and social events. | Player chooses what to share; private journal information never enters plan exports. |
| LIVE-G04 | Supply desk: voluntary directory and requests; pledged, reserved, delivered and available stay distinct. | No bank/bag disclosure or inventory movement; manual correction leaves a record. |
| LIVE-G05 | Raid debrief and next-run copy with confirmed attendance, progression, assignments and follow-ups. | No automatic attendance or loot inference; private notes excluded from shares. |
| LIVE-G06 | Recruiting/welcome packs and private officer decisions with corrections. | Public/portable copy visibly excludes trial notes and officer history; no automatic posting or awarding. |
| LIVE-G07 | Private sync and external integrations, independently gated. | Two real clients demonstrate scoped permissions, revocation, isolation and conflicts; evaluate documented native/Discord/calendar hooks independently. Preserve manual/offline use; no default collection or publishing. |

## 7. Cross-feature differentiators

| ID | Feature and reuse | Acceptance witness |
| --- | --- | --- |
| LIVE-X01 | Goal dependency planner over existing Objectives/Journeys, first for one dungeon or crafting goal. | Required, optional and unknown steps are separate; one proved action advances the goal without automatic execution. |
| LIVE-X02 | Shared exact actions: Map, Practice, Compare, Companion and manual in-game handoff. | Same entity ID across surfaces; revalidate character/build; never imply desktop wrote across a one-way live link. |
| LIVE-X03 | Personal timeline and weekly review of observed progress and manual accomplishments. | Manual corrections don’t overwrite evidence; unknown dates and wrong-character attribution are rejected. |
| LIVE-X04 | Explainable Companion with editable **Ask about this**, exact IDs, disambiguation, recovery and dated evidence. | No automatic send, no Retail/Classic/provider fallback for unsupported facts, and no history/Memory leakage from private local turns. Preserve separate scoring for factual answers and abstentions. |
| LIVE-X05 | Patch impact: show which routes/guides/abilities need rechecking without disabling unaffected modules. | Simulated client change retires only unsupported capabilities; stable scoped fallback and reactivation are tested. |
| LIVE-X06 | Versioned field guide and plan packs, local preview/import and last-known-good rollback. | Strict typed data only, bounded size and exact scope; reject unsupported versions or executable content without touching valid data. |

## 8. Dependability and release gates

| ID | Feature and reuse | Acceptance witness |
| --- | --- | --- |
| LIVE-T01 | Standalone-first operation, clear live / saved / disconnected status. | Main addon workflows still work with desktop closed; no inference of freshness when connection is lost. |
| LIVE-T02 | Module controls and clear observation requirements without changing permissions/goals. | Mute or disable once; non-enabled modules stay quiet and do no unnecessary live work. |
| LIVE-T03 | Accessible layouts: high contrast, text with icons, motion/sound alternatives, scalable and localized. | Populated compact and normal views, larger fonts, keyboard/screen reader and supported locales; color never carries meaning alone. |
| LIVE-T04 | Performance and coexistence with native data, bars and other addon layouts. | Measure idle, event bursts and first useful action versus the tagged baseline. Live frame-time and taint tests require a real client. |
| LIVE-T05 | Private by default; preview exports; restore preview, reset and rollback. | Prior reader/writer reopen synthetic state, reviewed share bytes match preview, failed writes and reset orphans are covered. |

**Shipping contract.** Run test-first, focused replays, generator parity, combined suites and independent review on exact heads. Use isolated profiles and clear artifact custody. Signed Windows installer and verified update feed are required for release; report platform signing levels honestly. Real WoW clients, native Mac, installed Windows upgrade/rollback and genuine two-client tests are separate witnesses. Leave capabilities opt-in or withheld where the required live state, permissions or evidence are missing. Continue the independent work rather than requesting routine approvals or shipping around a failed gate. Do not use restricted combat state, game automation, background guild/performance collection, or hosted services as shortcuts.
