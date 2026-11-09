"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), syncFs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { assertSelectContrast } = require("./select-contrast.cjs");
function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class DirectorUiShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [DirectorUiShortPath]::GetShortPathName($env:BF_DIRECTOR_UI_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,BF_DIRECTOR_UI_PATH:target},encoding:"utf8",timeout:15000}).trim();
  assert.notEqual(alias.toLowerCase(),target.toLowerCase());assert.match(alias,/~\d/);assert.equal(syncFs.statSync(alias).ino,syncFs.statSync(target).ino);return alias;
}
(async()=>{
  const tempRoot=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(tempRoot,"forever-director-ui-"));let app,page;
  const watchdog=setTimeout(()=>{console.error("Director UI fixture exceeded 180 seconds");process.exitCode=1;app?.process().kill();},180000);
  try {
    const normalData=path.join(dir,"synthetic-user-data");await fs.mkdir(normalData);
    const data=process.argv.includes("--short-path")?shortPath(normalData):normalData;
    const game=path.join(dir,"synthetic-client"),saved=path.join(game,"WTF/Account/Synthetic/SavedVariables/BackstageForever.lua");
    await fs.mkdir(path.dirname(saved),{recursive:true});await fs.writeFile(path.join(game,".flavor.info"),"wowf");
    const manual=id=>({id,name:id,realm:"Synthetic Realm",className:"Hunter",level:18,notes:"PRIVATE NOTE SENTINEL",goals:[{id:"g",text:"PRIVATE GOAL SENTINEL",done:false}]});
    await fs.writeFile(path.join(data,"state.json"),JSON.stringify({...defaultState(),onboarded:true,followGameCharacter:false,profiles:[manual("Aeralyn"),{...manual("Vaelric"),className:"Mage"}],activeProfileId:"Aeralyn"}));
    let clock=Date.now()/1000;
    const base={realm:"Synthetic Realm",level:18,updatedAt:clock,clientBuild:"1.15.8.64000",captureVersion:require("../package.json").version,location:{zone:"Synthetic Forest",subZone:"Camp",mapId:1,x:.4,y:.5},history:{recent:[],completedIdsKnown:true,completedIds:[]}};
    const characters=[{...base,id:"Synthetic-Alliance",name:"Aeralyn",className:"Hunter",faction:"Alliance",race:"Synthetic",quests:Array.from({length:6},(_,i)=>({id:101+i,title:i===0?"Return the scout":`Forest objective ${i}`,level:17,zone:"Synthetic Forest",complete:i===0,objectives:[{text:"Observed objective",done:i===0}],destination:{mapId:1,x:.45,y:.55,text:"Game-provided marker"}})),readiness:{bags:{free:2,total:40}}},{...base,id:"Synthetic-Horde",name:"Vaelric",className:"Mage",faction:"Horde",quests:[{id:201,title:"The second journey",complete:false,objectives:[{text:"Observe the trail",done:false}]}]}];
    const write=()=>fs.writeFile(saved,"BackstageForeverExport = "+JSON.stringify(JSON.stringify({schema:1,observedAt:clock,activeId:characters[0].id,characters})));
    await write();
    const launch=async()=>{
      app=await electron.launch({args:[path.join(__dirname,"..")],env:{...process.env,BF_USER_DATA:data},timeout:20000});
      await app.evaluate(({app,dialog})=>{
        const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));
        globalThis.directorUi={inference:0,launches:0,calls:0};
        load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe=async()=>({state:"not-running",launchAvailable:false});
        load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch=async()=>{directorUi.launches++;throw Error("No game launch in fixture");};
        load("./src/core/claude.cjs").status=async()=>({installed:false,loggedIn:false});
        load("./src/core/providers.cjs").ask=async()=>{directorUi.inference++;throw Error("No inference in fixture");};
        dialog.showMessageBox=async()=>({response:1});
      });
      page=await testWindow(app);page.setDefaultTimeout(8000);
      await page.evaluate(()=>localStorage.setItem("bf-setup-v4","complete"));
    };
    await launch();await page.evaluate(root=>window.backstage.prepareGame(root),game);await page.reload();
    await page.getByRole("heading",{name:"Aeralyn",exact:true}).waitFor();
    await page.locator(".companion-dock").waitFor({state:"hidden"});
    const evidence=path.resolve("work/v09-ui-evidence");await fs.mkdir(evidence,{recursive:true});
    const capture=async name=>page.screenshot({path:path.join(evidence,`${process.argv.includes("--short-path")?"short-":""}${name}.png`)});
    const savedState=async()=>(await page.evaluate(()=>window.backstage.bootstrap())).state;
    const untilMain=condition=>app.evaluate(async(_electron,condition)=>{const end=Date.now()+6000;while(!Function(`return (${condition})`)()){if(Date.now()>end)throw Error("Fixture condition timed out: "+condition);await new Promise(r=>setTimeout(r,10));}},condition);
    const adventure=async()=>{await page.getByRole("button",{name:"Adventure",exact:true}).click();await page.locator("[data-director-primary]").waitFor();};
    // RED: these assertions require the real Director view and physical action.
    assert.equal(await page.locator("[data-director-choice]").count(),3,"Director must expose primary and two alternatives");
    assert.match(await page.locator("[data-director-primary]").innerText(),/Return the scout/);
    await capture("alliance");
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
    await page.waitForFunction(()=>innerWidth<=1000);
    await page.evaluate(()=>{scrollTo(0,0);document.querySelector(".main")?.scrollTo(0,0);});
    const primary=page.getByRole("button",{name:"Start quest session",exact:true});
    await capture("compact-red");
    assert.ok(await primary.evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),"Start quest session must be inside the native compact first viewport");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.emulateMedia({reducedMotion:"reduce"});
    assert.equal(await primary.evaluate(n=>getComputedStyle(n).animationName),"none");
    await capture("compact");
    await assertSelectContrast(page,"Director compact shared controls");
    await page.locator("[data-director-primary] summary").click();
    assert.match(await page.locator("[data-director-primary]").innerText(),/Saved game destination.*Game-provided marker/s);
    assert.doesNotMatch(await page.locator("[data-director-primary]").innerText(),/yards|minutes away/);
    await page.locator("[data-director-primary] summary").click();
    // Native keyboard preferences use the one shared control set.
    await page.getByLabel("Session length",{exact:true}).focus();await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");
    await page.waitForFunction(()=>document.querySelector('[data-plan-option="minutes"]').value==="60");
    await page.getByLabel("Session length",{exact:true}).selectOption("30");
    await page.waitForFunction(()=>document.querySelectorAll("[data-director-choice]").length===3);
    await app.evaluate(({ipcMain})=>{
      const start=ipcMain._invokeHandlers.get("backstage:startDirectorSession"),save=ipcMain._invokeHandlers.get("backstage:saveState"),snapshot=ipcMain._invokeHandlers.get("backstage:gameSnapshot");
      ipcMain.removeHandler("backstage:startDirectorSession");ipcMain.handle("backstage:startDirectorSession",async(...args)=>{
        directorUi.calls++;
        if(directorUi.failOnce){directorUi.failOnce=false;throw Error("Synthetic disk write unavailable");}
        const result=await start(...args);directorUi.last=result;
        if(directorUi.holdDirector)await new Promise(resolve=>directorUi.releaseDirector=resolve);
        return result;
      });
      ipcMain.removeHandler("backstage:saveState");ipcMain.handle("backstage:saveState",async(...args)=>{
        const result=await save(...args);
        if(directorUi.holdSave)await new Promise(resolve=>directorUi.releaseSave=resolve);
        return result;
      });
      ipcMain.removeHandler("backstage:gameSnapshot");ipcMain.handle("backstage:gameSnapshot",async(...args)=>{directorUi.polls=(directorUi.polls||0)+1;return snapshot(...args);});
    });
    // A real preceding goal acknowledgement and a real poll cannot swallow one press.
    await app.evaluate(()=>directorUi.holdSave=true);
    await page.locator("[data-goal]").check();await untilMain("Boolean(directorUi.releaseSave)");
    await primary.scrollIntoViewIfNeeded();const box=await primary.boundingBox();
    await page.evaluate(()=>window.pressedDirector=document.querySelector("[data-director-start]"));
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await app.evaluate(()=>{directorUi.holdSave=false;directorUi.releaseSave();});
    const polled=await app.evaluate(()=>directorUi.polls||0);await untilMain(`directorUi.polls>${polled}`);
    assert.ok(await page.evaluate(()=>window.pressedDirector===document.querySelector("[data-director-start]")),"Held physical target must survive preceding acknowledgement and poll");
    await page.mouse.up();
    await page.locator("[data-company-journey]").waitFor();
    assert.equal(await app.evaluate(()=>directorUi.calls),1,"One physical click must produce one session call");
    const state=(await page.evaluate(()=>window.backstage.bootstrap())).state;
    assert.equal(state.journeys.length,1);assert.equal(state.followGameCharacter,false);
    assert.deepEqual(state.journeys[0].steps.map(s=>s.quest.id),[101,102]);
    assert.equal(await page.getByLabel("Plan title",{exact:true}).evaluate(node=>node===document.activeElement),true,"Exact returned journey should receive focus");
    const journeyId=state.journeys[0].id;
    await page.getByLabel("Plan title",{exact:true}).fill("A renamed evening");await page.getByLabel("Plan title",{exact:true}).press("Tab");
    await page.waitForFunction(async()=>((await window.backstage.bootstrap()).state.journeys[0].title==="A renamed evening"));
    await adventure();await page.getByRole("button",{name:"Start quest session",exact:true}).click();await page.locator("[data-company-journey]").waitFor();
    assert.equal((await savedState()).journeys.length,1);assert.equal((await savedState()).journeys[0].id,journeyId);
    assert.match(await page.getByRole("status").innerText(),/existing quest session/);
    assert.equal(await page.getByLabel("Plan title",{exact:true}).inputValue(),"A renamed evening");
    // Fail once before the real handler: error is visible and a single retry reuses.
    await adventure();await app.evaluate(()=>directorUi.failOnce=true);
    await page.getByRole("button",{name:"Start quest session",exact:true}).click();await page.getByRole("alert").waitFor();
    await page.getByRole("alert").scrollIntoViewIfNeeded();await capture("error");
    await page.getByRole("button",{name:"Retry quest session",exact:true}).click();await page.locator("[data-company-journey]").waitFor();assert.equal((await savedState()).journeys.length,1);
    // Same-ID saved observations do not erase a dirty journal or its caret range.
    await adventure();const goal=page.getByLabel("New goal",{exact:true});await goal.fill("LOCAL UNSAVED DRAFT");
    await goal.evaluate(n=>{window.goalBeforePoll=n;n.focus();n.setSelectionRange(2,7);});
    clock+=2;characters[0].updatedAt=clock;characters[0].quests[1].title="Updated forest observation";await write();await page.evaluate(()=>window.backstage.refreshGame());
    const pollBefore=await app.evaluate(()=>directorUi.polls||0);await untilMain(`directorUi.polls>${pollBefore}`);
    assert.ok(await goal.evaluate(n=>n===window.goalBeforePoll));assert.equal(await goal.inputValue(),"LOCAL UNSAVED DRAFT");assert.deepEqual(await goal.evaluate(n=>[n.selectionStart,n.selectionEnd]),[2,7]);
    const first=state.activeProfileId,second=(await savedState()).profiles.find(p=>p.name==="Vaelric").id;
    await page.getByLabel("Active character",{exact:true}).selectOption(second);await page.getByRole("heading",{name:"Vaelric",exact:true}).waitFor();
    assert.equal(await page.getByLabel("New goal",{exact:true}).inputValue(),"");await page.evaluate(()=>{scrollTo(0,0);document.querySelector(".main")?.scrollTo(0,0);});await capture("horde");
    await page.getByLabel("Active character",{exact:true}).selectOption(first);await page.getByRole("heading",{name:"Aeralyn",exact:true}).waitFor();
    assert.equal(await page.getByLabel("New goal",{exact:true}).inputValue(),"LOCAL UNSAVED DRAFT");
    await page.getByRole("button",{name:"Explain my plan",exact:true}).click();
    const draft=await page.getByLabel("Your question",{exact:true}).inputValue();assert.match(draft,/Return the scout/);assert.doesNotMatch(draft,/PRIVATE|LOCAL UNSAVED|sourceHash/);
    assert.equal(await app.evaluate(()=>directorUi.inference),0);
    // Pending duplicate presses and a newer intentional character selection.
    await adventure();await app.evaluate(()=>{directorUi.holdDirector=true;directorUi.releaseDirector=null;directorUi.beforeCalls=directorUi.calls;});
    await page.getByRole("button",{name:"Start quest session",exact:true}).click();await untilMain("Boolean(directorUi.releaseDirector)");
    assert.equal(await page.getByRole("button",{name:"Saving quest session…",exact:true}).isDisabled(),true);
    const pendingBox=await page.locator("[data-director-start]").boundingBox();await page.mouse.click(pendingBox.x+10,pendingBox.y+10,{clickCount:2});
    assert.equal(await app.evaluate(()=>directorUi.calls-directorUi.beforeCalls),1);
    await page.getByLabel("Active character",{exact:true}).selectOption(second);await page.getByRole("heading",{name:"Vaelric",exact:true}).waitFor();
    await app.evaluate(()=>{directorUi.holdDirector=false;directorUi.releaseDirector();});
    await page.waitForFunction(()=>document.querySelector('[aria-current="page"]')?.dataset.nav==="adventure");
    assert.equal((await savedState()).activeProfileId,second);assert.equal(await page.getByLabel("Active character",{exact:true}).inputValue(),second);
    assert.equal((await savedState()).journeys.length,2,"Accepted session persists even when its response can no longer paint");
    // A queued navigation invalidates presentation before waiting for the ack.
    await page.getByLabel("Active character",{exact:true}).selectOption(first);await page.getByRole("heading",{name:"Aeralyn",exact:true}).waitFor();
    await app.evaluate(()=>{directorUi.holdDirector=true;directorUi.releaseDirector=null;});
    await page.getByRole("button",{name:"Start quest session",exact:true}).click();await untilMain("Boolean(directorUi.releaseDirector)");
    await page.getByRole("button",{name:"Field Guide",exact:true}).click();
    await app.evaluate(()=>{directorUi.holdDirector=false;directorUi.releaseDirector();});
    await page.waitForFunction(()=>document.querySelector('[aria-current="page"]')?.dataset.nav==="guide");
    assert.equal(await page.locator("[data-company]").count(),0,"Late accepted session cannot jump back over explicit navigation");
    // Actual restart retains sessions and options; starting again reuses the exact baseline.
    await app.close();app=null;await launch();await page.getByRole("heading",{name:"Aeralyn",exact:true}).waitFor();
    await page.getByRole("button",{name:"Start quest session",exact:true}).click();await page.locator("[data-company-journey]").first().waitFor();
    assert.equal((await savedState()).journeys.length,2);assert.match(await page.getByRole("status").innerText(),/existing quest session/);
    // A deliberate import replaces the same profile ID and all Director evidence.
    const imported=await savedState();imported.profiles.find(p=>p.id===first).quests=[];
    const backup=path.join(dir,"replacement.json");await fs.writeFile(backup,JSON.stringify(imported));
    await app.evaluate(({dialog},backup)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});},backup);
    await page.getByRole("button",{name:"Field Guide",exact:true}).click();await page.getByRole("button",{name:"Import backup",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Backup imported."}).waitFor();await page.getByRole("button",{name:"Adventure",exact:true}).click();
    await page.getByRole("heading",{name:"Room for a new chapter.",exact:true}).waitFor();
    assert.equal(await page.locator("[data-director-choice]").count(),0);assert.equal(await page.getByRole("button",{name:"Start quest session",exact:true}).isDisabled(),true);
    await page.evaluate(()=>{scrollTo(0,0);document.querySelector(".main")?.scrollTo(0,0);});await capture("empty");
    // Reset is actual trusted replacement. Plan without a character remains usable.
    await page.getByRole("button",{name:"Field Guide",exact:true}).click();await page.getByRole("button",{name:"Delete all local data",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Local data and saved keys deleted."}).waitFor();assert.deepEqual((await savedState()).profiles,[]);
    await page.getByRole("button",{name:"Plan without a character",exact:true}).click();
    await page.getByRole("button",{name:"Adventure",exact:true}).click();await page.locator("[data-director]").waitFor();
    assert.equal(await page.getByRole("button",{name:"Start quest session",exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole("button",{name:"Open Company · plan manually →",exact:true}).count(),1);
    await page.locator("[data-director]").scrollIntoViewIfNeeded();await capture("no-characters");
    assert.deepEqual(await app.evaluate(()=>({inference:directorUi.inference,launches:directorUi.launches})),{inference:0,launches:0});
    console.log(`Director UI source Electron ${process.argv.includes("--short-path")?"genuine 8.3":"normal"}: choices/source, compact/reduced-motion, one held physical click/preceding ack/poll, reuse/rename/retry, drafts/selection, pending/late navigation, restart/import/reset/privacy PASS`);
  } finally {
    clearTimeout(watchdog);await app?.close();const resolved=await fs.realpath(dir);
    assert.equal(path.dirname(resolved).toLowerCase(),tempRoot.toLowerCase());assert.ok(path.basename(resolved).startsWith("forever-director-ui-"));await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
