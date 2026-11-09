"use strict";
// Source Electron, isolated synthetic game/save folders, no process or inference calls.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), syncFs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfCompanyShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfCompanyShortPath]::GetShortPathName($env:BF_COMPANY_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,BF_COMPANY_ALIAS_PATH:target},encoding:"utf8",timeout:15000}).trim();
  assert.notEqual(alias.toLowerCase(),target.toLowerCase(),"A genuine distinct Windows 8.3 alias is required");
  assert.match(alias,/~\d/);assert.equal(syncFs.statSync(alias).ino,syncFs.statSync(target).ino);
  return alias;
}
(async () => {
  const tempRoot = await fs.realpath(os.tmpdir()), dir = await fs.mkdtemp(path.join(tempRoot,"forever-company-backend-"));
  let app;
  const watchdog = setTimeout(()=>{
    console.error("Company backend fixture exceeded 100 seconds");
    process.exitCode=1;
    app?.process().kill();
  },100000);
  const normalData = path.join(dir,"synthetic-user-data");
  try {
    await fs.mkdir(normalData);
    const data = process.argv.includes("--short-path") ? shortPath(normalData) : normalData;
    const game=path.join(dir,"synthetic-client"), saved=path.join(game,"WTF/Account/Synthetic/SavedVariables/BackstageForever.lua");
    const backup=path.join(dir,"deliberate-backup.json"), badBackup=path.join(dir,"bad-backup.json");
    await fs.mkdir(path.dirname(saved),{recursive:true});await fs.writeFile(path.join(game,".flavor.info"),"wowf");
    const p=(id)=>({id,name:id,realm:"Synthetic Realm",className:"Mage",level:10,notes:"PRIVATE_NOTE_SENTINEL",goals:[{id:"g",text:"PRIVATE_GOAL_SENTINEL",done:false}]});
    const initial={...defaultState(),onboarded:true,profiles:[p("Alpha"),p("Beta")],activeProfileId:"Alpha"};
    await fs.writeFile(path.join(data,"state.json"),JSON.stringify(initial));
    const launch=async()=>{
      app=await electron.launch({args:[path.join(__dirname,"..")],env:{...process.env,BF_USER_DATA:data},timeout:20000});
      await app.evaluate(({app,dialog})=>{
        const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));
        const {GameRuntime}=load("./src/core/game-runtime.cjs");
        GameRuntime.prototype.probe=async()=>({state:"not-running",checkedAt:null,launchAvailable:false});
        GameRuntime.prototype.launch=async()=>{throw Error("Fixture blocks real launch");};
        load("./src/core/claude.cjs").status=async()=>({installed:false,loggedIn:false});
        load("./src/core/providers.cjs").ask=async()=>{throw Error("Fixture blocks inference");};
        globalThis.companyFixture={confirm:1};
        dialog.showMessageBox=async()=>({response:companyFixture.confirm});
        dialog.showSaveDialog=async()=>({canceled:false,filePath:companyFixture.backup});
        dialog.showOpenDialog=async()=>({canceled:false,filePaths:[companyFixture.importFile]});
      });
      const page=await testWindow(app);page.setDefaultTimeout(10000);
      return page;
    };
    let page=await launch();
    const initialBrief=await page.evaluate(()=>window.backstage.companyBrief());
    assert.equal(initialBrief.characters.length,2);
    const raw=await app.evaluate(async({ipcMain,BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0], event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
      const rejected=async(fn)=>{try{await fn();return false;}catch{return true;}};
      return {
        args:await rejected(()=>ipcMain._invokeHandlers.get("backstage:companyBrief")(event,{})),
        foreign:await rejected(()=>ipcMain._invokeHandlers.get("backstage:companyBrief")({sender:{},senderFrame:{url:"file:///wrong"}})),
        frame:await rejected(()=>ipcMain._invokeHandlers.get("backstage:companyBrief")({sender:win.webContents,senderFrame:{url:win.webContents.mainFrame.url}})),
        extra:await rejected(()=>ipcMain._invokeHandlers.get("backstage:journeyAction")(event,{type:"create",title:"bad"},{})),
      };
    });
    assert.deepEqual(raw,{args:true,foreign:true,frame:true,extra:true});
    const action=a=>page.evaluate(a=>window.backstage.journeyAction(a),a);
    let result=await action({type:"create",title:"PRIVATE_JOURNEY_SENTINEL",template:"quest-session",profileId:"Alpha"});
    const jid=result.state.journeys[0].id;assert.equal(result.company.journeys[0].steps.length,3);
    const dungeon=await action({type:"create",title:"Dungeon checklist",template:"dungeon-prep"});assert.equal(dungeon.company.journeys[1].steps.length,3);
    const beforeSnapshot=structuredClone(result.state);
    let clock=1794182400;
    const characters=[{id:"Synthetic-Alpha",name:"Alpha",realm:"Synthetic Realm",className:"Mage",level:20,updatedAt:clock,clientBuild:"1.15.8.64000",captureVersion:"0.7.0",quests:[{id:1061,title:"Saved ready quest",complete:true,objectives:[]}],history:{recent:[],completedIdsKnown:true,completedIds:[]},readiness:{bags:{free:2,total:20}}},{id:"Synthetic-Beta",name:"Beta",realm:"Synthetic Realm",className:"Hunter",level:11,updatedAt:clock,clientBuild:"1.15.8.64000",quests:[]}];
    const write=async()=>fs.writeFile(saved,"BackstageForeverExport = "+JSON.stringify(JSON.stringify({schema:1,observedAt:clock,activeId:characters[0].id,characters})));
    await write();
    let snapshot=await page.evaluate(root=>window.backstage.prepareGame(root),game);
    assert.equal(snapshot.state.profiles[0].level,20);assert.equal(snapshot.state.profiles[0].notes,"PRIVATE_NOTE_SENTINEL");assert.equal(snapshot.state.journeys.length,2);
    result=await action({type:"add-quest",journeyId:jid,profileId:"Alpha",questId:1061});
    const sid=result.state.journeys[0].steps.at(-1).id;
    assert.equal(result.company.journeys[0].steps.at(-1).completion,"pending");assert.equal(result.company.journeys[0].steps.at(-1).ready,true);
    const stale=structuredClone(result.state);
    clock+=60;characters[0].updatedAt=clock;characters[0].quests=[];characters[0].history.completedIds=[1061];await write();
    snapshot=await page.evaluate(()=>window.backstage.refreshGame());
    assert.equal(snapshot.state.journeys[0].steps.at(-1).observed.via,"completed-id");
    clock+=60;characters[0].updatedAt=clock;characters[0].history={recent:[],completedIdsKnown:false};await write();
    snapshot=await page.evaluate(()=>window.backstage.refreshGame());
    assert.equal(snapshot.state.journeys[0].steps.at(-1).observed.via,"completed-id");
    stale.profiles[0].notes="New private draft";stale.journeys=[];stale.profiles[0].history.completedIds=[999];
    for(const base of [result.state,undefined]) {
      const savedState=await page.evaluate(({edited,base})=>window.backstage.saveState(edited,base),{edited:stale,base});
      assert.equal(savedState.journeys.length,2);assert.equal(savedState.journeys[0].steps.at(-1).observed.via,"completed-id");
      assert.equal(savedState.profiles[0].source.updatedAt,new Date(clock*1000).toISOString());assert.equal(savedState.profiles[0].history.completedIdsKnown,false);assert.equal(savedState.profiles[0].notes,"New private draft");
    }
    const forged=structuredClone(beforeSnapshot);forged.profiles.push({...p("forged"),source:{kind:"wow-addon",id:"forged",updatedAt:new Date(clock*1000).toISOString()}});
    await assert.rejects(()=>page.evaluate(s=>window.backstage.saveState(s),forged),/could not be completed/);
    result=await action({type:"set-done",journeyId:jid,stepId:sid,done:false});assert.equal(result.company.journeys[0].steps.at(-1).completion,"observed");
    await assert.rejects(()=>action({type:"set-done",journeyId:jid,stepId:sid,done:true,observed:{at:"PRIVATE_ERROR_SENTINEL"}}),e=>!e.message.includes("PRIVATE_ERROR_SENTINEL"));
    const manual={...result.state,activeProfileId:"Beta"};
    let selected=await page.evaluate(({edited,base})=>window.backstage.saveState(edited,base),{edited:manual,base:result.state});
    assert.equal(selected.activeProfileId,"Beta");assert.equal(selected.followGameCharacter,false);
    const brief=await page.evaluate(()=>window.backstage.companyBrief());assert.equal(brief.recommendation.profileId,"Alpha");
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).state.activeProfileId,"Beta");
    const publicContext=await page.evaluate(()=>window.backstage.contextPreview("Alpha",true,"1061"));
    assert.doesNotMatch(JSON.stringify(publicContext),/PRIVATE_|New private draft|sourceHash|source\.id/);
    await page.evaluate(()=>window.backstage.saveProvider({provider:"openai",model:"synthetic",apiKey:"SYNTHETIC_CREDENTIAL_SENTINEL",authMode:"api"}));
    await app.evaluate((_e,file)=>{companyFixture.backup=file;companyFixture.importFile=file;},backup);
    assert.equal(await page.evaluate(()=>window.backstage.exportData()),true);
    const backupText=await fs.readFile(backup,"utf8");assert.match(backupText,/PRIVATE_JOURNEY_SENTINEL/);assert.doesNotMatch(backupText,/SYNTHETIC_CREDENTIAL_SENTINEL|credentials/);
    await action({type:"remove",journeyId:jid});
    await app.evaluate(()=>companyFixture.confirm=0);
    assert.equal(await page.evaluate(()=>window.backstage.importData()),null);
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).state.journeys.length,1);
    assert.equal(await page.evaluate(()=>window.backstage.resetData()),null);
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).secretStatus.openai,true);
    await app.evaluate(()=>companyFixture.confirm=1);
    result=await page.evaluate(()=>window.backstage.importData());assert.equal(result.journeys.length,2);assert.equal(result.journeys[0].steps.at(-1).observed.via,"completed-id");
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).secretStatus.openai,true);
    await fs.writeFile(badBackup,JSON.stringify({...result,journeys:[{id:"malformed"}]}));
    await app.evaluate((_e,file)=>companyFixture.importFile=file,badBackup);
    await assert.rejects(()=>page.evaluate(()=>window.backstage.importData()));
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).state.journeys.length,2);
    await app.close();app=null;page=await launch();
    assert.equal((await page.evaluate(()=>window.backstage.companyBrief())).journeys[0].steps.at(-1).completion,"observed");
    await app.evaluate(({app})=>{
      const load=process.getBuiltinModule("node:module").createRequire(process.getBuiltinModule("node:path").join(app.getAppPath(),"package.json"));
      const {GameSync}=load("./src/core/game-sync.cjs"),original=GameSync.prototype.reset;
      GameSync.prototype.reset=async function(){await new Promise(r=>companyFixture.releaseReset=r);return original.call(this);};
    });
    await page.evaluate(()=>{window.companyPendingReset=window.backstage.resetData();});
    await app.evaluate(async()=>{const end=Date.now()+5000;while(!companyFixture.releaseReset){if(Date.now()>end)throw Error("Reset fixture did not start");await new Promise(r=>setTimeout(r,10));}});
    await assert.rejects(()=>page.evaluate(()=>window.backstage.companyBrief()));
    await assert.rejects(()=>action({type:"create",title:"Must not survive reset"}));
    await app.evaluate(()=>companyFixture.releaseReset());
    const reset=await page.evaluate(()=>window.companyPendingReset);assert.deepEqual(reset.journeys,[]);assert.deepEqual(reset.profiles,[]);
    assert.equal((await page.evaluate(()=>window.backstage.bootstrap())).secretStatus.openai,false);
    const empty=await page.evaluate(()=>window.backstage.companyBrief());assert.deepEqual(empty.characters,[]);assert.equal(empty.totals.questLogsKnown,0);assert.equal(empty.recommendation,null);
    console.log(`Company backend source Electron ${process.argv.includes("--short-path")?"genuine 8.3":"normal"}: trusted IPC, templates, GameSync completion/pruning, private journals, stale saves, selection, backup/restart/reset PASS`);
  } finally {
    clearTimeout(watchdog);await app?.close();
    const resolved=await fs.realpath(dir);
    assert.equal(path.dirname(resolved).toLowerCase(),tempRoot.toLowerCase());assert.ok(path.basename(resolved).startsWith("forever-company-backend-"));
    await fs.rm(resolved,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
