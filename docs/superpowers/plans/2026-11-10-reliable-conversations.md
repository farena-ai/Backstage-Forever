# Reliable conversations implementation plan

> For agentic workers: REQUIRED subagent-driven-development and test-driven-development; one implementer/GUI owner, independent SPEC/QUALITY task gate, fresh strongest final whole-series review.

**Goal:** make a real bounded current-session conversation across every existing provider without weakening private-memory, cancellation or source-owner safety.
**Architecture:** main-owned volatile ConversationSession, one shared ask pipeline, compatible legacy ask plus structured askCompanion, minimal renderer lifecycle/notice integration.
**Tech Stack:** existing CommonJS Node/Electron, vanilla renderer and actual Playwright fixtures; no new dependencies.

## Global Constraints

Binding exact spec docs/superpowers/specs/2026-11-10-reliable-conversations-design.md and umbrella. Existing source/credentials/recovery/privacy/native/provider contracts remain; no actual player/game files, game input, audio capture/playback, auth, paid inference, installer, OS settings, watchers, publication or version changes. Prior sealed review artifacts immutable. One implementation/GUI worker; read-only travel research may run beside it. Reuse existing checkout by preference. Keep1.0held.

## Task 1: Reliable in-session companion requests

Files: create src/core/companion-conversation.cjs and companion-service.cjs, tests/companion-conversation.test.cjs and companion-service.test.cjs, scripts/conversation-smoke.cjs; modify main/preload/wow-policy/renderer app narrowly, provider modules only if essential for exact composed-prompt parity, existing affected fixtures, PRIVACY/VOICE-AND-MEMORY/PROVIDERS/GETTING-STARTED and serial package/workflow aliases. Avoid a larger unrelated app.js rewrite.

Interfaces: ConversationSession prepare({owner,shareProfile,memoryIds,prompt}) returns a bounded prepared turn {composedPrompt,questionForEvidence,token,meta}; commit(token,{question,answer,kind}) accepts only current successful work, clear(reason), status(). The shared service accepts existing ask input and returns {text,kind,conversation}; legacy ask returns only text from that result. Main is the only history owner; use the existing CompanionRequest for request acceptance/cancel/native settlement and MemoryService for original-question eligibility. Keep six completed pairs, 6,000-character historical-context limit inside the original 12,000-character composed-prompt limit. Latest current question/explicit saved-memory material remains intact. These names may be adjusted coherently in the task report if needed; behavior/caps are binding and downstream tasks consume the documented approved exports.

- [ ] Write actual pure session RED tests before implementation. Concrete acceptance:
```js
const session = new ConversationSession();
const first = session.prepare({owner,shareProfile:true,memoryIds:[],prompt:'what is the fastest way from org to tb'});
session.commit(first.token,{question:'what is the fastest way from org to tb',answer:'Unverified previous suggestion',kind:'ai'});
const followup=session.prepare({owner,shareProfile:true,memoryIds:[],prompt:'This is for wow forever, not retail'});
assert.match(followup.composedPrompt,/fastest way from org to tb/);
assert.match(followup.composedPrompt,/untrusted/i);
assert.equal(followup.questionForEvidence,'what is the fastest way from org to tb');
```
Also cover full 12,000-character current input, six-turn trimming, 100,000-character prior answer, exact unchanged original, missing-memory deselection clears previous private answer, share/provider/profile/root/replacement/reload clear, canceled commit refusal. Run node --test tests/companion-conversation.test.cjs and record RED, then implement the focused module and GREEN.
- [ ] Write shared-service RED using fake existing transports and actual request/context/memory modules. Assert legacy/new endpoints use identical bounded composed prompt for all seven transport modes; only successful current requests commit after memory eligibility succeeds; Clear and stop/switch/identical replacement race cannot append late text; private canaries never enter unselected payloads; selected saved memory remains per-question. Implement service and narrow main/preload wiring. Preserve original endpoint arity, input validation, secret/key lifecycle and CLI settlement. Run node --test tests/companion-service.test.cjs tests/companion-request.test.cjs tests/memory.test.cjs plus only changed integration boundaries. No actual provider calls.
- [ ] Add actual Electron RED before renderer behavior. Fake transport captures real main input while UI sends the original request then the Forever correction, verifying second payload contains the original question and remains specialized. Add Clear-in-flight/Stop/edit/retry, ordinary nav/back retention, character/provider/share/memory boundary clearing, stale responses/import/reset/restore/reload and full/984x635 held controls. Implement askCompanion response use, clearConversation action, compact truthful notice and separated view-vs-conversation owner keys; keep Enter/Shift+Enter/IME and billing/sharing visible. Run node scripts/conversation-smoke.cjs strictly serial and inspect captures. Update existing source fixtures only when changed contract requires, preserving original assertions rather than adding focus/time retries.
- [ ] Update privacy/help and serial CI test:conversation alias, document all exported interfaces and exact lifecycle reasons for downstream travel task. Self-review scope/budgets/canaries/errors; syntax/diff checks, affected tests only. Commit scoped code/docs; report .superpowers/sdd/conversation-task-1-report.md BEFORE commit with precise RED/GREEN commands/counts/screens/limits. Send full final SHA. Parent independent SPEC/QUALITY review is required before next implementer. Parent owns final full-suite/packaging and new isolated review ZIP.

Self-review: request serialization and main ownership prevent forged history; memory-selection key preserves per-question privacy. The structured response is new while legacy string API remains compatible. No data-routing or five-section implementation is hidden in this task. User approved the direction; proceed without another plan-selection question.
