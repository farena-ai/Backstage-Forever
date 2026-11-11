"use strict";
const { navigate } = require("./player-navigation.cjs");

const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');

const {defaultState,validateState}=require('../src/core/validation.cjs'),{normalizeInsights}=require('../src/core/insights-data.cjs'),{fixture,commit,build}=require('../tests/fixtures/insights.cjs'),{testWindow}=require('./test-window.cjs'),{selectCurrentText,currentControlState}=require('./selection-fixture.cjs');

const repo=path.resolve(__dirname,'..');

(async()=>{

 const dir=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'bf-character-guidance-')),evidence=path.join(repo,'work/character-guidance-ui-correction');let app,page,checks=0;

 const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};

 const watchdog=setTimeout(()=>{console.error('Character guidance fixture exceeded 180 seconds');app?.process().kill();process.exitCode=1;},180000);

 try{

  await fs.mkdir(evidence,{recursive:true});await fs.mkdir(path.join(dir,'knowledge-v1'));await fs.writeFile(path.join(dir,'knowledge-v1/preferences.json'),JSON.stringify({automatic:false,checked:{}}));

  const profile={id:'p',name:'Synthetic Explorer',realm:'Fictional',className:'Mage',race:'Sunborn',faction:'Horde',level:20,clientBuild:build,locale:'enUS',captureVersion:'0.6.0',source:{kind:'wow-addon',id:'PRIVATE_SOURCE_CANARY',updatedAt:new Date(Date.now()-3600000).toISOString()},notes:'PRIVATE_NOTES_CANARY',goals:[],readiness:{equipment:[{slot:16,itemId:20,name:'Observed blade <img src=x onerror=evil()>',quality:2,itemLevel:12},{slot:19,itemId:99}]}};

  const profiles=[profile,{...profile,id:'alliance',name:'Alliance Explorer',faction:'Alliance'},{...profile,id:'wrong',name:'Wrong Build',clientBuild:'1.60.1.0'},{id:'manual',name:'Manual Explorer',realm:'',className:'Warrior',level:1,notes:'',goals:[]}];

  await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(validateState({...defaultState(),onboarded:true,activeProfileId:'p',profiles})));

  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:'bf-character-guidance-fixture',version:require('../package.json').version,main:'launch.cjs'}));

  const inputs=fixture();for(let i=0;i<7;i++)inputs['trainers.json'].trainers[30].services[100+i]={spellId:100+i,name:i===6?'Distant Synthetic Spell':'Nearby Synthetic Spell '+i,level:i===6?80:20+i,skillRank:0,sources:1};
  const pack=normalizeInsights(inputs,{commit,build});pack.trainers[0].name='Mentor <script>evil()</script>';

  await fs.writeFile(path.join(dir,'launch.cjs'),`const {app,dialog}=require('electron');app.setAppPath(${JSON.stringify(repo)});globalThis.cgFixture={asks:0,hold:false,fail:false,pack:${JSON.stringify(pack)}};const insights=require(${JSON.stringify(path.join(repo,'src/core/insights-data.cjs'))});insights.loadBundledInsights=()=>cgFixture.pack;const Store=require(${JSON.stringify(path.join(repo,'src/core/store.cjs'))}).Store;const start=Store.prototype.startRecovery;Store.prototype.startRecovery=function(){cgFixture.store=this;return start.call(this)};require(${JSON.stringify(path.join(repo,'src/core/voice.cjs'))}).VoiceService.prototype.readCapabilities=async()=>({status:'unavailable',recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]},message:'Synthetic voice unavailable'});dialog.showMessageBox=async()=>({response:0});require(${JSON.stringify(path.join(repo,'src/main.cjs'))});`);

  app=await electron.launch({args:[dir],env:{...process.env,BF_USER_DATA:dir},timeout:20000});page=await testWindow(app);page.setDefaultTimeout(7000);

  await app.evaluate(({ipcMain})=>{for(const method of ['characterGuidance','searchGuidanceTrainers','characterGuidancePrompt']){const original=ipcMain._invokeHandlers.get('backstage:'+method);if(!original)continue;ipcMain.removeHandler('backstage:'+method);ipcMain.handle('backstage:'+method,async(...args)=>{if(cgFixture.fail===method)throw Error('Synthetic read failure');const value=await original(...args);if(cgFixture.hold===method)await new Promise(r=>cgFixture.release=r);cgFixture.completed=(cgFixture.completed||0)+1;return value;});}ipcMain.removeHandler('backstage:ask');ipcMain.handle('backstage:ask',()=>{cgFixture.asks++;throw Error('Inference forbidden in fixture');});});

  await page.evaluate(()=>{localStorage.setItem('bf-setup-v4','manual');localStorage.setItem('bf-share-character','false');});await page.reload();

  await page.getByRole('button',{name:'Characters',exact:true}).click();

  const panel=()=>page.locator('[data-character-guidance]');

  const select=async id=>{await page.locator('#active-character').selectOption(id);await panel().locator('[data-cg-status]').waitFor();};

  await check('automatic selected saved identity, exact custom race, source and escaped gear/trainer facts',async()=>{await panel().getByText('Sunborn',{exact:false}).first().waitFor();const text=await panel().innerText();assert.match(text,/Horde/);assert.match(text,/Main hand/);assert.match(text,/Observed blade <img/);assert.match(text,/Synthetic Starter/);assert.match(text,/Mentor <script>/);assert.equal(await panel().locator('script,img[src="x"]').count(),0);assert.equal(await page.locator('nav[aria-label="Main navigation"] button').count(),5);assert.equal(await page.getByRole("navigation",{name:"Settings and help",exact:true}).getByRole("button").count(),2);await page.screenshot({path:path.join(evidence,'hostile-escaped.png')});});

  await check('clean finished header uses existing environment art and keeps saved source facts readable',async()=>{
   await app.evaluate(()=>{cgFixture.store.state.profiles[0].readiness.equipment[0].name='Synthetic travel blade';cgFixture.store.state.profiles[0].source.updatedAt=new Date().toISOString();cgFixture.pack.trainers[0].name='Synthetic Mentor';});await panel().getByText('Synthetic travel blade',{exact:true}).waitFor();await page.locator('.cg-hero').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,'full.png')});await panel().locator('.cg-equipment').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,'equipment.png')});await panel().locator('[data-cg-personal]').evaluate(n=>n.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(evidence,'training.png')});
  });
  await check('idle saved-source poll refreshes new alts, selector and readonly journal identity without navigation',async()=>{
   await page.locator('.section-head h1').click();
   await app.evaluate(()=>{const p=cgFixture.store.state.profiles[0];p.name='Synthetic Pathfinder';p.realm='New Synthetic Realm';p.level=19;p.source.updatedAt=new Date().toISOString();cgFixture.store.state.profiles.push({...structuredClone(p),id:'new-alt',name:'Newly Saved Alt',level:8,source:{...p.source,id:'SYNTHETIC_NEW_ALT'}});});
   await page.locator('#active-character option[value="new-alt"]').waitFor({state:'attached'});
   await page.locator('.character-list [data-character="new-alt"]').waitFor();
   assert.equal(await page.locator('#character-form [name="name"]').inputValue(),'Synthetic Pathfinder');assert.equal(await page.locator('#character-form [name="realm"]').inputValue(),'New Synthetic Realm');assert.equal(await page.locator('#character-form [name="level"]').inputValue(),'19');
   assert.match(await page.locator('#active-character option[value="p"]').textContent(),/Synthetic Pathfinder/);assert.match(await page.locator('.snapshot-hint [data-snapshot-age]').innerText(),/Saved snapshot/);
  });
  await check('faction unknown access, mismatch numeric slots and manual states',async()=>{await select('alliance');await panel().getByText(/Missing Alliance/).waitFor();assert.equal(await panel().locator('[data-cg-personal] article').count(),0);await select('wrong');await panel().getByText('mismatch',{exact:true}).waitFor();assert.match(await panel().innerText(),/Slot 16/);await select('manual');await panel().getByText('manual',{exact:true}).waitFor();assert.match(await panel().innerText(),/Warrior/);assert.match(await panel().innerText(),/Equipment not observed/);await select('p');await panel().getByText('observed',{exact:true}).waitFor();});

  await check('historical search supports 120 characters and keeps current draft/caret through source updates',async()=>{await panel().locator('details[data-cg-browse] summary').click();await panel().locator('[data-cg-search]').fill('Mage');await panel().getByRole('button',{name:'Search historical reference',exact:true}).click();await panel().locator('[data-cg-results]').getByText(/Mentor/).waitFor();await selectCurrentText(page,{selector:'[data-cg-search]',value:'Mage',start:1,end:3,focus:true,capture:'originalCGSearch'});await app.evaluate(()=>{cgFixture.store.state.profiles[0].level=21;cgFixture.store.state.profiles[0].source.updatedAt=new Date().toISOString();});await panel().getByText(/Level 21.*Mage.*Sunborn.*Horde/).waitFor();assert.deepEqual(await currentControlState(page,'[data-cg-search]',{selection:true}),{focused:true,value:'Mage',start:1,end:3});assert.equal(await page.evaluate(()=>originalCGSearch.isConnected&&originalCGSearch===document.querySelector('[data-cg-search]')),true);await page.locator('.section-head h1').click();await page.waitForFunction(()=>document.querySelector('#character-form [name="level"]')?.value==='21');assert.equal(await panel().locator('[data-cg-search]').inputValue(),'Mage');});

  await check('exact spell query beyond six nearest listings exposes its source-qualified match',async()=>{
   await panel().locator('[data-cg-search]').fill('Distant Synthetic Spell');await panel().getByRole('button',{name:'Search historical reference',exact:true}).click();
   await panel().locator('[data-cg-results] li span').getByText('Distant Synthetic Spell',{exact:true}).waitFor();
   const text=await panel().locator('[data-cg-results]').innerText();assert.match(text,/Reported level 80/);assert.match(text,/Last observed 2026-11-09/);assert.match(text,/matching spell listing/i);assert.match(text,/other trainer listings not shown/i);await panel().locator('[data-cg-results]').evaluate(n=>n.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(evidence,'spell-match.png')});
   await panel().locator('[data-cg-search]').fill('Mage');await panel().getByRole('button',{name:'Search historical reference',exact:true}).click();
  });
  await check('held original checklist button survives a saved-source update and cannot commit stale facts',async()=>{
   const button=panel().locator('[data-cg-add]');await button.focus();await page.evaluate(()=>window.originalCGAdd=document.activeElement);await page.keyboard.down(' ');
   await app.evaluate(()=>{cgFixture.store.state.profiles[0].level=22;cgFixture.store.state.profiles[0].source.updatedAt=new Date().toISOString();});
   await page.waitForTimeout(5200);
   assert.equal(await page.evaluate(()=>originalCGAdd.isConnected&&originalCGAdd===document.querySelector('[data-cg-add]')&&document.activeElement===originalCGAdd),true);
   await page.keyboard.up(' ');await panel().getByText(/Level 22.*Mage.*Sunborn.*Horde/).waitFor();assert.equal(await app.evaluate(()=>cgFixture.store.state.journeys.length),0);
  });
  await check('search failure preserves draft and explicit retry returns bounded historical facts',async()=>{
   await app.evaluate(()=>cgFixture.fail='searchGuidanceTrainers');await panel().locator('[data-cg-search]').fill('Mage');await panel().getByRole('button',{name:'Search historical reference',exact:true}).click();await panel().getByText(/Historical search could not/).waitFor();assert.equal(await panel().locator('[data-cg-search]').inputValue(),'Mage');
   await app.evaluate(()=>cgFixture.fail=false);await panel().getByRole('button',{name:'Search historical reference',exact:true}).click();await panel().locator('[data-cg-results]').getByText(/Mentor/).waitFor();
  });
  await check('late character response cannot repaint another saved character; read error retries honestly',async()=>{
   await navigate(page, "company");await app.evaluate(()=>{cgFixture.hold='characterGuidance';cgFixture.release=null;});await page.getByRole('button',{name:'Characters',exact:true}).click();
   await app.evaluate(async()=>{const until=Date.now()+5000;while(!cgFixture.release){if(Date.now()>until)throw Error('Guidance read was not held');await new Promise(r=>setTimeout(r,10));}cgFixture.hold=false;});
   await select('alliance');await panel().getByText(/Alliance Explorer/).waitFor();await app.evaluate(()=>cgFixture.release());await page.waitForTimeout(80);assert.match(await panel().innerText(),/Alliance Explorer/);assert.doesNotMatch(await panel().locator('.cg-hero').innerText(),/Synthetic Explorer/);
   await navigate(page, "company");await app.evaluate(()=>cgFixture.fail='characterGuidance');await page.getByRole('button',{name:'Characters',exact:true}).click();await panel().getByText(/Character guidance could not be opened/).waitFor();await page.screenshot({path:path.join(evidence,'error.png')});await app.evaluate(()=>cgFixture.fail=false);await panel().getByRole('button',{name:'Retry character guidance',exact:true}).click();await panel().getByText(/Alliance Explorer/).waitFor();await select('p');await panel().getByText(/Level 22.*Mage/).waitFor();
  });
  await check('late optional draft cannot reopen AI after navigation',async()=>{
   await app.evaluate(()=>{cgFixture.hold='characterGuidancePrompt';cgFixture.release=null;});await panel().getByRole('button',{name:'Ask about this character',exact:true}).click();await app.evaluate(async()=>{const until=Date.now()+5000;while(!cgFixture.release){if(Date.now()>until)throw Error('Prompt was not held');await new Promise(r=>setTimeout(r,10));}cgFixture.hold=false;});await navigate(page, "company");await app.evaluate(()=>cgFixture.release());await page.waitForTimeout(80);assert.equal(await page.locator('#chat-form').count(),0);await page.getByRole('button',{name:'Characters',exact:true}).click();await panel().getByText(/Level 22.*Mage/).waitFor();
  });
  await check('optional public draft is editable, never sends, never changes sharing or selects memory',async()=>{await panel().getByRole('button',{name:'Ask about this character',exact:true}).click();const field=page.locator('#chat-form [name="prompt"]');await field.waitFor();const draft=await field.inputValue();assert.equal(await page.locator('#share-profile').isChecked(),false);assert.equal(await page.locator('[data-memory-select]:checked').count(),0);assert.match(draft,/Sunborn/);assert.doesNotMatch(draft,/PRIVATE_|PRIVATE_SOURCE|ollama|"p"/);await field.fill(draft+'\nMy edited question.');assert.match(await field.inputValue(),/My edited question/);assert.equal(await app.evaluate(()=>cgFixture.asks),0);await page.getByRole('button',{name:'Characters',exact:true}).click();});

  await check('failed checklist write is visible, atomic and retryable',async()=>{
   await app.evaluate(()=>{const store=cgFixture.store,save=store.saveState;store.saveState=function(...args){if(cgFixture.failWrite)throw Error('Synthetic write denied');return save.apply(this,args);};cgFixture.failWrite=true;});await panel().getByRole('button',{name:'Create character checklist',exact:true}).click();await panel().getByText(/This displayed choice could not be used/).waitFor();assert.equal(await app.evaluate(()=>cgFixture.store.state.journeys.length),0);await app.evaluate(()=>cgFixture.failWrite=false);await panel().getByRole('button',{name:'Retry character guidance',exact:true}).click();await panel().getByRole('button',{name:'Create character checklist',exact:true}).waitFor();
  });
  await check('one click creates manual Company checklist with no observed proof',async()=>{await panel().getByRole('button',{name:'Create character checklist',exact:true}).click();await page.getByRole('heading',{name:/company/i}).first().waitFor();const journeys=await app.evaluate(()=>cgFixture.store.state.journeys);assert.equal(journeys.length,1);assert.ok(journeys[0].steps.length>=3);assert.ok(journeys[0].steps.every(s=>!s.done&&!s.quest&&!s.observed));});

  await check('compact reduced motion has no horizontal overflow or tiny guidance text',async()=>{await page.getByRole('button',{name:'Characters',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setMinimumSize(800,600);w.setContentSize(984,635);});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok(await panel().evaluate(n=>[...n.querySelectorAll('p,small,button,input,td')].every(x=>parseFloat(getComputedStyle(x).fontSize)>=12)));await page.evaluate(()=>{document.getElementById('toast').className='';document.querySelector('.cg-hero').scrollIntoView({block:'start'});});await page.screenshot({path:path.join(evidence,'compact.png')});await panel().locator('.cg-equipment').evaluate(n=>n.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(evidence,'compact-loadout.png')});});

  await check('identical backup replacement invalidates main choices and pending renderer drafts; cancellation preserves choices',async()=>{
   const backup=path.join(dir,'synthetic-backup.json');await fs.writeFile(backup,await app.evaluate(()=>cgFixture.store.exportData()));
   await app.evaluate(({dialog},backup)=>{cgFixture.confirm=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});dialog.showMessageBox=async()=>({response:cgFixture.confirm});},backup);
   const choice=await page.evaluate(async()=>{const m=await window.backstage.characterGuidance('p');return {profileId:'p',token:m.token};});
   await navigate(page, "guide");await page.getByRole('button',{name:'Import backup',exact:true}).click();assert.match(await page.evaluate(c=>window.backstage.characterGuidancePrompt(c),choice),/Sunborn/);
   await page.getByRole('button',{name:'Characters',exact:true}).click();await panel().getByText(/Level 22.*Mage/).waitFor();await app.evaluate(()=>{cgFixture.hold='characterGuidancePrompt';cgFixture.release=null;});await panel().getByRole('button',{name:'Ask about this character',exact:true}).click();
   await app.evaluate(async()=>{const until=Date.now()+5000;while(!cgFixture.release){if(Date.now()>until)throw Error('Prompt not held');await new Promise(r=>setTimeout(r,10));}cgFixture.hold=false;cgFixture.confirm=1;});
   await navigate(page, "guide");await page.getByRole('button',{name:'Import backup',exact:true}).click();await page.getByText('Backup imported. Existing API keys preserved.',{exact:true}).waitFor();
   await app.evaluate(()=>cgFixture.release());await page.waitForTimeout(80);assert.equal(await page.locator('#chat-form').count(),0);
   assert.match(await page.evaluate(c=>window.backstage.characterGuidancePrompt(c).then(()=>'',e=>e.message),choice),/Refresh|could not|invalid/i);
   await page.getByRole('button',{name:'Characters',exact:true}).click();await panel().getByText(/Level 22.*Mage/).waitFor();
  });
  await check('recovery callback invalidates identical public facts and retired prompts',async()=>{
   await page.evaluate(()=>window.backstage.checkpointNow());const before=await page.evaluate(()=>window.backstage.characterGuidance('p')),choice={profileId:'p',token:before.token};
   await app.evaluate(()=>{cgFixture.hold='characterGuidancePrompt';cgFixture.release=null;});await panel().getByRole('button',{name:'Ask about this character',exact:true}).click();await app.evaluate(async()=>{const until=Date.now()+5000;while(!cgFixture.release){if(Date.now()>until)throw Error('Prompt not held');await new Promise(r=>setTimeout(r,10));}cgFixture.hold=false;});
   await navigate(page, "guide");await page.locator('[data-recovery-preview]').click();await page.locator('[data-recovery-restore]').click();await page.getByText(/Journal restored. Game observation is disconnected/).waitFor();await app.evaluate(()=>cgFixture.release());await page.waitForTimeout(80);assert.equal(await page.locator('#chat-form').count(),0);
   assert.match(await page.evaluate(c=>window.backstage.characterGuidancePrompt(c).then(()=>'',e=>e.message),choice),/Refresh|could not|invalid/i);
   const after=await page.evaluate(()=>window.backstage.characterGuidance('p'));assert.deepEqual(after.identity,before.identity);assert.deepEqual(after.source,before.source);assert.notEqual(after.token,before.token);
  });
  await check('confirmed reset retires held reads and empty Characters remains useful offline',async()=>{
   await app.evaluate(()=>{cgFixture.hold='characterGuidance';cgFixture.release=null;});await page.getByRole('button',{name:'Characters',exact:true}).click();await app.evaluate(async()=>{const until=Date.now()+5000;while(!cgFixture.release){if(Date.now()>until)throw Error('Guidance not held');await new Promise(r=>setTimeout(r,10));}cgFixture.hold=false;});
   await navigate(page, "guide");await page.getByRole('button',{name:'Delete all local data',exact:true}).click();await page.getByRole('button',{name:'Plan without a character',exact:true}).waitFor();await app.evaluate(()=>cgFixture.release());await page.waitForTimeout(80);assert.equal(await panel().count(),0);
   await page.getByRole('button',{name:'Plan without a character',exact:true}).click();await page.getByRole('button',{name:'Characters',exact:true}).click();await panel().getByText('no-character',{exact:true}).waitFor();assert.equal(await panel().locator('[data-cg-add]:disabled').count(),1);await page.screenshot({path:path.join(evidence,'empty.png')});assert.equal(await app.evaluate(()=>cgFixture.asks),0);
  });
  console.log(`Character guidance UI: ${checks} checks passed`);

 }catch(error){await page?.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});throw error;}finally{clearTimeout(watchdog);await app?.close();await fs.rm(dir,{recursive:true,force:true});}

})().catch(error=>{console.error(error);process.exitCode=1;});
