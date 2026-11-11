const { test } = require("node:test"),
  assert = require("node:assert/strict");
test('location preview uses explicit memory scope and original draft without mutation',()=>{
 const {registerKnowledgeHandlers}=require('../src/core/knowledge-ipc.cjs'),handlers={},seen=[];
 const p={id:'p',location:{zone:'Old mine',mapId:1,x:.1,y:.2}},state={activeProfileId:'p',profiles:[p]};
 registerKnowledgeHandlers({handle:(name,fn)=>handlers[name]=fn,knowledge:{index:()=>null},getState:()=>state,connected:()=>false,clipboard:{},getLocationContext:(...args)=>{seen.push(args);return {zone:'Orgrimmar',source:'user-report'};}});
 const mid='12345678-1234-4234-8234-123456789abc',r=handlers.contextPreview('p',true,"I'm in Org",[mid]);
 assert.equal(r.location.zone,'Orgrimmar');assert.equal(r.locationSource,'user-report');assert.equal(r.savedLocation.zone,'Old mine');assert.deepEqual(seen,[['p',true,"I'm in Org",[mid]]]);assert.deepEqual(p.location,{zone:'Old mine',mapId:1,x:.1,y:.2});assert.equal(handlers.contextPreview('p',false,'q',[mid]),null);
 assert.throws(()=>handlers.contextPreview('p',true,'q',['bad']));assert.throws(()=>handlers.contextPreview('p',true,'q',[mid,mid]));assert.throws(()=>handlers.contextPreview('p',true,'q',[],{}));
});

test('explicit other-profile public preview stays read-only without crossing active conversation ownership',async()=>{
 const {registerKnowledgeHandlers}=require('../src/core/knowledge-ipc.cjs'),providers=require('../src/core/providers.cjs'),{CompanionService}=require('../src/core/companion-service.cjs'),{CompanionContext}=require('../src/core/companion-context.cjs'),{CompanionRequest}=require('../src/core/companion-request.cjs'),{MemoryService}=require('../src/core/memory.cjs');
 const state={activeProfileId:'Beta',profiles:['Alpha','Beta'].map(id=>({id,name:id,location:{zone:id==='Alpha'?'Alpha saved forest':'Beta saved mine',mapId:1411,x:.1,y:.2},notes:'PRIVATE_NOTE',goals:[{text:'PRIVATE_GOAL'}],source:{kind:'wow-addon',id:'PRIVATE_SOURCE_'+id,updatedAt:'2026-11-01T00:00:00Z'}})),provider:{id:'ollama',model:'fixture',endpoint:'http://localhost:11434',authMode:'api'},memories:[]};
 const store={state,getKey:()=>''},context=new CompanionContext(()=>state),requests=new CompanionRequest(context),memory=new MemoryService({store,context}),calls=[],seen=[],handlers={};
 const service=new CompanionService({store,context,requests,memory,knowledge:{index:()=>null},ai:{...providers,ask:async r=>{calls.push(r);return 'Synthetic planning reply';}}});
 const ask=(prompt,profileId='Beta')=>service.ask({provider:'ollama',prompt,profileId,shareProfile:true,memoryIds:[]});
 registerKnowledgeHandlers({handle:(n,fn)=>handlers[n]=fn,knowledge:{index:()=>null},getState:()=>state,connected:()=>false,getLocationContext:(...args)=>{seen.push(args);return service.previewLocation(...args);}});
 await ask("I'm in Org. Help me plan my next quest");
 const snapshot=()=>JSON.stringify({state,session:service.session,rootEpoch:service.rootEpoch,context:context.snapshot(),draft:memory.draft('Beta')});
 const before=snapshot(),mid='12345678-1234-4234-8234-123456789abc';
 for(const [prompt,ids]of [['1061',[]],["I'm in TB. Explain my plan",[mid]]]){
  const result=handlers.contextPreview('Alpha',true,prompt,ids);
  assert.equal(result.name,'Alpha');assert.equal(result.location.zone,'Alpha saved forest');assert.equal(result.locationSource,'saved-snapshot');assert.equal(result.reportedLocation,undefined);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|Orgrimmar|Thunder Bluff|Beta saved mine/);assert.equal(snapshot(),before);
 }
 assert.equal(seen.length,0,'another stored profile must not consult the active-report callback');
 assert.equal(handlers.contextPreview('Alpha',false,'1061'),null);
 assert.throws(()=>handlers.contextPreview('Missing',true,'1061'),/Choose a character/);
 assert.throws(()=>handlers.contextPreview('Alpha',true,'1061',['bad']));
 const active=handlers.contextPreview(null,true,'Help me plan my next quest');
 assert.equal(active.name,'Beta');assert.equal(active.location.zone,'Orgrimmar');assert.equal(active.savedLocation.zone,'Beta saved mine');assert.equal(active.locationSource,'user-report');assert.equal(snapshot(),before);
 assert.deepEqual(handlers.contextPreview(undefined,true,'Help me plan my next quest'),active);assert.equal(snapshot(),before);
 assert.deepEqual(seen,[['Beta',true,'Help me plan my next quest',[]],['Beta',true,'Help me plan my next quest',[]]]);
 assert.throws(()=>service.previewLocation('Alpha',true,'1061'),/current character/);
 assert.throws(()=>memory.list('Alpha'),/current character/);
 await ask('Help me plan my next quest');const raw=calls.at(-1).context;assert.deepEqual(JSON.parse(raw.slice(raw.indexOf('{'))),active);
 const called=calls.length;await assert.rejects(ask('Help me plan','Alpha'),/current character/);assert.equal(calls.length,called);
});
test("knowledge IPC accepts bounded queries only, selects sourced clipboard coordinates and shares exact preview helper", () => {
  const {
      registerKnowledgeHandlers,
    } = require("../src/core/knowledge-ipc.cjs"),
    { KnowledgeIndex } = require("../src/core/knowledge.cjs");
  const index = new KnowledgeIndex(require("../data/forever/pack.json")),
    handlers = {};
  let clipboard;
  const p = {
    id: "p",
    name: "Example",
    className: "Mage",
    level: 20,
    clientBuild: index.pack.build,
    captureVersion: "0.6.0",
    source: {
      kind: "wow-addon",
      updatedAt: "2026-11-09T00:00:00.000Z",
      id: "PRIVATE",
    },
    quests: [
      {
        id: 1061,
        title: "The Spirits of Stonetalon",
        complete: true,
        objectives: [],
      },
    ],
  };
  const knowledge = {
    setContext() {},
    status: () => ({ phase: "ready" }),
    index: () => index,
    refresh: () => ({ phase: "ready" }),
    setAutomatic: (automatic) => ({ automatic }),
  };
  registerKnowledgeHandlers({
    handle: (n, fn) => (handlers[n] = fn),
    knowledge,
    getState: () => ({ profiles: [p], activeProfileId: "p" }),
    connected: () => true,
    clipboard: { writeText: (t) => (clipboard = t) },
  });
  assert.equal(handlers.questDetails("p", 1061).status, "match");
  assert.equal(handlers.searchQuests("1061", "p", {})[0].id, 1061);
  assert.equal(handlers.copyQuestWaypoint("p", 1061, "t").command, clipboard);
  assert.match(clipboard, /^\/bf guide 1061 t 1413/);
  assert.deepEqual(
    handlers.contextPreview("p", true, "1061"),
    require("../src/core/providers.cjs").approvedProfile(p, {
      knowledge: index,
      prompt: "1061",
    }),
  );
  assert.equal(handlers.contextPreview(null, false, "1061"), null);
  for (const [phase, complete] of [
    ["t", true],
    ["o", false],
  ]) {
    p.quests[0].complete = complete;
    p.quests[0].destination = { mapId: 999, x: 0.123456, y: 0.2 };
    const descriptor = handlers.questDetails("p", 1061).waypoint;
    const copied = handlers.copyQuestWaypoint("p", 1061, phase);
    const parts = copied.command.split(" ");
    assert.equal(descriptor.phase, phase);
    assert.equal(descriptor.source, "game");
    assert.equal(descriptor.canCopy, true);
    assert.equal(descriptor.destination.mapId, Number(parts[4]));
    assert.equal(descriptor.destination.x, Number(parts[5]));
    assert.equal(descriptor.destination.y, Number(parts[6]));
    assert.match(copied.message, /quest waypoint/);
    assert.doesNotMatch(copied.message, /reference marker/);
  }
  for (const [id, title, status] of [
    [1061, "Conflicting game title", "conflict"],
    [999999, "Missing community record", "missing"],
  ]) {
    p.quests[0] = { ...p.quests[0], id, title };
    const details = handlers.questDetails("p", id);
    assert.equal(details.status, status);
    assert.equal(details.waypoint.source, "game");
    assert.equal(details.waypoint.canCopy, true);
    assert.match(
      handlers.copyQuestWaypoint("p", id, "o").command,
      / 999 0.1235 0.2000 /,
    );
  }
  p.quests[0] = {
    ...p.quests[0],
    id: 1061,
    title: "The Spirits of Stonetalon",
  };
  p.captureVersion = undefined;
  const disabled = handlers.questDetails("p", 1061).waypoint;
  assert.equal(disabled.canCopy, false);
  assert.match(disabled.reason, /reload/i);
  const previousClipboard = clipboard;
  assert.throws(() => handlers.copyQuestWaypoint("p", 1061, "o"));
  assert.equal(clipboard, previousClipboard);
  p.captureVersion = "0.6.0";
  p.quests = [];
  const reference = handlers.questDetails("p", 5730).waypoint;
  assert.equal(reference.phase, "r");
  assert.equal(reference.source, "reference");
  assert.equal(reference.destination.id, 3216);
  const copiedReference = handlers.copyQuestWaypoint("p", 5730, "r");
  assert.match(copiedReference.message, /reference marker/);
  assert.ok(
    copiedReference.command.includes(
      ` ${reference.destination.mapId} ${reference.destination.x.toFixed(4)} ${reference.destination.y.toFixed(4)} `,
    ),
  );
  for (const [name, args] of [
    ["knowledgeStatus", ["url"]],
    ["refreshKnowledge", [{}]],
    ["setKnowledgeAutomatic", ["true"]],
    ["searchQuests", ["x".repeat(121), "p", {}]],
    ["searchQuests", ["", "p", { url: "https://bad" }]],
    ["questDetails", ["p", "1061"]],
    ["questDetails", ["absent", 1061]],
    ["copyQuestWaypoint", ["p", 1061, { mapId: 1, x: 1, y: 1 }]],
    ["copyQuestWaypoint", ["p", 1061, "t", { x: 1 }]],
    ["contextPreview", ["p", "yes", "1061"]],
  ])
    assert.throws(() => handlers[name](...args), name);
});
