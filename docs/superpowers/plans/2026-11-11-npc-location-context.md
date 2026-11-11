# NPC Location and Current Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Answer supported NPC-location questions from qualified Forever observations and stop treating an old character location as live or overriding an explicit current player report.

**Architecture:** A bounded local resolver runs before provider dispatch and returns clearly labelled NPC reference replies. Exact-build observations and a separately pinned historical NPC compilation retain distinct provenance. Narrow volatile reported-location context uses the existing main-owned conversation scope and shared projection/preview across all providers.

**Tech Stack:** Existing Electron, Node, Playwright, JSON compilation and shared safe reply renderer. No dependencies.

## Global Constraints

The binding design is `docs/superpowers/specs/2026-11-11-npc-location-context-design.md`. Keep 1.0 held. Task 1 already prepared 0.13.5; do not change the version or rewrite old notes/tags. Update current 0.13.5 notes to the combined scope. No real app/game/journal/provider/audio/credentials/OS changes, automatic paid fallback, live desktop feed, arbitrary URL execution, weakened privacy/cancellation guards or unrelated redesign.

## Task 2: Local NPC guidance and location evidence

**Files:** New `src/core/npc-location-sources.cjs`, `npc-location-data.cjs`, `npc-location.cjs`, `companion-location.cjs`; `scripts/build-forever-npc-locations.cjs`; `data/forever-npc-locations/`; focused `tests/` and `scripts/npc-companion-smoke.cjs`. Integrate only the existing companion/conversation/provider/policy/preview/main/preload/renderer files named by the design. Add the offline check and native smoke to existing validation/release commands without removing gates. Rewrite current user guidance and new 0.13.5 notes; preserve all previous release notes.

- [ ] Read the accepted design and preserve the independently reviewed Task 1 fixes. Record exact starting HEAD before edits. No source/GUI work until the parent releases ownership.
- [ ] Write failing data/compiler tests before code. Verify exact raw SHA/bytes/metadata/license and bounded NPC-only projection; reject corrupt keys, coordinates, dates, sizes and duplicate IDs. Prove 616 NPCs / 758 points and exclusion of gossip, world coordinates, objects and player data. Compile only the immutable source; save raw inputs under ignored work.
- [ ] Write failing resolver tests before code. Cover full/short/ID/apostrophe names; real duplicate-name ambiguity; known-name and explicit-NPC classification; non-NPC material/item/bank/geography questions; unknown and unavailable evidence; exact observed-build precedence; qualified historical fallback and no invented current presence. Preserve lastSeen separately from collection dates. Implement the minimal pure resolver and compiler.
- [ ] Write failing location/session/provider/preview tests. Current explicit first-person reports beat old snapshots for planning but are not live facts. NPC city premises, quoted/AI/history/memory text, past/future/negative/hypothetical statements cannot establish current player location. Reports expire with retained turns and existing conversation ownership/sharing/memory/source/root/clear boundaries; failed/cancelled requests cannot commit them. Preview is pure and matches actual send, including Claude's second allowlist and the existing total context budget.
- [ ] Integrate local NPC resolution before travel/model/key dispatch, after scope refusal. Found/ambiguous/explicit-unknown/unavailable replies perform zero provider/key lookup. Add a distinct local NPC reply kind to the existing conversation/memory/render flow and truthful model/cost copy. Preserve late-request, cancel, clear and travel-choice retirement. No new map, route, waypoint, screen or automatic send.
- [ ] Prove the actual isolated UI: saved Boulder Lode Mine + original Cairne-in-Org question yields the qualified Thunder Bluff observation and local badge with no model/provider. Then explicit current Org report, follow-up context/preview, sharing off, repeated query, ambiguity, missing/corrupt data and owner changes. Inspect native screenshots for readable existing graphical treatment. Use only fictional profiles and fake external surfaces.
- [ ] Run focused tests and both exact offline/native commands:

```powershell
node scripts/build-forever-npc-locations.cjs --check
node scripts/npc-companion-smoke.cjs
```

Expected: deterministic reproduction of pinned output, no forbidden fields, complete actual renderer assertions and zero provider/game/real audio calls. Run existing conversation, companion recovery and travel flows only because their shared contracts changed; run other adjacent checks only for concrete changed behavior. Full hosted validation and publication are parent-owned.

- [ ] Self-review and commit scoped changes. Record RED/GREEN commands, exact files, coverage, native captures, source qualifications and limitations in `work/npc-context-implementation-report.md`, with `.superpowers/sdd/task-2-report.md` pointing to it. Update checkboxes and release source/GUI ownership.

## Task 3: Final review, validation and preview delivery

- [ ] Independently review Task 2 plus the combined Task 1/2 delta from public 0.13.4. Fix Critical/Important findings and re-review; do not repeat green tests without a concrete new concern.
- [ ] Push reviewed source normally, tag a fresh v0.13.5 and follow normal Windows validation and release inline. Require complete green validation and release; diagnose failures instead of retrying for luck. Preserve all prior tags and artifacts.
- [ ] Verify public assets and the existing installed updater's discovery/signature/download size/hash in an isolated cache. Do not execute the installer or restart the real app remotely. Record source and public-delivery evidence separately.
- [ ] Report the update path and honest desktop-save versus in-game-live limits. 1.0 remains held for Frank's hands-on acceptance.
