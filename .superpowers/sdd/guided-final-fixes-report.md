# Guided final copy and fixture corrections

Base: `350f3e071bb033188cb32f35f7724050ff03006d` on `codex/pre-1.0-product-polish` (clean at start).

## Changes and preserved boundaries

- `src/renderer/app.js`: replaced only the outdated Field guide sentence with: “Recent completed exchanges accompany follow-ups in this session (up to six exchanges; older text may be omitted). Saved-memory sharing remains a separate, per-question choice; past answers remain unverified.” The preceding explicit per-question saved-memory consent and preview instructions remain intact. The wording agrees with the volatile `ConversationSession` six-exchange bound and prompt budget; it makes no persistence or verification claim.
- `tests/quest-guide-renderer.test.cjs`: loaded the real `player-navigation.js` in the existing VM loop before Quest Guide, with the same window-to-context export mechanism as the other modules. No fake disclosure stub or production fallback. All five original atlas, saved-game qualification, chain/reward, NPC-clue, and held/reversed-copy assertions remain unchanged.
- `tests/core.test.cjs`: moved the existing auth-mode and ChatGPT/Claude dispatch assertions to their actual owner, `src/core/companion-service.cjs`; added structural checks that main imports and constructs that service and wires both legacy `ask` and new `askCompanion` handlers to it. The existing main-owned ChatGPT reset, Claude credential clearing, subscription status, and all three preload assertions remain. Renamed the structural test to describe that boundary accurately.
- No production routing, transport, privacy, lifecycle, game, data, addon, SDK, artwork, dependency, version, or native bytes changed. Source remains 0.12.3; version 1.0 remains held.

## RED and GREEN evidence

Exact covering command, run before any edits and again after the three-file correction:

```text
node --test tests/core.test.cjs tests/quest-guide-renderer.test.cjs tests/companion-service.test.cjs
```

- RED: **29 tests, 23 pass, 6 fail, 0 cancelled, 0 skipped, 0 todo**, 115.1696 ms, exit 1. Log: `work/guided-final-fixes-red.log`. Five failures were the fixture's missing real `PlayerNavigation`; one was the outdated main-owned dispatch assertion.
- GREEN: **29 tests, 29 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**, 110.1544 ms, exit 0. Log: `work/guided-final-fixes-green.log`.
- Included the unchanged `companion-service` behavioral suite covering all seven transports, composed follow-up prompts, original draft questions, private-memory scope, request boundaries, and legacy dispatch. Existing production dispatch remains the test subject; fixtures were repaired rather than production code altered to satisfy stale assumptions.

Exact additional checks, all exit 0:

```text
node --check src/renderer/app.js
node --check tests/core.test.cjs
node --check tests/quest-guide-renderer.test.cjs
git diff --check
```

Self-reviewed the actual three-file diff against base: only one production copy sentence changes, the fixture gains its real module dependency, and the structural contract follows the extracted service boundary while retaining the original checks. No new string-mirror test was added: this is reversible static copy, and such a test would merely repeat implementation text. The source sentence was inspected directly; packaged artifact review belongs to the parent’s final delivery gate.

## Scope and handoff

No full `npm test`, GUI, package/build, real player/game/input/auth/audio, paid request, install, settings change, watcher, publication, push, tag, or release was performed in this batch. The parent owns the single final full-unit rerun and subsequent authorized artifact verification. This report follows the existing tracked `.superpowers/sdd` report convention. Implementation ownership returns to the parent with the final scoped commit SHA.
