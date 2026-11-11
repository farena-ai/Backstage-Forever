# Five-section player experience implementation plan

> For agentic workers: REQUIRED subagent-driven-development, test-driven-development and frontend-design. One implementer/GUIowner, task SPEC/QUALITY, fresh strongest whole-series review later.

**Goal:** make BF approachable through five clear player sections while retaining all tools and original fantasy presentation.
**Architecture:** focused navigation groups module maps existing internal routes to primary/secondary sections. Existing feature modules retain ownership; visible subtabs and compact disclosures simplify the shell. A shared fixture navigation helper follows actual controls for every legacy destination.
**Tech Stack:** existing vanilla JS/Electron/CSS/original art/fonts/Playwright; no dependencies.

## Global Constraints

Binding docs/superpowers/specs/2026-11-10-player-shell-design.md and umbrella. Keep1.0held/source0.12.3/publication unchanged. No actualplayer/game/input/auth/audio/paid/installer/OSsettings/watchers. Prior sealed artifacts immutable. Preserve prior conversation/travel/native/recovery/privacy/cancellation/source/held-control/caret guarantees; no data capture/context expansion. One GUI owner. Parent owns finalfullunits/package. Actual UI testing fakeexternalservices/syntheticowneddata only.

## Task 1: Group the full player experience behind five sections

Files create src/renderer/player-navigation.js/.css, scripts/player-shell-smoke.cjs, scripts/player-navigation.cjs (test helper); modify src/renderer/app.js/index.html and narrow existing feature/CSS markup only where grouping/disclosures require, package/CI/release test:player-shell, docs/GETTING-STARTED.md, docs/PRODUCT-READINESS.md, docs/ROADMAP.md and README.md and featurehelp navigation references. Update actual affected legacyGUI fixture scripts to use visible navigation helper. No unrelated backend/state migrations.

Interfaces: primary sections adventure,quest-guide,assistant,characters,company map to Adventure,Quests,Companion,Characters,Plans. Internal party/preparation group Plans; game/connections/updates group Settings, guide groupHelp. Existing data-nav legacy targets remain accepted by app router. Export player navigation primary/group/current labels/subtabmarkup from focused module; exact coherent exports chosen before wiring and documented. Test helper navigate(page,legacyId) clicks visibleprimary thenvisiblesubtab, verifiesactualcurrentpage; never directlychangesglobalpage/windoweval or forceshiddenbuttons. Existingtests may call ensureCompanionTools(page,'memory'|'voice') only if tools intentionally grouped behind disclosure; controls must remain findable by ordinary player action.

- [ ] Add real Electron RED before changing nav. Harness synthetic profiles bothfactions/customimportedclass, fake all external surfaces BEFORE bootstrap, isolated ownedappdata automaticupdates/referencefetch disabled. Exact initial assertion:
```js
const primary=page.getByRole('navigation',{name:'Main navigation'});
const names=['Adventure','Quests','Companion','Characters','Plans'];
assert.equal(await primary.getByRole('button').count(),names.length);
for(let i=0;i<names.length;i++){
  const button=primary.getByRole('button',{name:names[i],exact:true});
  assert.equal(await button.count(),1);
  assert.equal(await button.evaluate(n=>[...n.closest('nav').querySelectorAll('button')].indexOf(n)),i);
}
```
Normalize decorativeglyphtext deliberately via accessible names rather than drop labels. Assert Settings and Help secondaryactions visible, not part of fiveprimary. Iterate all11legacytargets via actualcontrols/helper, verify pagebreadcrumb+groupactive correct and currentcharacter unchanged. Primary routes testkeyboardEnter/Spaceand originalskip h1 stable/trustedURLunchanged. Run node scripts/player-shell-smoke.cjs RED, then implement focusednavigation/groupheader and minimalappwiring. Groupselectionmustfollow existingdeep-link corrective actions too.
- [ ] Add novice disclosure/flow RED in same fixture: PlansCompany/Party/Preparation allreachable; Settings game/setup/provider/updates reachable; Help FieldGuide/support/checkpoints/recovery reachable with existingconsents. No credential/billing/sharing/destructivewarning hidden atdecision. Conversation retainedsameowner acrossnav but activework canceled; currentdraftandcaret survive refresh. Characternewpicker contains nineconfirmedclasses+Other, existingcustom/importedvalue remainsselectedwithoutrewrites. Implement friendly summaries/oneclearrecommendedaction/optionalDetails without removing existinghighpowerpaths. Avoid collapsingunsavedreview/currenterror behind an invisiblepanel. All prior native quest/preparation/party/manualplan controls functional.
- [ ] Apply premium shellpolish using existing original class/faction art, gold/factionmaterials/embosseddepth/focus/active highlights and restrainedtransitions. Keep legible contrast/dark dropdowns, reducedmotion, compactlayout, stable autosave. Capture all5primary full+984x635 each, Settings/Help, Alliance/Horde,200%zoom/reducedmotion. Assert zerohorizontaloverflow/brokenimages, allnav/subtabs keyboardreachable, realdarkselectcontrast helper. Existingrendererinteractionguardmusthold originalpressedcontrols across asyncpaints; no focus/timewait padding hidingdefects. Visuallyinspect newcaptures and document provenance.
- [ ] Update all affectedexistingGUI fixtures through visible helper; preserve original11reachablepage coverage/focus/caret/native/ownership/raceassertions and meaningfulcount now5primary+2secondary. Run everyaffectedGUI command strictlySERIAL onceafterstablechanges; list exactcommands/counts/evidence in report. Add focusedrendererunitmetadata tests where practical, no implementationmirror snapshots. Register serial player-shell alias/workflows, update beginnerdocs and mapoldterms to new destinations. Scope/syntax/diff/self-review, scopedcommit with .superpowers/sdd/guided-shell-task-1-report.md BEFOREcommit and exactREDGREEN/commands/screens/alllegacycoverage/limits. Send finalSHA/releasesGUI. Parent independent taskgate thenintegratedfullsuite/strongestsource+artifactreview/newWindowsreviewbundle.

Self-review: fiveprimaryentries reduceequalweightchoices, grouping retains actual11destinations. Existing art/features source-of-truth unchanged. Navigationhelper exercises realnewgroupcontrols; assertions aren't deleted to make green. Advancedoptions remain discoverable; privacy/cost/destructive review retain visible context.


Existing feature interfaces: CompanionTravel.render(travel,index,text)/mounted(container,messages), CompanionReply formatter/escape; backend travel APIs unchanged as specified in exact design. Keep newmessage-start and unchanged-scroll/expanded-source state. Add sourcepublisher labels and top road-alternative jump as local presentation only; all trustedchoice IDs/source/copy/plan actions remain main-owned.

Task3 Minor cleanup files: src/main.cjs exact static stale-choice message allowlist, src/core/travel-companion.cjs + src/renderer/companion-travel.js readability formatting only. First strengthen actual IPC stale-choice assertion to expect the helpful recovery message, record RED, then allow only that exact static string. No broader error exposure. Reformat focused modules without semantics; run node --test tests/travel-companion.test.cjs tests/companion-reply.test.cjs plus already-required affectedtravel UI gate. Include both Minor resolutions in report so strongest final review can close the roll-up.

Disclosure acceptance is binding: selected saved-memory count and currentsharing/provider-cost remain visible when optionalpanels fold; openstate survivespaints/nav; closingVoice retiresactive/pendingfakeaudio; no memory-save eligibility invented from retainedhistory. Use shared visible-action testhelper for anyintentionallyclosedtool, preservingall original physical/race/caret/privacy assertions. EachaffectedlegacyGUIcommand must runserially afterstablecode, notmerelyhaveitsselectorsedited. Tests that needall11pages muststillvisitthem. Newcardjump mustshowroadwithout inference ormanualnestedscroll discovery; unchangedpaint retainsreadingposition.

Final self-review: glyph-sensitive initialtest corrected to accessible labels/order; nonexistentUSER-GUIDEpath removed in favor of actualbeginnerdocs. No undefined backend API or placeholders remain. Parent owns independenttaskreview/fullintegratedunit+strongestwholebranch/artifactgate; implement onlythisboundedUI task andreport finalSHA.
