"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");
const decode=v=>v.replaceAll("&quot;",'"').replaceAll("&lt;","<").replaceAll("&amp;","&");
const settle=()=>new Promise(r=>setImmediate(r));
function load(name){
  const handlers={},document={body:{isConnected:true,dataset:{}},addEventListener(){},activeElement:null};document.activeElement=document.body;
  const root={addEventListener(t,f){(handlers[t]??=[]).push(f);},contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[]};
  const c={window:{},document,setTimeout,clearTimeout,console,Intl,localStorage:{getItem:()=>null,setItem(){}}};vm.createContext(c);
  for(const [f,n] of [["interaction","InteractionGuard"],["command-center","CommandCenter"],["page-hero","PageHero"],[name,name[0].toUpperCase()+name.slice(1)]]){vm.runInContext(fs.readFileSync(require.resolve(`../src/renderer/${f}.js`),"utf8"),c);c[n]=c.window[n];}
  return {c,root,document,emit:(t,e)=>handlers[t]?.forEach(f=>f(e))};
}
function party(){
  const f=load("party");let observation=0,context="source-A",epoch=0,previewResolve,writeResolve,notified=0;
  const host={root:f.root,esc,active:()=>true,profileId:()=>"Alpha",sourceSignature:()=>observation,contextSignature:()=>context,epoch:()=>epoch,portrait:()=>"art",ready:async()=>{},show(){},cancelPreview(){},cleanError:e=>e.message,notify:()=>notified++,api:{partyBrief:async()=>({bags:{known:true,free:observation,total:20}}),partyPreview:()=>new Promise(r=>previewResolve=r),exportPartyPlan:()=>new Promise(r=>writeResolve=r)}};
  f.c.Party.init(host);
  const click=kind=>{const html=f.c.Party.page(),raw=html.match(new RegExp(`data-party-${kind} data-party-intent="([^"]*)"`))[1];const n={dataset:{partyIntent:decode(raw)},hasAttribute:k=>k===`data-party-${kind}`,closest:()=>n};f.emit("click",{target:n});};
  return {...f,host,click,refresh:async()=>{observation++;await f.c.Party.refresh();},context:value=>context=value,epoch:()=>epoch++,preview:()=>previewResolve({title:"Original",steps:[{text:"Original step"}]}),write:()=>writeResolve(true),notified:()=>notified};
}
test("Party ordinary reads preserve dirty portable title and step with fresh facts",async()=>{
  const f=party();await f.refresh();const task=f.c.Party.shareJourney("journey");await settle();f.preview();await task;
  f.emit("input",{target:{dataset:{partyField:"title"},value:"Reviewed title"}});f.emit("input",{target:{dataset:{partyField:"0"},value:"User edited private wording"}});
  const before=f.c.Party.page().match(/data-party-close data-party-intent="([^"]*)"/)[1];await f.refresh();
  const after=f.c.Party.page();assert.match(after,/Reviewed title/);assert.match(after,/User edited private wording/);assert.match(after,/2 \/ 20 slots free/);assert.ok(after.includes(before),"Editor/operation identity remains exact");
});
test('actual Party host separates selected source/provider identity from observation freshness and other characters',()=>{
  const source=fs.readFileSync(require.resolve('../src/renderer/app.js'),'utf8'),expression=source.match(/contextSignature: (\(\) => \{ const p=profile\(\);return [^\n]+\})/)[1];
  const state={activeProfileId:'Alpha',provider:{id:'ollama',model:'local'},profiles:[{id:'Alpha',source:{kind:'wow-addon',id:'source-A',updatedAt:'old'},readiness:{bags:{free:2}},name:'Alpha'},{id:'Beta',source:{kind:'wow-addon',id:'source-B'}}]};
  const c={state,profile:()=>state.profiles.find(p=>p.id===state.activeProfileId)};vm.createContext(c);const identity=vm.runInContext('('+expression+')',c),original=identity();
  state.profiles[0].source.updatedAt='new';state.profiles[0].readiness.bags.free=7;state.profiles[1].source.id='other-source';assert.equal(identity(),original);
  state.profiles[0].source.id='replacement';assert.notEqual(identity(),original);state.profiles[0].source.id='source-A';state.provider.model='different';assert.notEqual(identity(),original);
});
test("Party held preview and write continuations survive ordinary facts reads",async()=>{
  const f=party();await f.refresh();const task=f.c.Party.shareJourney("journey");await settle();await f.refresh();f.preview();await task;assert.match(f.c.Party.page(),/Original step/);
  f.click("save");await settle();await f.refresh();f.write();await settle();assert.equal(f.notified(),1);assert.match(f.c.Party.page(),/Original step/);assert.doesNotMatch(f.c.Party.page(),/data-party-save[^>]*disabled/);
});
for(const boundary of ["source","provider","profile","invalidate","close"])test(`Party retires held preview on true ${boundary} replacement`,async()=>{
  const f=party();await f.refresh();const task=f.c.Party.shareJourney("journey");await settle();
  if(boundary==="close")f.click("close");else if(boundary==="invalidate")f.c.Party.invalidate();else {f.context(boundary);await f.refresh();}
  f.preview();await task;assert.doesNotMatch(f.c.Party.page(),/Original step/);
});
function director(){
  const f=load("director");let profileId="Alpha",questId=101,region,nodes=[];
  const host={root:f.root,esc,active:()=>true,profileId:()=>profileId,options:()=>({minutes:30,focus:"balanced"}),model:()=>({primary:{questId,title:"Quest",source:{},kind:"objectives"},alternatives:[],session:{available:true}})};
  const replace=html=>{
    for(const n of nodes)n.isConnected=false;f.document.activeElement=f.document.body;
    region={dataset:{directorContext:decode(html.match(/data-director-context="([^"]*)"/)[1])},set outerHTML(v){replace(v);}};
    nodes=[...html.matchAll(/<summary data-interaction-key="([^"]*)"/g)].map(m=>({tagName:"SUMMARY",dataset:{interactionKey:decode(m[1])},parentElement:{open:false},isConnected:true,focus(){f.document.activeElement=this;},hasAttribute:()=>false}));
  };
  f.root.querySelector=()=>region;f.root.querySelectorAll=()=>nodes;f.c.Director.init(host);replace(f.c.Director.panel(host.model()));
  return {...f,host,replace,nodes:()=>nodes,profile:value=>profileId=value,quest:value=>questId=value};
}
for(const kind of ["region","root"])test(`Director preserves settled disclosure/focus across ${kind} paint`,()=>{
  const f=director(),old=f.nodes()[0];old.parentElement.open=true;old.focus();
  if(kind==="region")f.c.Director.paint();else{f.c.Director.beginRender();f.replace(f.c.Director.panel(f.host.model()));f.c.Director.mounted();f.c.Director.endRender();}
  assert.notEqual(f.nodes()[0],old);assert.equal(f.nodes()[0].parentElement.open,true);assert.equal(f.document.activeElement,f.nodes()[0]);
});
for(const boundary of ["quest","character","generation","newer-focus"])test(`Director cannot restore obsolete ${boundary} disclosure/focus`,()=>{
  const f=director(),old=f.nodes()[0];old.parentElement.open=true;old.focus();
  if(boundary==="quest")f.quest(202);if(boundary==="character")f.profile("Beta");if(boundary==="generation")f.c.Director.invalidate();
  f.c.Director.beginRender();f.replace(f.c.Director.panel(f.host.model()));
  const newer={isConnected:true};if(boundary==="newer-focus")f.document.activeElement=newer;
  f.c.Director.mounted();f.c.Director.endRender();
  if(boundary==="newer-focus")assert.equal(f.document.activeElement,newer);else {assert.equal(f.nodes()[0].parentElement.open,false);assert.equal(f.document.activeElement,f.document.body);}
});
function voice(){
  const f=load("voice"),question={value:"Keep this typed question",selectionStart:5,selectionEnd:9,isConnected:true,dataset:{}};
  let resolve,html="",rootRenders=0;
  const control={setAttribute(){},disabled:false,textContent:"",value:""},draft={querySelector:()=>control};
  const region={dataset:{},contains:()=>false,querySelector:s=>s==='[data-voice-draft]'?draft:control,querySelectorAll:()=>[],set outerHTML(v){html=v;}};
  f.root.querySelector=s=>s==='[data-voice]'?region:question;f.document.activeElement=question;
  f.c.Voice.init({root:f.root,esc,active:()=>true,busy:()=>false,answer:()=>"",plan:()=>null,render:()=>rootRenders++,api:{voiceCapabilities:()=>new Promise(r=>resolve=r),voiceCancel:async()=>{}}});
  return {...f,question,resolve:available=>resolve({recognition:{available,cultures:available?["en-US"]:[]},synthesis:{available:false,voices:[]},message:available?"Available":"Unavailable"}),html:()=>html,rootRenders:()=>rootRenders};
}
for(const available of [true,false])test(`Voice initial ${available?"available":"unavailable"} discovery paints only its region`,async()=>{
  const f=voice();f.c.Voice.mounted();f.resolve(available);await settle();assert.equal(f.rootRenders(),0);assert.match(f.html(),/data-voice/);
  assert.equal(f.document.activeElement,f.question);assert.deepEqual([f.question.value,f.question.selectionStart,f.question.selectionEnd],["Keep this typed question",5,9]);
  if(available)assert.match(f.html(),/value="en-US"/);else assert.match(f.html(),/<option>Unavailable<\/option>/);
});
test("Voice context invalidation retires a held initial capability result",async()=>{
  const f=voice();f.c.Voice.mounted();f.c.Voice.invalidate();f.resolve(true);await settle();assert.equal(f.html(),"");assert.equal(f.rootRenders(),0);assert.equal(f.document.activeElement,f.question);
});
function guidanceRefresh(){
  const source=fs.readFileSync(require.resolve('../src/renderer/app.js'),'utf8'),text=source.slice(source.indexOf('function syncGuidance()'),source.indexOf('function chooseSetup('));
  const pending=[],selected={minutes:60,focus:'balanced'},state={activeProfileId:'Alpha'},saved={source:{kind:'wow-addon',id:'source-A'},clientBuild:'build-A'};
  const c={state,profile:()=>saved,CommandCenter:{options:()=>selected},Director:{invalidate(){}},guidance:null,guidanceProfileId:'Alpha',guidanceSignature:'',guidanceContextSignature:'',guidanceEpoch:0,briefProfileId:'Alpha',adventureBrief:{guidance:{stamp:1}},api:{guidancePlan:()=>new Promise(resolve=>pending.push(resolve))},paintGuidance(){}};
  vm.createContext(c);vm.runInContext(text,c);
  return {c,pending,selected,state,saved};
}
test('actual root guidance lifecycle retains same-character same-options dated guidance while a read waits',async()=>{
  const f=guidanceRefresh();f.c.syncGuidance();const model={director:{primary:{questId:101}},steps:[{title:'Dated quest'}]};f.pending.shift()(model);await settle();
  f.c.adventureBrief={guidance:{stamp:2}};f.c.syncGuidance();assert.equal(f.c.guidance,model);assert.equal(f.pending.length,1);
});
for(const boundary of ['options','character','source','missing-brief'])test(`root guidance does not retain dated choices after ${boundary} replacement`,async()=>{
  const f=guidanceRefresh();f.c.syncGuidance();f.pending.shift()({director:{primary:{questId:101}}});await settle();
  if(boundary==='options')f.selected.focus='nearby';else if(boundary==='character')f.state.activeProfileId='Beta';else if(boundary==='source')f.saved.source.id='source-B';else f.c.adventureBrief=null;
  if(boundary!=='missing-brief')f.c.adventureBrief={guidance:{stamp:2}};
  f.c.syncGuidance();assert.equal(f.c.guidance,null);
});
test('root guidance treats source identity as context even when the reported guidance bytes match',async()=>{
  const f=guidanceRefresh();f.c.syncGuidance();f.pending.shift()({director:{primary:{questId:101}}});await settle();
  f.saved.source.id='replacement-source';f.c.syncGuidance();assert.equal(f.c.guidance,null);assert.equal(f.pending.length,1);
});
