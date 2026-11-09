"use strict";
const {_electron:electron}=require("playwright");
const fs=require("node:fs/promises"), path=require("node:path"), os=require("node:os"), assert=require("node:assert/strict");
const {testWindow}=require("./test-window.cjs");
const {assertSelectContrast}=require("./select-contrast.cjs");
const {defaultState}=require("../src/core/validation.cjs");
function shortPath(target) {
 const script=`Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfCompanyUiShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfCompanyUiShortPath]::GetShortPathName($env:BF_COMPANY_UI_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
 const alias=require("node:child_process").execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,BF_COMPANY_UI_ALIAS_PATH:target},encoding:"utf8",timeout:15000}).trim();
 assert.notEqual(alias.toLowerCase(),target.toLowerCase());assert.match(alias,/~\d/);assert.equal(require("node:fs").statSync(alias).ino,require("node:fs").statSync(target).ino);return alias;
}
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"forever-company-ui-")); let app;
 const watchdog=setTimeout(()=>{console.error("Company UI fixture exceeded 110 seconds");app?.process().kill();process.exitCode=1;},110000);
 try{
  const initial={...defaultState(),onboarded:true,activeProfileId:"lark",profiles:[
   {id:"lark",name:"Lark Ashvale",realm:"Fictional Realm",className:"Mage",faction:"Alliance",level:31,notes:"PRIVATE_NOTE_NEVER_SHARED",goals:[{id:"g",text:"Gather mooncloth",done:false}],source:{kind:"wow-addon",id:"fictional-lark",updatedAt:"2026-11-08T12:00:00.000Z"},clientBuild:"1.15.8.64000",quests:[{id:1061,title:"The saved expedition",complete:true,objectives:[]}],history:{recent:[],completedIdsKnown:true,completedIds:[]},readiness:{bags:{free:2,total:20}}},
   {id:"rook'\"><b>",name:"Rook Emberfall",realm:"Fictional Realm",className:"Warrior",faction:"Horde",level:28,notes:"PRIVATE_SECOND_NOTE",goals:[]}
  ]};
  for(const name of ["source","clientBuild","quests","history","readiness"]) delete initial.profiles[0][name];
  await fs.writeFile(path.join(dir,"state.json"),JSON.stringify(initial));
  const data=process.argv.includes("--short-path")?shortPath(dir):dir;
  app=await electron.launch({args:[path.join(__dirname,"..")],env:{...process.env,BF_USER_DATA:data}});
  await app.evaluate(({app,dialog,ipcMain})=>{
   const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));
   load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe=async()=>({state:"not-running",launchAvailable:false});
   load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch=async()=>{throw Error("Fixture blocks launch");};
   load("./src/core/providers.cjs").ask=async()=>{throw Error("Fixture blocks inference");};
   load("./src/core/claude.cjs").status=async()=>({installed:false,loggedIn:false});
   globalThis.companyUiFixture={};
   dialog.showMessageBox=async()=>({response:1});
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[companyUiFixture.importFile]});
   dialog.showSaveDialog=async()=>({canceled:false,filePath:companyUiFixture.exportFile});
  });
  const page=await testWindow(app); page.setDefaultTimeout(7000);
  const rendererErrors=[];page.on("pageerror",error=>rendererErrors.push(error.message));
  await app.evaluate(({ipcMain})=>{
   for(const channel of ["backstage:companyBrief","backstage:journeyAction","backstage:saveState"]){
    const original=ipcMain._invokeHandlers.get(channel);ipcMain.removeHandler(channel);
    ipcMain.handle(channel,async(event,...args)=>{
     if(channel==="backstage:companyBrief"&&companyUiFixture.failRead) throw Error("Synthetic read failure");
     const result=await original(event,...args);
     if(companyUiFixture.delay===channel){companyUiFixture.delay=null;await new Promise(r=>companyUiFixture.release=r);}
     return result;
    });
   }
  });

  await page.getByRole("button",{name:"Use a manual character",exact:true}).click();
  await page.getByRole("button",{name:"Company",exact:true}).click();
  await page.getByRole("heading",{name:"Lark Ashvale",exact:true}).waitFor();
  assert.equal(await page.getByLabel("Collected character totals").locator("div").nth(1).locator("b").innerText(),"—","All-manual roster has unknown aggregate quests");
  await page.getByRole("button",{name:"Adventure",exact:true}).click();
  const game=path.join(dir,"synthetic-client"), savedFile=path.join(game,"WTF/Account/Fiction/SavedVariables/BackstageForever.lua");
  await fs.mkdir(path.dirname(savedFile),{recursive:true});await fs.writeFile(path.join(game,".flavor.info"),"wowf");
  let clock=1794182400;
  const captures=[{id:"fictional-lark",name:"Lark Ashvale",realm:"Fictional Realm",className:"Mage",faction:"Alliance",level:31,updatedAt:clock,clientBuild:"1.15.8.64000",quests:[{id:1061,title:"The saved expedition",complete:true,objectives:[]}],history:{recent:[],completedIdsKnown:true,completedIds:[]},readiness:{bags:{free:2,total:20}}}];
  const writeCapture=()=>fs.writeFile(savedFile,"BackstageForeverExport = "+JSON.stringify(JSON.stringify({schema:1,observedAt:clock,activeId:"fictional-lark",characters:captures})));
  await writeCapture();await page.evaluate(root=>window.backstage.prepareGame(root),game);await page.reload();
  const original=await page.evaluate(()=>window.backstage.bootstrap());
  await page.getByRole("button",{name:"Company",exact:true}).click();
  await page.getByRole("heading",{name:"Your adventure company.",exact:true}).waitFor();
  await page.getByRole("heading",{name:"Lark Ashvale",exact:true}).waitFor();
  let saved=await page.evaluate(()=>window.backstage.bootstrap());
  assert.equal(saved.state.activeProfileId,original.state.activeProfileId);assert.equal(saved.state.followGameCharacter,original.state.followGameCharacter);
  await page.getByRole("button",{name:"Create plan",exact:true}).click();
  await page.getByLabel("Plan name").fill("Evening expedition <img src=x onerror=alert(1)>");
  await page.getByLabel("Starting checklist").selectOption("quest-session");
  await assertSelectContrast(page,"Company create plan");
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.locator("[data-company-journey]").waitFor();
  saved=await page.evaluate(()=>window.backstage.bootstrap());assert.equal(saved.state.journeys.length,1);assert.equal(saved.state.journeys[0].steps.length,3);
  assert.equal(await page.locator("[data-company] img[src=x]").count(),0);
  const journey=page.locator("[data-company-journey]").first();
  await journey.getByLabel("Note step").fill("PRIVATE_PLAN_SENTINEL");
  await journey.getByRole("button",{name:"Add note",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll("[data-company-step]").length===4);
  await journey.getByLabel("Saved character").selectOption("lark");
  await journey.getByLabel("Saved quest",{exact:true}).selectOption("1061");
  await assertSelectContrast(page,"Company saved quest/assignment");
  await journey.getByRole("button",{name:"Track saved quest",exact:true}).click();
  await page.getByText("Saved ready to turn in; not turned in",{exact:true}).waitFor();
  await page.getByText(/Tracking starts from the saved capture/).waitFor();
  const check=journey.getByRole("checkbox").first();await check.focus();await check.press("Space");
  await page.getByText("Manually checked",{exact:true}).waitFor();
  assert.equal(await check.evaluate(n=>document.activeElement===n),true,"Keyboard manual check retains focus");
  const rename=journey.getByLabel("Plan title");await rename.fill("Private evening plan");await rename.press("Tab");
  await page.waitForFunction(async()=> (await window.backstage.companyBrief()).journeys[0].title==="Private evening plan");
  await page.getByRole("button",{name:"Open Rook Emberfall Adventure",exact:true}).click();
  await page.getByRole("heading",{name:"Rook Emberfall",exact:true}).waitFor();
  saved=await page.evaluate(()=>window.backstage.bootstrap());assert.equal(saved.state.activeProfileId,"rook'\"><b>");assert.equal(saved.state.followGameCharacter,false);
  await page.getByRole("button",{name:"Company",exact:true}).click();
  await page.getByRole("heading",{name:"Your adventure company.",exact:true}).waitFor();
  const evidence=path.join(__dirname,"../work/v08-ui-evidence");await fs.mkdir(evidence,{recursive:true});
  await page.screenshot({path:path.join(evidence,"company-horde.png"),fullPage:true});
  await page.getByLabel("Active character").selectOption("lark");
  await page.getByRole("heading",{name:"Your adventure company.",exact:true}).waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1160));
  await page.screenshot({path:path.join(evidence,"company-overview-viewport.png"),fullPage:false});
  await page.screenshot({path:path.join(evidence,"company-alliance.png"),fullPage:true});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
  await page.emulateMedia({reducedMotion:"reduce"});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,"No horizontal overflow at compact size");
  assert.equal(await page.getByRole("button",{name:"Create plan",exact:true}).evaluate(n=>n.getBoundingClientRect().bottom<innerHeight),true,"First useful action visible");
  assert.equal(await page.getByRole("button",{name:"Open recommended Lark Ashvale Adventure",exact:true}).evaluate(n=>n.getBoundingClientRect().bottom<innerHeight),true,"Recommended character action visible in first compact viewport");
  await page.screenshot({path:path.join(evidence,"company-compact.png"),fullPage:true});
  // A newer genuine GameSync observation updates evidence without eating a draft or focus.
  await journey.getByLabel("Plan title").fill("Still editing this title");
  const titleNode=journey.getByLabel("Plan title");await titleNode.evaluate(n=>n.setSelectionRange(4,9));
  clock+=60;captures[0].updatedAt=clock;captures[0].quests=[];captures[0].history.completedIds=[1061];await writeCapture();
  await page.evaluate(()=>window.backstage.refreshGame());
  await page.evaluate(async()=>{const {state}=await window.backstage.bootstrap();await window.backstage.saveState({...state,activeProfileId:"rook'\"><b>"},state);});
  await page.getByText("Observed in a newer saved snapshot",{exact:true}).waitFor({timeout:12000});
  assert.equal(await titleNode.inputValue(),"Still editing this title");
  assert.deepEqual(await titleNode.evaluate(n=>({focused:document.activeElement===n,start:n.selectionStart,end:n.selectionEnd})),{focused:true,start:4,end:9},"Poll preserves focus/selection");
  assert.equal(await page.getByLabel("Active character").inputValue(),"rook'\"><b>","Company header reflects a newer main-owned selection without stealing text focus");
  assert.equal(await journey.getByRole("checkbox").last().isDisabled(),true,"Observed proof is distinct from manual checkbox");
  await titleNode.press("Tab");
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Still editing this title");
  await page.getByLabel("Active character").selectOption("lark");await page.waitForFunction(()=>document.body.dataset.faction==="alliance"&&document.querySelector("[data-company-journey]"));
  clock+=60;captures[0].updatedAt=clock;captures[0].clientBuild="1.15.9.64001";await writeCapture();await page.evaluate(()=>window.backstage.refreshGame());
  await page.getByText("Historical saved completion",{exact:true}).waitFor({timeout:12000});
  await page.getByText(/saved game build changed/).waitFor();
  const historicalSnapshot=(await page.evaluate(()=>window.backstage.bootstrap())).state;
  // Reassignment must explicitly convert a quest to a clean manual step, including hostile backup IDs.
  await journey.getByLabel("Assigned character",{exact:true}).last().selectOption("rook'\"><b>");
  await page.waitForFunction(async()=>!(await window.backstage.companyBrief()).journeys[0].steps.at(-1).quest);
  saved=await page.evaluate(()=>window.backstage.bootstrap());assert.equal(saved.state.journeys[0].steps.at(-1).done,false);assert.equal(saved.state.journeys[0].steps.at(-1).observed,undefined);
  // Rejected text autosave retains the exact draft and supplies recovery.
  await titleNode.fill("");await titleNode.press("Tab");
  await page.getByRole("alert").waitFor();assert.equal(await titleNode.inputValue(),"");
  await page.waitForTimeout(5500);
  assert.equal(await page.getByRole("alert").count(),1,"Background polling must retain a failed autosave and Retry");
  await page.screenshot({path:path.join(evidence,"company-error.png"),fullPage:true});
  await titleNode.fill("Recovered evening plan");await titleNode.press("Tab");
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Recovered evening plan");
  // A late save acknowledgement cannot erase typing that began after that save.
  await app.evaluate(()=>{companyUiFixture.delay="backstage:journeyAction";companyUiFixture.release=null;});
  await titleNode.fill("First pending title");await titleNode.press("Tab");
  await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Action delay did not start");await new Promise(r=>setTimeout(r,10));}});
  await titleNode.fill("Newer retained draft");await app.evaluate(()=>companyUiFixture.release());
  await page.waitForFunction(()=>!document.querySelector('[data-company-form="note"] button').disabled);
  assert.equal(await titleNode.inputValue(),"Newer retained draft");await titleNode.press("Tab");
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Newer retained draft");
  // Programmatic repeated submit represents two queued clicks before IPC returns.
  await page.getByRole("button",{name:"Create plan",exact:true}).click();await page.getByLabel("Plan name").fill("Duplicate guard plan");
  await app.evaluate(()=>{companyUiFixture.delay="backstage:journeyAction";companyUiFixture.release=null;});
  await page.locator('[data-company-form="create"]').evaluate(n=>{n.requestSubmit();document.querySelector('[data-company-form="create"]').dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
  await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Creation delay did not start");await new Promise(r=>setTimeout(r,10));}});
  await app.evaluate(()=>companyUiFixture.release());await page.waitForFunction(()=>document.querySelectorAll("[data-company-journey]").length===2);
  assert.equal((await page.evaluate(()=>window.backstage.companyBrief())).journeys.length,2);
  await page.evaluate(()=>window.confirm=()=>true);await page.getByRole("button",{name:"Delete plan Duplicate guard plan",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll("[data-company-journey]").length===1);
  // A different selection can finish while a real journey reply is delayed.
  await app.evaluate(()=>{companyUiFixture.delay="backstage:journeyAction";companyUiFixture.release=null;});
  await journey.getByRole("checkbox").first().uncheck();
  await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Checkbox delay did not start");await new Promise(r=>setTimeout(r,10));}});
  await page.getByLabel("Active character").selectOption("rook'\"><b>");await app.evaluate(()=>companyUiFixture.release());
  await page.waitForFunction(()=>document.body.dataset.faction==="horde"&&document.querySelector("[data-company-journey]"));
  await page.getByRole("heading",{name:"Rook Emberfall",exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).state.activeProfileId,"rook'\"><b>");
  await page.getByLabel("Active character").selectOption("lark");
  await page.waitForFunction(()=>document.body.dataset.faction==="alliance"&&document.querySelector("[data-company-journey]"));
  await app.evaluate(()=>{companyUiFixture.delay="backstage:journeyAction";companyUiFixture.release=null;});
  await journey.getByRole("checkbox").first().evaluate(n=>{n.checked=!n.checked;n.dispatchEvent(new Event("change",{bubbles:true}));});
  await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Navigation queue delay did not start");await new Promise(r=>setTimeout(r,10));}});
  await titleNode.fill("Saved while leaving Company");await titleNode.press("Tab");
  await page.getByRole("button",{name:"Adventure",exact:true}).click();await app.evaluate(()=>companyUiFixture.release());
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Saved while leaving Company");
  await page.getByRole("button",{name:"Company",exact:true}).click();await titleNode.fill("Newer retained draft");await titleNode.press("Tab");
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Newer retained draft");
  // A delayed real read must never reopen Company or replace a newer selection after navigation.
  await page.getByRole("button",{name:"Adventure",exact:true}).click();
  await app.evaluate(()=>{companyUiFixture.delay="backstage:companyBrief";companyUiFixture.release=null;});
  await page.getByRole("button",{name:"Company",exact:true}).click();
  await app.evaluate(async()=>{while(!companyUiFixture.release)await new Promise(r=>setTimeout(r,10));});
  await page.getByRole("button",{name:"Adventure",exact:true}).click();
  await app.evaluate(()=>companyUiFixture.release());
  await page.getByRole("heading",{name:"Lark Ashvale",exact:true}).waitFor();assert.equal(await page.locator("[data-company]").count(),0);
  // Real backup round-trip restores plans. IDs are intentionally not restricted to UUIDs.
  const backup=path.join(dir,"company-backup.json");
  await app.evaluate((_e,file)=>{companyUiFixture.exportFile=file;companyUiFixture.importFile=file;},backup);
  assert.equal(await page.evaluate(()=>window.backstage.exportData()),true);
  const restoreJourney=(await page.evaluate(()=>window.backstage.companyBrief())).journeys[0].id;
  await page.evaluate(journeyId=>window.backstage.journeyAction({type:"rename",journeyId,title:"Pre-restore stale title"}),restoreJourney);
  await app.evaluate(()=>{companyUiFixture.delay="backstage:companyBrief";companyUiFixture.release=null;});
  await page.getByRole("button",{name:"Company",exact:true}).click();
  await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Restore read delay did not start");await new Promise(r=>setTimeout(r,10));}});
  await page.getByRole("button",{name:"Field Guide",exact:true}).click();
  await page.getByRole("button",{name:"Import backup",exact:true}).click();
  await page.getByRole("button",{name:"Company",exact:true}).click();
  await page.getByLabel("Plan title").waitFor();assert.equal(await page.getByLabel("Plan title").inputValue(),"Newer retained draft");
  await app.evaluate(()=>companyUiFixture.release());await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.getByLabel("Plan title").inputValue(),"Newer retained draft","Same-ID restore rejects a pre-import read");
  // Read errors are recoverable, even before the first useful Company response.
  await page.getByRole("button",{name:"Adventure",exact:true}).click();await app.evaluate(()=>companyUiFixture.failRead=true);
  await page.getByRole("button",{name:"Company",exact:true}).click();await page.getByRole("alert").waitFor();
  await app.evaluate(()=>companyUiFixture.failRead=false);await page.getByRole("button",{name:"Retry",exact:true}).click();
  await page.getByLabel("Plan title").waitFor();
  const noProfiles=path.join(dir,"no-profiles.json");
  historicalSnapshot.journeys[0].id="plan'\"><i>";historicalSnapshot.journeys[0].steps[0].id="step'\"><img>";
  await fs.writeFile(noProfiles,JSON.stringify({...historicalSnapshot,onboarded:true,profiles:[],activeProfileId:null}));
  await app.evaluate((_e,file)=>companyUiFixture.importFile=file,noProfiles);
  await page.getByRole("button",{name:"Field Guide",exact:true}).click();await page.getByRole("button",{name:"Import backup",exact:true}).click();
  await page.getByRole("button",{name:"Company",exact:true}).click();await page.getByText("A company begins with one adventurer.",{exact:true}).waitFor();
  assert.equal(await page.getByLabel("Collected character totals").locator("div").nth(1).locator("b").innerText(),"—","No observed logs must not imply known zero quests");
  assert.equal(await page.getByLabel("Collected character totals").locator("div").nth(2).locator("b").innerText(),"—","No observed logs must not imply known zero turn-ins");
  await page.getByText("Historical saved completion",{exact:true}).waitFor();await page.getByText(/Assigned character is missing/).waitFor();
  assert.equal(await page.getByLabel("Assigned character",{exact:true}).last().inputValue(),"lark","An orphan must retain its missing assignment");
  await page.getByLabel("Step text",{exact:true}).first().fill("Safe backup ID edit");await page.getByLabel("Step text",{exact:true}).first().press("Tab");
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].steps[0].text==="Safe backup ID edit");
  await page.screenshot({path:path.join(evidence,"company-no-profiles.png"),fullPage:true});
  await page.getByRole("button",{name:"Create plan",exact:true}).click();await page.getByLabel("Plan name").fill("Offline plan");
  await page.getByLabel("Plan name").press("Enter");await page.waitForFunction(()=>document.querySelectorAll("[data-company-journey]").length===2);
  assert.equal((await page.evaluate(()=>window.backstage.companyBrief())).journeys.at(-1).title,"Offline plan");
  assert.doesNotMatch(JSON.stringify(await page.evaluate(()=>window.backstage.contextPreview(null,false))),/PRIVATE_PLAN_SENTINEL|PRIVATE_NOTE/);
  // First use after reset can start planning without inventing a character.
  await page.getByRole("button",{name:"Adventure",exact:true}).click();
  await app.evaluate(()=>{companyUiFixture.delay="backstage:companyBrief";companyUiFixture.release=null;});
  await page.getByRole("button",{name:"Company",exact:true}).click();
  await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Reset read delay did not start");await new Promise(r=>setTimeout(r,10));}});
  await page.getByRole("button",{name:"Field Guide",exact:true}).click();await page.getByRole("button",{name:"Delete all local data",exact:true}).click();
  await page.getByRole("button",{name:"Start my adventure",exact:true}).waitFor();await app.evaluate(()=>companyUiFixture.release());
  assert.equal(await page.locator("[data-company]").count(),0,"Delayed pre-reset Company cannot reopen itself");
  await app.evaluate(()=>{companyUiFixture.delay="backstage:saveState";companyUiFixture.release=null;});
  await page.getByRole("button",{name:"Plan without a character",exact:true}).click();
  await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("First-use delay did not start");await new Promise(r=>setTimeout(r,10));}});
  await page.getByRole("button",{name:"Use a manual character",exact:true}).click();
  await app.evaluate(()=>companyUiFixture.release());
  await page.getByRole("heading",{name:"Every adventure starts somewhere.",exact:true}).waitFor();
  assert.equal(await page.locator("[data-company]").count(),0,"Late first-use save cannot override a newer setup choice");
  await page.getByRole("button",{name:"Plan without a character",exact:true}).click();
  await page.getByRole("heading",{name:"Your adventure company.",exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).state.profiles.length,0);
  await page.getByRole("button",{name:"Create plan",exact:true}).click();await page.getByLabel("Plan name").fill("Persistent offline plan");await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await page.getByLabel("Plan title").waitFor();assert.deepEqual(rendererErrors,[]);
  await app.close();app=await electron.launch({args:[path.join(__dirname,"..")],env:{...process.env,BF_USER_DATA:data}});
  await app.evaluate(({app})=>{
   const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));
   load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe=async()=>({state:"not-running",launchAvailable:false});
   load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch=async()=>{throw Error("Fixture blocks launch");};
   load("./src/core/providers.cjs").ask=async()=>{throw Error("Fixture blocks inference");};
   load("./src/core/claude.cjs").status=async()=>({installed:false,loggedIn:false});
  });
  const restarted=await testWindow(app);await restarted.getByRole("button",{name:"Company",exact:true}).click();
  assert.equal(await restarted.getByLabel("Plan title").inputValue(),"Persistent offline plan","Company plans survive restart");
  console.log(`Company source Electron ${process.argv.includes("--short-path")?"genuine 8.3":"normal"}: real plans/notes/quests, newer evidence+dirty focus, historical mismatch, manual conversion, delayed reads/actions, duplicate guard, private backup/import/reset, no-profile first use, menus/compact PASS`);
 }finally{clearTimeout(watchdog);await app?.close();const resolved=await fs.realpath(dir);assert.equal(path.dirname(resolved).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());assert.ok(path.basename(resolved).startsWith("forever-company-ui-"));await fs.rm(resolved,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
