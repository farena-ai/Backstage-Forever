"use strict";
const { navigate, ensureCompanionTools, setCompanionToolOpen, clickCompanionTool } = require("./player-navigation.cjs");
// Actual renderer/main/preload; synthetic state and main-owned fake audio workers only.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), syncFs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow, launch } = require("./test-window.cjs");
const {currentControlState}=require("./selection-fixture.cjs");
const { defaultState } = require("../src/core/validation.cjs");
function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfVoiceUiShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfVoiceUiShortPath]::GetShortPathName($env:BF_VOICE_UI_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync(path.join(process.env.WINDIR,"System32/WindowsPowerShell/v1.0/powershell.exe"),["-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,BF_VOICE_UI_PATH:target},encoding:"utf8",timeout:15000}).trim();
  assert.notEqual(alias.toLowerCase(),target.toLowerCase());assert.match(alias,/~\d/);assert.equal(syncFs.statSync(alias).ino,syncFs.statSync(target).ino);return alias;
}
(async()=>{
  const temp=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),"forever-voice-memory-ui-"));let app;
  const watchdog=setTimeout(()=>{console.error("Voice/memory UI fixture exceeded 180 seconds");process.exitCode=1;app?.process().kill();},180000);
  try {
    const normal=path.join(temp,"synthetic-user-data");await fs.mkdir(normal);const data=process.argv.includes("--short-path")?shortPath(normal):normal;
    await fs.writeFile(path.join(data,"state.json"),JSON.stringify({...defaultState(),onboarded:true,activeProfileId:"Aeralyn",profiles:[{id:"Aeralyn",name:"Aeralyn",className:"Hunter",faction:"Alliance",realm:"Synthetic Realm",level:18,goals:[],notes:"PRIVATE NOTE SENTINEL"},{id:"Vaelric",name:"Vaelric",className:"Mage",faction:"Horde",realm:"Synthetic Realm",level:21,goals:[],notes:""}],provider:{...defaultState().provider,model:"synthetic-model"}}));
    app=await launch(electron, {args:[path.join(__dirname,"..")],env:{...process.env,BF_USER_DATA:data},timeout:20000});
    const page=await testWindow(app);page.setDefaultTimeout(8000);
    await app.evaluate(({app,dialog,ipcMain})=>{
      const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));
      const {EventEmitter}=load("node:events"),{PassThrough}=load("node:stream"),{VoiceService}=load("./src/core/voice.cjs");
      globalThis.voiceUi={commands:[],children:[],asks:0,launches:0,holdPrepare:false,holdList:true,unavailable:false,holdCapabilities:true};
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe=async()=>({state:"not-running",launchAvailable:false});
      load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch=async()=>{voiceUi.launches++;throw Error("Fixture blocks launch");};
      load("./src/core/providers.cjs").models=async()=>[];
      load("./src/core/claude.cjs").status=async()=>({available:false,connected:false,message:"Synthetic unavailable subscription"});
      load("./src/core/providers.cjs").ask=async request=>{voiceUi.asks++;voiceUi.lastPrompt=request.prompt;if(voiceUi.holdAsk)await new Promise(r=>voiceUi.releaseAsk=r);return "For this fictional journey, check your saved quest log before departing. Unreported prerequisites remain unknown.";};
      VoiceService.prototype.prepareBounded=async function(){voiceUi.service=this;if(voiceUi.holdPrepare)await new Promise(r=>voiceUi.releasePrepare=r);return "C:\\synthetic\\voice-helper.ps1";};
      const worker=VoiceService.prototype.worker;
      VoiceService.prototype.worker=function(...args){this.spawn=()=>{
        const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
        child.on("exit",code=>queueMicrotask(()=>child.emit("close",code)));
        child.kill=()=>{if(child.unclosed)return false;child.emit("exit",0);return true;};
        child.send=event=>child.stdout.write(JSON.stringify({v:1,id:child.id,...event})+"\n");
        child.stdin.on("data",line=>{const r=JSON.parse(String(line));child.id=r.id;voiceUi.commands.push(r);
          if(r.command==="capabilities")queueMicrotask(()=>{child.send(voiceUi.unavailable?{event:"unavailable",code:"engine"}:{event:"capabilities",recognizers:[{id:"MS-1033-80-DESK",name:"Microsoft English",culture:"en-US"}],voices:[{id:"Microsoft David Desktop",name:"Microsoft David Desktop",culture:"en-US"},{id:"Microsoft Zira Desktop",name:"Microsoft Zira Desktop",culture:"en-US"}]});child.emit("exit",0);});
          if(["listen","speak"].includes(r.command))queueMicrotask(()=>child.send({event:"started"}));
          if(r.command==="cancel"&&!child.unclosed)queueMicrotask(()=>child.emit("exit",0));});voiceUi.children.push(child);return child;};return worker.apply(this,args);};
      dialog.showMessageBox=async()=>({response:1});
      const capabilities=ipcMain._invokeHandlers.get("backstage:voiceCapabilities");ipcMain.removeHandler("backstage:voiceCapabilities");ipcMain.handle("backstage:voiceCapabilities",async(...args)=>{const fail=voiceUi.failCapabilities;const result=await capabilities(...args);if(voiceUi.holdCapabilities)await new Promise(r=>voiceUi.releaseCapabilities=r);if(fail)throw Error("Synthetic capability rejection");return result;});
      const start=ipcMain._invokeHandlers.get("backstage:voiceStart");ipcMain.removeHandler("backstage:voiceStart");ipcMain.handle("backstage:voiceStart",async(...args)=>{const result=await start(...args);if(voiceUi.holdAck)await new Promise(r=>voiceUi.releaseAck=r);return result;});
      const preview=ipcMain._invokeHandlers.get("backstage:memoryPreview");ipcMain.removeHandler("backstage:memoryPreview");ipcMain.handle("backstage:memoryPreview",async(...args)=>{const result=await preview(...args);if(voiceUi.holdPreview)await new Promise(r=>(voiceUi.previewReleases??=[]).push(r));return result;});
      const save=ipcMain._invokeHandlers.get("backstage:saveState");ipcMain.removeHandler("backstage:saveState");ipcMain.handle("backstage:saveState",async(...args)=>{const result=await save(...args);if(voiceUi.holdSave)await new Promise(r=>voiceUi.releaseSave=r);return result;});
      const list=ipcMain._invokeHandlers.get("backstage:memoryList");ipcMain.removeHandler("backstage:memoryList");ipcMain.handle("backstage:memoryList",async(...args)=>{const result=await list(...args);if(voiceUi.holdList)await new Promise(r=>(voiceUi.listReleases??=[]).push(r));return result;});
      const status=ipcMain._invokeHandlers.get("backstage:voiceStatus");ipcMain.removeHandler("backstage:voiceStatus");ipcMain.handle("backstage:voiceStatus",async(...args)=>{voiceUi.statusReads=(voiceUi.statusReads||0)+1;const result=await status(...args);if(voiceUi.holdStatus)await new Promise(r=>voiceUi.releaseStatus=r);return result;});
      const draft=ipcMain._invokeHandlers.get("backstage:memoryDraft");ipcMain.removeHandler("backstage:memoryDraft");ipcMain.handle("backstage:memoryDraft",async(...args)=>{const result=await draft(...args);if(voiceUi.holdDraft)await new Promise(r=>voiceUi.releaseDraft=r);return result;});
      const speak=ipcMain._invokeHandlers.get("backstage:voiceSpeak");ipcMain.removeHandler("backstage:voiceSpeak");ipcMain.handle("backstage:voiceSpeak",async(...args)=>{voiceUi.speakRequests=(voiceUi.speakRequests||0)+1;const result=await speak(...args);if(voiceUi.holdSpeakAck)await new Promise(r=>voiceUi.releaseSpeakAck=r);return result;});
      const cancel=ipcMain._invokeHandlers.get("backstage:voiceCancel");ipcMain.removeHandler("backstage:voiceCancel");ipcMain.handle("backstage:voiceCancel",async(...args)=>{voiceUi.cancels=(voiceUi.cancels||0)+1;return cancel(...args);});
    });
    await page.evaluate(()=>localStorage.setItem("bf-setup-v4","complete"));
    const hold=page.getByRole("button",{name:"Hold to dictate",exact:true}),question=page.getByRole("textbox",{name:"Your question",exact:true});
    for(const scenario of ['unavailable','newer-focus','available']){
      await app.evaluate((_e,scenario)=>{voiceUi.unavailable=scenario==='unavailable';voiceUi.holdCapabilities=true;voiceUi.releaseCapabilities=null;},scenario);
      await page.reload();await page.evaluate(()=>{window.confirm=()=>true;});
      await navigate(page, "adventure");await navigate(page, "assistant");await ensureCompanionTools(page,"voice");await ensureCompanionTools(page,"memory");
      // Navigation retires Adventure's probe; mounted then starts this composer's first probe.
      await app.evaluate(async()=>{const end=Date.now()+6000;while(!voiceUi.releaseCapabilities){if(Date.now()>end)throw Error("Adventure capability gate missing");await new Promise(r=>setTimeout(r,10));}voiceUi.releaseCapabilities();voiceUi.releaseCapabilities=null;});
      await page.waitForFunction(()=>!document.querySelector('[data-voice-check]').disabled);await page.evaluate(()=>Voice.mounted());
      assert.equal(await hold.count(),1,"Explicit graphical hold-to-dictate control is required");
      await app.evaluate(async()=>{const end=Date.now()+6000;while(!voiceUi.releaseCapabilities){if(Date.now()>end)throw Error("Initial capability gate missing");await new Promise(r=>setTimeout(r,10));}});
      await question.fill("Keep this typed question");await question.evaluate(n=>{window.initialQuestion=n;n.focus();n.setSelectionRange(5,9);});
      if(scenario==='newer-focus')await page.locator('#share-profile').focus();
      await app.evaluate(()=>{voiceUi.holdCapabilities=false;voiceUi.releaseCapabilities();});
      await page.waitForFunction(unavailable=>!document.querySelector('[data-voice-check]').disabled&&document.querySelector('[data-voice-culture]').value===(unavailable?'Unavailable':'en-US'),scenario==='unavailable');
      assert.deepEqual(await question.evaluate(n=>({same:n===window.initialQuestion,value:n.value,focused:n===document.activeElement,start:n.selectionStart,end:n.selectionEnd})),{same:true,value:"Keep this typed question",focused:scenario!=='newer-focus',start:5,end:9},`Initial ${scenario} capability discovery preserves the exact typed draft/range and current focus choice`);
      if(scenario==='newer-focus')assert.equal((await currentControlState(page,"#share-profile")).focused,true);
      else {await page.keyboard.type("fresh");assert.equal(await question.inputValue(),"Keep fresh typed question","Physical typing continues in the selected range after discovery");}
    }
    // A current manual capability failure remains discoverable after the player folds Voice.
    await app.evaluate(()=>{voiceUi.failCapabilities=true;voiceUi.holdCapabilities=true;voiceUi.releaseCapabilities=null;});
    await page.getByRole("button",{name:"Check local voice",exact:true}).click();
    await app.evaluate(async()=>{const end=Date.now()+6000;while(!voiceUi.releaseCapabilities){if(Date.now()>end)throw Error("Rejected capability gate missing");await new Promise(r=>setTimeout(r,10));}});
    await setCompanionToolOpen(page,"voice",false);
    await app.evaluate(()=>{voiceUi.holdCapabilities=false;voiceUi.releaseCapabilities();voiceUi.releaseCapabilities=null;});
    await page.waitForFunction(()=>!document.querySelector('[data-voice-check]').disabled);
    assert.equal(await page.locator('[data-player-tool="voice"]').evaluate(n=>n.open),false);
    assert.match(await page.locator('[data-player-tool="voice"] > summary').innerText(),/Needs attention/);
    assert.match(await page.locator('[data-voice-status]').textContent(),/Local voice could not be checked/);
    await ensureCompanionTools(page,"voice");await app.evaluate(()=>voiceUi.failCapabilities=false);
    await page.getByRole("button",{name:"Check local voice",exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[data-voice-check]').disabled);
    assert.doesNotMatch(await page.locator('[data-player-tool="voice"] > summary').innerText(),/Needs attention/);
    assert.doesNotMatch(await page.locator('[data-voice-status]').innerText(),/could not be checked/);
    console.log("I1: held manual capability rejection remains visible after folding; explicit successful retry clears its attention state PASS");
    // Deliberate dictation uses the exact range retained through initial discovery.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
    await question.evaluate(n=>{n.focus();n.setSelectionRange(5,10);});
    await hold.scrollIntoViewIfNeeded();const initialPoint=await hold.boundingBox();await page.mouse.move(initialPoint.x+initialPoint.width/2,initialPoint.y+initialPoint.height/2);await page.mouse.down();
    await page.waitForFunction(()=>document.querySelector('[data-voice]').dataset.phase==='listening');
    await app.evaluate(()=>voiceUi.children.at(-1).send({event:'hypothesis',text:'reviewed'}));await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector('[name="prompt"]').value==='Keep reviewed typed question');assert.equal(await app.evaluate(()=>voiceUi.asks),0);
    console.log('Final R3: held initial unavailable/available capabilities retain exact typed node/text/range/focus, newer focus, continued physical typing and deliberate fake dictation insertion PASS');
    const dictationLanguage=page.getByRole("combobox",{name:"Dictation language",exact:true});
    assert.equal(await dictationLanguage.locator("option:checked").innerText(),"English (United States)","Dictation language needs a friendly public caption");
    assert.equal(await dictationLanguage.locator("option:checked").getAttribute("value"),"en-US","The friendly caption must keep an explicit exact culture value");
    await dictationLanguage.selectOption("en-US");await page.evaluate(()=>render());
    assert.equal(await dictationLanguage.inputValue(),"en-US","An ordinary paint preserves the selected culture code");
    for(const fallback of ["unavailable","invalid"]){
      const option=await page.evaluate(fallback=>{
        const displayNames=Intl.DisplayNames;
        try{
          Intl.DisplayNames=fallback==="unavailable"?undefined:class{of(){throw new RangeError("Synthetic invalid display name");}};
          render();
          const selected=document.querySelector("[data-voice-culture] option:checked");
          return {caption:selected.textContent,value:selected.value,explicitValue:selected.getAttribute("value")};
        }finally{Intl.DisplayNames=displayNames;render();}
      },fallback);
      assert.deepEqual(option,{caption:"en-US",value:"en-US",explicitValue:"en-US"},"Unavailable or invalid display naming falls back to the exact culture code");
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].focus());
    await question.fill("Where OLD next?");await question.evaluate(n=>{n.focus();n.setSelectionRange(6,9);});
    await hold.scrollIntoViewIfNeeded();const point=await hold.boundingBox();await page.mouse.move(point.x+point.width/2,point.y+point.height/2);await page.mouse.down();
    await page.waitForFunction(()=>document.querySelector("[data-voice]").dataset.phase==="listening");
    assert.equal(await app.evaluate(()=>voiceUi.commands.findLast(c=>c.command==="listen").culture),"en-US","Actual fake-worker listening receives the culture code, never the caption");
    await page.evaluate(()=>window.heldMic=document.querySelector("[data-voice-hold]"));
    await app.evaluate(()=>voiceUi.children.at(-1).send({event:"hypothesis",text:"quest"}));
    await page.evaluate(()=>new Promise(r=>setTimeout(()=>{render();r();},0)));
    assert.equal(await page.evaluate(()=>window.heldMic===document.querySelector("[data-voice-hold]")),true);
    assert.match(await page.locator("[data-voice-status]").innerText(),/Listening locally/);
    await page.mouse.up();await page.waitForFunction(()=>document.querySelector('[name="prompt"]').value==="Where quest next?");
    assert.equal(await app.evaluate(()=>voiceUi.asks),0,"Dictation never sends a question");
    await page.getByRole("button",{name:"Send question",exact:true}).click();await page.getByRole("button",{name:"Save exchange",exact:true}).waitFor();
    assert.match(await page.locator("[data-memory-review]").innerText(),/Where quest next/);
    // The reviewed physical Save target survives a preceding mutation acknowledgement and paint.
    await app.evaluate(()=>voiceUi.holdSave=true);await page.evaluate(()=>{autosaveQueue=autosaveQueue.then(()=>persist(editedState(s=>{s.profiles[0].notes="PRIVATE QUEUED NOTE";})));});
    await app.evaluate(async()=>{const end=Date.now()+5000;while(!voiceUi.releaseSave){if(Date.now()>end)throw Error("Save gate missing");await new Promise(r=>setTimeout(r,10));}});
    const saveButton=page.getByRole("button",{name:"Save exchange",exact:true});await saveButton.scrollIntoViewIfNeeded();const saveBox=await saveButton.boundingBox();await page.evaluate(()=>window.heldMemorySave=document.querySelector("[data-memory-save]"));await page.mouse.move(saveBox.x+saveBox.width/2,saveBox.y+saveBox.height/2);await page.mouse.down();
    await app.evaluate(()=>{voiceUi.holdSave=false;voiceUi.releaseSave();voiceUi.releaseSave=null;});await page.evaluate(()=>autosaveQueue);await page.evaluate(()=>new Promise(r=>setTimeout(()=>{render();r();},0)));assert.equal(await page.evaluate(()=>window.heldMemorySave===document.querySelector("[data-memory-save]")),true);await page.mouse.up();await page.locator("[data-memory-row]").waitFor();
    await app.evaluate(()=>{voiceUi.holdList=false;voiceUi.listReleases.splice(0).reverse().forEach(r=>r());});await page.waitForTimeout(150);
    assert.equal(await page.locator("[data-memory-row]").count(),1,"A late earlier list cannot erase the newly committed save");
    assert.equal(await page.locator("[data-memory-select]").isChecked(),false,"Saving is separate from per-question sharing");
    await question.fill("What should I check in WoW Forever?");await page.locator("[data-memory-select]").check();
    await page.waitForFunction(()=>document.querySelector("[data-memory-preview]")?.textContent.includes("BEGIN UNTRUSTED SAVED CONVERSATION"));
    assert.doesNotMatch(await page.locator("[data-memory-preview]").innerText(),/PRIVATE NOTE SENTINEL/);
    const evidence=path.resolve("work/voice-memory-captures",new Date().toISOString().replace(/[:.]/g,"-"));await fs.mkdir(evidence,{recursive:true});
    const capture=async name=>{await page.evaluate(()=>{scrollTo(0,0);document.querySelector(".main")?.scrollTo(0,0);});await page.screenshot({path:path.join(evidence,`${process.argv.includes("--short-path")?"short-":""}${name}.png`),fullPage:true});};
    const untilMain=condition=>app.evaluate(async(_e,condition)=>{const end=Date.now()+6000;while(!Function(`return (${condition})`)()){if(Date.now()>end)throw Error("Fixture condition timed out: "+condition);await new Promise(r=>setTimeout(r,10));}},condition);
    const count=command=>app.evaluate((_e,command)=>voiceUi.commands.filter(c=>c.command===command).length,command);
    const focus=()=>app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.show();win.focus();});
    const mouseHold=async()=>{await focus();await hold.scrollIntoViewIfNeeded();const box=await hold.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();};
    const listening=()=>page.waitForFunction(()=>document.querySelector("[data-voice]").dataset.phase==="listening");
    const hypothesis=text=>app.evaluate((_e,text)=>voiceUi.children.at(-1).send({event:"hypothesis",text}),text);
    await capture("alliance-full");
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));await page.waitForFunction(()=>innerWidth<=1000);await capture("alliance-compact");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    // Native keyboard defaults toggle once, keep focus, and never silently share other entries.
    const selected=page.locator("[data-memory-select]");await selected.focus();await page.keyboard.press("Space");await page.waitForFunction(()=>!document.querySelector("[data-memory-select]").checked);
    await page.waitForFunction(()=>document.querySelector("[data-memory-select]")===document.activeElement);
    // Typing during the physical mouse hold survives and requires a separate explicit insertion.
    await question.fill("My newer typed question ");await question.focus();await mouseHold();await listening();await hypothesis("captured words");await page.keyboard.type("stays");await page.mouse.up();
    await page.getByRole("button",{name:"Insert dictated draft",exact:true}).waitFor();assert.equal(await question.inputValue(),"My newer typed question stays");
    assert.equal(await page.getByRole("textbox",{name:"Separate dictated draft",exact:true}).inputValue(),"captured words");
    await setCompanionToolOpen(page,"voice",false);
    assert.match(await page.locator('[data-player-tool="voice"] > summary').innerText(),/draft to review/i);
    await ensureCompanionTools(page,"voice");
    await page.getByRole("button",{name:"Insert dictated draft",exact:true}).click();assert.equal(await question.inputValue(),"My newer typed question stayscaptured words");
    // Both keyboard activation keys hold instead of invoking button click or Enter-to-send.
    for(const key of ["Space","Enter"]){await hold.focus();await page.keyboard.down(key);await listening();await hypothesis(key+" draft");await page.keyboard.up(key);await page.waitForFunction(()=>document.querySelector("[data-voice]").dataset.phase==="stopped");}
    await mouseHold();await listening();await app.evaluate(()=>voiceUi.holdStatus=true);await untilMain("Boolean(voiceUi.releaseStatus)");await page.mouse.up();await page.waitForFunction(()=>document.querySelector("[data-voice]").dataset.phase==="stopped");
    await app.evaluate(()=>{voiceUi.holdStatus=false;voiceUi.releaseStatus();voiceUi.releaseStatus=null;});await page.waitForTimeout(30);assert.equal(await page.locator("[data-voice]").getAttribute("data-phase"),"stopped","An older held status acknowledgement must not repaint listening after release");
    assert.equal(await app.evaluate(()=>voiceUi.asks),1);
    // Selecting saved memory now starts a fresh conversation; explicit speech needs a fresh reply.
    assert.equal(await page.locator(".message.assistant").count(),0,"Changed memory scope clears the prior visible reply");
    await question.fill("Explain the WoW Forever quest log for reading aloud.");
    await page.getByRole("button",{name:"Send question",exact:true}).click();
    await page.getByRole("button",{name:"Save exchange",exact:true}).waitFor();
    assert.equal(await app.evaluate(()=>voiceUi.asks),2,"Only the additional explicit Send creates the fresh reply");
    // Startup release fences a future main attachment; held IPC acknowledgement also cancels.
    await app.evaluate(()=>voiceUi.holdPrepare=true);let before=await count("listen");await mouseHold();await untilMain("Boolean(voiceUi.releasePrepare)");await page.mouse.up();
    await app.evaluate(()=>{voiceUi.holdPrepare=false;voiceUi.releasePrepare();voiceUi.releasePrepare=null;});await page.waitForTimeout(180);assert.equal(await count("listen"),before);
    await app.evaluate(()=>voiceUi.holdAck=true);await mouseHold();await untilMain("Boolean(voiceUi.releaseAck)");await hypothesis("pre acknowledgement draft");await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector('[name="prompt"]').value.includes("pre acknowledgement draft"));
    await app.evaluate(()=>{voiceUi.holdAck=false;voiceUi.releaseAck();voiceUi.releaseAck=null;});await page.waitForTimeout(160);assert.equal(await page.locator("[data-voice]").getAttribute("data-phase"),"stopped");
    // Blur cancels capture but preserves explicit TTS and an otherwise current AI answer.
    await mouseHold();await listening();await hypothesis("blur draft");await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());await page.waitForFunction(()=>document.querySelector("[data-voice]").dataset.phase==="stopped");await page.mouse.up();await focus();
    const readingVoice=page.getByRole("combobox",{name:"Reading voice",exact:true});await readingVoice.selectOption("Microsoft Zira Desktop");await page.evaluate(()=>render());assert.equal(await readingVoice.inputValue(),"Microsoft Zira Desktop","An ordinary paint preserves the explicitly selected local voice");
    // Stop retires the real renderer readiness continuation before it can dispatch speech.
    await page.evaluate(async()=>{await companionReady;companionReady=new Promise(resolve=>window.releaseReadingReady=resolve);});
    let speechBefore=await count("speak"),speakRequestsBefore=await app.evaluate(()=>voiceUi.speakRequests||0),cancelBefore=await app.evaluate(()=>voiceUi.cancels||0);
    await page.getByRole("button",{name:"Read answer",exact:true}).click();await page.waitForFunction(()=>document.querySelector("[data-voice]").dataset.phase==="starting");
    await page.getByRole("button",{name:"Stop voice",exact:true}).click();await untilMain(`(voiceUi.cancels||0)===${cancelBefore+1}`);assert.equal(await count("speak"),speechBefore);
    await page.evaluate(()=>{window.releaseReadingReady();delete window.releaseReadingReady;});await page.waitForTimeout(180);
    assert.equal(await count("speak"),speechBefore,"Stop before companion readiness must dispatch zero later speak commands");
    assert.equal(await app.evaluate(()=>voiceUi.speakRequests||0),speakRequestsBefore,"Stopped readiness continuation must dispatch zero voiceSpeak requests");
    assert.equal(await page.locator("[data-voice]").getAttribute("data-phase"),"stopped");
    // Main cancellation still owns an already-dispatched read whose acknowledgement is delayed.
    await app.evaluate(()=>voiceUi.holdSpeakAck=true);await page.getByRole("button",{name:"Read answer",exact:true}).click();await untilMain("Boolean(voiceUi.releaseSpeakAck)");await untilMain(`voiceUi.commands.filter(c=>c.command==="speak").length===${speechBefore+1}`);
    await page.getByRole("button",{name:"Stop voice",exact:true}).click();await page.waitForFunction(()=>document.querySelector("[data-voice]").dataset.phase==="stopped");await untilMain("voiceUi.service.workers.size===0");
    await app.evaluate(()=>{voiceUi.holdSpeakAck=false;voiceUi.releaseSpeakAck();voiceUi.releaseSpeakAck=null;});await page.waitForTimeout(30);
    assert.equal(await page.locator("[data-voice]").getAttribute("data-phase"),"stopped","A pre-Stop speech acknowledgement cannot repaint Starting after Stop");assert.equal(await count("speak"),speechBefore+1);
    // Folding Voice is a cancellation boundary for pending and active fake audio.
    await page.evaluate(async()=>{await companionReady;companionReady=new Promise(resolve=>window.releaseFoldReady=resolve);});
    const foldRequests=await app.evaluate(()=>voiceUi.speakRequests||0),foldCancels=await app.evaluate(()=>voiceUi.cancels||0),foldWorkers=await app.evaluate(()=>voiceUi.service.workers.size),foldCommands=await count("speak");
    await page.getByRole("button",{name:"Read answer",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-voice]').dataset.phase==='starting');
    await setCompanionToolOpen(page,"voice",false);
    await untilMain(`(voiceUi.cancels||0)>${foldCancels}`);
    await page.waitForFunction(()=>document.querySelector('[data-voice]').dataset.phase==='stopped');
    assert.equal(await app.evaluate(()=>voiceUi.speakRequests||0),foldRequests,"Cancellation is acknowledged while readiness is still held");
    await page.evaluate(async()=>{window.releaseFoldReady();await companionReady;delete window.releaseFoldReady;});
    assert.equal(await app.evaluate(()=>voiceUi.speakRequests||0),foldRequests,"Folded pending reading cannot dispatch later audio");
    assert.equal(await count("speak"),foldCommands,"Retired readiness cannot dispatch a fake worker speak command");
    assert.equal(await app.evaluate(()=>voiceUi.service.workers.size),foldWorkers,"Retired readiness cannot attach an audio worker");
    await ensureCompanionTools(page,"voice");
    await page.getByRole("button",{name:"Read answer",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-voice]').dataset.phase==='speaking');
    await setCompanionToolOpen(page,"voice",false);await untilMain("voiceUi.service.workers.size===0");
    await ensureCompanionTools(page,"voice");
    console.log("Voice startup R1: held readiness Stop dispatches zero voiceSpeak requests/workers; held speech acknowledgement cannot repaint Starting after Stop PASS");
    await page.getByRole("button",{name:"Read answer",exact:true}).click();await page.waitForFunction(()=>document.querySelector("[data-voice]").dataset.phase==="speaking");assert.equal(await app.evaluate(()=>voiceUi.commands.findLast(c=>c.command==="speak").voiceId),"Microsoft Zira Desktop");
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
    // testWindow keeps native rendering active; inject only the browser visibility property/event.
    await page.evaluate(()=>{Object.defineProperty(document,"hidden",{value:true,configurable:true});document.dispatchEvent(new Event("visibilitychange"));});
    const hiddenReads=await app.evaluate(()=>voiceUi.statusReads||0);await page.waitForTimeout(250);assert.equal(await app.evaluate(()=>voiceUi.statusReads||0),hiddenReads,"Hidden reading must not poll voice status");assert.equal(await page.locator("[data-voice]").getAttribute("data-phase"),"speaking");
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event("visibilitychange"));});await focus();await page.getByRole("button",{name:"Stop voice",exact:true}).click();assert.equal(await hold.isEnabled(),true,"An explicit Stop reading must leave dictation available");
    await app.evaluate(()=>voiceUi.holdAsk=true);await question.fill("What does the WoW Forever saved quest log show?");await question.press("Enter");await untilMain("Boolean(voiceUi.releaseAsk)");
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());await app.evaluate(()=>{voiceUi.holdAsk=false;voiceUi.releaseAsk();voiceUi.releaseAsk=null;});await focus();await page.getByRole("button",{name:"Save exchange",exact:true}).waitFor();
    // A new explicit send requires its own selection. No persistent conversation-sharing consent.
    assert.equal(await selected.isChecked(),false);
    // A held preview cannot permit duplicate sends or reuse sharing for the next question.
    await selected.check();await question.fill("Help me review the WoW Forever quest log carefully.");await page.waitForFunction(()=>document.querySelector("[data-memory-preview]").textContent.includes("carefully"));
    await setCompanionToolOpen(page,"memory",false);
    assert.match(await page.locator('[data-player-tool="memory"] > summary').innerText(),/1 selected/);
    assert.equal(await page.locator('[data-companion-cost]').isVisible(),true);
    assert.equal(await page.getByLabel('Use my active character',{exact:true}).isVisible(),true);
    await ensureCompanionTools(page,"memory");
    const previewText=await page.locator("[data-memory-preview]").innerText();await app.evaluate(()=>{voiceUi.holdPreview=true;voiceUi.holdAsk=true;});const userCount=await page.locator(".message.user").count();
    await question.press("Enter");await untilMain("Boolean(voiceUi.previewReleases?.length)");await question.press("Enter");await page.waitForTimeout(100);
    await app.evaluate(()=>{voiceUi.holdPreview=false;voiceUi.previewReleases.splice(0).forEach(r=>r());});await untilMain("Boolean(voiceUi.releaseAsk)");
    assert.equal(await page.locator(".message.user").count(),userCount+1,"A pending memory preview must accept exactly one explicit Send");
    assert.equal(await app.evaluate(()=>voiceUi.lastPrompt),previewText,"Main sends exactly the memory augmentation reviewed in the UI");
    assert.equal(await page.getByRole("button",{name:"Save exchange",exact:true}).count(),0,"An old reviewed response retires when a new question starts");
    await app.evaluate(()=>{voiceUi.holdAsk=false;voiceUi.releaseAsk();voiceUi.releaseAsk=null;});await page.getByRole("button",{name:"Save exchange",exact:true}).waitFor();assert.equal(await selected.isChecked(),false,"Selected sharing applies to one question only");
    // Unconfirmed cancellation is surfaced once after the fixed deadline; no new audio command.
    await mouseHold();await listening();await app.evaluate(()=>voiceUi.children.at(-1).unclosed=true);await hypothesis("bounded stopped draft");before=await count("listen");await page.mouse.up();
    await page.waitForFunction(()=>document.querySelector("[data-voice-status]").textContent.includes("could not confirm it stopped"));await capture("blocked-stop-error");
    await clickCompanionTool(page,"voice");
    await page.waitForFunction(()=>{const panel=document.querySelector('[data-player-tool="voice"]');return panel.open&&panel.querySelector('[data-voice]').dataset.phase==='error'&&panel.querySelector('[data-voice-status]').textContent.includes('could not confirm it stopped');});
    assert.match(await page.locator('[data-voice-status]').innerText(),/could not confirm it stopped/);
    await ensureCompanionTools(page,"voice");
    for(const fail of [true,false]){
      await app.evaluate((_e,fail)=>voiceUi.failCapabilities=fail,fail);
      await page.getByRole("button",{name:"Check local voice",exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('[data-voice-check]').disabled);
      assert.match(await page.locator('[data-voice-status]').innerText(),/could not confirm it stopped/,"Checking capabilities cannot erase an unconfirmed audio stop");
      assert.equal(await page.locator('[data-voice]').getAttribute('data-phase'),'error');
    }
    assert.equal(await count("listen"),before);await app.evaluate(()=>voiceUi.children.at(-1).emit("close",null));await page.waitForTimeout(160);assert.equal(await count("listen"),before);
    // Navigation retires selected sharing and a held network reply, retaining only completed same-owner replies.
    const completedBeforeNavigation=await page.locator(".message.assistant").allTextContents();
    await selected.check();await question.fill("Help my WoW Forever character with another quest.");await app.evaluate(()=>voiceUi.holdAsk=true);await page.getByRole("button",{name:"Send question",exact:true}).click();await untilMain("Boolean(voiceUi.releaseAsk)");
    await page.getByRole("button",{name:"Adventure",exact:true}).click();await app.evaluate(()=>{voiceUi.holdAsk=false;voiceUi.releaseAsk();voiceUi.releaseAsk=null;});await navigate(page, "assistant");await ensureCompanionTools(page,"voice");await ensureCompanionTools(page,"memory");assert.equal(await selected.isChecked(),false);assert.deepEqual(await page.locator(".message.assistant").allTextContents(),completedBeforeNavigation,"Navigation retains completed replies but never appends the cancelled late reply");assert.equal(await page.getByRole("button",{name:"Save exchange",exact:true}).count(),0,"Retained history must not manufacture a current save draft");
    await page.getByLabel("Active character",{exact:true}).selectOption("Vaelric");await page.waitForFunction(()=>document.querySelector("[data-memory]").textContent.includes("Vaelric"));assert.equal(await page.locator("[data-memory-row]").count(),0);await capture("horde-empty");
    await app.evaluate(()=>voiceUi.unavailable=true);await page.getByRole("button",{name:"Check local voice",exact:true}).click();await page.waitForFunction(()=>document.querySelector("[data-voice-hold]").disabled);await capture("unavailable");assert.equal(await question.isEnabled(),true);
    // Memory changes retire a pending reply and leave the typed composer usable.
    await page.getByLabel("Active character",{exact:true}).selectOption("Aeralyn");await page.locator("[data-memory-row]").waitFor();await question.fill("What should I check before a WoW Forever quest?");await app.evaluate(()=>voiceUi.holdAsk=true);await question.press("Enter");await untilMain("Boolean(voiceUi.releaseAsk)");
    await page.getByRole("button",{name:"Clear this character’s memory",exact:true}).click();await page.waitForFunction(()=>!document.querySelector("[data-memory-row]"));
    await app.evaluate(()=>{voiceUi.holdAsk=false;voiceUi.releaseAsk();voiceUi.releaseAsk=null;});await page.getByRole("button",{name:"Send question",exact:true}).waitFor();assert.equal(await question.isEnabled(),true);assert.equal(await page.locator(".message.assistant").count(),0);
    await app.evaluate(()=>voiceUi.holdDraft=true);await question.fill("Old WoW Forever question awaiting review.");await question.press("Enter");await untilMain("Boolean(voiceUi.releaseDraft)");
    assert.equal(await page.getByRole("button",{name:"Clear conversation",exact:true}).isEnabled(),true,"Clear must retire a pending reply/review without waiting for it");
    await page.getByRole("button",{name:"Clear conversation",exact:true}).click();await app.evaluate(()=>voiceUi.holdDraft=false);
    await question.fill("New WoW Forever question after clearing.");await question.press("Enter");await page.getByRole("button",{name:"Save exchange",exact:true}).waitFor();
    await app.evaluate(()=>{voiceUi.releaseDraft();voiceUi.releaseDraft=null;});await page.waitForTimeout(150);assert.match(await page.locator("[data-memory-review]").innerText(),/New WoW Forever question after clearing/);assert.doesNotMatch(await page.locator("[data-memory-review]").innerText(),/Old WoW Forever question/);
    await page.getByRole("button",{name:"Save exchange",exact:true}).click();await page.locator("[data-memory-row]").waitFor();await page.locator("[data-memory-row] summary").click();await page.getByRole("button",{name:"Delete exchange",exact:true}).click();await page.waitForFunction(()=>!document.querySelector("[data-memory-row]"));
    // The actual local plan comes from a canonical fictional saved-game root.
    const game=path.join(temp,"synthetic-client"),saved=path.join(game,"WTF/Account/Synthetic/SavedVariables/BackstageForever.lua"),clock=Math.floor(Date.now()/1000);
    await fs.mkdir(path.dirname(saved),{recursive:true});await fs.writeFile(path.join(game,".flavor.info"),"wowf");
    await fs.writeFile(saved,"BackstageForeverExport = "+JSON.stringify(JSON.stringify({schema:1,observedAt:clock,activeId:"Synthetic-Alliance",characters:[{id:"Synthetic-Alliance",name:"Aeralyn",realm:"Synthetic Realm",className:"Hunter",race:"Synthetic",faction:"Alliance",level:18,updatedAt:clock,clientBuild:"1.15.8.64000",captureVersion:require("../package.json").version,quests:[{id:999991,title:"Return the fictional scout",complete:true,objectives:[{text:"Scout returned",done:true}],destination:{mapId:1,x:.4,y:.5,text:"Saved camp marker"}}]}]})));
    await navigate(page,"adventure");await page.evaluate(async game=>{await mutateGame(()=>api.prepareGame(game));},game);await ensureCompanionTools(page,"coach-quest-plan");await page.locator("[data-director-primary]").waitFor();await ensureCompanionTools(page,"voice");
    await app.evaluate(()=>voiceUi.unavailable=false);await page.getByRole("button",{name:"Check local voice",exact:true}).click();const readPlan=page.getByRole("button",{name:"Read plan",exact:true});await page.waitForFunction(()=>!document.querySelector('[data-voice-read="plan"]').disabled);
    // Qualified fictional public reference uses the actual guidance shape, not Director's sourceKind.
    await page.evaluate(()=>{guidance={...guidance,steps:guidance.steps.map(step=>({...step,referenceDestination:{mapId:1,x:.41,y:.51,name:"Fictional public mention",evidence:"mentioned-in-objective"},knowledge:{status:"match",provenance:{build:"fictional-reference",observedThrough:"2026-01-01",attribution:"Fictional public source"}}}))};render();});
    await readPlan.click();await page.waitForFunction(()=>document.querySelector("[data-voice]").dataset.phase==="speaking");const spoken=await app.evaluate(()=>voiceUi.commands.findLast(c=>c.command==="speak").text);
    assert.ok(spoken.length<=4000);assert.match(spoken,/Return the fictional scout/);assert.match(spoken,/Saved .+Source: game snapshot/);assert.match(spoken,/not live game state/);assert.match(spoken,/Public reference build fictional-reference, observed through 2026-01-01/);assert.match(spoken,/clue only; destination and availability are unconfirmed/);assert.doesNotMatch(spoken,/PRIVATE NOTE|PRIVATE QUEUED NOTE|PRIVATE GOAL/);await page.getByRole("button",{name:"Stop voice",exact:true}).click();await capture("read-plan");
    // Physical provider, import and reset actions use the existing renderer queue and main gates.
    await navigate(page, "connections");await page.locator('#provider-form summary').click();await page.getByLabel("Manual model ID",{exact:true}).fill("synthetic-model-2");await page.getByLabel("Manual model ID",{exact:true}).press("Tab");await page.waitForFunction(()=>state.provider.model==="synthetic-model-2");
    await navigate(page, "assistant");await ensureCompanionTools(page,"voice");await ensureCompanionTools(page,"memory");assert.equal(await page.locator(".message.assistant").count(),0);await question.fill("A WoW Forever question to keep locally.");await question.press("Enter");await page.getByRole("button",{name:"Save exchange",exact:true}).click();await page.locator("[data-memory-row]").waitFor();
    const backup=path.join(temp,"synthetic-backup.json");await fs.writeFile(backup,JSON.stringify((await page.evaluate(()=>window.backstage.bootstrap())).state));await app.evaluate(({dialog},backup)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});},backup);
    await navigate(page, "guide");await page.getByRole("button",{name:"Import backup",exact:true}).click();await page.waitForFunction(()=>state.memories.length===0);await navigate(page, "assistant");await ensureCompanionTools(page,"voice");await ensureCompanionTools(page,"memory");assert.equal(await page.locator("[data-memory-row]").count(),0);assert.equal(await page.getByRole("button",{name:"Save exchange",exact:true}).count(),0);
    await app.evaluate(()=>{voiceUi.failCapabilities=true;voiceUi.holdCapabilities=true;voiceUi.releaseCapabilities=null;});
    await page.getByRole("button",{name:"Check local voice",exact:true}).click();await untilMain("Boolean(voiceUi.releaseCapabilities)");
    await navigate(page,"guide");await navigate(page,"assistant");await ensureCompanionTools(page,"voice");
    await app.evaluate(()=>{voiceUi.holdCapabilities=false;voiceUi.failCapabilities=false;voiceUi.releaseCapabilities();voiceUi.releaseCapabilities=null;});
    await page.waitForFunction(()=>!document.querySelector('[data-voice-check]').disabled);
    assert.doesNotMatch(await page.locator('[data-player-tool="voice"] > summary').innerText(),/Needs attention/);
    assert.doesNotMatch(await page.locator('[data-voice-status]').innerText(),/could not be checked/);
    console.log("I1: late rejected capability reply cannot mark the replacement navigation owner; failed/successful checks preserve unconfirmed stop error PASS");
    await navigate(page, "guide");await page.getByRole("button",{name:"Delete all local data",exact:true}).click();await page.waitForFunction(()=>state.profiles.length===0);assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).state.memories.length,0);
    assert.equal(await app.evaluate(()=>voiceUi.launches),0);
    console.log("PASS: actual Electron physical pointer/key hold/release, unchanged range/dirty insertion, explicit send/save/select/preview/read/stop, startup/pre-ack/blur/navigation/character races, unconfirmed-stop deadline, typed unavailable fallback and fictional full/compact/error evidence; fake audio workers only.");
  }finally{clearTimeout(watchdog);if(app)await app.close().catch(()=>app.process().kill());await fs.rm(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
