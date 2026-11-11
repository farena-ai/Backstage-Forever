# Runtime peer packaging implementation report

Baseline: `c2e0fc5d437d397301b0226dd48bbc56ae164365`, branch `codex/pre-1.0-product-polish`. Completed November 10, 2026. Source version remains 0.12.3; 1.0 and public release remain held.

- [x] Read the binding runtime packaging design/plan, umbrella addendum and TDD instructions; inspect installed primary manifests and licenses.
- [x] Strengthen canonical packaged acceptance and observe actual outside-checkout RED before changing dependency metadata.
- [x] Promote only the three existing exact peer versions offline; preserve upstream licenses and add attribution.
- [x] Verify output containment, build directory only, observe isolated GREEN, inspect closure and focused behavior tests.
- [x] Self-review changed files, parse/diff checks and record parent fixture adaptation contract before scoped commit.

## RED before metadata changes

Command: `node scripts/packaged-smoke.cjs` (PowerShell output redirected to `work/guided-peer-packaging-red.log`). Exit 1 against the existing missing-peer build. Exact failure: `Cannot find module '@anthropic-ai/sdk'`, require stack `C:\Users\faren\AppData\Local\Temp\backstage-packaged-i7ABZM\app\resources\app.asar\package.json`. The copied app started successfully and reached real peer resolution after existing source/reference checks. No peer metadata had yet changed. The earlier failed delivered candidate and `work/guided-delivered-attempt-1.log` were untouched.

## Production correction and closure

Command: `npm install --save-prod --save-exact --package-lock-only --offline --ignore-scripts --no-audit --no-fund @anthropic-ai/sdk@1.6.0 @modelcontextprotocol/sdk@1.32.2 zod@4.6.7`.

The production root now explicitly includes those exact three versions. Claude Agent SDK remains 0.3.319 and jose remains 6.2.16. Comparing every lock package to HEAD showed zero added/deleted entries and zero version, resolved URL or integrity changes. Eighty existing package entries lost peer-only metadata as their dependency closure became explicit production dependencies. No npm library download or new build tool was introduced.

`npm ls --omit=dev --all` exited 0; receipt `work/guided-peer-production-tree.log`. Optional foreign-platform Claude native packages are absent as expected. The MCP manifest marks `@cfworker/json-schema` optional; its validation documentation selects AJV for Node, and real SDK core loads without that unused edge-runtime adapter. It was neither added nor downloaded. No MCP servers/tools/hooks or provider permissions changed.

Attribution added to `docs/THIRD-PARTY-NOTICES.md`: Anthropic SDK Apache-2.0 plus retained historical `LICENSE-MIT`; MCP SDK MIT, Anthropic PBC 2024; Zod MIT, Colin McDonnell 2025. Four upstream peer license files and the attribution document now participate in the canonical byte-parity check. Additional closure audit command `node work/guided-peer-closure-check.cjs` passed: **101 packaged package manifests** match installed locked names/versions and **101 upstream license/notice files** are byte-identical. It also confirms no Claude native package is shipped. Receipt: `work/guided-peer-closure.log`. The audit resolves builder-rearranged packages by installed locked name/version; it does not assume npm's development directory layout survives packaging.

## Build and GREEN

Before the build, `fs.realpathSync` plus `path.relative` assertions verified both `dist` and `dist/win-unpacked` resolve strictly below the canonical checkout. `npm run pack` exited 0; directory output only, no installer. Receipt: `work/guided-peer-packaging-build.log`. Existing electron-builder 26.18.0 packaged existing pinned Electron 45.2.3; its normal output includes the Electron download/extraction status and expected unsigned-executable message. No version/build-tool configuration changed.

Final command: `node scripts/packaged-smoke.cjs`, exit 0; receipt `work/guided-peer-packaging-green.log`. **Two independent process startups** use the same owned profile and copied working directory, both load real SDK core and resolve the same three contained peers. **118 source/data/key/notice/license byte matches**, offline quest 1061 reference details, **five addon file installation/readback checks**, automatic startup repair of missing/obsolete synthetic addon files, and preservation of unrelated `player-extra.txt` all pass.

Final observed peer paths share prefix `C:\Users\faren\AppData\Local\Temp\backstage-packaged-E2tsoB\app\resources\app.asar\node_modules\`:

- `@anthropic-ai\sdk\index.js`
- `@modelcontextprotocol\sdk\dist\cjs\client\index.js`
- `zod\index.cjs`

No `query` invocation, authentication, inference, actual game files/input, audio, installer or OS settings were exercised. Automatic app and reference updates were disabled before first launch and verified through the actual preload API. Failed and successful temporary run roots were confirmed removed. Cleanup verifies the exact canonical owned run-root path, strict TEMP containment and owned basename before recursive removal.

Focused command: `node --test --test-concurrency=1 tests/claude.test.cjs tests/catalogs.test.cjs` — **23/23 pass**, zero failures/skips; receipt `work/guided-peer-focused.log`. `node --check scripts/packaged-smoke.cjs` and `git diff --check` pass. No full-suite rerun was performed by this implementer; parent owns it.

## Parent fixture adaptation contract

The canonical fixture retains `let app`, `data`, `page`, `ownFiles`, `expected`, `sourceMatch`, `gameRoot`, `addonFolder`, `owned` and `reopened` for the existing derived helpers. New variables:

- `repo`: real checkout root; `temp`: real OS TEMP root.
- `runRoot`: uniquely owned `backstage-packaged-*` directory outside checkout.
- `appDir = path.join(runRoot, "app")`: fresh copy of `dist/win-unpacked`.
- `data = path.join(runRoot, "profile")`: separate sibling profile, also containing the synthetic client.
- `launchOptions`: executable in `appDir`, `cwd: appDir`, `args: ["--user-data-dir=" + data]`, environment with BF_USER_DATA, NODE_PATH and NODE_OPTIONS removed case-insensitively. Both launches use this same object.
- `checkSdk(app, appDir)`: real core import plus contained-peer checks on both startups. `sdk` is now `{ queryType, peers }`, not a string.

Insert synthetic journal setup at the exact comment `// Synthetic journal fixtures can be seeded here, before the first launch.` immediately before the first `app = await electron.launch(launchOptions);`, after the two preference files have been written. Seed `path.join(data, "state.json")`; preserve disabled `updates/preferences.json` and `knowledge-v1/preferences.json`. Extra asset/help parity rows may still be appended to `ownFiles` before `expected`. The canonical cleanup removes the entire owned `runRoot`, not only `data`. Parent-owned `work/guided-packaged*` helpers were not edited.

## Self-review and remaining qualification

Diff is restricted to dependency metadata, permanent packaged acceptance, attribution and this report. Runtime application/provider/native/data/art/addon code and behavior are unchanged. Copying outside the checkout addresses the actual resolution fallback; changing cwd alone would not. Parent must complete its full integrated suite, richer feature/asset test, independent strongest source-review addendum and newly sealed review ZIP before delivery. Previous review artifacts and failed receipts remain immutable. GUI/build ownership is released with the scoped commit; no app process remains open from this fixture.
