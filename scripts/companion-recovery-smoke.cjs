"use strict";
// Actual main/preload/renderer with synthetic state and deliberately late fake transport.
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {testWindow}=require('./test-window.cjs');const {defaultState}=require('../src/core/validation.cjs');
(async()=>{
 const rawTempRoot=os.tmpdir(),tempRoot=await fs.realpath(rawTempRoot),dir=await fs.mkdtemp(path.join(rawTempRoot,'forever-companion-recovery-'));let app;
 const watchdog=setTimeout(()=>{console.error('Recovery fixture exceeded 100 seconds');app?.process().kill();process.exitCode=1;},100000);
 try{
  await fs.writeFile(path.join(dir,'state.json'),JSON.stringify({...defaultState(),onboarded:true,activeProfileId:'Alpha',profiles:['Alpha','Beta'].map(id=>({id,name:id,className:'Mage',realm:'Synthetic',level:12,goals:[],notes:'PRIVATE'})),provider:{id:'ollama',model:'fixture',endpoint:'http://127.0.0.1:11434'}}));
  app=await electron.launch({args:[path.join(__dirname,'..')],env:{...process.env,BF_USER_DATA:dir},timeout:20000});const page=await testWindow(app);page.setDefaultTimeout(6000);
  const appData=await app.evaluate(({app})=>app.getPath('userData')),canonicalData=await fs.realpath(dir);
  const ownedStat=await fs.stat(canonicalData),appStat=await fs.stat(appData);
  assert.equal(appStat.dev,ownedStat.dev);assert.equal(appStat.ino,ownedStat.ino);
  const aliasedTemp=path.resolve(rawTempRoot).toLowerCase()!==path.resolve(tempRoot).toLowerCase();
  if(aliasedTemp){assert.match(rawTempRoot,/~\d/);assert.match(dir,/~\d/);assert.notEqual(path.resolve(dir).toLowerCase(),path.resolve(canonicalData).toLowerCase());}
  console.log('Synthetic app-data identity:',JSON.stringify({aliasedTemp,aliasedInputPassed:aliasedTemp&&/~\d/.test(dir),appRetainedInput:path.resolve(appData).toLowerCase()===path.resolve(dir).toLowerCase(),sameOwnedDirectory:true}));
  await app.evaluate(({app,ipcMain})=>{
   const load=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(app.getAppPath(),'package.json'));
   globalThis.recovery={requests:[],invalidations:[]};
   const context=load('./src/core/companion-context.cjs').CompanionContext.prototype, invalidate=context.invalidate;
   context.invalidate=function(reason){recovery.invalidations.push(reason);return invalidate.call(this,reason);};
   const memoryDraft=ipcMain._invokeHandlers.get('backstage:memoryDraft');ipcMain.removeHandler('backstage:memoryDraft');
   ipcMain.handle('backstage:memoryDraft',async(...args)=>{const result=await memoryDraft(...args);if(recovery.holdReview){recovery.holdReview=false;recovery.heldDraft=result;await new Promise(resolve=>recovery.releaseReview=resolve);}return result;});
   load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
   load('./src/core/claude.cjs').status=async()=>({available:false,connected:false});
   load('./src/core/voice.cjs').VoiceService.prototype.capabilities=async()=>({available:false,recognizers:[],voices:[]});
   load('./src/core/providers.cjs').ask=async input=>{const entry={input};recovery.requests.push(entry);if(input.prompt.includes('FAIL'))throw Error('Provider request failed. Check the connection and model.');if(input.prompt.includes('HOLD'))return new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});return 'Synthetic quest answer';};
  });
  await page.evaluate(()=>localStorage.setItem('bf-setup-v4','complete'));await page.reload();
  const call=(method,...args)=>page.evaluate(({method,args})=>window.backstage[method](...args),{method,args});
  const open=()=>page.getByRole('button',{name:'AI Companion',exact:true}).click();await open();
  const question=page.getByRole('textbox',{name:'Your question',exact:true});
  const send=async text=>{await question.fill(text);await page.getByRole('button',{name:'Send question',exact:true}).click();};
  const waitPendingPresentation=()=>page.getByRole('button',{name:'Stop response',exact:true}).waitFor({state:'visible'});
  const waitRequest=async count=>app.evaluate(async (_e,count)=>{const end=Date.now()+4000;while(recovery.requests.length<count){if(Date.now()>end)throw Error('Request not started');await new Promise(r=>setTimeout(r,10));}},count);
  // Admission can precede paint while the original physical Send control is held.
  await question.fill('Explain HOLD quest');
  const sendButton=page.getByRole('button',{name:'Send question',exact:true});await sendButton.focus();
  await page.evaluate(()=>{window.recoveryHeldSend=document.querySelector('#chat-form [type=submit]');window.recoveryDeferredPaints=0;const defer=Memory.deferRender;Memory.deferRender=(...args)=>{const held=defer(...args);if(held)window.recoveryDeferredPaints++;return held;};});
  await page.keyboard.down('Enter');await waitRequest(1);
  const admission=await page.evaluate(()=>({deferredPaints:window.recoveryDeferredPaints,originalConnected:window.recoveryHeldSend.isConnected,originalCurrent:window.recoveryHeldSend===document.querySelector('#chat-form [type=submit]'),stopCount:document.querySelectorAll('[data-command="stop-response"]').length}));
  assert.ok(admission.deferredPaints>0,'A physical hold must demonstrably defer the requested paint');
  assert.equal(admission.originalConnected,true);assert.equal(admission.originalCurrent,true);
  assert.equal(admission.stopCount,0,'The held original Send control precedes the pending Stop presentation');
  console.log('Request admitted while physical Send remained held:',JSON.stringify(admission));
  await page.keyboard.up('Enter');
  await waitPendingPresentation();
  assert.equal(await page.getByRole('button',{name:'Stop response',exact:true}).count(),1,'Waiting requires a visible Stop response action');
  await page.getByRole('button',{name:'Stop response',exact:true}).click();await page.getByRole('button',{name:'Edit question',exact:true}).waitFor();
  assert.match(await page.locator('[data-question-recovery]').innerText(),/stopped/i);assert.equal(await question.inputValue(),'');assert.equal(await page.locator('#chatlog').getByText('Explain HOLD quest',{exact:true}).count(),1);
  assert.equal(await app.evaluate(()=>recovery.requests[0].input.signal.aborted),true);assert.equal(await call('cancelAsk'),false);assert.equal(await call('memoryDraft','Alpha'),null);
  await page.getByRole('button',{name:'Edit question',exact:true}).press('Enter');assert.equal(await question.inputValue(),'Explain HOLD quest');assert.equal(await question.evaluate(n=>document.activeElement===n),true);
  await send('Explain another quest');await page.locator('#chatlog').getByText('Synthetic quest answer',{exact:true}).waitFor();
  await app.evaluate(()=>recovery.requests[0].resolve('LATE OLD ANSWER'));await page.waitForTimeout(50);assert.equal(await page.getByText('LATE OLD ANSWER',{exact:true}).count(),0);assert.equal((await call('memoryDraft','Alpha')).question,'Explain another quest');
  await send('Explain FAIL quest');await page.getByRole('button',{name:'Edit question',exact:true}).waitFor();assert.match(await page.locator('[data-question-recovery]').innerText(),/failed/);
  await page.getByLabel('Use my active character',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Edit question',exact:true}).press('Enter');assert.equal(await question.inputValue(),'Explain FAIL quest');assert.equal(await question.evaluate(n=>document.activeElement===n),true);assert.equal(await page.getByLabel('Use my active character',{exact:true}).isChecked(),false);
  await send('Explain FAIL another quest');await page.getByRole('button',{name:'Edit question',exact:true}).waitFor();
  await question.fill('My newer quest draft');await page.getByRole('button',{name:'Edit question',exact:true}).click();assert.equal(await question.inputValue(),'My newer quest draft');assert.match(await page.locator('[data-question-recovery]').innerText(),/newer draft/);assert.equal(await call('memoryDraft','Alpha'),null);
  // Hold the actual main draft reply after transport settlement while renderer Stop remains visible.
  await app.evaluate(()=>{recovery.holdReview=true;});await send('Explain completed quest awaiting review');
  await app.evaluate(async()=>{const end=Date.now()+4000;while(!recovery.releaseReview){if(Date.now()>end)throw Error('Memory review did not reach the held boundary');await new Promise(r=>setTimeout(r,10));}});
  const retiredDraft=await call('memoryDraft','Alpha');assert.equal(retiredDraft.question,'Explain completed quest awaiting review');
  const beforeReviewStop=await app.evaluate(()=>recovery.invalidations.length);
  await page.getByRole('button',{name:'Stop response',exact:true}).click();await page.getByRole('button',{name:'Edit question',exact:true}).waitFor();
  assert.equal(await call('memoryDraft','Alpha'),null,'Stop must retire the completed backend draft while renderer review is pending');
  await assert.rejects(()=>call('saveMemory',{profileId:'Alpha',responseId:retiredDraft.responseId}),/no longer current/);
  assert.equal(await call('cancelAsk'),false);assert.equal(await app.evaluate(()=>recovery.invalidations.length),beforeReviewStop,'Completed/idle Stop must not invalidate unrelated context or voice work');
  const nextCount=await app.evaluate(()=>recovery.requests.length);await send('Explain HOLD newer review quest');await waitRequest(nextCount+1);await waitPendingPresentation();
  await app.evaluate(()=>recovery.releaseReview());await page.waitForTimeout(30);
  assert.equal(await page.getByRole('button',{name:'Save exchange',exact:true}).count(),0,'Late review must not publish the retired exchange');
  assert.equal(await page.getByRole('button',{name:'Stop response',exact:true}).count(),1,'Late review must not retire the newer request');
  assert.equal(await call('memoryDraft','Alpha'),null);
  await app.evaluate((_e,index)=>recovery.requests[index].resolve('New review answer'),nextCount);await page.getByRole('button',{name:'Save exchange',exact:true}).waitFor();
  assert.equal((await call('memoryDraft','Alpha')).question,'Explain HOLD newer review quest');
  await assert.rejects(()=>call('saveMemory',{profileId:'Alpha',responseId:retiredDraft.responseId}),/no longer current/);
  // Direct handlers verify trusted origin and cancellation arity independently of preload.
  const invalid=await app.evaluate(async({ipcMain,BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],handler=ipcMain._invokeHandlers.get('backstage:cancelAsk'),event={sender:win.webContents,senderFrame:win.webContents.mainFrame};const rejects=async(...args)=>{try{await handler(...args);return false;}catch{return true;}};return [await rejects(event,'extra'),await rejects({sender:{},senderFrame:{}}),await rejects({sender:win.webContents,senderFrame:{url:event.senderFrame.url}})];});assert.ok(invalid.every(Boolean));
  for(const scenario of ['navigation','provider','character']){
   const count=await app.evaluate(()=>recovery.requests.length);await send('Explain HOLD '+scenario+' quest');await waitRequest(count+1);await waitPendingPresentation();
   if(scenario==='navigation'){await page.getByRole('button',{name:'Field Guide',exact:true}).click();await open();}
   if(scenario==='provider'){await call('saveProvider',{provider:'ollama',model:'fixture-two',endpoint:'http://127.0.0.1:11434',authMode:'api'});}
   if(scenario==='character'){await page.getByLabel('Active character',{exact:true}).selectOption('Beta');}
   await page.waitForFunction(()=>!document.querySelector('#chat-form [type=submit]').disabled);
   assert.equal(await app.evaluate((_e,index)=>recovery.requests[index].input.signal.aborted,count),true);
   await app.evaluate((_e,index)=>recovery.requests[index].reject(Error('PRIVATE late failure')),count);await page.waitForTimeout(30);
   assert.equal(await call('memoryDraft',scenario==='character'?'Beta':'Alpha'),null);assert.equal(await page.getByText('PRIVATE late failure',{exact:true}).count(),0);
  }
  // Completion during an actively edited newer draft preserves its focus and caret.
  const last=await app.evaluate(()=>recovery.requests.length);await send('Explain HOLD focus quest');await waitRequest(last+1);await waitPendingPresentation();
  await page.getByRole('button',{name:'Stop response',exact:true}).click();await question.fill('New focus draft');await question.evaluate(n=>{window.recoveryOriginalQuestion=n;n.focus();n.setSelectionRange(4,9);});
  await app.evaluate((_e,index)=>recovery.requests[index].resolve('STALE focus answer'),last);await page.waitForTimeout(30);assert.equal(await question.inputValue(),'New focus draft');assert.deepEqual(await question.evaluate(n=>[n===window.recoveryOriginalQuestion,window.recoveryOriginalQuestion.isConnected,document.activeElement===n,n.selectionStart,n.selectionEnd]),[true,true,true,4,9]);
  console.log('Companion recovery actual Electron PASS: Stop/new request, stale success/error, memory ownership, completed-but-held review Stop, late review/new request isolation, navigation/provider/character, edit/newer draft, keyboard focus, trusted arity.');
 }finally{clearTimeout(watchdog);if(app)await app.close().catch(()=>{});const real=await fs.realpath(dir);assert.equal(path.dirname(real).toLowerCase(),tempRoot.toLowerCase());assert.ok(path.basename(real).startsWith('forever-companion-recovery-'));await fs.rm(real,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
