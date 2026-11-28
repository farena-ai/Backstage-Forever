"use strict";
// Companion benchmark (0.58): real player questions with answers checked against WoW Forever's
// own data (tests/fixtures/companion-bench/questions.json). Runs the companion exactly as the app
// wires it, offline, with no AI service, and scores each question two ways:
//   local     - with no model chosen: did it understand the request (intent) and state the facts?
//   grounding - with a model chosen: does the context sent to the model already hold the facts,
//               so even a small local model can answer from Forever data instead of guessing?
// Usage: node scripts/companion-bench.cjs [--json out.json] [--only id,id] [--verbose]
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const root = path.join(__dirname, "..");
const { CompanionService } = require("../src/core/companion-service.cjs");
const { CompanionContext } = require("../src/core/companion-context.cjs");
const { CompanionRequest } = require("../src/core/companion-request.cjs");
const { MemoryService } = require("../src/core/memory.cjs");
const providers = require("../src/core/providers.cjs");
const { TravelCompanion } = require("../src/core/travel-companion.cjs");
const { KnowledgeService } = require("../src/core/knowledge-cache.cjs");
const { LevelingAdvisor } = require("../src/core/leveling.cjs");

const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
const now = new Date().toISOString();
const base = (o) => ({ clientBuild: "1.60.1.70888", captureVersion: "0.58.0", locale: "enUS", updatedAt: Math.floor(Date.now() / 1000),
  source: { kind: "wow-addon", id: "bench-" + o.id, updatedAt: now }, history: { completedIdsKnown: true, completedIds: [], recent: [] }, quests: [], notes: "", goals: [], ...o });
// Fictional characters; no player data.
const PROFILES = {
  "horde-priest-21": base({ id: "bench-priest", name: "Morvaine", level: 21, faction: "Horde", race: "Undead", sex: "female", className: "Priest", location: { zone: "Ashenvale", subZone: "Splintertree Post", mapId: 1440, x: 0.73, y: 0.61 }, progress: { current: 4200, max: 21300 } }),
  "horde-hunter-16": base({ id: "bench-hunter", name: "Grukash", level: 16, faction: "Horde", race: "Orc", sex: "male", className: "Hunter", location: { zone: "The Barrens", subZone: "The Crossroads", mapId: 1413, x: 0.52, y: 0.30 }, progress: { current: 900, max: 11400 } }),
  "alliance-warrior-12": base({ id: "bench-warrior", name: "Edric", level: 12, faction: "Alliance", race: "Human", sex: "male", className: "Warrior", location: { zone: "Westfall", subZone: "Sentinel Hill", mapId: 1436, x: 0.56, y: 0.47 }, progress: { current: 1500, max: 8800 } }),
  "alliance-mage-34": base({ id: "bench-mage", name: "Tinkla", level: 34, faction: "Alliance", race: "Gnome", sex: "female", className: "Mage", location: { zone: "Stranglethorn Vale", subZone: "Rebel Camp", mapId: 1434, x: 0.38, y: 0.04 }, progress: { current: 30000, max: 69600 } }),
};

function makeService(profile, { model }) {
  const profiles = profile ? [structuredClone(profile)] : [];
  const state = { schemaVersion: 1, onboarded: true, activeProfileId: profile ? profile.id : null, profiles, provider: { id: "ollama", model: model ? "bench" : "", endpoint: "http://localhost:11434", authMode: "api" }, memories: [], journeys: [] };
  const store = { state, getKey: () => "", saveState(next) { store.state = next; return next; } };
  const context = new CompanionContext(() => store.state), requests = new CompanionRequest(context), memory = new MemoryService({ store, context });
  const travel = new TravelCompanion({ store, context, reference: read("data/forever-travel/pack.json"), openExternal: async () => {}, writeClipboard: () => {} });
  const knowledge = new KnowledgeService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "bf-bench-")) });
  const advisor = new LevelingAdvisor({ getState: () => store.state, knowledge: { bundled: { pack: knowledge.bundled.pack } }, insights: read("data/forever-insights/pack.json") });
  const seen = [];
  const ai = { ...providers, ask: async (req) => { seen.push(req); return "BENCH_MODEL_REPLY"; } };
  let npcReference = null, vendorPack = null, acquisitionPack = null;
  try { npcReference = require("../src/core/npc-location-data.cjs").validateNpcLocationPack(read("data/forever-npc-locations/pack.json")); } catch {}
  try { vendorPack = require("../src/core/vendor-facts.cjs").loadVendorPack(); } catch {}
  try { acquisitionPack = require("../src/core/acquisition-data.cjs").loadAcquisitionPack(); } catch {}
  const service = new CompanionService({ store, context, requests, memory, ai, chatgpt: {}, claude: {}, knowledge, travel, npcReference,
    travelReference: travel.reference || null, vendorPack, acquisitionPack, advise: (id) => advisor.advise(id) });
  return { service, store, seen };
}

// What the player wanted, read from which local answerer replied.
function routeOf(r) {
  if (!r) return "model";
  if (r.kind === "scope") return "refuse";
  if (r.kind === "npc") return r.npc?.status === "found" ? "npc-location" : "clarify";
  if (r.kind === "travel") return r.travel?.status === "route" ? "travel" : "clarify";
  if (r.kind === "intent") return { role: "role", "turnin-which": "clarify", place: "npc-location", profession: "trainer", recipe: "recipe", creature: "creature" }[r.intent] || r.intent;
  if (r.kind === "quick") return { train: "trainer", next: "quest-next", tonight: "quest-next", quest: "quest-info", "quest-turnin": "quest-turnin", "quest-clarify": "clarify", "quest-choices": "quest-info", lore: "lore", "dungeon-facts": "dungeon" }[r.topic] || "quick:" + r.topic;
  return r.kind;
}
const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
// Coordinates are approximate player-observed points: "52.0, 31.6" matches anything within 0.6.
const COORD = /^\s*(\d{1,2}(?:\.\d+)?)\s*,\s*(\d{1,2}(?:\.\d+)?)\s*$/;
function coordsIn(text) { return [...String(text).matchAll(/(\d{1,2}(?:\.\d)?),\s*(\d{1,2}(?:\.\d)?)/g)].map((m) => [Number(m[1]), Number(m[2])]); }
function has(text, t, fact) {
  const c = String(fact).match(COORD);
  if (c) return coordsIn(text).some(([x, y]) => Math.abs(x - Number(c[1])) <= 0.6 && Math.abs(y - Number(c[2])) <= 0.6);
  return t.includes(norm(fact));
}
function factsOk(text, expect) {
  const t = norm(text);
  const missing = (expect.mustInclude || []).filter((f) => !has(text, t, f));
  const groups = (expect.anyOf || []).filter((g) => !g.some((f) => has(text, t, f)));
  // A wrong fact counts in the answer itself, not inside a source link.
  const plain = norm(String(text).replace(/https?:\/\/\S+/g, ""));
  const wrong = (expect.mustNotInclude || []).filter((f) => plain.includes(norm(f)));
  const needed = (expect.mustInclude || []).length + (expect.anyOf || []).length;
  return { ok: !missing.length && !groups.length && !wrong.length, needed, missing, groups: groups.map((g) => g.join("|")), wrong };
}
// Intents that are the same request seen from the answerer's side.
// Roleplay and lore belong with the model (in voice, grounded by context); handing them over is right.
const SAME = { "quest-turnin": ["quest-info", "quest-next"], "quest-next": ["quest-next", "creature", "quest-info"], vendor: ["npc-location", "role"], trainer: ["trainer", "npc-location", "role"], profession: ["trainer", "role", "gather", "recipe"], travel: ["role"], "npc-location": ["role"], dungeon: ["travel", "npc-location"], "item-source": ["item-source", "drops", "quest-info"], rp: ["model", "role", "npc-location", "dungeon", "travel", "quest-next", "quest-info", "trainer", "vendor", "item-source"], lore: ["model", "npc-location", "lore"] };
const intentOk = (want, got) => want === got || (SAME[want] || []).includes(got);
const isInstanceAbstention = (outcome) => ["unknown-current", "clarify-instance"].includes(outcome);
const routeOk = (intent, route, outcome) => isInstanceAbstention(outcome) ? intent === route : intentOk(intent, route);

async function ask(q, model) {
  const profile = q.profile === "none" ? null : PROFILES[q.profile];
  if (q.profile !== "none" && !profile) throw Error(`${q.id}: unknown profile ${q.profile}`);
  const { service, store, seen } = makeService(profile, { model });
  try {
    const r = await service.ask({ provider: "ollama", prompt: q.question, profileId: store.state.activeProfileId ?? undefined, shareProfile: Boolean(profile), memoryIds: [] });
    return { r, sent: seen[0] || null };
  } catch (e) {
    if (/Choose a model/.test(e.message)) return { r: null, sent: seen[0] || null };
    return { r: null, error: e.message, sent: seen[0] || null };
  }
}

// "questions" is the tuned set; "heldout" was written without seeing the companion's code.
const loadQuestions = (set = "questions") => { const j = read(`tests/fixtures/companion-bench/${set}.json`); return Array.isArray(j) ? j : j.questions; };
async function runBench({ questions, verbose = false } = {}) {
  questions ??= loadQuestions();
  const rows = [];
  for (const q of questions) {
    const local = await ask(q, false);
    const route = local.error ? "error" : routeOf(local.r);
    const text = local.r?.text || "";
    const facts = factsOk(text, q.expect);
    const answeredLocally = Boolean(local.r);
    // Correct locally: understood the request, and (when facts are expected) stated them.
    const localCorrect = answeredLocally && routeOk(q.expect.intent, route, q.expect.outcome) && (q.expect.intent === "refuse" || facts.ok);
    let grounded = null;
    if (!answeredLocally && q.expect.intent !== "refuse" && !isInstanceAbstention(q.expect.outcome)) {
      const m = await ask(q, true);
      if (m.r?.kind === "ai" || m.sent) {
        // Only the context counts, and facts that merely repeat the question prove nothing.
        const sentText = m.sent?.context || "", asked = norm(q.question);
        const answerFacts = { mustInclude: (q.expect.mustInclude || []).filter((f) => !asked.includes(norm(f))), anyOf: (q.expect.anyOf || []).filter((g) => !g.some((f) => asked.includes(norm(f)))) };
        grounded = factsOk(sentText, answerFacts);
        if (!grounded.needed) grounded.ok = false; // nothing checkable: not counted as grounded
        grounded.reached = "model";
      } else if (m.r) grounded = { ok: false, reached: routeOf(m.r), needed: 0, missing: [], groups: [], wrong: [] };
    }
    rows.push({ id: q.id, category: q.category, intent: q.expect.intent, outcome: q.expect.outcome || null, route, answeredLocally, localCorrect, facts, grounded, text: verbose ? text : text.slice(0, 160), error: local.error || null });
  }
  return summarize(rows);
}
// Roleplay questions with no facts to check are judged on voice, which needs a live model.
const voiceOnly = (r) => r.intent === "rp" && !r.facts.needed;
function summarize(all) {
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
  const rows = all.filter((r) => !voiceOnly(r));
  const by = {};
  for (const r of rows) {
    const c = (by[r.category] ??= { n: 0, local: 0, understood: 0, grounded: 0, fallthrough: 0 });
    c.n++; if (r.localCorrect) c.local++; if (routeOk(r.intent, r.route, r.outcome)) c.understood++;
    if (r.grounded) { c.fallthrough++; if (r.grounded.ok) c.grounded++; }
  }
  const n = rows.length, local = rows.filter((r) => r.localCorrect).length, understood = rows.filter((r) => routeOk(r.intent, r.route, r.outcome)).length;
  const fall = rows.filter((r) => r.grounded), grounded = fall.filter((r) => r.grounded.ok).length;
  // Abstention fixtures check wording, not game facts. Keep both successful and
  // unsuccessful abstentions out of the factual denominator; score handling below.
  const factual = rows.filter(r => r.facts.needed && r.intent !== "refuse" && !isInstanceAbstention(r.outcome));
  const covered = factual.filter((r) => r.localCorrect || r.grounded?.ok).length;
  const voice = all.filter(voiceOnly);
  const abstentions = rows.filter(r => isInstanceAbstention(r.outcome));
  return { n, voiceOnly: voice.length, voiceUnderstood: voice.filter((r) => intentOk(r.intent, r.route)).length, abstention: { n: abstentions.length, correct: abstentions.filter(r => r.localCorrect).length }, factualCoverage: { n: factual.length, covered }, scores: { covered: pct(covered, factual.length), localCorrect: pct(local, n), understood: pct(understood, n), groundedWhenModel: pct(grounded, fall.length) }, byCategory: by, rows: all };
}
function print(report) {
  const s = report.scores;
  console.log(`Companion benchmark: ${report.n} scored questions (+${report.voiceOnly} roleplay questions judged on voice, which needs a live model; ${report.voiceUnderstood} of them routed to the model as they should be)`);
  console.log(`  factual coverage (correct locally or grounded):         ${s.covered}% (${report.factualCoverage.covered}/${report.factualCoverage.n})`);
  console.log(`  correct locally with no model:                         ${s.localCorrect}%`);
  if (report.abstention.n) console.log(`    includes correct abstentions/clarifications: ${report.abstention.correct}/${report.abstention.n}, not factual answers`);
  console.log(`  request understood (intent):                           ${s.understood}%`);
  console.log(`  facts in the model's context when it falls through:    ${s.groundedWhenModel}%`);
  console.log("  by category (n · local · understood · grounded/fallthrough):");
  for (const [k, c] of Object.entries(report.byCategory)) console.log(`    ${k.padEnd(16)} ${String(c.n).padStart(3)} · ${String(c.local).padStart(3)} · ${String(c.understood).padStart(3)} · ${c.grounded}/${c.fallthrough}`);
}
module.exports = { runBench, loadQuestions, makeService, PROFILES, factsOk, routeOf };
if (require.main === module) {
  const args = process.argv.slice(2), at = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  (async () => {
    let questions = loadQuestions(at("--set") || "questions");
    if (at("--only")) { const ids = new Set(at("--only").split(",")); questions = questions.filter((q) => ids.has(q.id)); }
    const report = await runBench({ questions, verbose: args.includes("--verbose") });
    print(report);
    if (args.includes("--fails")) for (const r of report.rows.filter((r) => !r.localCorrect && !r.grounded?.ok)) console.log(`  ✗ ${r.id} [${r.intent}→${r.route}] missing=${[...r.facts.missing, ...r.facts.groups].join(",")}${r.grounded ? " grounded-missing=" + [...r.grounded.missing, ...r.grounded.groups].join(",") : ""}${r.error ? " ERROR " + r.error : ""}  «${r.text.replace(/\n/g, " ").slice(0, 110)}»`);
    if (at("--json")) fs.writeFileSync(at("--json"), JSON.stringify(report, null, 1));
  })().catch((e) => { console.error(e); process.exit(1); });
}
