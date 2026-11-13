"use strict";
const { navigate } = require("./player-navigation.cjs");
// Real main/preload/renderer; only synthetic journals and fake inference.
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {testWindow}=require('./test-window.cjs');const {defaultState}=require('../src/core/validation.cjs');
(async()=>{
 const root=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(root,'forever-travel-companion-'));let app;
 const capture=path.join(__dirname,'..','.superpowers','sdd','travel-companion-captures',new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(capture,{recursive:true});
 const watchdog=setTimeout(()=>{console.error('Conversation fixture exceeded 120 seconds');app?.process().kill();process.exitCode=1;},120000);
 try{
  const initial={...defaultState(),onboarded:true,activeProfileId:'Alpha',profiles:['Alpha','Beta'].map(id=>({id,name:id,className:'Mage',realm:'Synthetic',level:12,goals:[{id:'g',text:'PRIVATE_GOAL_CANARY',done:false}],notes:'PRIVATE_NOTE_CANARY',faction:'Horde',clientBuild:'1.60.1.70862',location:{zone:'Orgrimmar'},source:{kind:'wow-addon',id:'SYNTHETIC_'+id,updatedAt:'2026-11-10T00:00:00.000Z'}})),provider:{id:'ollama',model:'',endpoint:'http://127.0.0.1:11434'}};
  await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(initial));
  await fs.mkdir(path.join(dir,'updates'));await fs.writeFile(path.join(dir,'updates','preferences.json'),JSON.stringify({automatic:false,installOnQuit:false}));
  await fs.mkdir(path.join(dir,'knowledge-v1'));await fs.writeFile(path.join(dir,'knowledge-v1','preferences.json'),JSON.stringify({automatic:false,checked:{}}));
  const repo=path.resolve(__dirname,'..');
  // Install fake external surfaces before bootstrap can enumerate providers or speech.
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:'backstage-forever-travel-companion-fixture',version:'0.12.3',main:'fixture-main.cjs'}));
  await fs.writeFile(path.join(dir,'fixture-main.cjs'),`
    const load=require('node:module').createRequire(${JSON.stringify(path.join(repo,'package.json'))});
    load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
    load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
    globalThis.travelFixture={calls:[],opens:[],copies:[],keys:0,receipts:[]};
    const companion=load('./src/core/companion-service.cjs').CompanionService.prototype,ask=companion.ask;
    companion.ask=async function(...args){const receipt={sequence:travelFixture.receipts.length+1,input:args[0],phase:'pending'};travelFixture.receipts.push(receipt);try{const result=await ask.apply(this,args);receipt.result=result;receipt.phase='complete';return result;}catch(error){receipt.phase='failed';throw error;}};
    const storeProto=load('./src/core/store.cjs').Store.prototype;storeProto.getKey=function(){travelFixture.keys++;return '';};
    load('electron').clipboard.writeText=text=>travelFixture.copies.push(text);
    load('electron').shell.openExternal=async url=>{travelFixture.opens.push(url);};
    load('./src/core/providers.cjs').ask=async input=>{travelFixture.calls.push(input);return ${JSON.stringify('**Synthetic advice**\n\n- Review your quest\n- Check your bags\n\n<img src=x onerror=alert(1)> [bad](javascript:alert(1))')};};
    const proto=load('./src/core/companion-context.cjs').CompanionContext.prototype,original=proto.invalidate;proto.invalidate=function(reason){travelFixture.context=this;return original.call(this,reason);};
    load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
    load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
    load('./src/core/knowledge-cache.cjs').KnowledgeService.prototype.maybeRefresh=function(){};
    load('./src/core/updater.cjs').Updater.prototype.start=function(){};
    load('./src/main.cjs');
  `);
  app=await electron.launch({args:[dir],env:{...process.env,BF_USER_DATA:dir},timeout:20000});const page=await testWindow(app);page.setDefaultTimeout(6000);
  await page.evaluate(()=>localStorage.setItem('bf-setup-v4','complete'));await page.reload();
  const call=(method,...args)=>page.evaluate(({method,args})=>window.backstage[method](...args),{method,args});
  const open=()=>navigate(page, "assistant");await open();
  const field=page.getByRole('textbox',{name:'Your question',exact:true});
  const send=async text=>{
   // Sharing changes can clear history while its guarded DOM paint is pending.
   // A new terminal reply/recovery belongs to this prompt; history size does not.
   const sequence=await app.evaluate(()=>travelFixture.receipts.length);
   const owner=await page.evaluate(()=>{window.travelBeforeSend={reply:messages.at(-1),recovery:questionRecovery,recoveryNode:document.querySelector('[data-question-recovery]')};return {generation:chatGeneration,profileId:state.activeProfileId,shareProfile:document.querySelector('#share-profile').checked};});
   await field.fill(text);await page.getByRole('button',{name:'Send question',exact:true}).click();
   const deadline=Date.now()+20000;
   const receipt=await app.evaluate(async(_e,{sequence,deadline})=>{while(!travelFixture.receipts[sequence]||travelFixture.receipts[sequence].phase==='pending'){if(Date.now()>deadline)throw Error('Current travel request did not settle');await new Promise(r=>setTimeout(r,10));}return travelFixture.receipts[sequence];},{sequence,deadline});
   assert.equal(receipt.sequence,sequence+1);assert.equal(receipt.input.prompt,text);assert.equal(receipt.input.profileId,owner.profileId);assert.equal(receipt.input.shareProfile,owner.shareProfile);
   await page.waitForFunction(({text,owner,receipt})=>{
    const prior=window.travelBeforeSend,last=messages.at(-1);
    const answered=receipt.phase==='complete'&&last?.role==='assistant'&&last!==prior.reply&&last.text===receipt.result.text&&last.kind===receipt.result.kind&&messages.at(-2)?.role==='user'&&messages.at(-2).text===text;
    const failed=receipt.phase==='failed'&&questionRecovery&&questionRecovery!==prior.recovery&&questionRecovery.prompt===text;
    const user=[...document.querySelectorAll('#chatlog .message.user')].at(-1);
    const recoveryNode=document.querySelector('[data-question-recovery]');
    // Identical prior markup is not a receipt for the current guarded root paint.
    const painted=lastPaintedMessage===last&&user?.querySelector('.message-text')?.textContent===text&&(answered?user.nextElementSibling?.classList.contains('assistant'):recoveryNode&&recoveryNode!==prior.recoveryNode&&recoveryNode.querySelector('p')?.textContent===questionRecovery?.message);
    return chatGeneration===owner.generation&&!sending&&!chatStarting&&(answered||failed)&&painted;
   },{text,owner,receipt},{timeout:Math.max(1,deadline-Date.now())});
   await page.waitForFunction(()=>!document.querySelector('[data-command="stop-response"]'));
  };
  await app.evaluate(()=>{travelFixture.keys=0;});
  await send('what is the fastest way from org to tb');
  assert.match(await page.locator('[data-travel-result]').innerText(),/Thunder Bluff/);assert.equal(await page.locator('.travel-option').count(),2);
  const primaryVisible=()=>page.evaluate(()=>{const log=document.querySelector('#chatlog').getBoundingClientRect(),h=document.querySelector('[data-travel-result] h3').getBoundingClientRect(),o=document.querySelector('.travel-option h4').getBoundingClientRect();return h.top>=log.top&&h.bottom<=log.bottom&&o.top>=log.top&&o.bottom<=log.bottom;});
  assert.equal(await primaryVisible(),true,'New route headline and primary option must be visible without scrolling');
  const roadJump=page.getByRole('button',{name:'Show road guide',exact:true}).last();
  assert.equal(await roadJump.count(),1,'Road alternative has a visible top-level jump');
  assert.equal(await roadJump.evaluate(n=>{const r=n.getBoundingClientRect(),l=document.querySelector('#chatlog').getBoundingClientRect();return r.top>=l.top&&r.bottom<=l.bottom;}),true);
  await roadJump.click();assert.equal(await page.locator('.travel-option').last().evaluate(n=>{const r=n.getBoundingClientRect(),l=document.querySelector('#chatlog').getBoundingClientRect();return r.top>=l.top-1&&r.top<l.bottom;}),true);
  await page.locator('#chatlog').evaluate(n=>n.scrollTop=0);
  await page.screenshot({path:path.join(capture,'travel-full.png'),fullPage:true});
  const position=await page.locator('#chatlog').evaluate(n=>{n.scrollTop=140;return n.scrollTop;});await page.evaluate(()=>render());assert.equal(await page.locator('#chatlog').evaluate(n=>n.scrollTop),position,'Background repaint preserves user chat scroll');
  await navigate(page, "guide");await open();assert.equal(await page.locator('#chatlog').evaluate(n=>n.scrollTop),position,'Navigation retains completed chat scroll');

  assert.equal(await page.evaluate(()=>typeof window.backstage.copyTravelGuidance),'function','Main-owned travel copy bridge exists');
  await page.getByRole('button',{name:'Copy full guidance',exact:true}).last().click();assert.match(await app.evaluate(()=>travelFixture.copies.at(-1)),/Sources:/);
  await send('This is for wow forever, not retail');
  assert.equal(await page.locator('[data-travel-result]').count(),2);assert.deepEqual(await app.evaluate(()=>[travelFixture.calls.length,travelFixture.keys]),[0,0]);
  await page.locator('.travel-evidence summary').last().click();await page.locator('#chatlog').evaluate(n=>n.scrollTop=n.scrollHeight);const evidenceScroll=await page.locator('#chatlog').evaluate(n=>n.scrollTop);await page.evaluate(()=>render());assert.equal(await page.locator('.travel-evidence').last().evaluate(n=>n.open),true,'Evidence disclosure stays open through a background paint');assert.equal(await page.locator('#chatlog').evaluate(n=>n.scrollTop),evidenceScroll);await page.screenshot({path:path.join(capture,'travel-sources.png'),fullPage:true});
  await page.getByRole('button',{name:'Open Efficient Games source',exact:true}).last().click();assert.equal(await app.evaluate(()=>travelFixture.opens.length),1);await page.screenshot({path:path.join(capture,'travel-observation-source.png'),fullPage:true});
  const latestArgs=()=>page.locator('[data-command="save-travel-plan"]').last().evaluate(b=>({optionId:b.dataset.optionId,index:Number(b.dataset.messageIndex)}));
  const current=await call('askCompanion',{provider:'ollama',prompt:'org to tb',shareProfile:true,profileId:'Alpha'});
  const choice={profileId:'Alpha',token:current.travel.choiceToken,optionId:current.travel.options[0].id};
  await navigate(page, "guide");await open();
  let saved=await call('createTravelPlan',choice);assert.equal(saved.reused,false);assert.equal((await call('createTravelPlan',choice)).reused,true);assert.equal(saved.state.journeys.length,1);
  const draft=await call('memoryDraft','Alpha');if(draft)await call('saveMemory',{profileId:'Alpha',responseId:draft.responseId});assert.equal((await call('createTravelPlan',choice)).reused,true);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  const point=(await call('checkpointNow')).points[0],preview=await call('previewCheckpoint',point.id);
  await call('restoreCheckpoint',{id:preview.id,sha256:preview.sha256});await assert.rejects(call('createTravelPlan',choice), /This trip choice is no longer current\. Ask again\./);
  const beforeImport=await call('askCompanion',{provider:'ollama',prompt:'org to tb',shareProfile:true,profileId:'Alpha'}),backup=path.join(dir,'synthetic-travel-backup.json');
  await fs.writeFile(backup,JSON.stringify((await call('bootstrap')).state));await app.evaluate(({dialog},backup)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});},backup);
  await call('importData');await assert.rejects(call('createTravelPlan',{profileId:'Alpha',token:beforeImport.travel.choiceToken,optionId:beforeImport.travel.options[0].id}));
  for(const reason of ['source-root','restore','import','reset','response-stop']){const r=await call('askCompanion',{provider:'ollama',prompt:'org to tb',shareProfile:true,profileId:'Alpha'});await app.evaluate((_e,r)=>travelFixture.context.invalidate(r),reason);await assert.rejects(call('createTravelPlan',{profileId:'Alpha',token:r.travel.choiceToken,optionId:r.travel.options[0].id}));}
  await call('clearConversation');await page.waitForFunction(()=>document.querySelector('#chatlog').textContent==='');
  await page.getByLabel('Use my active character',{exact:true}).uncheck();await send('Travel from Orgrimmar');await send('Thunder Bluff');assert.match(await page.locator('[data-travel-result]').last().innerText(),/faction/);await send('Horde');assert.equal(await page.locator('[data-travel-result]').last().locator('.travel-option').count(),1);assert.match(await page.locator('[data-travel-result]').last().innerText(),/user-reported/);await send('can I walk instead?');assert.equal(await app.evaluate(()=>travelFixture.calls.length),0);
  await send('Which pet should I use?');assert.match(await page.locator('[data-question-recovery]').innerText(),/Choose a model/);
  await call('saveProvider',{provider:'ollama',model:'fixture',endpoint:'http://127.0.0.1:11434',authMode:'api'});await page.waitForFunction(()=>document.querySelector('#chatlog').textContent==='');await page.reload();await open();
  await send('Which pet should I use?');await send('This is for wow forever, not retail');assert.match(await app.evaluate(()=>travelFixture.calls.at(-1).prompt),/Which pet should I use/);assert.equal(await page.locator('#chatlog .message.assistant img, #chatlog .message.assistant a, #chatlog .message.assistant script').count(),0);assert.ok(await page.locator('#chatlog strong').count());
  const dom=await page.evaluate(()=>{const n=document.createElement('div');n.innerHTML=CompanionReply.render('**bold**\n\n- list\n\n`code` <svg onload=evil()> [x](data:text/html,evil)');return [n.querySelectorAll('strong').length,n.querySelectorAll('li').length,n.querySelectorAll('code').length,n.querySelectorAll('a,svg,script,button').length];});assert.deepEqual(dom,[1,1,1,0]);
  await page.screenshot({path:path.join(capture,'safe-reply.png'),fullPage:true});
  const questCalls=await app.evaluate(()=>travelFixture.calls.length);await send('Explain the quest route');assert.equal(await app.evaluate(()=>travelFixture.calls.length),questCalls+1);assert.match(await app.evaluate(()=>travelFixture.calls.at(-1).prompt),/Explain the quest route/);
  await page.getByLabel('Use my active character',{exact:true}).check();await send('org to tb');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(984,635));await page.emulateMedia({reducedMotion:'reduce'});
  const save=page.locator('[data-command="save-travel-plan"]').last();await save.focus();await page.evaluate(()=>window.originalTravelSave=document.activeElement);await page.keyboard.down('Enter');await page.waitForFunction(()=>document.querySelector('[data-command="save-travel-plan"]')?.textContent.includes('Saved')||originalTravelSave.textContent.includes('Saved'));assert.deepEqual(await page.evaluate(()=>[originalTravelSave.isConnected,originalTravelSave===document.activeElement]),[true,true]);await page.keyboard.up('Enter');
  await field.fill('A new editable draft');await field.evaluate(n=>{window.originalTravelField=n;n.focus();n.setSelectionRange(2,7);});
  assert.deepEqual(await field.evaluate(n=>[n===originalTravelField,n.selectionStart,n.selectionEnd]),[true,2,7]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('#chatlog').evaluate(n=>n.scrollTop=0);await page.screenshot({path:path.join(capture,'travel-984x635.png'),fullPage:true});
  await navigate(page, "company");await page.screenshot({path:path.join(capture,'manual-plan.png'),fullPage:true});await open();
  // A saved IPC result held across character replacement cannot overwrite the newer renderer owner.
  await send('org to tb');
  await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('backstage:createTravelPlan');ipcMain._invokeHandlers.set('backstage:createTravelPlan',async(...args)=>{const result=await original(...args);return new Promise(resolve=>travelFixture.releaseSave=()=>resolve(result));});});
  await page.locator('[data-command="save-travel-plan"]').last().click();
  await app.evaluate(async()=>{for(let i=0;i<200&&!travelFixture.releaseSave;i++)await new Promise(r=>setTimeout(r,10));if(!travelFixture.releaseSave)throw Error('Save not admitted');});
  await page.getByLabel('Active character',{exact:true}).selectOption('Beta');
  await page.waitForFunction(()=>document.querySelector('#chatlog').textContent==='');
  await field.fill('Keep this newer draft');await field.evaluate(n=>{window.lateSaveField=n;n.focus();n.setSelectionRange(3,8);});
  await app.evaluate(()=>travelFixture.releaseSave());await page.waitForTimeout(50);
  assert.deepEqual(await field.evaluate(n=>[n===lateSaveField,n.isConnected,n.selectionStart,n.selectionEnd]),[true,true,3,8]);
  await navigate(page, "guide");await open();assert.equal(await page.getByLabel('Active character',{exact:true}).inputValue(),'Beta','Late plan save must not restore the old character');
  const ipcChecks=await app.evaluate(async({ipcMain,BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],event={sender:win.webContents,senderFrame:win.webContents.mainFrame};const rejects=async(name,e,...args)=>{try{await ipcMain._invokeHandlers.get('backstage:'+name)(e,...args);return false;}catch{return true;}};return [await rejects('createTravelPlan',event,{},{}),await rejects('createTravelPlan',event,{profileId:'Alpha',token:'forged',optionId:'road',url:'https://evil.test'}),await rejects('openTravelSource',event,'https://evil.test'),await rejects('openTravelSource',event,'E1','extra'),await rejects('openTravelSource',{sender:{},senderFrame:{}},'E1'),await rejects('copyTravelGuidance',event,'forged'),await rejects('copyTravelGuidance',event,'forged','text'),await rejects('copyTravelGuidance',{sender:{},senderFrame:{}},'forged')];});assert.ok(ipcChecks.every(Boolean));
  await fs.writeFile(path.join(capture,'synthetic-evidence.json'),JSON.stringify({ipcChecks,choices:current.travel,requests:await app.evaluate(()=>travelFixture.calls.map(i=>({prompt:i.prompt,context:i.context})))},null,2));
  console.log('Travel actual Electron PASS: zero-inference original/correction, pending/faction, local privacy, soft/hard choices, manual save/reuse, sources, no-model error, ordinary conversation, safe DOM, held Save/caret, compact/reduced motion. Captures: '+capture);
 }finally{clearTimeout(watchdog);if(app)await app.close().catch(()=>{});const real=await fs.realpath(dir);assert.equal(path.dirname(real).toLowerCase(),root.toLowerCase());assert.ok(path.basename(real).startsWith('forever-travel-companion-'));await fs.rm(real,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
