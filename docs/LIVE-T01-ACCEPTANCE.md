# LIVE-T01 — Standalone / saved / live baseline

Run `npm run test:live-baseline` from the repository root. This is the W1 diagnostic lane; it does not verify the new Compass detour or add a release gate.

| Mode | Automated witness |
| --- | --- |
| Desktop closed | Fengari exercises addon route and badge workflows with no Electron process involved in the replay: waypoint and next/back controls, combat restrictions, registered badge updates, and login/logout preservation of saved progress. |
| Live and disconnected | Real Electron main/preload/renderer with an isolated profile. A synthetic worker sends encoded hairline pixels into the real decoder. Silent expiry clears the live frame through the status poll; an advancing frame restores it without restarting the worker. An explicit window-loss report retires a still-young frame immediately, leaving only dated “Last live” history. |
| Old save, reopened offline | Import an old synthetic SavedVariables file, check the age label and exact capture time, disconnect in Game Connection, close Electron, remove the source, and restart. The disconnected journal retains the exact observed quest and timestamp. Adventure opens the exact Durotar map with the old saved pin, no live pin, and no provider, game launch, or external handoff. |
| macOS saved-only policy | Run the same isolated Electron saved flow with the real bridge constructed for `darwin`. Saved-only copy remains visible, capture controls are hidden, enabling capture is refused without touching preference bytes, and the worker never starts. The journal and offline action still work on restart. |

Comparison: the focused Node/Fengari suites passed on published `v1.12.1` and on the W1 candidate. The new immediate-minimize assertion fails on the old bridge because a cached frame can remain current inside its freshness window. The candidate passes it and both Electron scenarios. No change to capture permissions, saved-data format, or the addon package.

**Manual acceptance remains open.** These are synthetic client/worker and host-Electron results, not a claim about the native Windows capture worker, WoW Forever APIs, or native macOS. On a dedicated test installation and test character, repeat the addon route and logout with the desktop closed. On Windows verify active capture, minimize/close, and restore/reopen without relabeling the saved observation as live. On a native Mac verify import, restart and the saved map action without a Screen Recording request or capture worker. Record OS, game/client build, addon version, steps and outcome separately.
