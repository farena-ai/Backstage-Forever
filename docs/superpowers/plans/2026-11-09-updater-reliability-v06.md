# BF0.6 updater implementation plan

**Goal:** diagnose and fix failed authenticated updates without weakening trust.
**Architecture:** existing pinned-key updater with typed bounded errors, fresh retries, atomic cache, compatible GUI state.
**Tech stack:** Electron45/Node24/CommonJS, native HTTPS, Node tests, Playwright runtime fixtures.

## Task1: diagnose and implement update recovery
Files: src/core/updater.cjs, tests/updater.test.cjs, optional new tests/updater-network.test.cjs, scripts/updater-runtime-smoke.cjs, updater-only renderer controls/copy. No quest-data or profile modifications.
- [ ] Reproduce with installed Electron under isolated temp data; instrument only public update stages and allowlisted codes. Never execute installer or use actual user keys/profiles.
- [ ] Add failing tests for interrupted download retry/cap, stream abort, manifest failure status, cancellation, cache casing/path safety, diagnostics and preserved ready cache.
- [ ] Implement exact requirements in sibling design; use deterministic injected delays/transports for tests and real default transport for runtime validation.
- [ ] Run all updater tests and real isolated Electron runtime fixture; preserve signature/hash/security/cancellation tests. Independently review the complete task diff before accepting.

## Integration gate
0.6 quest-data work has its own design after source/data verification; no blanket database import or claim of complete coverage is authorized by this plan. Final0.6 must pass all UI/runtime/packaged release checks before the existing signed publication workflow. Update reliability fixes are not proof that a real installed self-upgrade has completed.
