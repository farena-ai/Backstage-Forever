const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const events={},storage={},root={addEventListener(t,f){(events[t]??=[]).push(f)},querySelector:()=>null,querySelectorAll:()=>[]};
 const c={window:{},document:{addEventListener(){},activeElement:null},localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v,removeItem:k=>delete storage[k]},setTimeout,console};Object.assign(c.localStorage,{});
 vm.createContext(c);
 for(const [file,name] of [['interaction','InteractionGuard'],['command-center','CommandCenter'],['preparation','Preparation']]){const p=require('node:path').join(__dirname,`../src/renderer/${file}.js`);if(fs.existsSync(p))vm.runInContext(fs.readFileSync(p,'utf8'),c);c[name]=c.window[name];}
 const host={root,esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),portrait:()=>'/art.png',active:()=>true,profileId:()=>'a',epoch:()=>0,api:{preparationBrief:async()=>model()},mutate:async()=>({journeyId:'j'}),open(){}};
 return {c,root,storage,events,host};
}
function model(){return {character:{id:'a',name:'Aeralyn',className:'Hunter',faction:'Alliance'},source:{updatedAt:'2026-11-09T12:00:00.000Z',clientBuild:'1.60.1.70862'},coverage:Object.fromEntries(['professions','recipes','materials'].map(k=>[k,{status:'complete',observedAt:'2026-11-09T12:00:00.000Z',itemCount:1}])),professions:[{name:'Alchemy',rank:22,maxRank:75}],recipes:[{id:100,name:'Amber restorative'}],selection:{recipeId:100,crafts:1},selectedRecipe:{id:100,name:'Amber restorative'},planning:{available:true,inventoryExact:false,checklistAvailable:true},shoppingRows:[{itemId:200,name:'Sunleaf',required:3,have:2,missing:null,quantityKind:'lower-bound'}],otherCharacters:[{character:{name:'Vaelric'},coverage:{materials:{status:'complete',observedAt:'2026-11-08T12:00:00.000Z'}},materials:[{itemId:200,name:'Sunleaf',count:99}],professions:[]}],limitations:[]};}
test('actual Preparation helper loads with the existing interaction dependency',()=>{const {c}=fixture();assert.equal(typeof c.Preparation?.init,'function');});
test('bounded local preferences keep characters separate and exclude evidence',()=>{const {c,host,storage}=fixture();c.Preparation.init(host);c.Preparation.save('a',{recipeId:100,crafts:2,materials:[{count:99}]});assert.deepEqual(JSON.parse(JSON.stringify(c.Preparation.options('a'))),{recipeId:100,crafts:2});assert.deepEqual(JSON.parse(JSON.stringify(c.Preparation.options('b'))),{crafts:1});assert.doesNotMatch(JSON.stringify(storage),/materials|99/);c.Preparation.save('a',{recipeId:-1,crafts:99});assert.deepEqual(JSON.parse(JSON.stringify(c.Preparation.options('a'))),{crafts:1});c.Preparation.remove('a');assert.deepEqual(JSON.parse(JSON.stringify(c.Preparation.options('a'))),{crafts:1});});
test('partial materials retain unknown shortfalls and separate dated alt counts',()=>{const {c,host}=fixture();c.Preparation.init(host);const html=c.Preparation.page(model());assert.match(html,/At least 2/);assert.match(html,/Shortfall unknown/);assert.match(html,/Total required/);assert.match(html,/99/);assert.match(html,/never subtracted/);assert.match(html,/backpack plus four bags/i);assert.doesNotMatch(html,/Ready to craft|guaranteed skill/);});
test('explicit checklist availability governs action, including missing recipe selection',()=>{const {c,host}=fixture();c.Preparation.init(host);const m=model();m.planning.checklistAvailable=false;m.selectedRecipe=null;m.shoppingRows=[];m.planning.reason='Selected recipe is no longer observed.';const html=c.Preparation.page(m);assert.match(html,/data-preparation-add[^>]* disabled/);assert.match(html,/no longer observed/);assert.match(html,/Open Company/);});
test('stable source disclosure identity uses profile and recipe rather than row index',()=>{const {c,host}=fixture();c.Preparation.init(host);const html=c.Preparation.page(model());assert.ok(html.includes('&quot;a&quot;,100,&quot;workshop-source&quot;'));});

test('rapid native choice changes preserve the newest recipe while its read is pending',async()=>{
 const {c,host,events}=fixture();host.sourceSignature=()=>'';host.api.preparationBrief=async(_id,opts)=>({...model(),selection:{recipeId:opts.recipeId??100,crafts:opts.crafts}});c.Preparation.init(host);c.Preparation.mounted();await new Promise(r=>setImmediate(r));
 host.api.preparationBrief=()=>new Promise(()=>{});
 events.change.at(-1)({target:{dataset:{preparationOption:'recipeId'},value:'101'}});
 events.change.at(-1)({target:{dataset:{preparationOption:'crafts'},value:'3'}});
 assert.deepEqual(JSON.parse(JSON.stringify(c.Preparation.options('a'))),{recipeId:101,crafts:3});
});

test('the compact action previews shortfall checks or unknown supply before saving',()=>{const {c,host}=fixture();c.Preparation.init(host);const m=model();assert.match(c.Preparation.page(m),/Supply check needed/);m.planning.inventoryExact=true;m.shoppingRows[0].missing=1;assert.match(c.Preparation.page(m),/1 material shortfall/);m.shoppingRows[0].missing=0;assert.match(c.Preparation.page(m),/Saved supply covers listed quantities/);});
test('out-of-order reads and invalidated replies cannot repaint replaced recipe facts',async()=>{
 const {c,host}=fixture(),reads=[];let source=0;host.sourceSignature=()=>source;host.api.preparationBrief=()=>new Promise(r=>reads.push(r));c.Preparation.init(host);c.Preparation.mounted();source++;c.Preparation.refresh();
 const latest=model();latest.selectedRecipe.name='Latest public formula';reads[1](latest);await new Promise(r=>setImmediate(r));reads[0](model());await new Promise(r=>setImmediate(r));assert.match(c.Preparation.page(),/Latest public formula/);
 source++;c.Preparation.refresh();c.Preparation.invalidate();reads[2](latest);await new Promise(r=>setImmediate(r));assert.doesNotMatch(c.Preparation.page(),/Latest public formula/);
});
test('a settled unavailable/read-error paint never leaves a fake loading headline',async()=>{
 const {c,host,root}=fixture();let painted='';const region={set outerHTML(v){painted=v;}};root.querySelector=()=>region;host.sourceSignature=()=>'';host.character=()=>({id:'a',name:'Aeralyn',className:'Hunter'});host.api.preparationBrief=async()=>({...model(),selectedRecipe:null,recipes:[],shoppingRows:[],planning:{checklistAvailable:false,reason:'Known recipes have not been observed.'}});c.Preparation.init(host);c.Preparation.mounted();await new Promise(r=>setImmediate(r));assert.doesNotMatch(painted,/Opening the recipe book/);assert.equal((painted.match(/Known recipes have not been observed\./g)||[]).length,1);
 c.Preparation.save('a',{recipeId:100,crafts:2});c.Preparation.invalidate();host.api.preparationBrief=async()=>{throw Error('read unavailable')};c.Preparation.refresh();await new Promise(r=>setImmediate(r));assert.doesNotMatch(painted,/Opening the recipe book/);assert.match(painted,/Aeralyn/);assert.doesNotMatch(painted,/Selected recipe no longer observed/);
});
function actionFixture(){
 const handlers={},docHandlers={},calls=[],requests=[];let source=0,html='',button;
 const root={addEventListener(t,f){(handlers[t]??=[]).push(f)},contains:()=>true,querySelector:()=>region,querySelectorAll:s=>s==='[data-preparation-add]'?[button].filter(Boolean):[]};
 const document={activeElement:null,body:{},addEventListener(t,f){(docHandlers[t]??=[]).push(f)}};
 const region={set outerHTML(value){html=value;const raw=value.match(/data-preparation-choice="([^"]*)"/)?.[1];button={tagName:'BUTTON',disabled:/data-preparation-add[^>]*disabled/.test(value),dataset:raw?{preparationChoice:raw.replaceAll('&quot;','"').replaceAll('&amp;','&')}:{},closest:s=>s==='[data-preparation-add]'?button:null};},get outerHTML(){return html}};
 const storage={},c={window:{},document,setTimeout,console,localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v,removeItem:k=>delete storage[k]}};vm.createContext(c);
 for(const [file,name] of [['interaction','InteractionGuard'],['command-center','CommandCenter'],['preparation','Preparation']]){vm.runInContext(fs.readFileSync(require.resolve(`../src/renderer/${file}.js`),'utf8'),c);c[name]=c.window[name];}
 c.Preparation.init({root,esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;'),portrait:()=>'/art.png',active:()=>true,profileId:()=>'a',epoch:()=>0,sourceSignature:()=>source,api:{preparationBrief:(_id,options)=>new Promise(resolve=>requests.push({options,resolve}))},mutate:async(id,options)=>{calls.push({id,options:JSON.parse(JSON.stringify(options))});return null;},open(){}});
 const emit=(type,event)=>handlers[type]?.forEach(f=>f(event)),doc=(type,event={})=>docHandlers[type]?.forEach(f=>f(event));
 return {c,calls,requests,emit,doc,button:()=>button,html:()=>html,source:()=>source++,settle:()=>new Promise(r=>setImmediate(r))};
}
for(const [field,value] of [['recipeId','101'],['crafts','3']])test(`changed ${field} cannot submit the prior painted action while its brief is pending`,async()=>{
 const f=actionFixture();f.c.Preparation.mounted();f.requests[0].resolve(model());await f.settle();const prior=f.button();
 f.emit('change',{target:{tagName:'SELECT',dataset:{preparationOption:field},value}});
 // A deferred DOM paint must not be the only thing preventing an old button dispatch.
 prior.disabled=false;f.emit('click',{target:prior});await f.settle();assert.deepEqual(f.calls,[],'changed native choices must not send the old model');
 const next=model();next.selection={recipeId:field==='recipeId'?101:100,crafts:field==='crafts'?3:1};next.selectedRecipe={id:next.selection.recipeId,name:'Selected formula'};f.requests[1].resolve(next);await f.settle();f.emit('click',{target:f.button()});await f.settle();assert.deepEqual(f.calls,[{id:'a',options:next.selection}]);
});
test('held painted Add retains its exact recipe and attempts across a source-only default replacement',async()=>{
 const f=actionFixture();f.c.Preparation.mounted();f.requests[0].resolve(model());await f.settle();const pressed=f.button();f.emit('pointerdown',{button:0,target:pressed});
 f.source();f.c.Preparation.refresh();const replacement=model();replacement.selection={recipeId:101,crafts:1};replacement.selectedRecipe={id:101,name:'New default formula'};f.requests[1].resolve(replacement);await f.settle();assert.equal(f.button(),pressed,'shared guard must keep the actual held button');
 f.doc('pointerup');f.emit('click',{target:pressed});await f.settle();assert.deepEqual(f.calls,[{id:'a',options:{recipeId:100,crafts:1}}],'source-only refresh must not redirect the painted action to a new recipe');
});
