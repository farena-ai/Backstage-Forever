"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { KnowledgeIndex } = require("../src/core/knowledge.cjs");
const { referenceFacts, publicFacts } = require("../src/core/knowledge-context.cjs");
const ai = require("../src/core/providers.cjs");
const pack = require("../data/forever/pack.json"), index = new KnowledgeIndex(pack);
const quest = (id, title = pack.quests[id]?.title || "Missing reference") => ({ id, title, complete: false, objectives: [] });
const profile = (ids = [1061, 5729, 5730, 98024]) => ({
  id: "fictional", name: "Example", clientBuild: pack.build, locale: "enUS",
  source: { kind: "wow-addon", id: "PRIVATE_GUID", updatedAt: "2026-11-09T00:00:00.000Z" },
  notes: "PRIVATE_NOTE", goals: [], quests: ids.map(id => quest(id)),
  history: { completedIdsKnown: true, completedIds: [5727], recent: [] },
});
test("literal NPC questions find the relevant active quest beyond the first three", () => {
  const p = profile(), facts = referenceFacts(p, index, "Where is Thork?");
  assert.equal(facts[0].questId, 98024);
  assert.equal(facts[0].mentions[0].name, "Thork");
  assert.equal(facts[0].mentions[0].positions[0].x, 0.5154);
  assert.deepEqual(ai.approvedProfile(p, { knowledge: index, prompt: "Where is Thork?" }).knowledge, facts);
  assert.equal(ai.profileContext({ profiles: [p] }, p.id, false, { knowledge: index, prompt: "Where is Thork?" }), "");
  assert.equal(referenceFacts(p, index, "Where is Thorkson?")[0].questId, 1061);
  assert.equal(referenceFacts(p, index, "Where is Neeru?")[0].questId, 1061, "Partial NPC names cannot silently join records");
  assert.doesNotMatch(JSON.stringify(facts), /PRIVATE|completedIds|notes|goals/);
});
test("literal punctuation and ambiguous whole NPC names retain only actual relationships", () => {
  const synthetic = structuredClone(pack);
  synthetic.npcs["npc:3429"].name = "Thork (Camp)+";
  synthetic.quests[5730].mentions = [{ kind: "npc", id: 3429, relationship: "mentioned-in-objective" }];
  const idx = new KnowledgeIndex(synthetic), p = profile([1061, 98024, 5730]);
  assert.deepEqual(referenceFacts(p, idx, "Where is Thork (Camp)+?").slice(0,2).map(f => f.questId), [5730, 98024]);
  assert.equal(referenceFacts(p, idx, "Where is Thork Camp?")[0].questId, 1061);
  assert.ok(!referenceFacts(profile([]), idx, "Where is Thork (Camp)+?")?.some(f => f.questId === 98024), "Cache-only NPC relationships cannot establish playability");
});
test("a specifically named NPC survives the existing two-NPC-per-relationship bound", () => {
  const synthetic = structuredClone(pack);
  synthetic.quests[1061].givers = [4949,3216,3429].map(id=>({id,kind:"npc"}));
  const facts = referenceFacts(profile([1061]),new KnowledgeIndex(synthetic),"Where is Thork?");
  assert.ok(facts[0].givers.some(n=>n.id===3429));
  assert.equal(facts[0].givers.length,2);
});
test("usable facts are filtered before the three-record cap", () => {
  for (const prefix of [[900001, 900002, 900003].map(id => quest(id)), [5727, 5728, 5729].map(id => quest(id, "Current hotfix title"))]) {
    const p = { ...profile(), quests: [...prefix, quest(1061), quest(5730), quest(98024), quest(1062)] };
    assert.deepEqual(referenceFacts(p, index, "What should I do next?").map(f => f.questId), [1061, 5730, 98024]);
    if (prefix[0].id === 5727) assert.equal(referenceFacts(p, index, "Explain quest 5729"), undefined, "Explicit conflicting quest must not be replaced by unrelated facts");
  }
  const p = profile([5729, 1061]); p.quests[0].title = "Current hotfix title";
  assert.equal(referenceFacts(p, index, "Explain Current hotfix title"), undefined);
  const unique = profile([1061]); unique.quests[0].title = "Current hotfix title";
  assert.equal(referenceFacts(unique, index, "Explain The Spirits of Stonetalon"), undefined);
  const missing = profile([900001,1061]); missing.quests[0].title = "Missing current quest title";
  assert.equal(referenceFacts(missing,index,"Explain Missing current quest title"),undefined);
});
test("explicit IDs select references; incidental level/map/coordinate/money numbers use current quests", () => {
  const p = profile([1061]);
  for (const prompt of ["Where should I quest at level 23?", "Where should I level 2?", "Map 23 at 2, 3", "I have 23 gold"]) {
    assert.equal(referenceFacts(p, index, prompt)[0].questId, 1061, prompt);
  }
  for (const prompt of ["#5730", "Explain quest 5730", "quest ID 5730", "5730"]) {
    assert.ok(referenceFacts(p, index, prompt)?.some(f => f.questId === 5730), prompt);
  }
  assert.equal(referenceFacts(p, index, "Tell me about Goblin Invaders")[0].questId,1062);
  assert.equal(referenceFacts(profile([]), index, "quest 1"), undefined, "Inactive cache-only records stay excluded");
});
test("chain neighbors preserve game titles, reference conflicts and translated aliases separately from progress", () => {
  for (const locale of ["enUS", "deDE"]) {
    const p = profile([5730, 5729]); p.locale = locale; p.quests[1].title = "Current game title";
    const node = index.details(p, 5730).chain.find(c => c.id === 5729);
    assert.equal(node.title, "Current game title");
    assert.equal(node.referenceTitle, "Hidden Enemies");
    assert.equal(node.status, "active");
    assert.equal(node.referenceStatus, locale === "enUS" ? "conflict" : "match");
    const facts = referenceFacts(p, index, "quest 5730");
    assert.deepEqual(facts[0].chain.find(c => c.id === 5729), node);
    assert.deepEqual(publicFacts(facts), facts, "Transport re-whitelisting preserves qualified nodes");
  }
});
test("real middle-chain facts retain actual directed links through the public whitelist", () => {
  const facts = referenceFacts(profile([5728]), index, "quest 5728");
  assert.deepEqual(facts[0].chain.filter(c => c.nextQuestId).map(c => [c.id, c.nextQuestId]).sort((a,b) => a[0]-b[0]), [[5727,5728],[5728,5729],[5729,5730]]);
  const injected = structuredClone(facts); injected[0].chain[0].nextQuestId = -1; injected[0].chain[0].private = "PRIVATE";
  assert.equal(publicFacts(injected)[0].chain[0].nextQuestId, undefined);
  assert.doesNotMatch(JSON.stringify(publicFacts(injected)), /PRIVATE/);
});
test("merge, cycle, missing targets and truncated chains keep only real edges and the requested node", () => {
  const synthetic = structuredClone(pack), seed = synthetic.quests[1061];
  const edges = [[70001,70003],[70002,70003],[70003,70004],[70004,70005],[70005,70003],[70006,79999]];
  for (let n=71000; n<71016; n++) edges.push([n,n+1]);
  for (const [id,nextQuestId] of edges) synthetic.quests[id] = { ...structuredClone(seed), id, title: `Synthetic ${id}`, nextQuestId };
  const idx = new KnowledgeIndex(synthetic), p = profile([70003,71008]);
  p.quests = p.quests.map(q=>({...q,title:synthetic.quests[q.id].title}));
  const merge = idx.details(p,70003);
  assert.ok(merge.warnings.some(w => /cycle/.test(w)));
  for (const node of merge.chain) if (node.nextQuestId) assert.equal(synthetic.quests[node.id].nextQuestId,node.nextQuestId);
  assert.ok(merge.chain.some(c => c.id===70001)); assert.ok(merge.chain.some(c => c.id===70002));
  assert.equal(idx.details(p,70006).chain.find(c => c.id===79999).status,"missing");
  const bounded = idx.details(p,71008); assert.equal(bounded.chain.length,12);
  assert.ok(bounded.warnings.some(w=>/limited/.test(w)));
  const facts = referenceFacts(p,idx,"quest 71008"); assert.equal(facts[0].chain.length,6);
  assert.ok(facts[0].chain.some(c=>c.id===71008));
  assert.ok(facts[0].chain.some(c=>c.nextQuestId && !facts[0].chain.some(n=>n.id===c.nextQuestId)), "Out-of-view reported targets remain explicit");
});
test("Explain my plan drafts preserve directed and title-qualified chain nodes", () => {
  const p = profile([5730,5729]); p.quests[1].title = "Current game title";
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/renderer/command-center.js"),"utf8"),sandbox);
  const details = index.details(p,5730);
  const text = sandbox.window.CommandCenter.draft({ steps: [{ title: "Hidden Enemies", questId:5730, knowledge:details }] }, { minutes:30, focus:"balanced" });
  const data = JSON.parse(text.slice(text.indexOf("\n")+1));
  const node = data.evidence[0].reference.chain.find(c=>c.id===5729);
  assert.equal(node.title,"Current game title"); assert.equal(node.referenceStatus,"conflict"); assert.equal(node.nextQuestId,5730);
  assert.match(text,/array order|node order/i);
});
test("NPC and qualified directed-chain facts reach all direct provider payloads", async t => {
  const p = profile(); p.quests[1].title = "Current game title";
  const dir = fs.mkdtempSync(require("node:path").join(require("node:os").tmpdir(),"bf-final-context-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let input;
  const claude = require("../src/core/claude.cjs").createClaude({
    dataDir:dir, findExecutable:async()=>"C:/synthetic/claude.exe",
    runner:async (_exe,args,options)=>args.includes("--print")
      ? (input=options.input,{ code:0,stdout:JSON.stringify({ type:"result", subtype:"success", is_error:false,result:"ok" }) })
      : { code:0,stdout:JSON.stringify({loggedIn:true,authMethod:"claude.ai",apiProvider:"firstParty",subscriptionType:"max"}) },
  });
  for (const prompt of ["Where is Thork?","quest 5730"]) {
    const approved = ai.approvedProfile(p,{knowledge:index,prompt});
    const check = text => {
      assert.doesNotMatch(text,/PRIVATE|completedIds|readiness/);
      assert.match(text,prompt.includes("Thork") ? /Thork/ : /Current game title/);
      if (prompt === "quest 5730") {
        assert.match(text,/nextQuestId/); assert.match(text,/referenceStatus/); assert.match(text,/conflict/);
      }
    };
    for (const provider of ["ollama","ollama-cloud","openai","anthropic","xai"]) {
      await ai.ask({provider,model:"fixture",apiKey:"fixture",prompt,context:ai.profileContext({profiles:[p]},p.id,true,{knowledge:index,prompt})},async (_url,options)=>{
        check(options.body);
        return new Response(JSON.stringify(provider.startsWith("ollama") ? {message:{content:"ok"}} : provider === "openai" ? {output:[{type:"message",content:[{type:"output_text",text:"ok"}]}]} : provider === "anthropic" ? {content:[{type:"text",text:"ok"}]} : {choices:[{message:{content:"ok"}}]}));
      });
    }
    await claude.ask({model:"fixture",prompt,context:approved}); check(input);
  }
});
