# W7 7D / LIVE-T03: populated Instance Atlas

Scope: the real Electron shell, populated Instance Atlas, and the Deadmines Fieldbook ↔ Practice Lab handoff on development base `8a70bdd4a29e2fc66f883fa0d6c479daf90533e7`. No changes to evidence, data models, addon translations, dispatch ownership, or sharing defaults.

Run `npm run test:atlas-accessibility`. Set `BF_ATLAS_CAPTURE_DIR` to an absolute directory to keep composited viewport PNGs. The smoke uses a validated synthetic character with a saved Deadmines encounter and quest, an isolated profile, the existing German preference and Planner preset, and disabled game detection, live bridge, and outbound renderer requests.

| Case | Native window | CSS viewport observed on Windows | Native zoom |
| --- | --- | --- | --- |
| English control | 1480 × 900 | 1464 × 835 | 100% |
| German compact | 1000 × 700 | 984 × 635 | 100% |
| German desktop / larger text | 1480 × 900 | 1171 × 668 | 125% |
| German compact / larger text | 1000 × 700 | 787 × 508 | 125% |

- Chromium accessibility tree exposes a named tablist, selected tabs and their named results panel, a named recap, translated preparation actions, and a heading revealed by the Fieldbook disclosure. Arrow/Home/End move focus without changing results; Enter/Space activate. Selection is underlined independently of focus.
- Keyboard arrival from saved recap focuses the preparation heading with the first action in view. The actual encounter and quest remain identifiable. Tab and Shift+Tab keep the sampled outlines visible; normal contrast checks require 4.5:1 for heading text and 3:1 for focus on parchment.
- The compact Fieldbook opens the scoped opener drill with its first choice in view; a keyboard answer moves focus to the result, and returning restores the exact practice launch control and compact mode. Fixture journal bytes remain unchanged.
- The compact German 125% case also verifies reduced-motion hero animation suppression and forced colors with a solid card surface and a contrasting focus ring. The native captures were inspected for these states.

Also exercised `node scripts/dungeon-atlas-recap-smoke.cjs`, `npm run test:practice-lab`, `npm run test:desktop-view-presets`, `npm run test:player-shell`, and `node scripts/build-locales.cjs --check`.

The broad unit run still reports the existing Companion 0.58 benchmark failure (92.6% factual coverage). The same named test failed at 92.6% in a clean checkout of the exact base; the benchmark was not changed.

This is keyboard and Chromium accessibility-tree qualification, not a spoken NVDA/Narrator/VoiceOver pass or a claim of complete German translation. The zoom cases exercise larger rendered text through native page zoom, not an OS text-only setting. Game proper names, saved strings and unreviewed reference/drill text may remain in their source language. No installed owner profile or live game was used.
