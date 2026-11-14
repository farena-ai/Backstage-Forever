"use strict";
const { navigate } = require("./player-navigation.cjs");
// Real main/preload/renderer; only synthetic journals and fake inference.
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {testWindow}=require('./test-window.cjs');const {defaultState}=require('../src/core/validation.cjs');
(async()=>{
 const root=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(root,'forever-conversation-'));let app;
 const capture=path.join(__dirname,'..','.superpowers','sdd','conversation-captures');await fs.mkdir(capture,{recursive:true});
 const watchdog=setTimeout(()=>{console.error('Conversation fixture exceeded 120 seconds');app?.process().kill();process.exitCode=1;},120000);
 try{
  const initial={...defaultState(),onboarded:true,activeProfileId:'Alpha',profiles:['Alpha','Beta'].map(id=>({id,name:id,className:'Mage',realm:'Synthetic',level:12,goals:[{id:'g',text:'PRIVATE_GOAL_CANARY',done:false}],notes:'PRIVATE_NOTE_CANARY'})),provider:{id:'ollama',model:'fixture',endpoint:'http://127.0.0.1:11434'}};
  await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(initial));
  const repo=path.resolve(__dirname,'..');
  // Install fake external surfaces before bootstrap can enumerate providers or speech.
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:'backstage-forever-conversation-fixture',version:'0.12.3',main:'fixture-main.cjs'}));
  await fs.writeFile(path.join(dir,'fixture-main.cjs'),`
    const load=require('node:module').createRequire(${JSON.stringify(path.join(repo,'package.json'))});
    load('./src/core/model-catalog.cjs').listModels=async()=>({models:[],source:'fixture'});
    load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
    load('./src/core/providers.cjs').ask=async()=>{throw Error('Fixture inference is not installed');};
    load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
    load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
    load('./src/main.cjs');
  `);
  app=await electron.launch({args:[dir],env:{...process.env,BF_USER_DATA:dir},timeout:20000});const page=await testWindow(app);page.setDefaultTimeout(6000);
  await app.evaluate((_electron,repo)=>{
   const load=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(repo,'package.json'));globalThis.conversationFixture={requests:[]};
   const proto=load('./src/core/companion-context.cjs').CompanionContext.prototype,original=proto.invalidate;proto.invalidate=function(reason){conversationFixture.context=this;return original.call(this,reason);};
   load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
   load('./src/core/providers.cjs').ask=async input=>{const entry={input};conversationFixture.requests.push(entry);const current=input.prompt.split('Current original question:\n').at(-1).split('Current request (original question and any explicitly selected saved memory):\n').at(-1);if(current.includes('FAIL'))throw Error('Provider request failed.');if(current.includes('HOLD'))return new Promise(resolve=>entry.resolve=resolve);entry.reply=input.prompt.includes('SAVED_PRIVATE_CANARY')?'MEMORY_DERIVED_CANARY':'Synthetic Forever answer '+conversationFixture.requests.length;return entry.reply;};
  },repo);
  await page.evaluate(()=>localStorage.setItem('bf-setup-v4','complete'));await page.reload();
  const call=(method,...args)=>page.evaluate(({method,args})=>window.backstage[method](...args),{method,args});
  const open=()=>navigate(page, "assistant");await open();
  const field=page.getByRole('textbox',{name:'Your question',exact:true});
  const send=async text=>{await field.fill(text);await page.getByRole('button',{name:'Send question',exact:true}).click();};
  // The reply paints after the memory review settles (Stop stays available until then); slow CI runners need more than 6 s.
  const done=async()=>{const reply=await app.evaluate(()=>conversationFixture.requests.at(-1)?.reply);if(reply)await page.locator('#chatlog').getByText(reply,{exact:true}).last().waitFor({timeout:20000});await page.waitForFunction(()=>document.querySelector('#chat-form [type=submit]')?.disabled===false&&!document.querySelector('[data-command="stop-response"]'),null,{timeout:20000});};
  const count=()=>app.evaluate(()=>conversationFixture.requests.length);
  const latest=()=>app.evaluate(()=>{const i=conversationFixture.requests.at(-1).input;return {prompt:i.prompt,context:i.context};});
  const pending=()=>page.getByRole('button',{name:'Stop response',exact:true}).waitFor();
  await send('Which pet should my hunter use in WoW Forever');await done();
  await send('This is for wow forever, not retail');await done();
  const second=await latest();assert.match(second.prompt,/Which pet should my hunter use/,'Follow-up must include original pet question in actual outgoing main request');assert.match(second.prompt,/untrusted/i);assert.match(second.prompt,/This is for wow forever, not retail/);assert.doesNotMatch(JSON.stringify(second),/PRIVATE_NOTE_CANARY|PRIVATE_GOAL_CANARY/);
  assert.match(await page.locator('[data-conversation-notice]').innerText(),/recent messages/i);
  const chat=await page.locator('#chatlog').innerText(),beforeNav=await count();await navigate(page, "guide");await open();assert.equal(await page.locator('#chatlog').innerText(),chat);assert.equal(await count(),beforeNav);
  // Private edits and public observations neither insert their text nor reset the owner.
  let state=(await call('bootstrap')).state;const next=structuredClone(state);next.profiles[0].notes='EDITED_PRIVATE_CANARY';next.profiles[0].level=13;await call('saveState',next,state);await send('Where next?');await done();assert.match((await latest()).prompt,/Which pet should my hunter use/);assert.doesNotMatch(JSON.stringify(await latest()),/EDITED_PRIVATE/);
  const verbatim='  Where next, exactly?\n  ';await send(verbatim);await done();assert.ok((await latest()).prompt.endsWith(verbatim),'Typed current question must remain verbatim, including surrounding whitespace');
  const boundaryQuestion=' '.repeat(1000)+'Where should I level after this quest?';
  const boundaryReply='Synthetic Forever answer '+((await count())+1);await send(boundaryQuestion);
  await page.waitForFunction(reply=>document.querySelector('[data-question-recovery]')||document.querySelector('#chatlog .message.assistant:last-child')?.textContent.includes(reply),boundaryReply);
  assert.equal(await page.locator('[data-question-recovery]').count(),0,'Valid original question with 1000 leading spaces must deliver its completed answer');
  await done();assert.ok((await latest()).prompt.endsWith(boundaryQuestion),'Full outgoing question must preserve the whitespace prefix');
  const boundedDraft=await call('memoryDraft','Alpha');assert.equal(boundedDraft.question,boundaryQuestion.trimStart());assert.match(await page.locator('[data-memory-review]').innerText(),/Where should I level after this quest/);
  await send('Continue after the whitespace-prefixed question');await done();const recent=(await latest()).prompt.split('\n').find(line=>line.startsWith('[{'));assert.equal(JSON.parse(recent).at(-1).question,boundaryQuestion,'Main history preserves the complete original question');
  await page.screenshot({path:path.join(capture,'conversation-full.png'),fullPage:true});
  // Same IDs restored/imported/root changed are explicit process epochs.
  for(const reason of ['source-root','import','restore','reset']){
   await app.evaluate((_e,reason)=>conversationFixture.context.invalidate(reason),reason);await page.waitForFunction(()=>document.querySelector('#chatlog')?.textContent==='');await send('Fresh '+reason+' question');await done();assert.doesNotMatch((await latest()).prompt,/Which pet should my hunter use/);
  }
  await page.getByLabel('Use my active character',{exact:true}).uncheck();await page.waitForFunction(()=>document.querySelector('#chatlog')?.textContent==='');assert.equal(await page.locator('#chatlog').innerText(),'');await send('Sharing off question');await done();assert.doesNotMatch((await latest()).prompt,/Fresh reset question/);
  // Save an explicitly reviewed synthetic private exchange, select it anew, then omit it.
  await call('clearConversation');await send('SAVED_PRIVATE_CANARY quest');await done();const draft=await call('memoryDraft','Alpha');await call('saveMemory',{profileId:'Alpha',responseId:draft.responseId});await page.getByRole('button',{name:'Refresh memory',exact:true}).click();
  const select=page.locator('[data-memory-select]').first();await select.waitFor();await select.check();await send('Use selected memory');await done();assert.match((await latest()).prompt,/SAVED_PRIVATE_CANARY/);assert.equal(await select.isChecked(),false);await send('Ordinary following question');await done();assert.doesNotMatch((await latest()).prompt,/SAVED_PRIVATE_CANARY|MEMORY_DERIVED_CANARY/);assert.equal(await page.locator('#chatlog').getByText('MEMORY_DERIVED_CANARY',{exact:true}).count(),0);
  // Clear in-flight, Stop/edit/retry, and late success cannot reinsert old work.
  await send('HOLD clear quest');await pending();const heldClear=(await count())-1;await page.getByRole('button',{name:'Clear conversation',exact:true}).click();await done();assert.equal(await page.locator('#chatlog').innerText(),'');assert.equal(await call('memoryDraft','Alpha'),null);await app.evaluate((_e,i)=>conversationFixture.requests[i].resolve('LATE_CLEAR_CANARY'),heldClear);
  await send('HOLD stop quest');await pending();const heldStop=(await count())-1;await page.getByRole('button',{name:'Stop response',exact:true}).click();await page.getByRole('button',{name:'Edit question',exact:true}).click();assert.equal(await field.inputValue(),'HOLD stop quest');await send('Recovered quest');await done();await app.evaluate((_e,i)=>conversationFixture.requests[i].resolve('LATE_STOP_CANARY'),heldStop);assert.doesNotMatch((await latest()).prompt,/HOLD stop quest|LATE_/);
  await send('FAIL quest');await page.getByRole('button',{name:'Edit question',exact:true}).waitFor();assert.match(await page.locator('#chatlog').innerText(),/Recovered quest/);
  // Physical input hold preserves the original node; completion preserves newer draft/caret.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(984,635));
  await field.fill('HOLD physical quest');const submit=page.getByRole('button',{name:'Send question',exact:true});await submit.focus();await page.evaluate(()=>{window.heldConversationSend=document.querySelector('#chat-form [type=submit]');});const beforeHeld=await count();await page.keyboard.down('Enter');
  await app.evaluate(async(_e,n)=>{const end=Date.now()+4000;while(conversationFixture.requests.length<=n){if(Date.now()>end)throw Error('Held send not admitted');await new Promise(r=>setTimeout(r,10));}},beforeHeld);
  assert.deepEqual(await page.evaluate(()=>[heldConversationSend.isConnected,heldConversationSend===document.querySelector('#chat-form [type=submit]')]),[true,true]);await page.keyboard.up('Enter');await pending();await page.getByRole('button',{name:'Stop response',exact:true}).click();await field.fill('New editable draft');await field.evaluate(n=>{window.originalConversationField=n;n.focus();n.setSelectionRange(4,9);});await app.evaluate((_e,i)=>conversationFixture.requests[i].resolve('LATE_PHYSICAL_CANARY'),beforeHeld);
  assert.deepEqual(await field.evaluate(n=>[n===originalConversationField,n.isConnected,document.activeElement===n,n.selectionStart,n.selectionEnd]),[true,true,true,4,9]);
  await page.screenshot({path:path.join(capture,'conversation-984x635.png'),fullPage:true});
  const sendsBeforeKeys=await count();await field.press('Shift+Enter');assert.equal(await count(),sendsBeforeKeys);await field.evaluate(n=>{n.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));n.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});assert.equal(await count(),sendsBeforeKeys);
  // Character away/back, provider and reload boundaries clear both presentation and wire history.
  for(const id of ['Beta','Alpha']){await page.getByLabel('Active character',{exact:true}).selectOption(id);await page.waitForFunction(()=>document.querySelector('#chatlog')?.textContent==='');await send('Quest for '+id);await done();assert.doesNotMatch((await latest()).prompt,/Recovered quest|physical quest/);}
  await call('saveProvider',{provider:'ollama',model:'fixture-two',endpoint:'http://127.0.0.1:11434',authMode:'api'});await page.waitForFunction(()=>document.querySelector('#chatlog')?.textContent==='');await page.reload();await open();assert.equal(await page.locator('#chatlog').innerText(),'');await send('Reloaded quest');await done();assert.equal((await latest()).prompt,'Reloaded quest');
  // Exercise actual same-ID replacement transactions, including late in-flight replies.
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  const point=(await call('checkpointNow')).points[0];
  await send('HOLD actual restore');await pending();const restoreHeld=(await count())-1;
  const preview=await call('previewCheckpoint',point.id);const restored=await call('restoreCheckpoint',{id:preview.id,sha256:preview.sha256});assert.equal(restored.activeProfileId,'Alpha');
  await page.waitForFunction(()=>document.querySelector('#chatlog')?.textContent==='');await app.evaluate((_e,i)=>conversationFixture.requests[i].resolve('LATE_RESTORE_CANARY'),restoreHeld);
  await send('After actual restore');await done();assert.equal((await latest()).prompt,'After actual restore');
  const backup=path.join(dir,'synthetic-backup.json');await fs.writeFile(backup,JSON.stringify((await call('bootstrap')).state));
  await app.evaluate(({dialog},backup)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});},backup);
  await send('HOLD actual import');await pending();const importHeld=(await count())-1;const imported=await call('importData');assert.equal(imported.activeProfileId,'Alpha');
  await page.waitForFunction(()=>document.querySelector('#chatlog')?.textContent==='');await app.evaluate((_e,i)=>conversationFixture.requests[i].resolve('LATE_IMPORT_CANARY'),importHeld);
  await send('After actual import');await done();assert.equal((await latest()).prompt,'After actual import');
  await send('HOLD actual reset');await pending();const resetHeld=(await count())-1;const reset=await call('resetData');assert.deepEqual(reset.profiles,[]);
  await page.waitForFunction(()=>document.querySelector('#chatlog')?.textContent==='');await app.evaluate((_e,i)=>conversationFixture.requests[i].resolve('LATE_RESET_CANARY'),resetHeld);assert.equal(await call('memoryDraft',null),null);
  const ipcChecks=await app.evaluate(async({ipcMain,BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],event={sender:win.webContents,senderFrame:win.webContents.mainFrame};const rejects=async(name,e,...args)=>{try{await ipcMain._invokeHandlers.get('backstage:'+name)(e,...args);return false;}catch{return true;}};return [await rejects('clearConversation',event,'extra'),await rejects('askCompanion',event,{},{}),await rejects('askCompanion',event,{provider:'ollama',prompt:'q',shareProfile:true,history:[]}),await rejects('clearConversation',{sender:{},senderFrame:{}})];});assert.ok(ipcChecks.every(Boolean));
  await fs.writeFile(path.join(capture,'requests.json'),JSON.stringify(await app.evaluate(()=>conversationFixture.requests.map(({input})=>({prompt:input.prompt,context:input.context}))),null,2));
  console.log('Conversation actual Electron PASS: original/correction continuity, navigation, scope/privacy, lifecycle epochs, Clear/Stop/retry, late text, physical controls/caret, keyboard, exact IPC contract. Captures: '+capture);
 }finally{clearTimeout(watchdog);if(app)await app.close().catch(()=>{});const real=await fs.realpath(dir);assert.equal(path.dirname(real).toLowerCase(),root.toLowerCase());assert.ok(path.basename(real).startsWith('forever-conversation-'));await fs.rm(real,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
