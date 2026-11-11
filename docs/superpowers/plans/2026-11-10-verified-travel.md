# Verified Forever travel implementation plan

> For agentic workers: REQUIRED subagent-driven-development and test-driven-development. One implementation owner, task SPEC/QUALITY gate, fresh strongest whole-series review.

**Goal:** ship an offline, qualified travel reference/planner that can answer supported trips without inventing retail transport.
**Architecture:** immutable selected public observations plus original cited curation compile into a bounded validated pack; pure intent/planner returns local explanatory text and typed route options for later companion integration.
**Tech Stack:** existing CommonJS Node, JSON and node:test. No dependency/addon/native protocol changes.

## Global Constraints

Exact binding spec docs/superpowers/specs/2026-11-10-verified-travel-design.md and umbrella. Keep1.0held/source0.12.3; no actual player/game files/input/accounts/audio/paid inference/installer/OS settings/watchers/publication. Previous sealed artifacts immutable. Existing reference pack bytes and updater/provider/recovery/privacy boundaries preserved. All source evidence scope/date/build/eligibility conditions remain visible in returned text/metadata. Offline check never fetches. Parent owns final full-suite/GUI/package. No GUI in this task.

## Task 1: Bounded evidence pack and deterministic trip planner

Files create src/core/travel-data.cjs, src/core/travel-sources.cjs, src/core/travel.cjs, scripts/build-forever-travel.cjs, tests/travel-data.test.cjs, tests/travel.test.cjs, data/forever-travel/{pack.json,source-lock.json,NOTICE,LICENSE-CC-BY-4.0.txt}; modify package.json/serial CI and release checks, docs/TRAVEL-GUIDANCE.md and existing attribution docs. Do not add main/preload/UI wiring yet.

Interfaces consumed: actual research report work/forever-travel-evidence-report.md and work/guided-travel-research/{raw-source-manifest,source-index,flight-evidence-sample}.json; pinned raw flights and existing raw NPC input under work/series-data-research. Existing observed profile shape source.kind==='wow-addon', source.updatedAt, clientBuild, faction, location. Caller MUST omit profile when sharing off. Do not depend on main conversation internal representation.
Interfaces produced: loadTravelReference(bytes), parseTravelIntent(question,{previousQuestion,profile}), planTravel(reference,intent,{profile}), optional exported plain text formatter. Exact names may adjust coherently, all exports/shape/usage examples required in task report for next integration worker. Result text is safe plain text; structured source IDs from static registry, no renderer-provided arbitrary URLs/actions. A missing/invalid reference produces honest recognized-travel unavailable results later.

- [x] Add RED before code, run node --test tests/travel-data.test.cjs. Tests compile selected actual pinned inputs through strict size/meta/hash provenance, validate roundtrip pack, and reject changed raw hash/bytes/meta, schema/ID/alias/source/endpoint/mode/date/position failures atomically. Example invariant:
```js
const reference=loadTravelReference(compiledBytes);
assert.equal(reference.product,'wowf');
assert.ok(reference.edges.some(e=>e.mode==='flight'&&e.from==='orgrimmar'&&e.to==='thunder-bluff'));
assert.throws(()=>loadTravelReference(Buffer.alloc(256*1024+1)));
```
Implement focused validation/compilation with <=64nodes/128edges/32sources/16negatives/16itineraries/12steps/8sources per fact/4aliases per node and256KiBcompiled limit. Use exact raw hash locks from research; no copied guide prose or images. Build takes --source-dir explicitly, --check reads only shipped bytes and immutable descriptor. Run actual build twice compare bytes then offline check with raw input inaccessible to prove no network/raw dependency. Record generated pack bytes/hash and older pack hash parity.
- [x] Add planner RED before implementation, run node --test tests/travel.test.cjs. Acceptance behavior:
```js
const intent=parseTravelIntent('what is the fastest way from org to tb',{});
assert.equal(intent.originId,'orgrimmar');
assert.equal(intent.destinationId,'thunder-bluff');
const result=planTravel(reference,intent,{profile:matchingHorde});
assert.equal(result.status,'route');
assert.match(result.text,/Doras/);
assert.match(result.text,/offered|available/i);
assert.match(result.text,/Razor Hill/);
assert.match(result.text,/zeppelin/i);
assert.doesNotMatch(result.text,/take the zeppelin (to|bound for) Thunder Bluff/i);
```
Additional cases: OrgUC positive zeppelin; E4 directedlinks only; flights conditional even matchingbuild; manual/mismatch/unknownbuild doesn't inherit exactbuild proof; Horde/Alliance/unknownfaction; 'how to get to tb' explicit/savedqualified/no-share origins; standalonealiases notURLs/.org/substrings or conjunctionif; get-to-level20/nextquest nontravel; unknown/ambiguous/multitrip/thereclarification; no oldintent after unrelatedquestion; correction recovers originalUSER question only; samecity; invalid reference; unknown route uncovered not impossible; zero costs/timing/fastest/safety guarantees. Implement pure parser and direct supported candidate selection, no continent shortestpath or imagined accesslegs. Preserve documented OrgTB road alternatives and route-specificnegative (one direction if source doesn't establish reverse). Plaintext result carries citations/scope/cautions for oldstring API later.
- [x] Register offline check in package/CI/release paths following existing insights check. Add beginner travel documentation with clear coverage, saved-vs-live and unlock limits, sourceattribution and contributor process. Test only new units+affected build/integration boundaries. Syntax/diff/self-review. Commit scoped code/docs with report .superpowers/sdd/guided-travel-task-1-report.md BEFORE commit, exact RED/GREENcommands/counts/sourceproof/exportcontracts/limitations, send finalSHA. No full suite/GUI/package. Parent independent task review before next implementer.

Self-review: initial17directedtransportcandidates maximum are6observedflights+6zeppelin+2tram+2StormwindHarbourboat+oneRatchet→BootyBay, and one OrgTB road itinerary. Implement only facts proven by report; report a deliberate excluded fact instead of manufacturing a reverse. This is a finite evidence reference, not exhaustive travel coverage or a fastest-route claim. Parser keeps unknowns honest; exact main-owned conversation and UI actions belong next task.



