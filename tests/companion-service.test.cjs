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
