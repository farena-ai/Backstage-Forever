"use strict";
const {_electron:electron}=require("playwright");
const fs=require("node:fs/promises"), path=require("node:path"), os=require("node:os"), assert=require("node:assert/strict");
const {testWindow}=require("./test-window.cjs");
const {assertSelectContrast}=require("./select-contrast.cjs");
const {selectCurrentText}=require("./selection-fixture.cjs");
const {defaultState}=require("../src/core/validation.cjs");
function shortPath(target) {
 const script=`Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfCompanyUiShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfCompanyUiShortPath]::GetShortPathName($env:BF_COMPANY_UI_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
 const alias=require("node:child_process").execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,BF_COMPANY_UI_ALIAS_PATH:target},encoding:"utf8",timeout:15000}).trim();
 assert.notEqual(alias.toLowerCase(),target.toLowerCase());assert.match(alias,/~\d/);assert.equal(require("node:fs").statSync(alias).ino,require("node:fs").statSync(target).ino);return alias;
}
// Optional CI regression injection: main has saved the preceding write, while its
// actual renderer acknowledgement is held. A forgotten settlement fails deterministically.
const setupRaces=process.argv.find(arg=>arg==="--setup-races"||arg.startsWith("--setup-races="));
if(setupRaces)assert.ok(["--setup-races","--setup-races=uncheck","--setup-races=remove-step","--setup-races=create","--setup-races=refresh"].includes(setupRaces),"Known setup-race case");
let setupWriteRelease=null, setupRefreshPending=setupRaces==="--setup-races"||setupRaces==="--setup-races=refresh";
async function releaseSetupWrite() {
 const release=setupWriteRelease;setupWriteRelease=null;await release?.();
}
async function armSetupRace(page,app,name) {
 if(!setupRaces || (setupRaces!=="--setup-races"&&setupRaces!==`--setup-races=${name}`))return;
 assert.equal(setupWriteRelease,null,"Previous injected acknowledgement has been consumed");
 await page.evaluate(async()=>{await autosaveQueue;});
 await app.evaluate(()=>{companyUiFixture.setupDelay="backstage:journeyAction";companyUiFixture.setupRelease=null;});
 setupWriteRelease=async()=>{
  await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.setupRelease){if(Date.now()>end)throw Error("Setup write did not reach its held acknowledgement");await new Promise(r=>setTimeout(r,10));}});
  const gap=await page.evaluate(async()=>({saved:(await window.backstage.bootstrap()).state.journeys,shown:state.journeys,plans:document.querySelectorAll("[data-company-journey]").length}));
  if(name==="uncheck"){assert.equal(gap.saved[0].steps[0].done,false);assert.equal(gap.shown[0].steps[0].done,true);}
  if(name==="remove-step"){assert.equal(gap.saved[0].steps.length,5);assert.equal(gap.shown[0].steps.length,6);}
  if(name==="create"){assert.equal(gap.saved.length,2);assert.equal(gap.shown.length,1);assert.equal(gap.plans,1);}
  console.log(`Injected ${name}: main saved the preceding mutation before renderer acknowledgement`);
  await app.evaluate(()=>companyUiFixture.setupRelease());
  await page.evaluate(async()=>{await autosaveQueue;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 };
}
// Main-store visibility can precede Company.perform's final renderer paint.
// Settle only the preceding accepted work, before dirtying the next text field.
async function settleCompanyWrite(page) {
 await releaseSetupWrite();
 await page.waitForFunction(()=>stateMutationBusy===0);
 const stable=await page.evaluate(async()=>{
  const previous=autosaveQueue;await previous;
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return previous===autosaveQueue&&stateMutationBusy===0;
 });
 assert.equal(stable,true,"Preceding Company write settled before preparing a new gesture");
}
// Preparation can be refreshed before a gesture begins. Bound acquisition to
// three hit-tested snapshots; record and retain the actual control at pointerdown.
async function physicalClick(page, locator, whilePressed) {
 assert.equal(setupWriteRelease,null,"Preceding injected write settled before gesture preparation");
 let prepared,ready=false,refreshed=false;
 for(let attempt=0;attempt<3&&!ready;attempt++){
  prepared=await locator.evaluate(node=>{
   window.companyControlKey=control=>control?JSON.stringify([control.tagName,control.type,control.name,
    control.dataset.companyField,control.dataset.companyFocus,control.dataset.companyCommand,control.dataset.companyOpen,
    control.closest("[data-company-journey]")?.dataset.companyJourney,
    control.closest("[data-company-step]")?.dataset.companyStep,
    control.closest("[data-company-form]")?.dataset.companyForm]):null;
   if(!node.isConnected||node.disabled)return null;
   node.scrollIntoView({block:"center",inline:"center",behavior:"instant"});
   const rect=node.getBoundingClientRect();if(!rect.width||!rect.height)return null;
   window.companyPointerSetup=node;
   return {identity:window.companyControlKey(node),x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  });
  if(!prepared)continue;
  // An ordinary read may replace this idle node before the gesture starts.
  if(setupRefreshPending){
   setupRefreshPending=false;refreshed=true;
   await page.evaluate(async()=>{window.companyPrepressRefreshNode=window.companyPointerSetup;await new Promise(r=>requestAnimationFrame(r));await Company.refresh();});
   assert.equal(await page.evaluate(()=>window.companyPrepressRefreshNode.isConnected),false,"Actual age-only Company refresh replaced the idle preparation node");
   console.log("Injected refresh: actual age-only Company read repainted before pointerdown");
  }
  await page.mouse.move(prepared.x,prepared.y);
  ready=await page.evaluate(({identity,x,y})=>{
   const hit=document.elementFromPoint(x,y)?.closest("button,input,select");
   if(!hit?.isConnected||hit.disabled||window.companyControlKey(hit)!==identity)return false;
   window.companyPointerTarget={node:null,identity:null,clicks:0};
   document.addEventListener("pointerdown",event=>{
    const node=event.target.closest("button,input,select");
    window.companyPointerTarget.node=node;window.companyPointerTarget.identity=window.companyControlKey(node);
    node?.addEventListener("click",()=>window.companyPointerTarget.clicks++,{once:true});
   },{once:true,capture:true});
   return true;
  },prepared);
 }
 assert.equal(ready,true,"Physical target prepared within three snapshots before pressing");
 await page.mouse.down();
 try {
  assert.equal(await page.evaluate(()=>window.companyPointerTarget.identity),prepared.identity,"Pointerdown reached the intended control");
  if(refreshed)assert.equal(await page.evaluate(()=>window.companyPointerTarget.node===window.companyPrepressRefreshNode),false,"Gesture owns the current control after idle refresh");
  await whilePressed?.();
 } finally {await page.mouse.up();}
 assert.equal(await page.evaluate(()=>window.companyPointerTarget.clicks),1,"One physical click must reach the original control");
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
   dialog.showMessageBox=async()=>{companyUiFixture.confirmCalls=(companyUiFixture.confirmCalls||0)+1;return {response:companyUiFixture.confirm??1};};
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
     if(companyUiFixture.setupDelay===channel){companyUiFixture.setupDelay=null;await new Promise(r=>companyUiFixture.setupRelease=r);return result;}
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
  await settleCompanyWrite(page);
  // Held native Space must survive an intervening scheduled root render.
  const keyboardCheck=journey.getByRole("checkbox").first();
  await keyboardCheck.focus();
  await keyboardCheck.evaluate(node=>{window.companySpace={original:node,changes:0};node.addEventListener("change",()=>window.companySpace.changes++);});
  await app.evaluate(()=>companyUiFixture.spaceWrites=0);
  await app.evaluate(({ipcMain})=>{
   const original=ipcMain._invokeHandlers.get("backstage:journeyAction");ipcMain.removeHandler("backstage:journeyAction");
   ipcMain.handle("backstage:journeyAction",(event,...args)=>{if(args[0]?.type==="set-done")companyUiFixture.spaceWrites++;return original(event,...args);});
  });
  await page.keyboard.down("Space");await page.evaluate(()=>new Promise(resolve=>setTimeout(()=>{render();resolve();},0)));
  assert.equal(await keyboardCheck.evaluate(node=>node===window.companySpace.original),true,"Held Company checkbox Space must retain its native target until keyup");
  await page.keyboard.up("Space");
  await page.waitForFunction(async()=>window.companySpace.changes===1&&(await window.backstage.companyBrief()).journeys[0].steps[0].done);
  await settleCompanyWrite(page);
  assert.equal(await keyboardCheck.isChecked(),true);assert.equal(await app.evaluate(()=>companyUiFixture.spaceWrites),1,"Exactly one native activation reaches persisted completion");
  assert.equal(await keyboardCheck.evaluate(node=>node===document.activeElement),true,"Checkbox focus survives deferred render and saved acknowledgement");
  await keyboardCheck.uncheck();await settleCompanyWrite(page);
  // Natural title blur must preserve the next pointer target even behind queued work.
  const pointerTitle=journey.getByLabel("Plan title"),pointerCheck=journey.getByRole("checkbox").first();
  await page.evaluate(async()=>{await autosaveQueue;window.companyHeldQueue={};window.companyHeldQueue.promise=new Promise(resolve=>window.companyHeldQueue.release=resolve);autosaveQueue=window.companyHeldQueue.promise;});
  await pointerTitle.fill("One click queued title");
  await physicalClick(page,pointerCheck,async()=>{
   assert.equal(await page.evaluate(()=>autosaveQueue!==window.companyHeldQueue.promise),true,"Natural blur accepted the title before pointer release");
  });
  await page.evaluate(()=>window.companyHeldQueue.release());
  await page.waitForFunction(async()=>{const j=(await window.backstage.companyBrief()).journeys[0];return j.title==="One click queued title"&&j.steps[0].done;});
  await armSetupRace(page,app,"uncheck");
  await pointerCheck.uncheck();
  await page.waitForFunction(async()=>!(await window.backstage.companyBrief()).journeys[0].steps[0].done);
  await settleCompanyWrite(page);
  // A fast acknowledgement/read/full-root refresh while the physical button is down
  // must not detach the newly focused input, or steal its later typed text/range.
  await app.evaluate(()=>{companyUiFixture.delay="backstage:journeyAction";companyUiFixture.release=null;});
  await pointerTitle.fill("Fast acknowledgement title");
  await physicalClick(page,journey.getByLabel("Note step"),async()=>{
   await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Natural blur delay did not start");await new Promise(r=>setTimeout(r,10));}companyUiFixture.release();});
   await page.evaluate(async()=>{await autosaveQueue;await Company.refresh();render();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   assert.equal(await page.evaluate(()=>window.companyPointerTarget.node.isConnected),true,"Fast ack/poll keeps the pressed input mounted");
  });
  await page.waitForFunction(()=>document.activeElement?.getAttribute("aria-label")==="Plan title"?false:document.activeElement?.name==="note");
  await page.keyboard.type("Pointer entry text");
  assert.equal(await journey.getByLabel("Note step").inputValue(),"Pointer entry text");
  assert.equal(await journey.getByLabel("Note step").evaluate(n=>document.activeElement===n&&n.selectionStart===n.value.length),true,"Next field accepts real keyboard typing after ack");
  await pointerTitle.fill("Keyboard transfer title");await pointerTitle.press("Tab");
  await page.waitForFunction(async()=>{await autosaveQueue;return document.activeElement?.dataset.companyCommand==="remove";});
  assert.equal(await journey.getByRole("button",{name:"Delete plan Keyboard transfer title",exact:true}).evaluate(n=>document.activeElement===n),true,"Keyboard Tab also reaches its natural next control");
  await settleCompanyWrite(page);
  // An unrelated pending text edit must not disable or lose the next submit button.
  const originalStep=(await page.evaluate(()=>window.backstage.companyBrief())).journeys[0].steps[0].text;
  await journey.getByLabel("Step text",{exact:true}).first().fill("Pointer step edit");
  await app.evaluate(()=>{companyUiFixture.delay="backstage:journeyAction";companyUiFixture.release=null;});
  await physicalClick(page,journey.getByRole("button",{name:"Add note",exact:true}),async()=>{
   await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Step blur delay did not start");await new Promise(r=>setTimeout(r,10));}});
  });
  await app.evaluate(()=>companyUiFixture.release());
  await page.waitForFunction(async()=>{const j=(await window.backstage.companyBrief()).journeys[0];return j.steps[0].text==="Pointer step edit"&&j.steps.at(-1).text==="Pointer entry text";});
  await settleCompanyWrite(page);
  await armSetupRace(page,app,"remove-step");
  await journey.getByRole("button",{name:"Remove Pointer entry text",exact:true}).click();
  await settleCompanyWrite(page);
  await journey.getByLabel("Step text",{exact:true}).first().fill(originalStep);
  await physicalClick(page,journey.getByLabel("Assigned character",{exact:true}).first(),async()=>{
   await page.evaluate(async()=>{await autosaveQueue;await Company.refresh();render();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   assert.equal(await page.evaluate(()=>window.companyPointerTarget.node.isConnected),true,"Assignment popup survives blur ack/poll");
  });
  await page.keyboard.press("Home");await page.keyboard.press("ArrowDown");await page.keyboard.press("Enter");
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].steps[0].profileId==="lark");
  await settleCompanyWrite(page);
  await physicalClick(page,journey.getByLabel("Note step"));
  await journey.getByLabel("Assigned character",{exact:true}).first().selectOption("");
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].steps[0].profileId===null);
  await settleCompanyWrite(page);
  await pointerTitle.fill("Button focus title");
  await physicalClick(page,page.getByRole("button",{name:"Create plan",exact:true}));
  await page.waitForFunction(()=>document.activeElement?.name==="title"&&document.activeElement.closest('[data-company-form="create"]'));
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
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
  // Same-ID saved identity/level/source changes must update chrome during a dirty edit.
  const sameIdTitle=journey.getByLabel("Plan title");await sameIdTitle.fill("Same-ID retained draft");
  // A real read may finish between resolving an idle locator and evaluating its
  // setter. Prove that stale preparation changes only the disconnected element.
  await app.evaluate(()=>{companyUiFixture.delay="backstage:companyBrief";companyUiFixture.release=null;});
  await page.evaluate(()=>{void Company.refresh();});
  await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Caret preparation read did not reach its held reply");await new Promise(r=>setTimeout(r,10));}});
  await page.evaluate(()=>{window.companyCaretResolvedNode=document.querySelector('[data-company-edit="title"]');});
  await app.evaluate(()=>companyUiFixture.release());
  // refresh() can return early when a poll already owns the read. Observe the
  // accepted replacement itself; neither focus nor the expected range gates it.
  await page.waitForFunction(()=>!window.companyCaretResolvedNode.isConnected);
  assert.deepEqual(await page.evaluate(()=>{
   const old=window.companyCaretResolvedNode,current=document.querySelector('[data-company-edit="title"]');
   old.setSelectionRange(3,8);
   return {oldConnected:old.isConnected,oldStart:old.selectionStart,oldEnd:old.selectionEnd,replaced:old!==current,value:current.value,focused:document.activeElement===current,start:current.selectionStart,end:current.selectionEnd};
  }),{oldConnected:false,oldStart:3,oldEnd:8,replaced:true,value:"Same-ID retained draft",focused:true,start:22,end:22},"Held real read exposes stale selection preparation without changing the current draft");
  await selectCurrentText(page,{selector:'[data-company-edit="title"]',value:"Same-ID retained draft",start:3,end:8});
  console.log("Injected caret preparation: real held read replaced the idle target; atomic setup owns the current exact range");
  clock=Math.floor(Date.now()/1000);Object.assign(captures[0],{updatedAt:clock,name:"Lark Dawnvale",level:32,className:"Warrior",faction:"Horde"});await writeCapture();await page.evaluate(()=>window.backstage.refreshGame());
  await page.waitForFunction(()=>document.body.dataset.faction==="horde"&&document.body.dataset.class==="warrior"&&document.querySelector('#active-character option:checked')?.textContent.includes("Lark Dawnvale · Level 32"),{},{timeout:12000});
  assert.match(await page.locator(".game-status-chip small").innerText(),/Saved · just now/);
  assert.equal(await sameIdTitle.inputValue(),"Same-ID retained draft");
  assert.deepEqual(await page.evaluate(()=>{const n=document.querySelector('[data-company-edit="title"]');return {value:n.value,focused:document.activeElement===n,start:n.selectionStart,end:n.selectionEnd};}),{value:"Same-ID retained draft",focused:true,start:3,end:8},"Same-ID chrome update retains dirty text and focus");
  // A physical click followed by native Shift+Arrow creates a newer selection.
  // The next genuine same-ID header/source update must preserve that selection.
  await physicalClick(page,sameIdTitle);
  await page.keyboard.press("Home");for(let i=0;i<4;i++)await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift");try{for(let i=0;i<5;i++)await page.keyboard.press("ArrowRight");}finally{await page.keyboard.up("Shift");}
  assert.deepEqual(await page.evaluate(()=>{const n=document.querySelector('[data-company-edit="title"]');return {value:n.value,focused:document.activeElement===n,start:n.selectionStart,end:n.selectionEnd};}),{value:"Same-ID retained draft",focused:true,start:4,end:9},"Physical selection owns the current draft before the next source update");
  clock+=60;Object.assign(captures[0],{updatedAt:clock,name:"Lark Ashvale",level:31,className:"Mage",faction:"Alliance"});await writeCapture();await page.evaluate(()=>window.backstage.refreshGame());
  await page.waitForFunction(()=>document.body.dataset.faction==="alliance"&&document.body.dataset.class==="mage"&&document.querySelector('#active-character option:checked')?.textContent.includes("Lark Ashvale · Level 31"),{},{timeout:12000});
  assert.deepEqual(await page.evaluate(()=>{const n=document.querySelector('[data-company-edit="title"]');return {value:n.value,focused:document.activeElement===n,start:n.selectionStart,end:n.selectionEnd};}),{value:"Same-ID retained draft",focused:true,start:4,end:9},"Same-ID header/source paint preserves a newer physical selection");
  await sameIdTitle.press("Tab");await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Same-ID retained draft");
  // A real same-ID GameSync/header poll can arrive while a natural blur's
  // acknowledgement resolves and the next input is still physically pressed.
  await settleCompanyWrite(page);
  await app.evaluate(()=>{companyUiFixture.delay="backstage:journeyAction";companyUiFixture.release=null;});
  await sameIdTitle.fill("Held same-ID header title");
  await physicalClick(page,journey.getByLabel("Note step"),async()=>{
   await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.release){if(Date.now()>end)throw Error("Header blur delay did not start");await new Promise(r=>setTimeout(r,10));}companyUiFixture.release();});
   await page.evaluate(async()=>{await autosaveQueue;});
   clock+=60;captures[0].updatedAt=clock;captures[0].level=32;await writeCapture();await page.evaluate(()=>window.backstage.refreshGame());
   await page.waitForFunction(()=>state.profiles.find(p=>p.id==="lark")?.level===32,{},{timeout:12000});
   assert.equal(await page.evaluate(()=>window.companyPointerTarget.node.isConnected),true,"Real same-ID header poll preserves the pressed input");
   assert.match(await page.locator('#active-character option:checked').innerText(),/Level 31/,"Header rendering waits for the gesture, while root state accepts the new capture");
  });
  await page.waitForFunction(()=>document.querySelector('#active-character option:checked')?.textContent.includes("Level 32"));
  assert.equal(await journey.getByLabel("Note step").evaluate(n=>document.activeElement===n),true,"Deferred real header poll preserves next-input focus");
  await page.keyboard.type("Header poll typing");assert.equal(await journey.getByLabel("Note step").inputValue(),"Header poll typing");
  await journey.getByLabel("Note step").fill("");
  clock+=60;captures[0].updatedAt=clock;captures[0].level=31;await writeCapture();await page.evaluate(()=>window.backstage.refreshGame());
  await page.waitForFunction(()=>document.querySelector('#active-character option:checked')?.textContent.includes("Level 31"),{},{timeout:12000});
  // A newer genuine GameSync observation updates evidence without eating a draft or focus.
  await journey.getByLabel("Plan title").fill("Still editing this title");
  const titleNode=journey.getByLabel("Plan title");await selectCurrentText(page,{selector:'[data-company-edit="title"]',value:"Still editing this title",start:4,end:9});
  clock+=60;captures[0].updatedAt=clock;captures[0].quests=[];captures[0].history.completedIds=[1061];await writeCapture();
  await page.evaluate(()=>window.backstage.refreshGame());
  await page.evaluate(async()=>{const {state}=await window.backstage.bootstrap();await window.backstage.saveState({...state,activeProfileId:"rook'\"><b>"},state);});
  await page.getByText("Observed in a newer saved snapshot",{exact:true}).waitFor({timeout:12000});
  assert.equal(await titleNode.inputValue(),"Still editing this title");
  assert.deepEqual(await page.evaluate(()=>{const n=document.querySelector('[data-company-edit="title"]');return {value:n.value,focused:document.activeElement===n,start:n.selectionStart,end:n.selectionEnd};}),{value:"Still editing this title",focused:true,start:4,end:9},"Poll preserves focus/selection");
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
  await titleNode.fill("Newer retained draft");await physicalClick(page,titleNode);
  await page.keyboard.press("Home");for(let i=0;i<3;i++)await page.keyboard.press("ArrowRight");
  await page.keyboard.down("Shift");try{for(let i=0;i<5;i++)await page.keyboard.press("ArrowRight");}finally{await page.keyboard.up("Shift");}
  assert.deepEqual(await page.evaluate(()=>{const n=document.querySelector('[data-company-edit="title"]');return {value:n.value,focused:document.activeElement===n,start:n.selectionStart,end:n.selectionEnd};}),{value:"Newer retained draft",focused:true,start:3,end:8},"New physical selection precedes the older save acknowledgement");
  await app.evaluate(()=>companyUiFixture.release());await settleCompanyWrite(page);
  await page.waitForFunction(()=>!document.querySelector('[data-company-form="note"] button').disabled);
  assert.equal(await titleNode.inputValue(),"Newer retained draft");
  assert.deepEqual(await page.evaluate(()=>{const n=document.querySelector('[data-company-edit="title"]');return {value:n.value,focused:document.activeElement===n,start:n.selectionStart,end:n.selectionEnd};}),{value:"Newer retained draft",focused:true,start:3,end:8},"Older save acknowledgement preserves the newer physical selection");
  await titleNode.press("Tab");
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Newer retained draft");
  if(process.argv.includes("--caret-only")){console.log("Company actual main/preload/read/header/older-save and physical selection regression PASS");return;}
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
  await page.evaluate(async()=>{await autosaveQueue;window.companyHeldQueue={};window.companyHeldQueue.promise=new Promise(resolve=>window.companyHeldQueue.release=resolve);autosaveQueue=window.companyHeldQueue.promise;});
  await titleNode.fill("Saved while leaving Company");await titleNode.press("Tab");
  assert.equal(await page.evaluate(()=>autosaveQueue!==window.companyHeldQueue.promise),true,"Blur has entered the held real renderer queue before navigation");
  await page.getByRole("button",{name:"Adventure",exact:true}).click();await page.evaluate(()=>window.companyHeldQueue.release());
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Saved while leaving Company");
  await page.getByRole("button",{name:"Company",exact:true}).click();await titleNode.fill("Newer retained draft");await titleNode.press("Tab");
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Newer retained draft");
  await page.evaluate(async()=>{await autosaveQueue;window.companyHeldQueue={};window.companyHeldQueue.promise=new Promise(resolve=>window.companyHeldQueue.release=resolve);autosaveQueue=window.companyHeldQueue.promise;});
  await titleNode.fill("Saved across queued selection");await titleNode.press("Tab");
  assert.equal(await page.evaluate(()=>autosaveQueue!==window.companyHeldQueue.promise),true,"Selection regression starts with an accepted queued blur");
  await page.getByLabel("Active character").selectOption("rook'\"><b>");await page.evaluate(()=>window.companyHeldQueue.release());
  await page.waitForFunction(async()=>{const {state}=await window.backstage.bootstrap();return state.activeProfileId==="rook'\"><b>"&&state.journeys[0].title==="Saved across queued selection";});
  await page.waitForFunction(()=>document.body.dataset.faction==="horde"&&document.querySelector("[data-company-journey]"));
  await page.getByLabel("Active character").selectOption("lark");await page.waitForFunction(()=>document.body.dataset.faction==="alliance"&&document.querySelector("[data-company-journey]"));
  await titleNode.fill("Newer retained draft");await titleNode.press("Tab");await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Newer retained draft");
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
  // Cancellation is an actual main/dialog outcome. Only the boundary trigger is synthetic.
  await page.getByRole("button",{name:"Company",exact:true}).click();await titleNode.waitFor();
  for(const boundary of ["import","reset"]){
   await page.evaluate(async()=>{await autosaveQueue;window.companyHeldQueue={};window.companyHeldQueue.promise=new Promise(resolve=>window.companyHeldQueue.release=resolve);autosaveQueue=window.companyHeldQueue.promise;});
   await titleNode.fill(`Accepted before cancelled ${boundary}`);await titleNode.press("Tab");
   assert.equal(await page.evaluate(()=>autosaveQueue!==window.companyHeldQueue.promise),true);
   await app.evaluate(()=>{companyUiFixture.confirm=0;companyUiFixture.confirmCalls=0;});
   await page.evaluate(command=>{const button=document.createElement("button");button.dataset.command=command;button.dataset.companyBoundaryFixture="true";button.textContent="Fixture boundary";document.getElementById("app").append(button);},boundary);
   await page.locator("[data-company-boundary-fixture]").click();await page.evaluate(()=>window.companyHeldQueue.release());
   await page.waitForFunction(()=>stateMutationBusy===0);
   await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyUiFixture.confirmCalls){if(Date.now()>end)throw Error("Cancellation did not reach the real confirmation");await new Promise(r=>setTimeout(r,10));}});
   const kept=(await page.evaluate(()=>window.backstage.bootstrap())).state;
   assert.equal(kept.journeys[0].title,`Accepted before cancelled ${boundary}`);assert.equal(kept.profiles.length,2);
   await page.locator("[data-company-boundary-fixture]").evaluate(n=>n.remove());
   await page.getByRole("button",{name:"Company",exact:true}).click();await titleNode.waitFor();
  }
  await app.evaluate(()=>companyUiFixture.confirm=1);
  await titleNode.fill("Newer retained draft");await titleNode.press("Tab");await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Newer retained draft");
  await page.getByRole("button",{name:"Adventure",exact:true}).click();
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
  await page.evaluate(async()=>{await autosaveQueue;window.companyHeldQueue={};window.companyHeldQueue.promise=new Promise(resolve=>window.companyHeldQueue.release=resolve);autosaveQueue=window.companyHeldQueue.promise;});
  await page.getByLabel("Plan title").fill("Persistent accepted queued plan");await page.getByLabel("Plan title").press("Tab");
  assert.equal(await page.evaluate(()=>autosaveQueue!==window.companyHeldQueue.promise),true);
  await page.getByRole("button",{name:"Adventure",exact:true}).click();await page.evaluate(()=>window.companyHeldQueue.release());
  await page.waitForFunction(async()=>(await window.backstage.companyBrief()).journeys[0].title==="Persistent accepted queued plan");
  // Keep a separate natural-click plan for actual restart readback, alongside the
  // accepted queued-navigation plan above (neither persistence assertion replaces the other).
  await page.getByRole("button",{name:"Company",exact:true}).click();
  await page.getByRole("button",{name:"Create plan",exact:true}).click();
  await page.getByLabel("Plan name").fill("Pointer restart plan");
  await armSetupRace(page,app,"create");
  await page.getByRole("button",{name:"Save plan",exact:true}).click();
  await settleCompanyWrite(page);
  const restartPlan=page.locator("[data-company-journey]").last();
  assert.equal(await restartPlan.getByLabel("Plan title").inputValue(),"Pointer restart plan","The new plan owns restart setup before filling its note");
  await restartPlan.getByLabel("Note step").fill("Persistent pointer step");await restartPlan.getByRole("button",{name:"Add note",exact:true}).click();
  await restartPlan.getByRole("checkbox").waitFor();
  await settleCompanyWrite(page);
  await restartPlan.getByLabel("Plan title").fill("Persistent pointer title");
  await physicalClick(page,restartPlan.getByRole("checkbox"));
  await page.waitForFunction(async()=>{const j=(await window.backstage.companyBrief()).journeys.at(-1);return j.title==="Persistent pointer title"&&j.steps[0].done;});
  await app.close();app=await electron.launch({args:[path.join(__dirname,"..")],env:{...process.env,BF_USER_DATA:data}});
  await app.evaluate(({app})=>{
   const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));
   load("./src/core/game-runtime.cjs").GameRuntime.prototype.probe=async()=>({state:"not-running",launchAvailable:false});
   load("./src/core/game-runtime.cjs").GameRuntime.prototype.launch=async()=>{throw Error("Fixture blocks launch");};
   load("./src/core/providers.cjs").ask=async()=>{throw Error("Fixture blocks inference");};
   load("./src/core/claude.cjs").status=async()=>({installed:false,loggedIn:false});
  });
  const restarted=await testWindow(app);await restarted.getByRole("button",{name:"Company",exact:true}).click();
  assert.equal(await restarted.getByLabel("Plan title").first().inputValue(),"Persistent accepted queued plan","Accepted queued blur survives navigation and a real restart");
  const restartedPointer=restarted.locator("[data-company-journey]").last();
  assert.equal(await restartedPointer.getByLabel("Plan title").inputValue(),"Persistent pointer title","Natural blur title survives restart");
  assert.equal(await restartedPointer.getByRole("checkbox").isChecked(),true,"One physical checkbox action survives restart");
  assert.equal(await restartedPointer.getByLabel("Step text").inputValue(),"Persistent pointer step");
  assert.equal(setupWriteRelease,null,"Every injected preceding write was settled before its next gesture");
  assert.equal(setupRefreshPending,false,"Requested idle refresh injection ran before a gesture");
  console.log(`Company source Electron ${process.argv.includes("--short-path")?"genuine 8.3":"normal"}: single physical blur clicks/focus/select/submit/restart, real plans/notes/quests, newer evidence+dirty focus, historical mismatch, manual conversion, delayed reads/actions, duplicate guard, private backup/import/reset, no-profile first use, menus/compact PASS`);
 }finally{clearTimeout(watchdog);await app?.close();const resolved=await fs.realpath(dir);assert.equal(path.dirname(resolved).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());assert.ok(path.basename(resolved).startsWith("forever-company-ui-"));await fs.rm(resolved,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
