"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const providers=require('../src/core/providers.cjs'),{CompanionService}=require('../src/core/companion-service.cjs'),{CompanionContext}=require('../src/core/companion-context.cjs'),{CompanionRequest}=require('../src/core/companion-request.cjs'),{MemoryService}=require('../src/core/memory.cjs'),{registerKnowledgeHandlers}=require('../src/core/knowledge-ipc.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){
 const state={activeProfileId:'Alpha',profiles:[{id:'Alpha',name:'Alpha',location:{zone:'Boulder Lode Mine',mapId:1411,x:.1,y:.2},source:{kind:'wow-addon',id:'SYNTHETIC',updatedAt:'2026-11-01T00:00:00Z'}}],provider:{id:'ollama',model:'fixture',endpoint:'http://localhost:11434',authMode:'api'},memories:[]};
 const store={state,getKey:()=>''},context=new CompanionContext(()=>state),requests=new CompanionRequest(context),memory=new MemoryService({store,context}),calls=[];
 const service=new CompanionService({store,context,requests,memory,knowledge:{index:()=>null},npcReference:JSON.parse(fs.readFileSync('data/forever-npc-locations/pack.json')),ai:{...providers,ask:async r=>{calls.push(r);return 'Synthetic planning reply';}}});
 const handlers={};registerKnowledgeHandlers({handle:(n,f)=>handlers[n]=f,knowledge:{index:()=>null},getState:()=>state,connected:()=>false,getLocationContext:(...args)=>service.previewLocation(...args)});
 return {state,service,calls,preview:handlers.contextPreview,ask:prompt=>service.ask({provider:'ollama',prompt,profileId:'Alpha',shareProfile:true,memoryIds:[]})};
}
function renderer(f){
 const paints=[],host={set innerHTML(value){paints.push(value);},get innerHTML(){return paints.at(-1);}},field={value:'Help me plan my next quest',selectionStart:3,selectionEnd:8},share={checked:true};
 const root={querySelector:s=>s==='[data-context-body]'?host:s==='#chat-form [name="prompt"]'?field:s==='#share-profile'?share:null,querySelectorAll:()=>[],addEventListener(){}};
 const previews=[],heldClear=deferred();let holdNext=false,oldReply;
 const api={contextPreview:async(...args)=>{const value=f.preview(...args);previews.push({args,value});if(holdNext){holdNext=false;oldReply=deferred();await oldReply.promise;}return value;},clearConversation:async()=>{await heldClear.promise;return f.service.clear();}};
 const sandbox={window:{},document:{addEventListener(){},activeElement:field},InteractionGuard:{create:()=>({invalidate(){}})},api,root,state:f.state,companionReady:Promise.resolve(),localConversationClears:0,sending:false,questionRecovery:null,messages:[],conversationScope:null,conversationNotice:'',retireCompanion(){},companionView:()=>'ai',queueMicrotask,setTimeout,clearTimeout};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync('src/renderer/quest-guide.js','utf8'),sandbox);sandbox.QuestGuide=sandbox.window.QuestGuide;
 sandbox.QuestGuide.init({api,root,esc:String,ready:()=>sandbox.companionReady});sandbox.QuestGuide.sync(f.state.profiles[0]);sandbox.render=()=>sandbox.QuestGuide.mounted();
 // Exercise the actual app clear/reset integration, with an inert host around QuestGuide.
 const app=fs.readFileSync('src/renderer/app.js','utf8'),start=app.indexOf('function resetConversationView('),end=app.indexOf('api.onConversationReset?',start);
 assert.ok(start>0&&end>start);vm.runInContext(app.slice(start,end),sandbox);
 return {sandbox,field,host,paints,previews,heldClear,holdNext:()=>{holdNext=true;},releaseOld:()=>oldReply.resolve()};
}
for(const timing of ['resolved cache','old reply during clear','old reply after new preview'])test(`unchanged draft preview belongs to the new held-clear conversation (${timing})`,async()=>{
 const late=timing!=='resolved cache',after=timing==='old reply after new preview';
 const f=fixture();await f.ask("I'm in Org. Where is Cairne?");const r=renderer(f);
 await r.sandbox.QuestGuide.updateContext();assert.match(r.host.innerHTML,/user-report/);assert.equal(r.previews.length,1);
 let old;if(late){r.holdNext();old=r.sandbox.QuestGuide.updateContext(true);await flush();assert.equal(r.previews.length,2);}
 const clearing=r.sandbox.clearMainConversation();await flush();
 assert.doesNotMatch(r.host.innerHTML,/user-report|Orgrimmar/,'clear must retire resolved and in-flight preview ownership immediately');
 const heldCalls=r.previews.length;if(late&&!after){r.releaseOld();await old;await flush();assert.doesNotMatch(r.host.innerHTML,/user-report|Orgrimmar/,'late old result must not repaint');}
 assert.equal(r.previews.length,heldCalls,'new preview waits for clear readiness');
 r.heldClear.resolve();await clearing;await flush();assert.equal(r.previews.length,heldCalls+1);
 if(after){r.releaseOld();await old;await flush();assert.doesNotMatch(r.host.innerHTML,/user-report|Orgrimmar/,'old result cannot replace the newly resolved preview');}
 assert.match(r.host.innerHTML,/saved-snapshot/);assert.match(r.host.innerHTML,/Boulder Lode Mine/);
 assert.equal(r.field.value,'Help me plan my next quest');assert.deepEqual([r.field.selectionStart,r.field.selectionEnd],[3,8]);
 const preview=r.previews.at(-1).value;await f.ask(r.field.value);const raw=f.calls.at(-1).context;
 assert.deepEqual(JSON.parse(raw.slice(raw.indexOf('{'))),preview,'resolved preview must equal the next actual main send payload');
 // The same integration retires a resolved cache on an unsolicited hard reset.
 f.service.clear();r.sandbox.resetConversationView();r.sandbox.render();await flush();assert.equal(r.previews.length,heldCalls+2);
});
