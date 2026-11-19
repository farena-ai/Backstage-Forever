"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {CompanionContext}=require('../src/core/companion-context.cjs');
const {CompanionRequest}=require('../src/core/companion-request.cjs');
const {MemoryService}=require('../src/core/memory.cjs');
const providers=require('../src/core/providers.cjs');
let CompanionService;try{({CompanionService}=require('../src/core/companion-service.cjs'));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const mid='12345678-1234-4234-8234-123456789abc';
function fixture(id='ollama',authMode='api'){
 const state={activeProfileId:'Alpha',profiles:[{id:'Alpha',name:'Alpha',notes:'PRIVATE_NOTE_CANARY',goals:[{text:'PRIVATE_GOAL_CANARY'}],source:{kind:'wow-addon',id:'opaque'}}],provider:{id,model:'fixture',endpoint:'http://localhost:11434',authMode},memories:[{profileId:'Alpha',exchanges:[{id:mid,question:'SAVED_QUESTION',answer:'SAVED_CANARY'}]}]};
 const store={state,getKey:()=> 'SECRET_CANARY'},context=new CompanionContext(()=>state),requests=new CompanionRequest(context),memory=new MemoryService({store,context}),seen=[],resets=[];
 let transport=async i=>{seen.push(i);return 'Unverified suggestion';};
 const ai={...providers,ask:i=>transport(i)},chatgpt={ask:i=>transport(i)},claude={ask:i=>transport(i)};
 const service=new CompanionService({store,context,requests,memory,ai,chatgpt,claude,knowledge:{index:()=>undefined},onReset:r=>resets.push(r)});
 const ask=(prompt='Where should I level?',extra={})=>service.ask({provider:id,prompt,profileId:state.activeProfileId,shareProfile:true,memoryIds:[],...extra});
 return {state,store,context,requests,memory,service,seen,resets,ask,transport(fn){transport=fn;}};
}
test('shared service interface exists',()=>assert.equal(typeof CompanionService,'function'));

test('explicit dungeon preparation answers offline with no character, model, or credentials',async()=>{
 const f=fixture();f.state.activeProfileId=null;f.state.profiles=[];f.state.provider.model='';
 f.store.getKey=()=>assert.fail('offline answer read a credential');
 const r=await f.ask('Dungeon prep for #dm?',{shareProfile:false});
 assert.equal(r.kind,'quick');assert.equal(r.topic,'dungeon-prep');
 assert.match(r.text,/The Deadmines.*#dm/);assert.match(r.text,/No verified Forever preparation details/);
 assert.doesNotMatch(r.text,/Westfall|42\.0|Classic-era baseline|Repair gear/);
 assert.match(r.text,/Use my active character/);assert.equal(f.seen.length,0);
});

test('dungeon prep never guesses a partial name or turns a clarification into a provider request',async()=>{
 const f=fixture();
 for(const prompt of ['Dungeon preparation','Dungeon prep for DM?','Dungeon prep for #dm-extra?','Dungeon prep for Blackrock Spire?']){
  const r=await f.ask(prompt);
  assert.equal(r.topic,'dungeon-prep');assert.match(r.text,/Which instance/);assert.doesNotMatch(r.text,/approximate entrance/);
 }
 const raid=await f.ask('How should I prepare for Onyxia’s Lair?');
 assert.match(raid.text,/Onyxia's Lair.*#ony/);assert.doesNotMatch(raid.text,/attunement|Dustwallow/i);
 assert.equal(f.seen.length,0);
});

test('only exact-build Forever encounters can supplement local preparation',async()=>{
 const f=fixture(),at='2026-11-10T00:00:00.000Z',reads=[];
 const pack=require('../src/core/boss-loot-data.cjs').loadBossLootPack();
 const alpha=f.state.profiles[0];
 Object.assign(alpha,{clientBuild:pack.builds[0],quests:[{id:900001,title:'Scarlet Monastery Alpha quest',complete:false,objectives:[]},{id:900003,title:'Herod',complete:false,objectives:[]},{id:900004,title:'Scarlet Monasteryyard',complete:false,objectives:[]}],journal:{encounters:[{name:'Personal defeat canary',encounterId:444,instanceMap:189,instanceType:'party',difficultyId:1,at:Date.parse('2026-11-09')/1000}]}});alpha.source.updatedAt=at;
 f.state.profiles.push({...alpha,id:'Beta',name:'Beta',clientBuild:'1.60.1.99999',quests:[{id:900002,title:'The Deadmines Beta quest',complete:false,objectives:[]}]});
 f.service.dungeonEvidence={lootPack:()=>pack,wishes:id=>{reads.push(id);return [5202];}};
 const prompt='Dungeon prep for #sm?';
 const local=await f.ask(prompt);
 assert.match(local.text,/Interrogator Vishas \(encounter #444\)/);
 assert.match(local.text,/1\.60\.1\.70888.*2026-11-10.*2026-11-11/);
 assert.match(local.text,/From your saved quest log.*2026-11-10/);
 assert.match(local.text,/Scarlet Monastery Alpha quest \(quest #900001\)/);
 assert.doesNotMatch(local.text,/900003|900004|Personal defeat canary|5202|Beta|PRIVATE_|opaque|Tirisfal|85\.0|Roogug/);assert.equal(f.seen.length,0);
 assert.equal(f.memory.draft('Alpha'),null);
 await f.ask('Tell me some lore about the Titans.');
 assert.doesNotMatch(f.seen[0].prompt,/Dungeon prep|Interrogator Vishas|900001/);
 assert.doesNotMatch(JSON.stringify(f.seen[0].context),/Interrogator Vishas|historical boss-loot listings/);
 assert.doesNotMatch((await f.ask(prompt,{shareProfile:false})).text,/Alpha|900001|5202|Interrogator Vishas/);
 await assert.rejects(f.ask(prompt,{profileId:'Beta'}),/Choose the current character/);
 f.state.activeProfileId='Beta';
 const mixed=await f.ask(prompt);
 assert.match(mixed.text,/No verified Forever encounter observations match this instance and saved build/);
 assert.doesNotMatch(mixed.text,/900001|900002|5202|Alpha|Interrogator Vishas/);assert.deepEqual(reads,[]);
 f.state.profiles[1].source={kind:'wow-addon',id:'future',updatedAt:'2999-01-01T00:00:00.000Z'};
 assert.match((await f.ask(prompt)).text,/No dated addon save/);
 assert.equal(f.seen.length,1);
});
test('a same-build pack with an unreviewed source URL is not Forever encounter evidence',async()=>{
 const f=fixture(), pack=require('../src/core/dungeon-atlas.cjs').loadEncounters();
 Object.assign(f.state.profiles[0],{clientBuild:pack.build});
 f.state.profiles[0].source.updatedAt='2026-11-09T00:00:00.000Z';
 assert.match((await f.ask('Dungeon prep for #sm')).text,/collection window 2026-11-10 to 2026-11-11/);
 f.service.dungeonEvidence={encounters:()=>({...pack,source:{...pack.source,url:`https://example.invalid/data/wowf/${pack.build}/encounters.json`}})};
 const answer=await f.ask('Dungeon prep for #sm');
 assert.match(answer.text,/No verified Forever encounter observations/);
 assert.doesNotMatch(answer.text,/Interrogator Vishas|collection window/);
 assert.equal(f.seen.length,0);
});
test('recognized preparation never reaches local, API or subscription providers, even for the wrong edition',async()=>{
 for(const [id,mode] of [['local','api'],['ollama','api'],['ollama-cloud','api'],['openai','api'],['anthropic','api'],['xai','api'],['openai','subscription'],['anthropic','subscription']]){
  for(const lookups of [true,false]){
   const f=fixture(id,mode);f.service.lookups=lookups;
   f.service.localAi={start:()=>assert.fail('offline preparation started the local model')};
   f.transport(async()=>assert.fail('offline preparation reached inference'));
   for(const prompt of ['How do I prepare for the Deadmines?','What should I do to prepare for The Deadmines in Retail?','Dungeon prep for Classic Deadmines','How should I prepare for the Rookery dungeon?','How do I prep for the Deadmines and where is the entrance?','How should I prepare for the Rookery in Retail?','How do I prep for SM?','How do I prep for SM and where is the entrance?','How do I prep for SM (Retail)?','How to prepare for Shadowfang?','Dungeon prep: Deadmines','What do I need before entering it?','How do I prep for it?','How do I prepare for Retail Rookery?']){
    const r=await f.ask(prompt);assert.equal(r.topic,'dungeon-prep',prompt);
    assert.doesNotMatch(r.text,/Westfall|42\.0|VanCleef/);
    if(/Retail|Classic/.test(prompt))assert.match(r.text,/only covers World of Warcraft: Forever/);
   }
   assert.equal(f.service.session.status().turns,0);
  }
 }
});
test('unrelated natural preparation is not made a dungeon question by a non-game use of midnight',async()=>{
 const f=fixture();
 assert.equal((await f.ask('How do I prepare for a midnight fishing trip?')).kind,'ai');
});
test('general instance facts stay local, including edition mismatches and unsupported current facts',async()=>{
 for(const [id,mode] of [['local','api'],['ollama','api'],['ollama-cloud','api'],['openai','api'],['anthropic','api'],['xai','api'],['openai','subscription'],['anthropic','subscription']]){
  for(const model of ['', 'fixture']){
   const f=fixture(id,mode);f.state.provider.model=model;f.service.lookups=false;
   f.store.getKey=()=>assert.fail('instance answer read credentials');
   f.transport(()=>assert.fail('instance answer reached inference'));
   f.service.localAi={start:()=>assert.fail('instance answer started the local model')};
   for(const [prompt,expected] of [
    ['Where is Wailing Caverns?',/Wailing Caverns.*#wc/s],
    ['What bosses are in #sm?',/Scarlet Monastery.*#sm/s],
    ['How do I get to The Deadmines?',/The Deadmines.*#dm/s],
    ['Can I do Scarlet Monastery at level 30?',/No verified current Forever/],
    ['Where is the entrance to the Rookery dungeon?',/Which instance/],
    ['Where is the Rookery dungeon?',/Which instance/],
    ['Where is The Deadmines in Retail?',/only covers World of Warcraft: Forever/],
    ['What bosses are in Classic #sm?',/only covers World of Warcraft: Forever/],
    ['Where is #dm-extra?',/Which instance/],
    ['Where is #dm.extra?',/Which instance/],
    ['What bosses are in DM?',/Which instance/],
    ['Compare bosses in Scarlet Monastery and Razorfen Kraul',/Which instance/],
   ]){
    const r=await f.ask(prompt);assert.equal(r.topic,'dungeon-facts',prompt);
    assert.match(r.text,expected,prompt);
    assert.doesNotMatch(r.text,/Barrens|Westfall|Tirisfal|VanCleef|Interrogator Vishas|17–24|46\.0/);
   }
   assert.equal(f.memory.draft('Alpha'),null);assert.equal(f.service.session.status().turns,0);
  }
 }
});
test('only an explicit historical instance question can show bounded public encounter observations',async(t)=>{
 const f=fixture(), pack=require('../src/core/dungeon-atlas.cjs').loadEncounters();
 const fetch=t.mock.method(globalThis,'fetch',()=>assert.fail('instance answer accessed the network'));
 const prompt='Historical encounters for #sm?';
 const r=await f.ask(prompt,{shareProfile:false});
 assert.equal(r.topic,'dungeon-facts');
 assert.match(r.text,/Interrogator Vishas \(encounter #444\)/);
 assert.match(r.text,/Efficient Games.*1\.60\.1\.70888.*2026-11-10 to 2026-11-11/);
 assert.match(r.text,/Not a full roster/);assert.doesNotMatch(r.text,/Alpha|Tirisfal|85\.0|PRIVATE_/);
 const rfk=await f.ask('Historical encounters for #rfk on build 1.60.1.70888?',{shareProfile:false});
 assert.match(rfk.text,/Roogug \(encounter #2773\)/);assert.doesNotMatch(rfk.text,/Interrogator Vishas|Charlga Razorflank/);
 assert.equal(rfk.text.match(/\(encounter #\d+\)/g).length,4);
 for(const q of ['Historical encounters for #sm on build 1.60.1.77777?', 'Historical encounters for #dm?', 'Historical encounters for #sm on build 1.60.1.70888-extra?']){
  assert.doesNotMatch((await f.ask(q)).text,/Interrogator Vishas|VanCleef/);
 }
 for(const invalid of [null,{...pack,product:'wow'},{...pack,source:{...pack.source,url:'https://example.invalid/wowf/encounters.json'}}]){
  f.service.dungeonEvidence={encounters:()=>invalid};
  const answer=await f.ask(prompt);assert.match(answer.text,/No verified historical Forever/);assert.doesNotMatch(answer.text,/Interrogator Vishas/);
 }
 assert.equal(fetch.mock.callCount(),0);assert.equal(f.seen.length,0);
 assert.equal(f.memory.draft('Alpha'),null);assert.equal(f.service.session.status().turns,0);
 await f.ask('Tell me some lore about the Titans.');
 assert.doesNotMatch(f.seen[0].prompt,/Historical encounters|Interrogator Vishas/);
});
test('a dungeon name or token alone does not override unrelated Companion intents',async()=>{
 const f=fixture();
 for(const prompt of ["Where does Cobrahn's Grasp drop?", 'Where is the bank in Scarlet Monastery?', 'Where is the level 30 trainer in The Deadmines?', 'What level do I need to learn Alchemy for a raid?', 'What is quest #166 about?', 'How do I get to Thunder Bluff?']){
  const r=await f.ask(prompt);assert.notEqual(r.topic,'dungeon-facts',prompt);
 }
});
test('all seven transports receive identical composed main prompt and original draft question',async()=>{
 let expected;
 for(const [id,mode] of [['ollama','api'],['ollama-cloud','api'],['openai','api'],['anthropic','api'],['xai','api'],['openai','subscription'],['anthropic','subscription']]){
  const f=fixture(id,mode);await f.ask('what is the fastest way from org to tb');const result=await f.ask('This is for wow forever, not retail');
  assert.equal(result.kind,'ai');assert.equal(result.conversation.usedTurns,1);assert.match(f.seen[1].prompt,/fastest way from org to tb/);assert.doesNotMatch(f.seen[1].prompt,/PRIVATE_|SAVED_CANARY|SECRET_CANARY/);
  expected??=f.seen[1].prompt;assert.equal(f.seen[1].prompt,expected);assert.equal(f.memory.draft('Alpha').question,'This is for wow forever, not retail');
 }
});
test('memory scope is per question: deselection never resends a private memory-bearing answer',async()=>{
 const f=fixture();f.transport(async i=>{f.seen.push(i);return i.prompt.includes('SAVED_CANARY')?'PRIVATE_DERIVED_ANSWER':'Ordinary answer';});
 await f.ask('Quest?',{memoryIds:[mid]});await f.ask('Follow up?',{memoryIds:[mid]});assert.match(f.seen[1].prompt,/PRIVATE_DERIVED_ANSWER/);
 const r=await f.ask('New question');assert.doesNotMatch(f.seen[2].prompt,/PRIVATE_DERIVED|SAVED_CANARY/);assert.equal(r.conversation.resetReason,'scope-change');
});
test('navigation, public snapshots and private edits retain completed text; hard ownership and replacement boundaries clear',async()=>{
 const f=fixture();await f.ask('Original quest');f.context.notify({profileId:'Alpha',view:'other'});f.context.notify({profileId:'Alpha',view:'ai'});f.state.profiles[0].notes='EDITED_PRIVATE';f.state.profiles[0].level=22;f.context.sync();assert.equal((await f.ask()).conversation.usedTurns,1);
 for(const reason of ['source-root','source-disconnect','provider-save','authentication-key-delete','import','reset','restore','renderer-navigation','renderer-destroyed','renderer-gone']){
  f.context.invalidate(reason);assert.equal((await f.ask('Fresh '+reason)).conversation.usedTurns,0);
 }
 f.state.activeProfileId=null;f.context.sync();f.state.activeProfileId='Alpha';f.context.sync();assert.equal((await f.ask()).conversation.usedTurns,0);
});
test('concurrent rejection preserves active history; Stop/Clear/identical restore prevent late commit and native settlement stays serialized',async()=>{
 for(const boundary of ['stop','clear','restore','renderer-context']){
  const f=fixture();await f.ask('Completed quest');let release;f.transport(i=>{f.seen.push(i);return new Promise(r=>release=r);});
  const pending=f.ask('Pending quest');const rejected=assert.rejects(pending,/stopped|no longer current/);
  await assert.rejects(f.ask('Forged competing question',{shareProfile:false}),/in progress/);assert.equal(f.service.session.status().turns,1);
  if(boundary==='stop')f.requests.cancel();else if(boundary==='clear')f.service.clear();else f.context.invalidate(boundary);
  await rejected;release('LATE_CANARY');await new Promise(r=>setImmediate(r));assert.equal(f.memory.draft('Alpha'),null);
  assert.equal(f.service.session.status().turns,['stop','renderer-context'].includes(boundary)?1:0);
 }
 const f=fixture('anthropic','subscription');let release;f.transport(()=>new Promise(r=>release=r));const pending=f.ask();const rejected=assert.rejects(pending,/no longer current/);f.service.clear();await rejected;await assert.rejects(f.ask(),/still stopping/);release('Late');await new Promise(r=>setImmediate(r));f.transport(async()=> 'New');assert.equal((await f.ask()).text,'New');
});
test('failure/refusal/invalid arguments never become history; exact keys and arity apply to both endpoints',async()=>{
 const f=fixture();await f.ask('Successful quest');f.transport(async()=>{throw Error('failed');});await assert.rejects(f.ask('Failed quest'));assert.equal(f.service.session.status().turns,1);assert.equal(f.memory.draft('Alpha'),null);
 assert.equal((await f.ask('Write a cake recipe')).kind,'scope');assert.equal(f.service.session.status().turns,1);
 await assert.rejects(f.service.ask({provider:'ollama',prompt:'q',shareProfile:true,history:[]}));await assert.rejects(f.service.ask());await assert.rejects(f.service.ask({},{}));assert.throws(()=>f.service.clear('extra'));
 f.transport(async()=> 'Legacy text');assert.equal(await f.service.legacy({provider:'ollama',prompt:'Legacy quest',shareProfile:true}),'Legacy text');assert.equal(f.service.session.status().turns,2);
});

for(const boundary of ['question','answer'])test(`valid ${boundary} whitespace prefix cannot discard a successful answer or full conversation history`,async()=>{
 const f=fixture(),question=(boundary==='question'?' '.repeat(1000):'')+'Where should I level?',answer=(boundary==='answer'?' '.repeat(2000):'')+'Check the saved quest log.';
 f.transport(async input=>{f.seen.push(input);return answer;});
 const result=await f.ask(question);assert.equal(f.seen[0].prompt,question);assert.equal(result.text,answer);assert.equal(f.service.session.status().turns,1);
 const draft=f.memory.draft('Alpha');assert.equal(draft.question,question.trimStart());assert.equal(draft.answer,answer.trimStart());
 await f.ask('Which quest next?');const quoted=f.seen[1].prompt.split('\n').find(line=>line.startsWith('[{'));
 assert.deepEqual(JSON.parse(quoted),[{question,answer}],'Full original question and successful reply remain unchanged in recent history');
 let release;f.transport(()=>new Promise(resolve=>release=resolve));const pending=f.ask(question),rejected=assert.rejects(pending,/no longer current/);f.context.invalidate('restore');release(answer);await rejected;assert.equal(f.memory.draft('Alpha'),null);assert.equal(f.service.session.status().turns,0);
});
