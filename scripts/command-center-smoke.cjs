const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs");
const { navigate } = require("./player-navigation.cjs");
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { testWindow } = require('./test-window.cjs');
(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'bf-command-'));
  let app, page;
  try {
    const game = path.join(data, 'synthetic-client');
    const file = path.join(game, 'WTF/Account/Synthetic/SavedVariables/BackstageForever.lua');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(path.join(game, '.flavor.info'), 'wowf');
    const now = Date.now()/1000;
    const base = {realm:'Synthetic Realm', level:18, updatedAt:now, location:{zone:'Synthetic Forest',subZone:'Camp',mapId:1,x:.4,y:.5},progress:{current:250,max:1000}};
    const characters = [
      {...base,id:'Synthetic-Alliance',name:'Aeralyn',className:'Hunter',faction:'Alliance',race:'Synthetic',quests:Array.from({length:6},(_,i)=>({id:101+i,title:i===0?'Return the scout':`Forest objective ${i}`,level:17,zone:'Synthetic Forest',complete:i===0,objectives:[{text:'Observed objective',done:i===0}],destination:{mapId:1,x:.45,y:.55,text:'Game-provided marker'}})),readiness:{equipment:[{slot:16,itemId:123,name:'Synthetic Bow',quality:2,itemLevel:20}],bags:{free:4,total:40}}},
      {...base,id:'Synthetic-Horde',name:'Vaelric',className:'Mage',faction:'Horde',race:'Synthetic',quests:[{id:201,title:'The second journey',complete:false,objectives:[{text:'Observe the trail',done:false}]}]}
    ];
    const write = async()=>fs.writeFile(file,'BackstageForeverExport = '+JSON.stringify(JSON.stringify({schema:1,activeId:characters[0].id,observedAt:Date.now()/1000,characters})));
    await write();
    app = await electron.launch({args:[await syntheticLaunch(data)],env:{...process.env,BF_USER_DATA:data}});
    page = await testWindow(app);
    await app.evaluate(({ipcMain})=>{globalThis.commandAIRequests=0;ipcMain.removeHandler('backstage:ask');ipcMain.handle('backstage:ask',()=>{globalThis.commandAIRequests++;throw Error('Fixture blocks inference');});});
    await page.evaluate(()=>localStorage.setItem('bf-setup-v4','complete'));
    await page.evaluate(root=>window.backstage.prepareGame(root),game);
    await page.reload();
    await page.getByRole('heading',{name:'Aeralyn',exact:true}).waitFor();
    await navigate(page, "adventure");
    if(process.env.BF_SMOKE_CAPTURE_ROOT){
      await fs.mkdir(process.env.BF_SMOKE_CAPTURE_ROOT,{recursive:true});
      for(const [width,height,name] of [[1440,960,'command-center-full'],[984,635,'command-center-compact']]){
        await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setContentSize(width,height),{width,height});
        await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
        await page.screenshot({path:path.join(process.env.BF_SMOKE_CAPTURE_ROOT,name+'.png')});
      }
    }
    // Reproduce an existing saved roster with follow disabled and no active ID.
    const nullSelection=await page.evaluate(()=>window.backstage.bootstrap());
    nullSelection.state.activeProfileId=null;
    nullSelection.state.followGameCharacter=false;
    await app.close();
    await fs.writeFile(path.join(data,'state.json'),JSON.stringify(nullSelection.state));
    app = await electron.launch({args:[await syntheticLaunch(data)],env:{...process.env,BF_USER_DATA:data}});
    page = await testWindow(app);
    await app.evaluate(({ipcMain})=>{globalThis.commandAIRequests=0;ipcMain.removeHandler('backstage:ask');ipcMain.handle('backstage:ask',()=>{globalThis.commandAIRequests++;throw Error('Fixture blocks inference');});});
    await page.getByRole('heading',{name:'Aeralyn',exact:true}).waitFor({timeout:5000});
    await navigate(page, "adventure");
    const repaired=await page.evaluate(()=>window.backstage.bootstrap());
    assert.equal(repaired.state.activeProfileId,repaired.state.profiles[0].id,'Bootstrap must give Adventure a real selected profile');
    assert.equal(repaired.state.followGameCharacter,false,'Selection repair must retain the follow preference');
    const plans=page.getByRole('region',{name:'Your next steps',exact:true});
    await plans.waitFor({timeout:5000});
    // Saved profiles load before the asynchronous game reconnection completes.
    await page.locator('.companion-dock').waitFor({state:'hidden'});
    assert.equal(await page.locator('.companion-dock').count(),0);
    assert.equal(await plans.locator('.guidance-step').count(),5);
    await plans.locator('.step-evidence').first().locator('summary').click();
    assert.match(await plans.locator('.step-evidence').first().innerText(),/Source: game snapshot/);
    assert.match(await page.locator('.preparation').innerText(),/4 \/ 40/);
    const privateState=await page.evaluate(()=>window.backstage.bootstrap());
    privateState.state.profiles.find(p=>p.name==='Aeralyn').notes='PRIVATE NOTE NEVER SHARED';
    privateState.state.profiles.find(p=>p.name==='Aeralyn').goals=[{id:'private-goal',text:'PRIVATE GOAL NEVER SHARED',done:false}];
    await page.evaluate(s=>window.backstage.saveState(s),privateState.state);
    await page.reload();
    await page.getByRole('heading',{name:'Aeralyn',exact:true}).waitFor();
    await navigate(page, "adventure");
    await page.evaluate(()=>PlayerNavigation.reveal(root,'coach-quest-plan'));
    await page.getByLabel('Session length',{exact:true}).selectOption('15');
    await page.waitForFunction(()=>document.querySelectorAll('.guidance-step').length===3);
    assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Session length','Automatic planning must preserve keyboard focus on the preference control');
    await page.getByLabel('Quest focus',{exact:true}).selectOption('turn-ins');
    await page.waitForFunction(()=>document.querySelectorAll('.guidance-step').length===1);
    assert.match(await plans.innerText(),/Return the scout/);
    assert.match(await plans.innerText(),/saved|snapshot|game/i);
    const options=await page.getByLabel('Active character',{exact:true}).locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,text:n.textContent})));
    const second=options.find(o=>o.text.includes('Vaelric')).value;
    const first=options.find(o=>o.text.includes('Aeralyn')).value;
    await page.getByLabel('Active character',{exact:true}).selectOption(second);
    await page.getByRole('heading',{name:'Vaelric',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('[aria-label="Your next steps"]')?.textContent.includes('The second journey'));
    assert.ok(!(await page.getByRole('region',{name:'Your next steps',exact:true}).innerText()).includes('Return the scout'),"Selected character must not show another toon's plan");
    assert.equal(await page.getByLabel('Session length',{exact:true}).inputValue(),'30');
    assert.equal(await page.getByLabel('Quest focus',{exact:true}).inputValue(),'balanced');
    await page.getByLabel('Quest focus',{exact:true}).selectOption('nearby');
    await page.getByLabel('Active character',{exact:true}).selectOption(first);
    await page.getByRole('heading',{name:'Aeralyn',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Session length',{exact:true}).inputValue(),'15');
    assert.equal(await page.getByLabel('Quest focus',{exact:true}).inputValue(),'turn-ins');
    await page.reload();
    await navigate(page, "adventure");
    await page.evaluate(()=>PlayerNavigation.reveal(root,'coach-quest-plan'));
    await page.getByLabel('Session length',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Session length',{exact:true}).inputValue(),'15');
    assert.equal(await page.getByLabel('Quest focus',{exact:true}).inputValue(),'turn-ins');
    await page.getByRole('button',{name:'Explain my plan',exact:true}).click();
    const drafted=await page.getByLabel('Your question',{exact:true}).inputValue();
    assert.match(drafted,/Return the scout/);
    assert.ok(drafted.length<=11500);
    for(const secret of ['PRIVATE NOTE','PRIVATE GOAL','Synthetic-Alliance','Synthetic Bow',game,file]) assert.ok(!drafted.includes(secret),'Draft must exclude private/local identity and readiness details');
    assert.equal(await app.evaluate(()=>globalThis.commandAIRequests),0,'Planning and drafting must not run AI');
    await page.getByRole('button',{name:'Adventure',exact:true}).click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
    await page.waitForFunction(()=>innerWidth<=1000);
    await page.evaluate(()=>scrollTo(0,0));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Compact layout must not scroll horizontally');
    assert.ok(await page.locator('.command-hero').evaluate(node=>node.getBoundingClientRect().height<=230),'Compact hero must leave room for the actual next steps');
    assert.ok(await page.locator('[data-coach-action]').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'The proactive next action must be readable in the compact first screen');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>PlayerNavigation.reveal(root,'coach-quest-plan'));
    await page.getByLabel('Session length',{exact:true}).selectOption('30');
    await page.getByLabel('Quest focus',{exact:true}).selectOption('balanced');
    const before=await page.getByRole('region',{name:'Your next steps',exact:true}).innerText();
    characters[0].quests=characters[0].quests.slice(1);characters[0].updatedAt=Date.now()/1000+1;await write();
    await page.evaluate(()=>window.backstage.refreshGame());
    await page.waitForFunction(()=>!document.querySelector('[aria-label="Your next steps"]')?.textContent.includes('Return the scout'));
    assert.notEqual(await page.getByRole('region',{name:'Your next steps',exact:true}).innerText(),before,'Imported progress must rebuild guidance');
    await app.evaluate(({ipcMain})=>{
      const original=ipcMain._invokeHandlers.get('backstage:guidancePlan');
      globalThis.commandOriginalGuidance=original;
      ipcMain.removeHandler('backstage:guidancePlan');
      ipcMain.handle('backstage:guidancePlan',async (...args)=>{
        const result=await original(...args);
        if(args[2].minutes===60) {
          globalThis.commandDelayedResponse=new Promise(resolve=>setTimeout(resolve,1200));
          await globalThis.commandDelayedResponse;
          result.headline='STALE RESPONSE MUST NOT APPEAR';
        }
        return result;
      });
    });
    await page.evaluate(()=>PlayerNavigation.reveal(root,'coach-quest-plan'));
    await page.getByLabel('Session length',{exact:true}).selectOption('60');
    await app.evaluate(async()=>{
      const deadline=Date.now()+5000;
      while(!globalThis.commandDelayedResponse) {
        if(Date.now()>deadline) throw Error('Delayed guidance fixture did not start');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    });
    await page.evaluate(()=>PlayerNavigation.reveal(root,'coach-quest-plan'));
    await page.getByLabel('Session length',{exact:true}).selectOption('15');
    await app.evaluate(()=>globalThis.commandDelayedResponse);
    await page.waitForFunction(()=>document.querySelectorAll('.guidance-step').length===3);
    assert.ok(!(await plans.innerText()).includes('STALE RESPONSE'),'Out-of-order guidance must not replace the current selection');
    const savedPreferences=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('bf-guidance-v1:')));
    assert.ok(savedPreferences.length>=2);
    for(const [,value] of savedPreferences) assert.deepEqual(Object.keys(JSON.parse(value)).sort(),['focus','minutes']);
    const restored=(await page.evaluate(()=>window.backstage.bootstrap())).state;
    const restoredCharacter=restored.profiles.find(p=>p.id===first);
    restored.activeProfileId=first;
    restoredCharacter.quests=[{id:901,title:'Restored quest from backup',complete:false,objectives:[{text:'Restored objective',done:false}]}];
    restoredCharacter.notes='RESTORED PRIVATE NOTES';
    restoredCharacter.goals=[{id:'restored-goal',text:'Restored personal goal',done:false}];
    restored.provider.model='restore-fixture-model';
    const backupFile=path.join(data,'restore-fixture.json');
    await fs.writeFile(backupFile,JSON.stringify(restored));
    await app.evaluate(({ipcMain,dialog},backup)=>{
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});
      dialog.showMessageBox=async()=>({response:1});
      ipcMain.removeHandler('backstage:listModels');
      ipcMain.handle('backstage:listModels',async()=>({models:[{id:'restore-fixture-model',label:'Restore fixture model'}],source:'Synthetic fixture',checkedAt:new Date().toISOString(),message:'Synthetic catalog; no inference.'}));
      const original=globalThis.commandOriginalGuidance;
      const snapshot=ipcMain._invokeHandlers.get('backstage:gameSnapshot');
      globalThis.commandOriginalSnapshot=snapshot;
      ipcMain.removeHandler('backstage:gameSnapshot');
      ipcMain.handle('backstage:gameSnapshot',(...args)=>new Promise(resolve=>{
        globalThis.commandSnapshotRelease=()=>Promise.resolve(snapshot(...args)).then(resolve);
      }));
      let held=false;
      ipcMain.removeHandler('backstage:guidancePlan');
      ipcMain.handle('backstage:guidancePlan',async(...args)=>{
        const result=await original(...args);
        if(!held && args[2].minutes===60) {
          held=true;
          globalThis.commandRestorePending=new Promise(resolve=>{globalThis.commandRestoreRelease=resolve;});
          await globalThis.commandRestorePending;
          result.steps[0].title='PRE-RESTORE QUEST MUST NOT RETURN';
        }
        return result;
      });
    },backupFile);
    await page.evaluate(()=>PlayerNavigation.reveal(root,'coach-quest-plan'));
    await page.getByLabel('Session length',{exact:true}).selectOption('60');
    await app.evaluate(async()=>{
      const deadline=Date.now()+5000;
      while(!globalThis.commandRestoreRelease) {
        if(Date.now()>deadline) throw Error('Pre-restore planner fixture did not start');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    });
    await navigate(page, "guide");
    await page.getByRole('button',{name:'Import backup',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Backup imported.'}).waitFor();
    await page.getByRole('button',{name:'Adventure',exact:true}).click();
    await plans.getByRole('heading',{name:'Restored quest from backup',exact:true}).waitFor({timeout:1000});
    assert.equal(await page.getByLabel('Active character',{exact:true}).inputValue(),first);
    assert.equal(await page.getByLabel('Session length',{exact:true}).inputValue(),'60');
    assert.equal(await page.getByLabel('Quest focus',{exact:true}).inputValue(),'balanced');
    await app.evaluate(()=>globalThis.commandRestoreRelease());
    await app.evaluate(()=>globalThis.commandRestorePending);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.ok(!(await plans.innerText()).includes('PRE-RESTORE'),'Pre-import responses must not overwrite restored guidance');
    await page.getByRole('button',{name:'Characters',exact:true}).click();
    assert.equal(await page.getByLabel('Private notes').inputValue(),'RESTORED PRIVATE NOTES');
    await navigate(page, "connections");
    await page.getByRole('option',{name:'Restore fixture model',exact:true}).waitFor({state:'attached'});
    assert.equal(await page.getByLabel('Available models').inputValue(),'restore-fixture-model');
    assert.equal(await app.evaluate(()=>globalThis.commandAIRequests),0,'Restoring and loading a provider must not run inference');
    await app.evaluate(({ipcMain})=>{
      ipcMain.removeHandler('backstage:gameSnapshot');
      ipcMain.handle('backstage:gameSnapshot',globalThis.commandOriginalSnapshot);
      globalThis.commandSnapshotRelease?.();
    });
    // Reconnect only the synthetic export so the remaining import/empty-state checks stay independent.
    await page.evaluate(root=>window.backstage.prepareGame(root),game);
    await page.reload();
    await page.getByRole('heading',{name:'Aeralyn',exact:true}).waitFor();
    await navigate(page, "adventure");
    characters[0].quests=[];characters[0].updatedAt=Date.now()/1000+2;await write();
    await page.evaluate(()=>window.backstage.refreshGame());
    await page.waitForFunction(()=>document.querySelector('[aria-label="Your next steps"]')?.textContent.includes('observed quest log is empty'));
    assert.equal(await plans.locator('.guidance-step').count(),0);
    assert.equal(await page.getByRole('button',{name:'Explain my plan',exact:true}).isDisabled(),true);
    await page.evaluate(async()=>{
      await window.backstage.disconnectGame();
      const result=await window.backstage.bootstrap();
      result.state.profiles=[{id:'manual-synthetic',name:'Manual Hero',className:'Hunter',level:1,realm:'Synthetic Realm',notes:'',goals:[]}];
      result.state.activeProfileId='manual-synthetic';
      await window.backstage.saveState(result.state);
    });
    await page.reload();
    await page.getByRole('heading',{name:'Manual Hero',exact:true}).waitFor();
    await navigate(page, "adventure");
    assert.match(await plans.innerText(),/Manual journals work/);
    assert.match(await page.locator('.preparation').innerText(),/unavailable|not been received/);
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    await navigate(page, "guide");
    await page.getByRole('button',{name:'Delete all local data',exact:true}).click();
    await page.getByRole('heading',{name:'A companion for the road ahead.',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('bf-guidance-v1:')).length),0,'Reset must remove per-character planning preferences');
    console.log('PASS: automatic source-backed plans, session/focus autosave, character isolation, restart persistence, explicit AI draft without inference, compact/reduced-motion layout and import replanning. Synthetic profiles only.');
  } catch(error) {
    if(page) { await fs.mkdir(path.join(__dirname,'../work'),{recursive:true});await page.screenshot({path:path.join(process.env.BF_SMOKE_CAPTURE_ROOT || path.join(__dirname,'../work'),'command-center-failure.png')}).catch(()=>{}); }
    throw error;
  } finally {
    if(app) await app.evaluate(()=>{globalThis.commandRestoreRelease?.();globalThis.commandSnapshotRelease?.();}).catch(()=>{});
    if(app) await app.close();
    const cleanupTarget=path.resolve(data);
    assert.equal(path.dirname(cleanupTarget),path.resolve(os.tmpdir()),'Cleanup must stay in the temporary directory');
    assert.ok(path.basename(cleanupTarget).startsWith('bf-command-'),'Cleanup must target this test fixture');
    await fs.rm(cleanupTarget,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
