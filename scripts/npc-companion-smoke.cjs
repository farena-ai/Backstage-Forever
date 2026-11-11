"use strict";
const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {defaultState}=require('../src/core/validation.cjs'),{testWindow}=require('./test-window.cjs'),{navigate}=require('./player-navigation.cjs');
(async()=>{
 const root=await fs.realpath(os.tmpdir()),repo=path.resolve(__dirname,'..'),capture=path.join(repo,'work','npc-captures',new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(capture,{recursive:true});
 for(const corrupt of [false,true]){
  const dir=await fs.mkdtemp(path.join(root,'forever-npc-fixture-'));let app;
  const watchdog=setTimeout(()=>{app?.process().kill();process.exitCode=1;console.error('NPC fixture exceeded 120 seconds');},120000);
  try{
   const initial={...defaultState(),onboarded:true,activeProfileId:'Alpha',profiles:['Alpha','Beta'].map(id=>({id,name:id,className:'Mage',realm:'Synthetic',level:12,faction:'Horde',clientBuild:'1.60.1.70862',location:{zone:'Boulder Lode Mine',mapId:1411,x:.1,y:.2},notes:'PRIVATE_NOTE_CANARY',goals:[],source:{kind:'wow-addon',id:'SYNTHETIC_'+id,updatedAt:'2026-11-01T00:00:00.000Z'}})),provider:{id:'ollama',model:'',endpoint:'http://127.0.0.1:11434'}};
   await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(initial));
   await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:'forever-npc-fixture',version:'0.13.5',main:'fixture-main.cjs'}));
   await fs.writeFile(path.join(dir,'fixture-main.cjs'),`
    const load=require('node:module').createRequire(${JSON.stringify(path.join(repo,'package.json'))});
    globalThis.npcFixture={calls:[],keys:0,receipts:[],external:0};
    load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
    load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
    load('./src/core/providers.cjs').ask=async input=>{npcFixture.calls.push(input);return 'Synthetic planning reply';};
    load('./src/core/store.cjs').Store.prototype.getKey=function(){npcFixture.keys++;return '';};
    const proto=load('./src/core/companion-service.cjs').CompanionService.prototype,ask=proto.ask;
    proto.ask=async function(...args){npcFixture.service=this;const r={input:args[0],phase:'pending'};npcFixture.receipts.push(r);try{r.result=await ask.apply(this,args);r.phase='complete';return r.result;}catch(e){r.phase='failed';r.error=e.message;throw e;}};
    load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
    load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
    load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.maybeRefresh=function(){};
    load('./src/core/updater.cjs').Updater.prototype.start=function(){};
    load('electron').shell.openExternal=async()=>{npcFixture.external++;};
    ${corrupt?`const nativeFs=load('node:fs'),read=nativeFs.readFileSync;nativeFs.readFileSync=function(file,...args){if(String(file).replace(/\\\\/g,'/').endsWith('/data/forever-npc-locations/pack.json'))return Buffer.from('{"corrupt":true}');return read.call(this,file,...args);};`:''}
    load('./src/main.cjs');
   `);
   app=await electron.launch({args:[dir],env:{...process.env,BF_USER_DATA:dir},timeout:20000});const page=await testWindow(app);page.setDefaultTimeout(7000);
   await page.evaluate(()=>localStorage.setItem('bf-setup-v4','complete'));await page.reload();await navigate(page,'assistant');
   const call=(method,...args)=>page.evaluate(({method,args})=>window.backstage[method](...args),{method,args});
   const field=page.getByRole('textbox',{name:'Your question',exact:true});
   const send=async prompt=>{
    const sequence=await app.evaluate(()=>npcFixture.receipts.length);await field.fill(prompt);await page.getByRole('button',{name:'Send question',exact:true}).click();
    const r=await app.evaluate(async(_e,index)=>{const end=Date.now()+7000;while(!npcFixture.receipts[index]||npcFixture.receipts[index].phase==='pending'){if(Date.now()>end)throw Error('Current NPC request did not settle');await new Promise(r=>setTimeout(r,10));}return npcFixture.receipts[index];},sequence);
    assert.equal(r.input.prompt,prompt);assert.equal(r.phase,'complete',r.error);await page.waitForFunction(text=>!sending&&!chatStarting&&lastPaintedMessage===messages.at(-1)&&messages.at(-1)?.text===text,r.result.text);return r.result;
   };
   await app.evaluate(()=>npcFixture.keys=0);
   const original=await send('where in org is Cairne Bloodhoof');assert.equal(original.kind,'npc');assert.match(await page.locator('#chatlog .message.assistant').last().innerText(),/Forever NPC reference · local/i);
   if(corrupt){assert.equal(original.npc.status,'unavailable');assert.match(original.text,/unavailable/);await page.screenshot({path:path.join(capture,'npc-unavailable.png'),fullPage:true});assert.deepEqual(await app.evaluate(()=>[npcFixture.calls.length,npcFixture.keys,npcFixture.external]),[0,0,0]);continue;}
   assert.match(original.text,/Thunder Bluff.*59.9, 51.7/);assert.match(original.text,/2026-11-05/);assert.match(original.text,/1.60.1.70790/);assert.doesNotMatch(original.text,/Boulder|go to Org/i);
   const evidence=page.locator('#chatlog .message.assistant').last().locator('details');assert.equal(await evidence.evaluate(n=>n.open),false);assert.equal(await evidence.getByRole('link').count(),0);assert.match(await page.locator('.context-selection').innerText(),/Last saved location.*Boulder Lode Mine/);
   await page.screenshot({path:path.join(capture,'npc-cairne-full.png'),fullPage:true});
   const preview=()=>page.locator('[data-context-body] pre');await field.fill("I'm already in Org. Where is Cairne?");await preview().waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('[data-context-body] pre')?.textContent.includes('"locationSource": "user-report"'));
   assert.equal(JSON.parse(await preview().textContent()).location.zone,'Orgrimmar');await send("I'm already in Org. Where is Cairne?");
   await field.fill('Help me plan my next quest');await page.waitForFunction(()=>document.querySelector('[data-context-body] pre')?.textContent.includes('"locationSource": "user-report"'));const prior=JSON.parse(await preview().textContent());assert.equal(prior.location.zone,'Orgrimmar');assert.equal(prior.savedLocation.zone,'Boulder Lode Mine');
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(984,635));
   await page.locator('[data-context-body] summary').click();await page.screenshot({path:path.join(capture,'npc-current-location-984x635.png'),fullPage:true});
   // A context repaint preserves the actual draft input and caret.
   await field.evaluate(n=>{window.npcDraftNode=n;n.focus();n.setSelectionRange(3,8);});await page.evaluate(()=>QuestGuide.updateContext());assert.deepEqual(await field.evaluate(n=>[n===npcDraftNode,n.selectionStart,n.selectionEnd]),[true,3,8]);
   await send('Where is Cairne?');assert.deepEqual(await app.evaluate(()=>[npcFixture.calls.length,npcFixture.keys]),[0,0]);
   const ambiguity=await send('Where is Valennia Stormfist?');assert.equal(ambiguity.npc.status,'ambiguous');assert.equal(ambiguity.npc.candidates.length,3);assert.doesNotMatch(ambiguity.text,/around/);await page.screenshot({path:path.join(capture,'npc-ambiguity.png'),fullPage:true});
   assert.equal((await send('Where is NPC Unknown?')).npc.status,'unknown');
   await page.getByLabel('Use my active character',{exact:true}).uncheck();await page.waitForFunction(()=>document.querySelector('#chatlog')?.textContent==='');assert.match(await page.locator('[data-context-body]').innerText(),/No character context/);assert.equal((await send('Where is Cairne?')).npc.entities[0].evidenceTier,'historical-reference');
   await page.getByLabel('Use my active character',{exact:true}).check();await send("I'm in Org. Where is Cairne?");
   await page.getByLabel('Active character',{exact:true}).selectOption('Beta');await page.waitForFunction(()=>document.querySelector('#chatlog')?.textContent==='');await field.fill('Help me plan my next quest');await page.waitForFunction(()=>document.querySelector('[data-context-body] pre')?.textContent.includes('saved-snapshot'));assert.equal(JSON.parse(await preview().textContent()).location.zone,'Boulder Lode Mine');
   await call('saveProvider',{provider:'ollama',model:'fixture',endpoint:'http://127.0.0.1:11434',authMode:'api'});await page.reload();await navigate(page,'assistant');await send("I'm in Org. Help me plan my next quest");const sent=await app.evaluate(()=>npcFixture.calls.at(-1).context);assert.match(sent,/user-report/);assert.equal(JSON.parse(sent.slice(sent.indexOf('{'))).location.zone,'Orgrimmar');assert.doesNotMatch(sent,/PRIVATE_/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await app.evaluate(()=>npcFixture.external),0);
   await fs.writeFile(path.join(capture,'evidence.json'),JSON.stringify(await app.evaluate(()=>({calls:npcFixture.calls.map(r=>({prompt:r.prompt,context:r.context})),receipts:npcFixture.receipts.map(r=>({prompt:r.input.prompt,kind:r.result?.kind,status:r.result?.npc?.status})),external:npcFixture.external})),null,2));
  }finally{clearTimeout(watchdog);if(app)await app.close().catch(()=>{});const real=await fs.realpath(dir);assert.equal(path.dirname(real).toLowerCase(),root.toLowerCase());assert.ok(path.basename(real).startsWith('forever-npc-fixture-'));await fs.rm(real,{recursive:true,force:true});}
 }
 console.log('NPC actual Electron PASS: historical Cairne, local/no-provider, current-report preview/send, sharing/owner boundaries, repeats, ambiguity, unknown, corrupt bundle, compact layout and caret. Captures: '+capture);
})().catch(e=>{console.error(e);process.exitCode=1;});
