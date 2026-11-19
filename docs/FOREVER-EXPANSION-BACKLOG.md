# Backstage Forever — Expansion backlog

Parent: [Field Dispatch and Forever-only Companion](FOREVER-COMPANION-NEXT-ROADMAP.md). Baseline: shipped 1.11.0 plus the code and docs audit used for the parent plan. These are proposals, not implemented features or release promises. **Next** means a candidate after the first vertical slice; **Later** requires other work first; **Gated** needs new evidence, native hardware, explicit consent, or operator approval. Advance complete workflows, not entire categories at once. Existing surfaces listed below are starting points, not claims about their live-client coverage.

For work added after Field Dispatch, see the [Academy, Fieldbook and Guild backlog](ACADEMY-FIELDBOOK-GUILD-BACKLOG.md) and its [post-1.12 delivery order](FOREVER-COMPANION-NEXT-ROADMAP.md#post-112-delivery-order). Its Guild Run Pack extends the local Party workflow first; two-client sync and external integrations remain gated.

## 1. Updates, onboarding, and recovery

Build on the signed updater, release notes, setup repair, [Support and Recovery](SUPPORT-AND-RECOVERY.md), and existing desktop view presets. The cumulative What’s New popup and its update-range contract stay first in the parent roadmap.

| ID | Priority | Proposal and acceptance |
| --- | --- | --- |
| U01 | Next | **Release-note action cards.** Add one tested shortcut per headline where useful (e.g. open the exact Companion starter prompt). Unsupported platform or setup states get a useful alternate action; a button never toggles consent or settings. |
| U02 | Later | **Searchable Field Dispatch archive.** Filter by version, feature, platform and fixes; jump to next matching change. Keep the original release grouping so a correction never vanishes behind a summary. |
| U03 | Next | **See it with a sample character.** Extend the no-character entry path with a clearly isolated, disposable walkthrough: Ask → inspect source → open exact destination. No real roster, save files or provider needed. |
| U04 | Next | **Connection health in plain English.** Improve existing Support with distinct statuses for install, addon, saved import, live link and reference build, each with one appropriate fix. One failure must not hide the last readable journal. |
| U05 | Later | **Recovery preview.** Before using the existing import/restore flow, show what will be replaced, how recent the checkpoint is, and what will not carry back to an older version. Compare exact journal/checkpoint bytes after cancellation and failed restore. |
| U06 | Gated | **Upgrade rehearsal kit.** Installed test scenarios for previous stable, skipped versions, manual Mac replacement, and rollback. Run in disposable environments; signed artifact checks and synthetic renderer tests are not proof of installed behavior. |

## 2. Companion: getting the right question right

Build on current local intent routing, context previews, read-only tools, existing reply cards and voice controls. The Forever-only eligibility/answer gate is a prerequisite for any new factual surface. See [Companion](COMPANION.md) and [Character Guidance](CHARACTER-GUIDANCE.md).

| ID | Priority | Proposal and acceptance |
| --- | --- | --- |
| C01 | Next | **Contextual Ask about this.** From a quest, item, recipe, map marker or dungeon, open an editable draft with its exact ID. Never auto-send; changing character or losing the source invalidates the draft’s private context. |
| C02 | Next | **One-clarifier answering.** Offer two or three labeled choices when “DM,” “that trainer,” or a shared quest name could resolve differently. Choice records stay tied to the current conversation scope. |
| C03 | Next | **Answer → map → answer.** Add a reliable round trip between the cited fact and its exact destination while preserving the question and keyboard focus. A mismatched character/build does not open a stale action. |
| C04 | Next | **Say what you searched.** Show type, build, date, and missing evidence with plain-language recovery, such as “Open your profession window, then save.” Don't surface private internals or turn a failed lookup into a negative game fact. |
| C05 | Next | **Compare verified options.** Compare two routes, items or training plans in a small table showing requirements, trade-offs, assumptions and unknowns. Never manufacture completion times, costs or a best choice from incomplete evidence. |
| C06 | Later | **Beginner and veteran answer depth.** Start with the same answer and sources; let the player expand terminology, rationale and exact IDs. Presentation never changes the facts, prompts sent externally, or sharing preferences. |
| C07 | Later | **Compound questions into checked steps.** “Where do I get this, and can I use it?” gives distinct source and usability rows. Unsupported clauses stay visibly unresolved without discarding useful verified portions. |
| C08 | Later | **Optional push-to-talk refinement.** Improve the existing voice path with game-name recognition, editable transcription and explicit send. Continually enforce cancellation, visible mic state and no background listening. |
| C09 | Later | **Question shortcuts and local research notes.** Bookmark a public lookup by ID and rerun it against updated compatible packs. Keep private saved answers out of provider history and Memory; a bookmark is not new knowledge or preserved authorization. |
| C10 | Later | **No-model experience and provider failure recovery.** Surface working local tools before setup; when configured inference is unavailable or returns invalid content, fall back clearly without silently sending to another service. |

## 3. Forever knowledge quality and coverage

Build on the existing build-pinned packs, `knowledge` modules, generator checks and two Companion benchmark banks. Nothing added here authorizes open-web lookup, live mode or community ingestion. Unrestricted provider web lookup floated in the historical roadmap is superseded for Companion.

| ID | Priority | Proposal and acceptance |
| --- | --- | --- |
| K01 | Next | **Knowledge coverage screen.** Show what this build supports by fact type and region, the last pack update, and whether a shown fact is exact, historical or missing. Never sum multiple builds to imply single-build coverage. |
| K02 | Next | **Retail lookalike and wrong-build challenge set.** Include plausible contaminated answers, invalid citations and same-name entities. Score final answers, correct abstention and false refusals separately; block wrong-edition or unverified factual output. |
| K03 | Next | **Correction and evidence-gap workflow.** Let the player review a minimal report of the entity/build/question category, edit it, and copy it if desired. No automatic upload, transcript collection or character identifiers. |
| K04 | Later | **Patch impact map.** Automatically diff eligible pack records by ID and scope to flag affected articles and endpoints for human review. An ID change or fresh patch date is not itself proof of a mechanic change. |
| K05 | Later | **Versioned, reversible knowledge packs.** First ship reviewed content with the app; only later consider separately verified pack updates with compatibility, offline last-known-good fallback, and rollback. No new network service in the first wave. |
| K06 | Gated | **Earn more coverage through exact facts.** Qualify one quest chain, vendor cluster, transportation leg or boss at a time. Track source permission and evidence at row level, not just “pack supports this build.” Do not promote disputed or community-only observations automatically. |

## 4. Leveling, Map and character planning

Extend the existing Now, Adventure Compass, Guided Route, World Map, crew planning and Talents surfaces. See [the All-in-One roadmap](ALL-IN-ONE-ROADMAP.md) for the existing route gaps and parity gates.

| ID | Priority | Proposal and acceptance |
| --- | --- | --- |
| L01 | Next | **Explain the next step.** Now, Route and Companion agree on the same verified quest ID and say why it fits or what blocks it. An explicitly skipped step remains skipped, not completed. |
| L02 | Next | **Resume where you left off.** Deep-link from Now back to the right character’s last explicitly chosen objective, with “why now” and save age. Real events, not reopens or spinner state, advance it. |
| L03 | Later | **Time-budget refinements.** Improve the existing evening planner with a short and a fuller plan, travel uncertainty and one manual swap. No precise time promise based on an unverified route or move speed. |
| L04 | Later | **Map field layers.** Add readable toggles and legends for verified quest pins, travel, recent observations and historical references. Show approximate areas as areas; a missing pin isn’t proof nothing is there. |
| L05 | Later | **Trainer and talent comparison.** Reuse existing Talents and trainer planning to compare two manual builds or upcoming unlock paths, with prerequisite and cost evidence. No automatic allocation or respec. |
| L06 | Gated | **Fill route gaps by real continuity.** Qualify remaining early Dwarf/Gnome/Tauren and later Alliance/Horde slices, one build and edge at a time. Never promise 1–60 coverage from a few endpoints; no route guessing while data is absent. |

## 5. Workshop, Ledger and alts

Extend the current profession shopping, stock and price evidence, Ledger, and guarded savings review. Do not add another goal store or assume inventory can be transferred.

| ID | Priority | Proposal and acceptance |
| --- | --- | --- |
| W01 | Next | **Gather, buy or already have it.** Compare a batch’s exact materials with current bags, last-seen storage, compatible vendor/gathering observations and saved AH prices. Age and unknown price stay visible per row. |
| W02 | Later | **Recipe dependency planner.** Expand reviewed sub-recipes, aggregate duplicate inputs, and handle loops, unknown ranks and inaccessible recipes. Do not infer a craft chain where spell/item IDs do not join. |
| W03 | Later | **Crafting alternatives.** Compare recipe batches by carried shortfall, observed cost and qualifying skill range. Do not promise a skill gain or use stale stock as readiness. |
| W04 | Later | **Safe alt handoff checklist.** Show “last seen on this alt” without silently counting it as available. Only suggest a transfer when applicable rules are verified; no auto-mailing or clicking. |
| W05 | Later | **Goal and cooldown dashboard.** Extend existing goal/weekly/reminder surfaces to group near-term training, materials and reputation with filters for age and character. No surprise replacements, fake refresh, or duplicate goal storage. |

## 6. Dungeons, gear, groups and progression

Extend existing Atlas prep, Sheet comparisons, recent defeats, Company/party, Badge Case and Journey. Check the earlier evidence contract before expanding any collection or combat claim.

| ID | Priority | Proposal and acceptance |
| --- | --- | --- |
| D01 | Next | **Run prep card.** Put verified directions, possible saved quest matches and explicit wishlist checks in working order. A Classic-only Atlas reference never becomes a Companion fact; no access promise or assumed clear. |
| D02 | Later | **Gear acquisition shortlist.** Let players compare exact item IDs and verified sources by intended role, availability and constraints. A scoring heuristic is not best-in-slot, and reference loot is not ownership. |
| D03 | Later | **Loadout review with explainable trade-offs.** Build on Sheet, Talents and existing Gear Sets. Compare saved vs proposed sets for one named activity; leave unknown modifiers explicit and do not automatically equip anything. |
| D04 | Later | **After-action recap.** Show positively recorded defeats, personal milestones and attributable estimates from a specific session. Distinguish observed zero from unavailable; never invent combat logs, personal loot or lockouts. |
| D05 | Later | **Collection checklists with evidence.** Expand by one stable and observable family of items, quests, or trophies. Allow planning notes separate from confirmed ownership; preserve earned awards and refuse to fill missing records with zero. |
| D06 | Gated | **Group prep and shareable checklist.** Improve existing Company/party planning so players can deliberately share a minimal prep summary with the group. Preview exactly what is sent, keep inventories and alt details private, exercise two genuine client installs before promising sync. |

## 7. Art, interaction and accessibility

Build on [the style guide](STYLE-GUIDE.md), the original artwork pipeline, `PageHero`, Compact/Guided/Planner, and the current command catalog. The working view comes first; artwork must not push the next action below the fold.

| ID | Priority | Proposal and acceptance |
| --- | --- | --- |
| X01 | Next | **Field Dispatch illustration and answer visual language.** Original banners, trust badges and restrained icons. Evidence status is conveyed in text as well as color; respect artwork fallback and reduced motion. |
| X02 | Next | **Find a feature from one keyboard entry point.** Extend existing Commands/Command Center with cross-surface search and safe existing action IDs, not a duplicate navigation system. Check focus, exact destination, and no destructive actions from ambiguous matches. |
| X03 | Later | **Working-screen art pass.** Refresh populated Map, Atlas and Journal rather than only empty states. Check clarity at standard and compact German sizes, 200% text and the first real action. |
| X04 | Later | **Journey story cards.** Extend existing recap and share-picture capabilities with weekly highlights, specific progress and private-by-default export previews. Apply an opt-in redaction pass; no name or realm unless the player selects it. |
| X05 | Later | **Visual and spoken accessibility.** Audit keyboard order, screen-reader labels/live announcements, high contrast, captions, motion and input mode with actual populated flows. Keep one quiet default rather than adding alerts for everything. |

## 8. Platform trust and distribution

Complete a workflow on supported systems before claiming it. Apply the [privacy contract](PRIVACY.md), prior installed release gates and existing addon workflows. None of the items below authorize new CI, paid services or deployments.

| ID | Priority | Proposal and acceptance |
| --- | --- | --- |
| P01 | Next | **Reviewable diagnostics.** Improve existing local Support export with a clear read-before-copy summary of build, last successful import and status codes; remove paths, keys, account IDs, names, chat, and private saved rows by default. |
| P02 | Later | **Offline and older-install compatibility matrix.** Exercise no-model mode, update history, signed upgrade, restore and addon-only setup. Test previous reader and writer on the same synthetic journal, and don't blur Windows and Mac behavior. |
| P03 | Gated | **Mac parity by capability.** First prove saved-only install, import, repair and history in native test installs. Keep live capture disabled until exact game-window targeting, permission denial/revocation, scaling and teardown have native evidence. |
| P04 | Gated | **Real client acceptance and addon-site readiness.** Verify live Horde/Alliance step, profession rank change, combat quietness, two-player sync and German client; verify existing site project/token setup separately. No owner machine changes or uploads without the relevant authorization. |
| P05 | Gated | **Community evidence preparation.** Local qualification exists; only consider transport with explicit default-off previews, minimal coarse fields, a vetted server contract and tested rollback. Never make community hints proof of eligibility or automatically create a waypoint. |

## Recommended sequence and gates

1. **Protect the first release:** cumulative What’s New plus the first Forever-only correction; include U01 and X01 only if the two core workflows stay simple and qualified. Freeze the baseline and add K02 before expanding authoring.
2. **Make everyday questions dependable:** finish cross-provider evidence enforcement, then C01–C04, K01 and L01. Walk a beginner from natural question to exact destination and back; test no model and wrong build as first-class paths.
3. **Make planning worth returning to:** add W01, D01, L02 and one readout upgrade. Expand evidence-backed options and art in subsequent small releases, not as prerequisites for the first ship.
4. **Build depth where data supports it:** pick the most useful compatible content slices for each faction; advance private-by-default alt, gear and group tools without splitting the player’s journal across duplicate systems.
5. **Qualify the gated work separately:** no native Mac, live WoW, two-player, provider quality, community or addon-site claim without its own witness. Keep signed packaging and previous-client updater verification. Mark every row as planned, built, locally verified, live verified, or released as it actually progresses.

Do not add by default: another knowledge store when existing resolvers can be extended, any unverified Retail/Classic fallback, a public transcript pipeline, gameplay automation, auto-spending, or broad new capture. Each selected item needs one player-facing test plus the relevant evidence, privacy and platform checks.
