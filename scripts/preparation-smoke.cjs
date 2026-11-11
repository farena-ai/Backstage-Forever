"use strict";
const { syntheticLaunch } = require("./synthetic-coach-bootstrap.cjs");
const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), syncFs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const {currentControlState}=require("./selection-fixture.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { assertSelectContrast } = require("./select-contrast.cjs");
function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class PreparationUiShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [PreparationUiShortPath]::GetShortPathName($env:BF_PREPARATION_UI_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,BF_PREPARATION_UI_PATH:target},encoding:"utf8",timeout:15000}).trim();
  assert.notEqual(alias.toLowerCase(),target.toLowerCase());assert.match(alias,/~\d/);assert.equal(syncFs.statSync(alias).ino,syncFs.statSync(target).ino);return alias;
}
(async()=>{
  const tempRoot=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(tempRoot,"forever-preparation-ui-"));let app,page;
  const watchdog=setTimeout(()=>{console.error("Preparation UI fixture exceeded 180 seconds");process.exitCode=1;app?.process().kill();},180000);
  try {
    const normalData=path.join(dir,"synthetic-user-data");await fs.mkdir(normalData);
    const data=process.argv.includes("--short-path")?shortPath(normalData):normalData;
    const game=path.join(dir,"synthetic-client"),saved=path.join(game,"WTF/Account/Synthetic/SavedVariables/BackstageForever.lua");
    await fs.mkdir(path.dirname(saved),{recursive:true});await fs.writeFile(path.join(game,".flavor.info"),"wowf");
    const manual=id=>({id,name:id,realm:"Synthetic Realm",className:"Hunter",level:18,notes:"PRIVATE NOTE SENTINEL",goals:[{id:"g",text:"PRIVATE GOAL SENTINEL",done:false}]});
    await fs.writeFile(path.join(data,"state.json"),JSON.stringify({...defaultState(),onboarded:true,followGameCharacter:false,profiles:[manual("Aeralyn"),{...manual("Vaelric"),className:"Mage"}],activeProfileId:"Aeralyn",provider:{...defaultState().provider,model:"synthetic-model"}}));
    let clock=Math.floor(Date.now()/1000);
    const col=items=>({observedAt:clock,complete:true,items});
    const workshop=count=>({professions:col([{skillLineId:171,professionId:1,name:"Alchemy",rank:22,maxRank:75}]),recipes:col([{id:100,skillLineId:171,name:"Amber restorative",canSkillUp:true,reagentsKnown:true,reagents:[{itemId:200,name:"Sunleaf",required:3},{itemId:201,name:"Clear vial",required:1},{itemId:2320,name:"Coarse Thread",required:1}]},{id:101,skillLineId:171,name:"Silverleaf infusion",canSkillUp:true,reagentsKnown:true,reagents:[{itemId:200,name:"Sunleaf",required:2}]},{id:102,skillLineId:171,name:"Unresolved formula",reagentsKnown:false,reagents:[]}]),materials:{...col([{itemId:200,name:"Sunleaf",count},{itemId:201,name:"Clear vial",count:1},{itemId:2320,name:"Coarse Thread",count:20}]),scope:"bags-0-4"}});
    const characters=["Aeralyn","Vaelric"].map((name,i)=>({id:`Synthetic-${name}`,name,realm:"Synthetic Realm",className:i?"Mage":"Hunter",faction:i?"Horde":"Alliance",race:"Synthetic",level:18,updatedAt:clock,clientBuild:"1.60.1.70862",captureVersion:require("../package.json").version,readiness:{bags:{free:4,total:40},workshop:workshop(i?99:2)}}));
    const write=()=>fs.writeFile(saved,"BackstageForeverExport = "+JSON.stringify(JSON.stringify({schema:1,observedAt:clock,activeId:characters[0].id,characters})));
    await write();
    const launch=async()=>{
      app=await electron.launch({args:[await syntheticLaunch(data)],env:{...process.env,BF_USER_DATA:data},timeout:20000});
      await app.evaluate(({app,dialog})=>{
        const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));
        globalThis.preparationUi={inference:0,launches:0,calls:0};
        load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe=async()=>({state:"not-running",launchAvailable:false});
        load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch=async()=>{preparationUi.launches++;throw Error("Fixture blocks launch");};
        load("./src/core/claude.cjs").status=async()=>({installed:false,loggedIn:false});
        load("./src/core/providers.cjs").ask=async request=>{if(!preparationUi.allowAsk){preparationUi.inference++;throw Error("Fixture blocks inference");}preparationUi.fakeAsks=(preparationUi.fakeAsks||0)+1;preparationUi.sent={prompt:request.prompt,context:request.context};return "Fictional supply review. Partial counts cannot prove shortfalls, and historical sellers do not guarantee access.";};
        load("./src/core/voice.cjs").VoiceService.prototype.readCapabilities=async()=>({status:"unavailable",recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]},message:"Synthetic voice unavailable; typed draft remains editable."});
        dialog.showMessageBox=async()=>({response:1});
      });
      page=await testWindow(app);page.setDefaultTimeout(8000);
      await app.evaluate(({ipcMain})=>{const snapshot=ipcMain._invokeHandlers.get("backstage:gameSnapshot");ipcMain.removeHandler("backstage:gameSnapshot");ipcMain.handle("backstage:gameSnapshot",async(...args)=>{preparationUi.polls=(preparationUi.polls||0)+1;return snapshot(...args);});});
      await page.evaluate(()=>localStorage.setItem("bf-setup-v4","complete"));
    };
    await launch();await page.evaluate(root=>window.backstage.prepareGame(root),game);await page.reload();
    await page.getByRole("heading",{name:"Aeralyn",exact:true}).waitFor();
    // RED requires the real page after a genuine synthetic saved recipe/shortfall.
    const initial=(await page.evaluate(()=>window.backstage.bootstrap())).state;
    await page.evaluate(id=>Preparation.save(id,{recipeId:100,crafts:1}),initial.activeProfileId);
    assert.equal((await page.evaluate(id=>window.backstage.preparationBrief(id,{recipeId:100,crafts:2}),initial.activeProfileId)).shoppingRows[0].missing,4);
    await navigate(page,"preparation");assert.equal(await page.getByRole("button",{name:"Professions",exact:true}).count(),1,"Preparation navigation must exist for the saved workshop");
    await navigate(page, "preparation");await page.locator("[data-preparation-reagent]").first().waitFor();
    assert.match(await page.locator("[data-preparation]").innerText(),/Amber restorative/);

    const evidence=path.resolve(process.env.BF_SMOKE_CAPTURE_ROOT || "work/v012-preparation-ui-evidence");await fs.mkdir(evidence,{recursive:true});
    const capture=async name=>{await page.locator("#toast.visible").waitFor({state:"hidden",timeout:8000});await page.evaluate(()=>{scrollTo(0,0);document.querySelector(".main")?.scrollTo(0,0);});await page.screenshot({path:path.join(evidence,`${process.argv.includes("--short-path")?"short-":""}${name}.png`),fullPage:true});};
    const state=async()=>(await page.evaluate(()=>window.backstage.bootstrap())).state;
    const untilMain=condition=>app.evaluate(async(_e,condition)=>{const end=Date.now()+6000;while(!Function(`return (${condition})`)()){if(Date.now()>end)throw Error("Fixture condition timed out: "+condition);await new Promise(r=>setTimeout(r,10));}},condition);
    const workshopPage=async()=>{await navigate(page, "preparation");await page.locator("[data-preparation-reagent]").first().waitFor();};
    const update=async()=>{clock+=2;characters[0].updatedAt=clock;await write();await page.evaluate(()=>window.backstage.refreshGame());};
    const first=initial.activeProfileId,second=initial.profiles.find(p=>p.name==="Vaelric").id;
    const readRetryFocus=async()=>{
      // Hold the real main-owned brief after it reads the synthetic saved source.
      await app.evaluate(({ipcMain})=>{
        const read=ipcMain._invokeHandlers.get("backstage:professionCoach");
        ipcMain.removeHandler("backstage:professionCoach");
        ipcMain.handle("backstage:professionCoach",async(...args)=>{
          if(preparationUi.retryReadError)throw Error("Synthetic read error");
          const result=await read(...args);
          if(preparationUi.holdRetryRead)await new Promise(resolve=>preparationUi.retryReaders.push(resolve));
          return result;
        });
        preparationUi.retryReaders=[];preparationUi.retryReadError=true;
      });
      const beforeJourneys=(await state()).journeys.length;
      await update();await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("button",{name:"Ask about this supply plan",exact:true}).isDisabled(),true,"Replaced-source read failure must not authorize a new draft from old facts");
      if(!process.argv.includes("--read-retry-only"))await capture("read-error");
      const action=()=>page.locator("[data-preparation-add]").first().evaluate(n=>JSON.parse(n.dataset.preparationChoice));
      const waitForRetryPaint=previous=>page.waitForFunction(previous=>{
        const node=document.querySelector("[data-preparation-add]");
        if(!node||node.disabled||document.querySelector("[data-preparation] [role=alert]"))return false;
        const current=JSON.parse(node.dataset.preparationChoice);
        return current.profileId===previous.profileId&&current.generation===previous.generation&&current.sourceRevision>previous.sourceRevision;
      },previous);
      const beginRetry=async()=>{
        const previous=await action();
        await app.evaluate(()=>{preparationUi.retryReadError=false;preparationUi.holdRetryRead=true;});
        await page.getByRole("button",{name:"Retry workshop",exact:true}).click();
        await untilMain("preparationUi.retryReaders.length===1");
        // This is the old CI wait: it succeeds while this retry reply is still held.
        await page.locator("[data-preparation-reagent]").first().waitFor();
        assert.equal((await action()).sourceRevision,previous.sourceRevision,"Existing rows belong to the error paint, not the retry reply");
        assert.equal((await currentControlState(page,"[data-preparation] [data-preparation-control=\"retry-read\"]")).focused,true,"A pending read has not completed its focus handoff");
        return previous;
      };
      const releaseRetry=()=>app.evaluate(()=>{preparationUi.holdRetryRead=false;preparationUi.retryReaders.splice(0).forEach(resolve=>resolve());});
      const previous=await beginRetry();
      await releaseRetry();await waitForRetryPaint(previous);
      assert.equal((await currentControlState(page,"[data-preparation] [data-preparation-control=\"add\"]")).focused,true,"Successful read retry returns focus to the semantic action");
      // A later deliberate focus owns the keyboard even when completion paint is deferred.
      await app.evaluate(()=>preparationUi.retryReadError=true);await update();await page.getByRole("alert").waitFor();
      const later=await beginRetry();
      const sources=page.locator('[data-preparation-control="sources"]');await sources.focus();await page.keyboard.down("Space");
      await releaseRetry();
      await page.waitForFunction(()=>!Preparation.page().includes('role="alert"'));
      assert.equal(await page.getByRole("alert").count(),1,"The held native key defers successful replacement paint");
      await page.keyboard.up("Space");await waitForRetryPaint(later);
      assert.equal((await currentControlState(page,"[data-preparation] [data-preparation-control=sources]")).focused,true,"Successful read retry must preserve newer deliberate focus");
      console.log("Preparation retry: stale rows witnessed during held genuine reply; current successful paint restores Add and preserves newer native Summary focus PASS");
      assert.equal((await state()).journeys.length,beforeJourneys,"Read retry does not create a checklist");
    };
    if(process.argv.includes("--read-retry-only")){
      await readRetryFocus();console.log("Preparation read-retry focused fixture PASS");return;
    }

    assert.equal(await page.getByRole('button',{name:'Ask about this supply plan',exact:true}).count(),1,"Supply-plan draft action must be explicit");
    assert.match(await page.locator('[data-preparation]').innerText(),/Historical seller observations/i);
    console.log("Preparation: saved source and navigation ready");await capture("alliance-full");
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));await page.waitForFunction(()=>innerWidth<=1000);
    let add=page.getByRole("button",{name:"Add shopping checklist",exact:true});
    await capture("alliance-compact");
    assert.ok(await add.evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),"Primary action must fit the compact first viewport: "+JSON.stringify(await add.boundingBox()));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const rail=page.locator(".rail");assert.ok(await rail.evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight));
    await page.getByRole("button",{name:"Help",exact:true}).scrollIntoViewIfNeeded();assert.ok(await page.getByRole("button",{name:"Help",exact:true}).isVisible());
    assert.ok(await page.getByRole("button",{name:"Settings",exact:true}).evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight),"Settings must remain reachable beneath the scrolling navigation");
    await workshopPage();await assertSelectContrast(page,"Preparation compact native controls");
    await page.emulateMedia({reducedMotion:"reduce"});assert.equal(await add.evaluate(n=>getComputedStyle(n).animationName),"none");
    await page.getByLabel("Craft attempts",{exact:true}).focus();await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");
    await page.waitForFunction(()=>document.querySelector('[data-preparation-reagent="200"] .reagent-copy>span b')?.textContent==="6");
    assert.match(await page.locator('[data-preparation-reagent="200"]').innerText(),/4\s*shortfall/);assert.match(await page.locator(".workshop-supply-summary").innerText(),/2 material shortfalls/);
    await page.getByLabel("Saved recipe",{exact:true}).selectOption("101");await page.waitForFunction(()=>document.querySelector(".formula-heading h2")?.textContent==="Silverleaf infusion");
    assert.equal((await state()).profiles[0].readiness.workshop.materials.items[0].count,2,"Display preferences must not rewrite evidence");
    await page.getByLabel("Saved recipe",{exact:true}).selectOption("100");await page.waitForFunction(()=>document.querySelector(".formula-heading h2")?.textContent==="Amber restorative");
    // Seller facts stay historical and browse-only when this faction was not observed.
    const thread=page.locator('[data-preparation-reagent="2320"]');await thread.locator('summary').evaluateAll(nodes=>nodes.forEach(n=>n.parentElement.open=true));
    assert.match(await thread.innerText(),/Browse only.*not a recommendation/i);assert.match(await thread.innerText(),/faction access unknown/i);assert.match(await thread.innerText(),/Approximate interaction/);
    assert.equal(await thread.locator('[data-quest-copy]').count(),0);await capture('historical-sellers-alliance');
    // Deliberate draft shares only the visible selected plan and never changes sharing opt-out.
    await navigate(page, "assistant");await page.getByLabel('Use my active character',{exact:true}).uncheck();
    await workshopPage();const askSupply=page.getByRole('button',{name:'Ask about this supply plan',exact:true});await askSupply.click();
    const question=page.getByLabel('Your question',{exact:true});await question.waitFor();const supplyDraft=await question.inputValue();
    assert.match(supplyDraft,/Amber restorative/);assert.match(supplyDraft,/Coarse Thread/);assert.match(supplyDraft,/bags 0–4/);assert.match(supplyDraft,/saved source/i);assert.match(supplyDraft,/Browse only, not a recommendation/);assert.match(supplyDraft,/faction access unknown/);assert.ok(supplyDraft.length<=12000);
    assert.doesNotMatch(supplyDraft,/Vaelric|PRIVATE|Synthetic-Aeralyn|equipment|journeys/);assert.ok(!supplyDraft.includes(game)&&!supplyDraft.includes(saved));
    assert.equal(await page.getByLabel('Use my active character',{exact:true}).isChecked(),false);assert.equal(await app.evaluate(()=>preparationUi.fakeAsks||0),0);assert.equal(await page.locator('.context-preview pre').count(),0);
    await question.fill(supplyDraft+'\nMy deliberate edit: suggest checks, not purchases.');await capture('supply-editable-draft');await app.evaluate(()=>preparationUi.allowAsk=true);await page.getByRole('button',{name:'Send question',exact:true}).click();await page.locator('.message.assistant').waitFor();await app.evaluate(()=>preparationUi.allowAsk=false);
    const sent=await app.evaluate(()=>preparationUi.sent);assert.equal(sent.prompt,supplyDraft+'\nMy deliberate edit: suggest checks, not purchases.');assert.ok(!sent.context);assert.equal(await app.evaluate(()=>preparationUi.fakeAsks),1);
    await workshopPage();assert.equal(await page.locator('.workshop-sellers[open]').count(),0,'Leaving the workshop retires old disclosure presentation');
    // The real native Summary target survives a held key and a competing root paint.
    const summary=page.locator('[data-preparation-control="sources"]');await summary.focus();await summary.evaluate(n=>{window.heldSummary=n;window.summaryToggles=0;n.parentElement.addEventListener("toggle",()=>window.summaryToggles++);});
    await page.keyboard.down("Space");await page.evaluate(()=>new Promise(r=>setTimeout(()=>{render();r();},0)));assert.ok(await summary.evaluate(n=>n===window.heldSummary));await page.keyboard.up("Space");
    await page.waitForFunction(()=>window.summaryToggles===1);assert.equal((await currentControlState(page,"[data-preparation] [data-preparation-control=sources]",{disclosure:true})).open,true);assert.equal((await currentControlState(page,"[data-preparation] [data-preparation-control=sources]")).focused,true);
    // A held native menu survives source refresh; newest counts appear after closure.
    const select=page.getByLabel("Saved recipe",{exact:true});await select.click();
    const beforeNativePoll=await app.evaluate(()=>preparationUi.polls||0);await select.evaluate(n=>window.heldRecipe=n);characters[0].readiness.workshop.materials.items[0].count=5;characters[0].readiness.workshop.materials.observedAt=clock+2;await update();
    await untilMain(`preparationUi.polls>${beforeNativePoll}`);assert.ok(await select.evaluate(n=>n===window.heldRecipe),"Native recipe control survives saved-source refresh");await page.keyboard.press("Enter");await page.getByLabel("Craft attempts",{exact:true}).focus();
    await page.getByLabel("Saved recipe",{exact:true}).selectOption("100");await page.waitForFunction(()=>document.querySelector('[data-preparation-reagent="200"]')?.innerText.includes("1\nshortfall"));
    await app.evaluate(({ipcMain})=>{
      const original=ipcMain._invokeHandlers.get("backstage:createPreparationJourney");
      ipcMain.removeHandler("backstage:createPreparationJourney");ipcMain.handle("backstage:createPreparationJourney",async(...args)=>{
        preparationUi.calls++;if(preparationUi.failOnce){preparationUi.failOnce=false;throw Error("Synthetic unavailable write");}
        const result=await original(...args);preparationUi.last=result;
        if(preparationUi.hold)await new Promise(r=>preparationUi.release=r);return result;
      });
      const read=ipcMain._invokeHandlers.get("backstage:professionCoach");
      ipcMain.removeHandler("backstage:professionCoach");ipcMain.handle("backstage:professionCoach",async(...args)=>{if(preparationUi.failRead){throw Error("Synthetic read error");}return read(...args);});
    });
    // A dirty local note and caret survive newer source evidence; no provider call.
    await page.getByRole("button",{name:"Characters",exact:true}).click();const notes=page.locator('textarea[name="notes"]');await notes.fill("PRIVATE LOCAL UNSAVED DRAFT");await notes.evaluate(n=>{window.dirtyNotes=n;n.focus();n.setSelectionRange(2,7);});
    const draftPoll=await app.evaluate(()=>preparationUi.polls||0);await update();await untilMain(`preparationUi.polls>${draftPoll}`);assert.ok(await notes.evaluate(n=>n===window.dirtyNotes));assert.equal(await notes.inputValue(),"PRIVATE LOCAL UNSAVED DRAFT");assert.deepEqual(await currentControlState(page,"#character-form textarea[name=\"notes\"]",{selection:true}),{focused:true,value:"PRIVATE LOCAL UNSAVED DRAFT",start:2,end:7});await workshopPage();
    // Hold a genuine preceding state save acknowledgement in the existing queue.
    await app.evaluate(({ipcMain})=>{const save=ipcMain._invokeHandlers.get("backstage:saveState");ipcMain.removeHandler("backstage:saveState");ipcMain.handle("backstage:saveState",async(...args)=>{const result=await save(...args);if(preparationUi.holdSave)await new Promise(r=>preparationUi.releaseSave=r);return result;});preparationUi.holdSave=true;});
    await page.evaluate(()=>{autosaveQueue=autosaveQueue.then(()=>persist(editedState(next=>{next.profiles.find(p=>p.id===next.activeProfileId).notes="PRIVATE QUEUED SAVE";})));});await untilMain("Boolean(preparationUi.releaseSave)");
    // A physical press across a preceding acknowledgement and root paint creates exactly one manual checklist.
    await add.scrollIntoViewIfNeeded();const box=await add.boundingBox();await page.evaluate(()=>window.heldAdd=document.querySelector("[data-preparation-add]"));await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await app.evaluate(()=>{preparationUi.holdSave=false;preparationUi.releaseSave();});await page.evaluate(()=>autosaveQueue);
    const heldPoll=await app.evaluate(()=>preparationUi.polls||0);await untilMain(`preparationUi.polls>${heldPoll}`);
    await page.evaluate(()=>new Promise(r=>setTimeout(()=>{render();r();},0)));assert.ok(await page.evaluate(()=>window.heldAdd===document.querySelector("[data-preparation-add]")));await page.mouse.up();
    await page.locator("[data-company-journey]").waitFor();assert.equal(await app.evaluate(()=>preparationUi.calls),1);let savedNow=await state();assert.equal(savedNow.journeys.length,1);assert.equal(savedNow.followGameCharacter,false);assert.ok(savedNow.journeys[0].steps.every(s=>!s.done&&!s.quest&&!s.observed));
    assert.equal((await currentControlState(page,{selector:'[data-company-edit="title"][aria-label="Plan title"]',scope:{selector:"[data-company-journey]",attribute:"data-company-journey",value:savedNow.journeys[0].id}})).focused,true,"Exact returned checklist receives focus");assert.match(savedNow.journeys[0].steps[0].text,/shortfall: 1/);
    // Mutation error retry is deliberate and never makes a duplicate successful call.
    await workshopPage();await app.evaluate(()=>preparationUi.failOnce=true);await add.click();await page.getByRole("alert").waitFor();assert.equal((await currentControlState(page,"[data-preparation] [data-preparation-control=\"retry-add\"]")).focused,true,"Failed action must transfer its owned focus to semantic retry");await capture("mutation-error");await page.getByRole("button",{name:"Retry shopping checklist",exact:true}).click();await page.locator("[data-company-journey]").first().waitFor();assert.equal((await state()).journeys.length,2);
    // Read errors have a separate explicit retry without a checklist mutation.
    await workshopPage();await readRetryFocus();
    // Partial supply creates manual totals, never an invented exact missing amount.
    characters[0].readiness.workshop.materials.complete=false;characters[0].readiness.workshop.materials.observedAt=clock+2;await update();await workshopPage();await page.waitForFunction(()=>document.querySelector('[data-preparation-reagent="200"]')?.innerText.includes("Shortfall unknown"));
    assert.match(await page.locator('[data-preparation-reagent="200"]').innerText(),/At least 5/);await capture("partial");await add.focus();await page.keyboard.press("Space");await page.locator("[data-company-journey]").first().waitFor();savedNow=await state();assert.equal(savedNow.journeys.length,3);assert.match(savedNow.journeys.at(-1).steps[0].text,/incomplete or unknown/);assert.match(savedNow.journeys.at(-1).steps[1].text,/total required: 6/);
    console.log("Preparation: physical ack/click/key, read/write retry and partial checklist passed");
    // A later partial-supply draft is an editable question, never a fabricated exact shortfall.
    await workshopPage();await page.getByRole('button',{name:'Ask about this supply plan',exact:true}).click();const partialQuestion=await page.getByLabel('Your question',{exact:true}).inputValue();assert.match(partialQuestion,/Shortfall unknown/);assert.match(partialQuestion,/lower-bound/);assert.doesNotMatch(partialQuestion,/Vaelric|PRIVATE/);assert.equal(await app.evaluate(()=>preparationUi.fakeAsks),1);await workshopPage();
    // A missing material collection stays unknown rather than becoming zero inventory.
    delete characters[0].readiness.workshop.materials;await update();await workshopPage();await page.waitForFunction(()=>document.querySelector('[data-preparation-reagent="200"]')?.innerText.includes("Unknown"));assert.match(await page.locator(".workshop-supply-summary").innerText(),/Supply check needed/);assert.equal(await add.isEnabled(),true);await capture("unknown-supply");characters[0].readiness.workshop.materials={...col([{itemId:200,name:"Sunleaf",count:5}]),complete:false,scope:"bags-0-4"};await update();
    // Another character keeps independent options and counted supply, not pooled stock.
    await workshopPage();await page.evaluate(id=>Preparation.save(id,{recipeId:100,crafts:1}),second);await page.getByLabel("Active character",{exact:true}).selectOption(second);await page.waitForFunction(()=>document.querySelector(".workshop-hero-copy p")?.textContent.includes("Vaelric"));await capture("horde-compact");assert.equal(await page.getByLabel("Craft attempts",{exact:true}).inputValue(),"1");
    await page.getByLabel("Craft attempts",{exact:true}).selectOption("3");await page.waitForFunction(()=>document.querySelector('[data-preparation-reagent="200"] .reagent-copy>span b')?.textContent==="9");
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));await capture("horde-full");
    await page.getByLabel("Active character",{exact:true}).selectOption(first);await page.waitForFunction(()=>document.querySelector(".workshop-hero-copy p")?.textContent.includes("Aeralyn"));assert.equal(await page.getByLabel("Craft attempts",{exact:true}).inputValue(),"2");
    // Accepted writes survive a later intentional selection, without late navigation.
    await app.evaluate(()=>{preparationUi.hold=true;preparationUi.release=null;preparationUi.before=preparationUi.calls;});await add.click();await untilMain("Boolean(preparationUi.release)");assert.equal(await page.getByRole("button",{name:"Saving shopping checklist…",exact:true}).isDisabled(),true);
    await page.getByLabel("Active character",{exact:true}).selectOption(second,{timeout:8000,noWaitAfter:true}).catch(()=>{});
    await app.evaluate(()=>{preparationUi.hold=false;preparationUi.release();});await page.waitForFunction(()=>document.querySelector(".workshop-hero-copy p")?.textContent.includes("Vaelric"));assert.equal((await state()).journeys.length,4);assert.equal(await app.evaluate(()=>preparationUi.calls-preparationUi.before),1);assert.equal((await state()).activeProfileId,second);
    await app.evaluate(()=>{preparationUi.hold=true;preparationUi.release=null;});await add.click();await untilMain("Boolean(preparationUi.release)");await page.getByRole("button",{name:"Help",exact:true}).click({noWaitAfter:true});await app.evaluate(()=>{preparationUi.hold=false;preparationUi.release();});await page.waitForFunction(()=>document.querySelector('[aria-current="page"]')?.dataset.nav==="guide");assert.equal((await state()).journeys.length,5);assert.equal(await page.locator("[data-company]").count(),0);
    assert.deepEqual(await app.evaluate(()=>({inference:preparationUi.inference,launches:preparationUi.launches})),{inference:0,launches:0});
    // Restart proves local recipe/attempt preferences, while sources remain main-owned.
    await app.close();app=null;await launch();add=page.getByRole("button",{name:"Add shopping checklist",exact:true});await page.getByRole("heading",{name:"Vaelric",exact:true}).waitFor();await workshopPage();assert.equal(await page.getByLabel("Craft attempts",{exact:true}).inputValue(),"3");
    await page.getByLabel("Active character",{exact:true}).selectOption(first);await page.waitForFunction(()=>document.querySelector(".workshop-hero-copy p")?.textContent.includes("Aeralyn"));
    // Selected recipes disappearing and orphaned professions are explicit, no fallback.
    characters[0].readiness.workshop.recipes.items=characters[0].readiness.workshop.recipes.items.filter(r=>r.id!==100);await update();await page.getByRole("option",{name:"Selected recipe no longer observed",exact:true}).waitFor({state:"attached"});assert.equal(await add.isDisabled(),true);assert.match(await page.locator("[data-preparation]").innerText(),/no longer|not.*observed|unavailable/i);await capture("missing-recipe");
    characters[0].readiness.workshop=workshop(5);characters[0].readiness.workshop.professions.items=[];await update();await page.waitForFunction(()=>document.querySelector("[data-preparation]")?.innerText.includes("currently observed owned profession"));assert.equal(await add.isDisabled(),true);
    characters[0].readiness.workshop=workshop(5);characters[0].readiness.workshop.recipes.items[0].reagentsKnown=false;characters[0].readiness.workshop.recipes.items[0].reagents=[];await update();await page.waitForFunction(()=>document.querySelector("[data-preparation]")?.innerText.includes("unknown or ambiguous"));assert.equal(await add.isDisabled(),true);await capture("unknown-requirements");
    // R1: changed native choices cannot submit the previous model while a read waits.
    characters[0].readiness.workshop=workshop(5);await update();await page.waitForFunction(()=>document.querySelector('[data-preparation-add]')?.disabled===false);
    await page.getByLabel("Craft attempts",{exact:true}).selectOption("1");
    const displayed=async(recipeId,crafts)=>page.waitForFunction(({recipeId,crafts})=>{const n=document.querySelector('[data-preparation-add]');if(!n||n.disabled)return false;const v=JSON.parse(n.dataset.preparationChoice||'{}');return v.recipeId===recipeId&&v.crafts===crafts;},{recipeId,crafts});
    await displayed(100,1);const beforeChoiceJourneys=(await state()).journeys.length;
    await app.evaluate(({ipcMain})=>{
      preparationUi.choiceCalls=[];preparationUi.choiceReaders=[];
      const create=ipcMain._invokeHandlers.get("backstage:createPreparationJourney"),read=ipcMain._invokeHandlers.get("backstage:professionCoach");
      ipcMain.removeHandler("backstage:createPreparationJourney");ipcMain.handle("backstage:createPreparationJourney",async(...args)=>{preparationUi.choiceCalls.push({profileId:args[1],options:args[2]});return create(...args);});
      ipcMain.removeHandler("backstage:professionCoach");ipcMain.handle("backstage:professionCoach",async(...args)=>{const result=await read(...args);if(preparationUi.holdChoice)await new Promise(resolve=>preparationUi.choiceReaders.push(resolve));if(args[2].recipeId===undefined&&result.selection.recipeId===101)preparationUi.defaultRefreshSeen=true;return result;});
      preparationUi.holdChoice=true;
    });
    await page.getByLabel("Saved recipe",{exact:true}).click();await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");
    await untilMain("preparationUi.choiceReaders.length>=1");assert.equal(await page.getByLabel("Saved recipe",{exact:true}).inputValue(),"101");assert.equal(await add.isDisabled(),true,"Changed recipe disables the actual pending native action");
    await add.evaluate(n=>{n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});await page.evaluate(()=>autosaveQueue);assert.equal(await app.evaluate(()=>preparationUi.choiceCalls.length),0,"Logical pending guard rejects stale DOM dispatch as well as native disabled clicks");assert.equal((await state()).journeys.length,beforeChoiceJourneys);
    await app.evaluate(()=>{preparationUi.holdChoice=false;preparationUi.choiceReaders.splice(0).forEach(resolve=>resolve());});await displayed(101,1);await add.click();await page.locator('[data-company-journey]').first().waitFor();assert.deepEqual(await app.evaluate(()=>preparationUi.choiceCalls[0]),{profileId:first,options:{recipeId:101,crafts:1}});assert.match((await state()).journeys.at(-1).title,/Silverleaf infusion.*1 craft attempt/);
    await workshopPage();await page.getByLabel("Saved recipe",{exact:true}).selectOption("100");await displayed(100,1);await app.evaluate(()=>preparationUi.holdChoice=true);
    await page.getByLabel("Craft attempts",{exact:true}).focus();await page.keyboard.press("ArrowDown");await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");await untilMain("preparationUi.choiceReaders.length>=1");assert.equal(await page.getByLabel("Craft attempts",{exact:true}).inputValue(),"3");assert.equal(await add.isDisabled(),true);
    await add.evaluate(n=>n.dispatchEvent(new MouseEvent('click',{bubbles:true})));await page.evaluate(()=>autosaveQueue);assert.equal(await app.evaluate(()=>preparationUi.choiceCalls.length),1);assert.equal((await state()).journeys.length,beforeChoiceJourneys+1);
    await app.evaluate(()=>{preparationUi.holdChoice=false;preparationUi.choiceReaders.splice(0).forEach(resolve=>resolve());});await displayed(100,3);await add.click();await page.locator('[data-company-journey]').first().waitFor();assert.deepEqual(await app.evaluate(()=>preparationUi.choiceCalls[1]),{profileId:first,options:{recipeId:100,crafts:3}});assert.match((await state()).journeys.at(-1).title,/Amber restorative.*3 craft attempts/);
    // A source-only read may default to a different recipe behind a held native Add.
    // The clicked snapshot must still request the visible old recipe; main rejects it freshly.
    await workshopPage();await page.evaluate(id=>{Preparation.remove(id);Preparation.invalidate();render();},first);await displayed(100,1);await add.scrollIntoViewIfNeeded();const heldChoiceBox=await add.boundingBox();await add.evaluate(n=>window.heldSourceChoice=n);await page.mouse.move(heldChoiceBox.x+heldChoiceBox.width/2,heldChoiceBox.y+heldChoiceBox.height/2);await page.mouse.down();
    characters[0].readiness.workshop.recipes.items=characters[0].readiness.workshop.recipes.items.filter(r=>r.id!==100);await update();await untilMain("Boolean(preparationUi.defaultRefreshSeen)");await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));assert.ok(await add.evaluate(n=>n===window.heldSourceChoice));assert.equal(await page.getByLabel("Saved recipe",{exact:true}).inputValue(),"");
    await page.mouse.up();await page.getByRole("alert").waitFor();assert.deepEqual(await app.evaluate(()=>preparationUi.choiceCalls.at(-1)),{profileId:first,options:{recipeId:100,crafts:1}});assert.equal((await state()).journeys.length,beforeChoiceJourneys+2,"A newly defaulted recipe is never silently saved by the held old button");await capture("held-choice-replacement");
    console.log("Preparation R1: delayed native recipe/crafts logically blocked, matching briefs submit exact choices, held source/default replacement retains painted request and no wrong journey PASS");
    console.log("Preparation: independent alts, pending navigation/selection, restart and replacements passed");
    // Actual same-ID import clears local preferences and replaces sources atomically.
    const imported=await state();const importedFirst=imported.profiles.find(p=>p.id===first);delete importedFirst.readiness;delete importedFirst.source;
    const backup=path.join(dir,"replacement.json");await fs.writeFile(backup,JSON.stringify(imported));await app.evaluate(({dialog},backup)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});},backup);
    await navigate(page, "guide");await page.getByRole("button",{name:"Import backup",exact:true}).click();await page.getByRole("status").filter({hasText:"Backup imported."}).waitFor();await navigate(page, "preparation");await page.waitForFunction(()=>document.querySelector(".workshop-hero-copy p")?.textContent.includes("Aeralyn")&&document.querySelector(".workshop-source")?.textContent.includes("quiet bench"));assert.equal(await add.isDisabled(),true);assert.equal(await page.getByLabel("Craft attempts",{exact:true}).inputValue(),"1");await capture("manual-empty");
    assert.doesNotMatch(JSON.stringify(await page.evaluate(id=>window.backstage.contextPreview(id,true,"Explain my plan"),first)),/PRIVATE|Amber restorative|Sunleaf|workshop|journeys/);
    assert.deepEqual(await app.evaluate(()=>({inference:preparationUi.inference,launches:preparationUi.launches})),{inference:0,launches:0});
    await navigate(page, "guide");await page.getByRole("button",{name:"Delete all local data",exact:true}).click();await page.getByRole("status").filter({hasText:"Local data and saved keys deleted."}).waitFor();await page.getByRole("button",{name:"Plan without a character",exact:true}).click();await navigate(page, "preparation");await page.locator("[data-preparation]").waitFor();assert.equal(await add.isDisabled(),true);await capture("no-character");
    console.log(`Preparation UI source Electron ${process.argv.includes("--short-path")?"genuine 8.3":"normal"}: saved recipe, native selection, compact rail/action, physical click/key/disclosure, dated refresh, manual totals, separate alts, retry, pending selection/navigation, restart/import/reset/privacy PASS`);

  } finally {
    clearTimeout(watchdog);await app?.close();const resolved=await fs.realpath(dir);
    assert.equal(path.dirname(resolved).toLowerCase(),tempRoot.toLowerCase());assert.ok(path.basename(resolved).startsWith("forever-preparation-ui-"));await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
