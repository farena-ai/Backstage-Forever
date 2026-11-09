"use strict";
// Source Electron with synthetic saves and bounded, fixture-owned side-effect hooks.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), syncFs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfDirectorShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfDirectorShortPath]::GetShortPathName($env:BF_DIRECTOR_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,BF_DIRECTOR_ALIAS_PATH:target},encoding:"utf8",timeout:15000}).trim();
  assert.notEqual(alias.toLowerCase(),target.toLowerCase(),"A genuine distinct Windows 8.3 alias is required");
  assert.match(alias,/~\d/);assert.equal(syncFs.statSync(alias).ino,syncFs.statSync(target).ino);
  return alias;
}
(async()=>{
  const tempRoot=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(tempRoot,"forever-director-backend-"));
  let app;
  const watchdog=setTimeout(()=>{console.error("Director fixture exceeded 100 seconds");process.exitCode=1;app?.process().kill();},100000);
  try {
    const normalData=path.join(dir,"synthetic-user-data");await fs.mkdir(normalData);
    const data=process.argv.includes("--short-path")?shortPath(normalData):normalData;
    const game=path.join(dir,"synthetic-client"),saved=path.join(game,"WTF/Account/Synthetic/SavedVariables/BackstageForever.lua"),backup=path.join(dir,"backup.json");
    await fs.mkdir(path.dirname(saved),{recursive:true});await fs.writeFile(path.join(game,".flavor.info"),"wowf");
    const p=id=>({id,name:id,realm:"Synthetic Realm",className:"Mage",level:12,notes:"PRIVATE_NOTE_SENTINEL",goals:[{id:"g",text:"PRIVATE_GOAL_SENTINEL",done:false}]});
    const initial={...defaultState(),onboarded:true,profiles:[p("Alpha"),p("Beta")],activeProfileId:"Alpha"};
    await fs.writeFile(path.join(data,"state.json"),JSON.stringify(initial));
    const launch=async()=>{
      app=await electron.launch({args:[path.join(__dirname,"..")],env:{...process.env,BF_USER_DATA:data},timeout:20000});
      await app.evaluate(({app,dialog})=>{
        const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));
        globalThis.directorFixture={confirm:1,inference:0,launches:0};
        const {GameRuntime}=load("./src/core/game-runtime.cjs");
        GameRuntime.prototype.probe=async()=>({state:"not-running",checkedAt:null,launchAvailable:false});
        GameRuntime.prototype.launch=async()=>{directorFixture.launches++;throw Error("Fixture blocks real launch");};
        load("./src/core/claude.cjs").status=async()=>({installed:false,loggedIn:false});
        load("./src/core/providers.cjs").ask=async()=>{directorFixture.inference++;throw Error("Fixture blocks inference");};
        dialog.showMessageBox=async()=>({response:directorFixture.confirm});
        dialog.showSaveDialog=async()=>({canceled:false,filePath:directorFixture.backup});
        dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directorFixture.backup]});
      });
      const page=await testWindow(app);page.setDefaultTimeout(10000);return page;
    };
    let page=await launch();
    const start=(profileId="Alpha",options={minutes:30,focus:"balanced"})=>page.evaluate(({profileId,options})=>window.backstage.startDirectorSession(profileId,options),{profileId,options});
    await assert.rejects(()=>start());
    const raw=await app.evaluate(async({ipcMain,BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0],event={sender:win.webContents,senderFrame:win.webContents.mainFrame},handler=ipcMain._invokeHandlers.get("backstage:startDirectorSession");
      const rejected=async(fn)=>{try{await fn();return false;}catch{return true;}};
      return {
        missing:await rejected(()=>handler(event,"Alpha")),extra:await rejected(()=>handler(event,"Alpha",{},{})),
        foreign:await rejected(()=>handler({sender:{},senderFrame:{url:"file:///wrong"}},"Alpha",{})),
        frame:await rejected(()=>handler({sender:win.webContents,senderFrame:{url:win.webContents.mainFrame.url}},"Alpha",{})),
        proof:await rejected(()=>handler(event,"Alpha",{questIds:[1],source:"forged"})),
      };
    });
    assert.deepEqual(raw,{missing:true,extra:true,foreign:true,frame:true,proof:true});
    await assert.rejects(()=>page.evaluate(()=>window.backstage.startDirectorSession("Alpha",{},"extra")));
    let clock=1794225600;
    const q=(id,extra={})=>({id,title:`Observed quest ${id}`,complete:false,objectives:[{text:"Saved objective",done:false}],...extra});
    const characters=[{id:"Synthetic-Alpha",name:"Alpha",realm:"Synthetic Realm",className:"Mage",level:12,updatedAt:clock,clientBuild:"1.15.8.64000",captureVersion:require("../package.json").version,location:{zone:"Forest",subZone:"Synthetic",mapId:1,x:0.2,y:0.2},quests:[q(1,{complete:true}),q(2,{zone:"Forest"}),q(3),q(4)],history:{recent:[],completedIdsKnown:true,completedIds:[]},readiness:{bags:{free:2,total:20}}},{id:"Synthetic-Beta",name:"Beta",realm:"Synthetic Realm",className:"Mage",level:10,updatedAt:clock,clientBuild:"1.15.8.64000",quests:[]}];
    const write=()=>fs.writeFile(saved,"BackstageForeverExport = "+JSON.stringify(JSON.stringify({schema:1,observedAt:clock,activeId:characters[0].id,characters})));
    await write();let snapshot=await page.evaluate(root=>window.backstage.prepareGame(root),game);
    assert.equal(snapshot.brief.director.primary.questId,1);assert.equal(snapshot.brief.director.choices.length,3);
    assert.equal(snapshot.brief.director.privateGoals[0].text,"PRIVATE_GOAL_SENTINEL");
    const guidance=await page.evaluate(()=>window.backstage.guidancePlan("Alpha",{minutes:60,focus:"balanced"}));assert.equal(guidance.steps.length,4);assert.equal(guidance.director.alternatives.length,2);
    const before=structuredClone(snapshot.state);
    let result=await start();assert.equal(result.created,true);const jid=result.journeyId;
    assert.deepEqual(result.state.journeys[0].steps.map(s=>s.quest.id),[1,2]);assert.equal(result.state.journeys[0].steps[0].quest.baselineAt,new Date(clock*1000).toISOString());
    assert.doesNotMatch(JSON.stringify(result.state.journeys),/PRIVATE_/);
    await page.evaluate(journeyId=>window.backstage.journeyAction({type:"rename",journeyId,title:"My renamed session"}),jid);
    result=await start();assert.equal(result.created,false);assert.equal(result.journeyId,jid);assert.equal(result.state.journeys.length,1);
    // A newer saved source owns the next session's baseline, despite a stale UI draft.
    clock+=60;characters[0].updatedAt=clock;characters[0].quests=[q(3,{complete:true}),q(4,{zone:"Forest"})];await write();
    snapshot=await page.evaluate(()=>window.backstage.refreshGame());
    result=await start();assert.equal(result.created,true);assert.deepEqual(result.state.journeys[1].steps.map(s=>s.quest.id),[3,4]);assert.equal(result.state.journeys[1].steps[0].quest.baselineAt,new Date(clock*1000).toISOString());
    before.profiles[0].notes="New draft";before.journeys=[];
    const edited=await page.evaluate(({state,base})=>window.backstage.saveState(state,base),{state:before,base:before});assert.equal(edited.journeys.length,2);assert.equal(edited.profiles[0].quests[0].id,3);
    const switched=structuredClone(edited);switched.activeProfileId="Beta";
    await page.evaluate(({state,base})=>window.backstage.saveState(state,base),{state:switched,base:edited});
    await assert.rejects(()=>start("Alpha"));
    const afterRejected=(await page.evaluate(()=>window.backstage.bootstrap())).state;assert.equal(afterRejected.journeys.length,2);assert.equal(afterRejected.activeProfileId,"Beta");assert.equal(afterRejected.followGameCharacter,false);
    const publicContext=await page.evaluate(()=>window.backstage.contextPreview("Alpha",true,"Explain my plan"));assert.doesNotMatch(JSON.stringify(publicContext),/PRIVATE_|New draft|sourceHash/);
    assert.deepEqual(await app.evaluate(()=>({inference:directorFixture.inference,launches:directorFixture.launches})),{inference:0,launches:0});
    const active=structuredClone(afterRejected);active.activeProfileId="Alpha";
    await page.evaluate(({state,base})=>window.backstage.saveState(state,base),{state:active,base:afterRejected});
    await app.close();app=null;page=await launch();
    result=await start();assert.equal(result.created,false);assert.equal(result.state.journeys.length,2);assert.deepEqual(result.state.journeys[1].steps.map(s=>s.quest.id),[3,4]);
    await app.evaluate((_e,file)=>directorFixture.backup=file,backup);assert.equal(await page.evaluate(()=>window.backstage.exportData()),true);
    // Import replaces state; stale profile/session requests must be re-evaluated.
    await fs.writeFile(backup,JSON.stringify({...defaultState(),onboarded:true,profiles:[p("Manual")],activeProfileId:"Manual"}));
    const imported=await page.evaluate(()=>window.backstage.importData());assert.equal(imported.profiles[0].id,"Manual");assert.deepEqual(imported.journeys,[]);await assert.rejects(()=>start("Alpha"));await assert.rejects(()=>start("Manual"));
    await app.close();app=null;page=await launch();
    assert.deepEqual((await page.evaluate(()=>window.backstage.bootstrap())).state.journeys,[]);await assert.rejects(()=>start("Alpha"));
    await app.evaluate(({app})=>{
      const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));const {GameSync}=load("./src/core/game-sync.cjs"),reset=GameSync.prototype.reset;
      GameSync.prototype.reset=async function(){await new Promise(resolve=>directorFixture.releaseReset=resolve);return reset.call(this);};
    });
    await page.evaluate(()=>{window.directorReset=window.backstage.resetData();});
    await app.evaluate(async()=>{const end=Date.now()+5000;while(!directorFixture.releaseReset){if(Date.now()>end)throw Error("Reset did not start");await new Promise(r=>setTimeout(r,10));}});
    await assert.rejects(()=>start("Manual"));await app.evaluate(()=>directorFixture.releaseReset());
    assert.deepEqual((await page.evaluate(()=>window.directorReset)).profiles,[]);await assert.rejects(()=>start());
    assert.deepEqual(await app.evaluate(()=>({inference:directorFixture.inference,launches:directorFixture.launches})),{inference:0,launches:0});
    console.log(`Director backend source Electron ${process.argv.includes("--short-path")?"genuine 8.3":"normal"}: strict trusted IPC, latest saved baselines, renamed reuse, stale ordinary save, selection, privacy, import/restart/reset, no inference/launch PASS`);
  } finally {
    clearTimeout(watchdog);await app?.close();const resolved=await fs.realpath(dir);
    assert.equal(path.dirname(resolved).toLowerCase(),tempRoot.toLowerCase());assert.ok(path.basename(resolved).startsWith("forever-director-backend-"));await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
