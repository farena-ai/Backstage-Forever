# Profession coach Task 1 — source and synthetic GUI report

Base `668f76eb301a9a2439ee9563c63afaca956133f9`, existing clean branch. Source **0.12.3**, preview; **1.0 and in-client acceptance held**. Written before the scoped commit. No subagents, full npm test/build/package/installer, real player/game/input/auth/audio/paid inference, OS settings, watchers or publication. Parent owns independent SPEC/QUALITY review and the following Map increment.

## Delivered

Native Compass follows observed professions through ready crafting and named material shortfalls. Defaults are Auto/one attempt. Optional Profession details cycles Auto/owned profession, Auto/learned recipe, and 1/5/10/20 attempts. Explicit non-skill-up recipes remain visible manual plans. Goal controls retire on source/character/goal/capture failure/combat/session changes. Native per-character settings and desktop goals remain independent. Full25 quest pool before final3, protected dense sequences, valid entries in partial recipe catalogs, quest ordering and waypoint ownership remain intact.

The single existing Preparation workshop now has owned-profession/Auto, Auto/manual recipe, attempts, numeric native rank progress, a next-step recommendation and qualified historical source cards. Existing manual checklist and explicit editable AI-draft actions remain. Only resolved recipeId/crafts reach the unchanged checklist API. The draft includes bounded acquisition contexts/qualifications, never private/other-character evidence, and still needs separate Send. Other-character observations remain separate behind optional detail.

Adventure owns Next step/Professions. Plans keeps My plans/Party and a Professions shortcut. Five primary entries and all11 legacy routes remain; no Map placeholder. Original art/fonts/faction banners/ornate controls remain. The984×635 initial Add action fits. Actual200% uses stacked readable native controls, measured main/root overflow checks, header bounds and held-select/root-paint continuity.

## Exact API, helper and DTO contracts for Map

- `src/core/profession-coach.cjs`: **validateProfessionOptions(value={})**, **buildProfessionCoach(state,profileId,options={},dependencies={})**. Only skillLineId?/recipeId? positive ordinary integers≤2147483647 and crafts integer1–20(default1). Unknown keys/arrays/null/nonplain prototypes fail. Dependencies are trusted optional acquisitionPack/vendorPack, never renderer input.
- `src/core/profession-coach-ipc.cjs`: **registerProfessionCoachHandlers({handle,getState})**. Actual main/preload **professionCoach(profileId,options)** requires exactly2args and forwards extras for rejection. Main checks raw activeProfileId before state-validation fallback, requires the current main-owned saved addon profile/build, loads optional bundled packs itself, and performs no write/provider/key/network action. preparationBrief/createPreparationJourney and adventureCoach mode-only IPC remain unchanged. Manual/no-character UI retains the legacy preparationBrief/manual-plan path.
- Desktop preserves Preparation public `character`, sanitized `source`, `coverage`, `professions`, `recipes`, `materials`, `equipment`, `bags`, `planning`, `selectedRecipe`, `profession`, `shoppingRows`, `sellerReference`, `otherCharacters`, `limitations`, all detached. Private source IDs/notes/goals do not cross the public model.
- **selection** `{skillLineId:number|null,recipeId:number|null,crafts,automatic}`. automatic means recipe Auto, even when profession is explicit. An unavailable explicit recipe ID remains in selection with selectedRecipe=null. **ownedProfessionChoices** is stable skillLineId-sorted public professions. **recipeChoices** is stable ID-sorted recipes of the selected owned profession, with per-entry `levelingEligible`.
- **recommendation** `{kind,title,detail,levelingEligible,atObservedCap,qualification}`. Kinds: craft-ready, materials-needed, profession-cap, craft-plan, observe-profession. Absent qualification is null(native nil). Cap qualification asks to check training; no higher cap/trainer/cost/unlock promise. Attempts never promise output/skill gain.
- **shoppingRows[]** retains `{itemId,name,required,have,missing,quantityKind,historicalSellers}` and adds **acquisition**: exact acquisitionFacts row `{itemId,status,reason,sources}`. Each source retains approved `sourceKey,kind,entityId,referenceName,nameKind,gatherSpellId,requiredSkillLineId,requiredRank,positions,positionCountInOriginal,positionEvidence,exactObjectPosition,contributingFiles,observedLootWindows,context,observedOn,clientBuild,observedReactionsByFaction,reactionContributingFiles,listingContributingFiles,lastSeen,limitedStock,availableNow,qualification,reason`. Positions are `{mapId,x,y}`. At most3 sources/3 points each, ≤10 selected reagent rows. Names derive only from exact same-ID observed reagent/material names; source labels are separate publisher labels.
- **acquisitionReference** `{status,reference,limitations}` preserves reviewed provenance/build/license/attribution/dates/change notice. **gatheringReference** is null or the complete acquisitionFacts DTO for a supported method. Method mappings only: Herbalism182→spell2368, Mining186→2576. These are method matches, never required rank/profession claims. Gathering rank/reference browsing works without a learned crafting recipe. Missing/damaged optional acquisition reference degrades to observed planning and unavailable/unknown sources.
- Existing **historicalSellers/sellerReference** retain sellerFacts authority. An actual same item/entity/build/position-list vendor duplicate is displayed once in its acquisition card with both sets of qualifiers/dates/contributor counts. Other seller listings remain separately qualified. Source stock/context uncertainty remains visible. No new vendor/disenchant sources; Strange Dust10940 and Lesser Magic Essence10938 are not relabeled as shards.
- Native **BackstageForeverBuildProfessionCoach(character,options)** returns analogous selection/coverage/planning/selectedRecipe/profession/ownedProfessionChoices/recipeChoices/shoppingRows with acquisition/acquisitionReference/gatheringReference/recommendation. Native unknown values are **nil**, not JS null. It uses actual public current `character.updatedAt` and collection **epoch numbers**, not a fabricated desktop source object. It does not require nonexistent recipe.learned: capture already records owned learned entries. Native acquisition qualifies current public date/build/faction;70888 remains browse-only against70862.
- **BackstageForeverPublicFacts**, exported by Coach.lua: `public,field,number,text,sequence,collection,stamp`. Profession.lua consumes these focused reviewed normalizers. Coach calls Profession only after TOC loading; no circular eager calls. Raw bounded sequence validation rejects protected/unreadable/sparse/non-array/oversize/metatable-backed sequences. Invalid/duplicate profession or material entries cannot establish readiness; valid individually known recipes in a structurally valid partial catalog remain eligible.
- TOC order: Reference.lua, Plan.lua, Coach.lua(normalizers), Acquisition.lua(unchanged generated data), Profession.lua, BackstageForever.lua(unchanged capture), HUD.lua. Including TOC, **eight owned files**. Install/current/readback/startup repair and source/setup/package fixture lists include all8; foreign files remain. Packaged later acceptance now removes both new files to exercise repair; it was not executed here.

## Policy limits

Auto requires observed owned learned canSkillUp=true, recipe date≥profession-rank date, unambiguous positive schematic and≤10 reagents. It ranks complete fresh known supply, then distinct missing materials, missing units and stable recipe ID. Whole-catalog completeness is not required. Exact shortfall/absent zero requires complete fresh bags0–4 counts≥recipe collection date. Missing partial/older inventory is unknown, not zero. Bounds100000/reagent×20attempts×10rows keep every product/sum safe in JS/Lua. Attempts are plans, not automatically decremented actual crafts.

Historical positions are approximate contributor standing points, not exact nodes/NPCs/current presence. Required rank/skill, availability/access/stock/prices stay unknown. Corpse quest-context remains distinct from gathering/skinning; bountifulHarvest context is retained without inferring requirements. Seven relations are incomplete coverage; absent source does not mean unobtainable. No profession/material/manual/cap row can create a quest command/source waypoint or perform game action/inference.

## RED before associated behavior

1. `node --test tests/profession-coach.test.cjs tests/addon-profession-coach.test.cjs tests/profession-coach-ipc.test.cjs`: **0 pass/11 fail**, missing native/model/IPC behavior. An initial fixture-brace parser error was corrected first and is not counted as behavioral RED.
2. `node scripts/profession-coach-smoke.cjs`: actual Electron timed out on missing **Owned profession**, after a genuine synthetic saved import and working old workshop navigation.
3. `node --test tests/player-navigation.test.cjs tests/addon-profession-coach.test.cjs tests/adventure-coach.test.cjs`: **16 pass/4 fail** for missing native details, desktop material follow-through and navigation ownership/shortcut.
4. `node --test --test-name-pattern="material follow-through|supply draft retains exact" tests/addon-profession-coach.test.cjs tests/preparation-renderer.test.cjs`: **0 pass/2 fail** for missing named native shortfalls and explicit draft acquisition contexts; then implemented.
5. `node --test --test-name-pattern="observed profession progress" tests/preparation-renderer.test.cjs`: **0 pass/1 fail**. Visual review found inline width blocked by self-only style policy. Replaced with numeric native progress value/max; same test then passed, final GUI asserts22/75 and visibly fills~29%.
6. `node --test --test-name-pattern="gathering rank" tests/profession-coach.test.cjs`: **0 pass/1 fail**, damaged optional pack escaped the gathering branch. Gated on validated acquisition availability; policy/IPC10-test follow-up passed.
7. `node --test --test-name-pattern="explicit non-skillup goal" tests/addon-profession-coach.test.cjs`: **0 pass/1 fail**, explicit native manual recipe was hidden. Added manual craft-plan opportunity without a quest action; final covering tests pass.

## Final GREEN

```powershell
node --test --test-concurrency=1 tests/profession-coach.test.cjs tests/addon-profession-coach.test.cjs tests/profession-coach-ipc.test.cjs tests/adventure-coach.test.cjs tests/addon-coach.test.cjs tests/addon-live.test.cjs tests/addon-plan.test.cjs tests/addon-preparation.test.cjs tests/preparation.test.cjs tests/preparation-ipc.test.cjs tests/preparation-renderer.test.cjs tests/player-navigation.test.cjs
```

**142/142 PASS**, no skips/failures/cancellation,41450ms. Native tests execute actual Fengari and assert both exit0 and empty stderr. Covers full candidate pool, public/protected arrays, partial/stale/unknown/bounds/privacy, manual/Auto and native callback/waypoint ownership.

Expanded affected run of those files plus `tests/game-sync.test.cjs tests/addon.test.cjs tests/addon-lifecycle.test.cjs tests/acquisition-data.test.cjs`: **196 pass/0 fail/1 skip** (197tests). The optional raw acquisition test was skipped solely because its explicit source-dir environment variable was absent. It was then verified correctly:

```powershell
$env:ACQUISITION_SOURCE_DIR = 'work/proactive-research'
node --test tests/acquisition-data.test.cjs
node scripts/build-forever-acquisition.cjs --source-dir work/proactive-research --check
node scripts/build-forever-acquisition.cjs --check
```

**20/20 PASS**, zero skips; both raw/shipped CLI parity checks PASS. Required final142 includes later gathering/manual/draft/progress corrections. Actual new8-file startup repair and foreign preservation also passed in the **64/64** profession/native/renderer/GameSync run. Earlier obsolete TOC and legacy fallback-height expectations were reconciled: TOC asserts actual7-Lua order, missing-profession-module fallback retains original440px while current HUD expands without intruding into reserved footer/action rows.

Serial actual GUI commands all **PASS**:

- `node scripts/player-shell-smoke.cjs`: five primary/two secondary,11destinations,26faction/full/compact/secondary/tool/zoom captures. Canonical Adventure tabs and remaining two Plans tabs receive physical keyboard checks.
- `node scripts/director-smoke.cjs`: new compact first-view action plus preserved expanded Director interaction/privacy/late-result gates.
- `node scripts/command-center-smoke.cjs`: source-backed plans, autosaved focus/session, character isolation/restart, unsent AI draft, compact/reduced motion and import replanning. This existing script captures only on failure; no success PNG was emitted.
- `node scripts/preparation-smoke.cjs`: preserved native inputs/held actions/retry focus/source/character/navigation/restart/import/reset behavior against real new endpoint/nav. Its deliberate Send reaches only the existing synthetic provider fake, never external inference.
- `node scripts/profession-coach-smoke.cjs`: Auto/profession/manual/attempt autosave, Plans shortcut, actual22/75 progress, both factions1440×960/984×635/actual200%, contrast/held native select/root paint/header bounds, no main/root horizontal overflow or broken images, older-build source cards and main-owned synthetic limited-stock variation. Later Enter/pointer/select/stale-source/profile/navigation/checklist/draft/retry scenarios pass. New profession draft is edited **without Send**; fakeAsks/inference/game launches remain0.

All relevant GUI gates use prebootstrap provider/model/key/voice/game-process/clipboard/shell fakes and disable automatic app/reference starts. Only verified temporary synthetic user/client trees are removed. Automated checks do not establish actual client acceptance.

Syntax checks passed for changed main/preload/app/preparation/navigation, core/IPC and smoke modules. `git diff --check` passed. Existing capture/Plan, Director/guidance, preparation/legacy IPC and package-lock are unchanged. Package edit adds only test:profession-coach; no version/channel/dependency change.

## Immutable receipts / self-review

Final folder `.superpowers/sdd/profession-coach-captures/2026-11-11T07-38-59-476Z/`: **22 PNGs + manifest.json**. Earlier failed/older receipts remain intact. Final faction compact and native200% receipts were visually inspected. The22/75 bar is partially filled, Add fits initial635px, and actual200% controls remain readable/stable. Playwright full-page capture crops under Electron zoom; final200% uses native webContents.capturePage. Numeric progress, header bounds, no overflow, contrast and native selector continuity are actual GUI assertions.

The main-owned synthetic fixture overrides only the returned acquisition clone to limitedStock=true for item2320 before bootstrap, explicitly labeled in its manifest. Shipped limitedStock remains null; no canonical data byte changes.

Final covering roots under the same captures directory: `covering-player-shell-2026-11-11T0740`, `covering-director-2026-11-11T0740`, `covering-preparation-2026-11-11T0743`. Command Center emitted no success image. `task-1-verified-manifest-2026-11-11.json` hashes every file in final roots. `task-1-reference-byte-manifest-2026-11-11.json` verifies **22 existing data/generated reference files byte-for-byte against base**. Acquisition pack remains6051bytes, SHA256 `6447033020706c08abf1005f97a6fe86ac3ba081b72935a7781b185f978f940b`.

- `2026-11-11T07-38-59-476Z/manifest.json`: `c5b7ced21b43011b88149aa5103d665e85b7970603a118d92caec98ff7cf3e23`
- `2026-11-11T07-38-59-476Z/profession-alliance-compact.png`: `1aecebea3a1dcca72c3029b224b6d2d0a8255c58201d98553e4a8d2542c61c42`
- `2026-11-11T07-38-59-476Z/profession-horde-200-percent.png`: `a8d3a917b64098df9a997ea623a0a1e814d65705767527f5e151056b053e4806`

## Remaining limits and ownership

Parent independent SPEC/QUALITY review is next. Map should consume the exact selection/shoppingRows.acquisition/acquisitionReference/gatheringReference fields above, not create a second source database. Native/current versus desktop/last-saved and independent goals stay explicit. Actual client behavior/layout/performance and final full-suite/build/package/outside-checkout review remain pending with parent/owner. Source0.12.3;1.0held. Source/GUI ownership releases only after force-adding this report and a successful scoped commit.
