"use strict";
// Synthetic Electron IPC verification. Runtime methods are stubbed before any button/API call.
const { _electron: electron }=require("playwright"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path");
const { testWindow }=require("./test-window.cjs");
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"forever-living-backend-"));let app;
  try{
    const roots=[path.join(dir,"one"),path.join(dir,"two")];
    for(const root of roots){await fs.mkdir(path.join(root,"WTF"),{recursive:true});await fs.writeFile(path.join(root,".flavor.info"),"wowf");}
    app=await electron.launch({args:[path.join(__dirname,"..")],env:{...process.env,BF_USER_DATA:path.join(dir,"data")}});
    await app.evaluate(({app,dialog})=>{
      const path=process.getBuiltinModule("node:path");
      const load=process.getBuiltinModule("node:module").createRequire(path.join(app.getAppPath(),"package.json"));
      const {GameSync}=load("./src/core/game-sync.cjs");
      const {GameRuntime}=load("./src/core/game-runtime.cjs");
      globalThis.fixture={candidates:[],launches:0,pickers:0,runtime:"not-running"};
      dialog.showOpenDialog=async()=>{fixture.pickers++;throw Error("unexpected picker");};
      dialog.showMessageBox=async()=>({response:1});
      GameSync.prototype.discover=async()=>{if(fixture.waitDiscovery)await new Promise(r=>fixture.releaseDiscovery=r);return fixture.candidates;};
      GameRuntime.prototype.probe=async()=>({state:fixture.runtime,checkedAt:"2026-11-09T00:00:00.000Z",launchAvailable:true});
      GameRuntime.prototype.launch=async(_root,cancelled)=>{if(fixture.waitLaunch)await new Promise(r=>fixture.releaseLaunch=r);if(cancelled())return {state:"cancelled",message:"cancelled"};fixture.launches++;return {state:"requested",message:"launch requested"};};
    });
    const page=await testWindow(app);
    let snapshot=await page.evaluate(()=>window.backstage.startCompanion());
    assert.equal(snapshot.gameStatus.connected,false);assert.deepEqual(snapshot.setupCandidates,[]);
    await app.evaluate((_e,roots)=>{fixture.candidates=roots.map((root,i)=>({id:String(i),path:root,label:"Synthetic Forever"}));},roots);
    snapshot=await page.evaluate(()=>window.backstage.startCompanion());assert.equal(snapshot.gameStatus.connected,false);assert.equal(snapshot.setupCandidates.length,2);
    assert.equal(await app.evaluate(()=>fixture.pickers),0);
    await app.evaluate(()=>{fixture.candidates=fixture.candidates.slice(0,1);});
    snapshot=await page.evaluate(()=>window.backstage.startCompanion());assert.equal(snapshot.gameStatus.addonCurrent,true);assert.equal(snapshot.gameStatus.companionState,"prepared");assert.equal(snapshot.gameStatus.lastSync,null);
    snapshot=await page.evaluate(()=>window.backstage.launchGame());assert.equal(snapshot.launchResult.state,"requested");assert.equal(snapshot.gameStatus.loadedCaptureVersion,null);assert.equal(await app.evaluate(()=>fixture.launches),1);
    const account=path.join(roots[0],"WTF","Account","SyntheticAccount","SavedVariables","BackstageForever.lua");await fs.mkdir(path.dirname(account),{recursive:true});
    const save=(observedAt,activeId,characters)=>"BackstageForeverExport = "+JSON.stringify(JSON.stringify({schema:1,observedAt,activeId,characters}));
    const c=(id,level,updatedAt)=>({id,name:id,realm:"Synthetic Realm",className:"Mage",level,updatedAt,captureVersion:"0.7.0"});
    await fs.writeFile(account,save(1794182400,"a",[c("a",10,1794182400),c("b",10,1794182200)]));
    snapshot=await page.evaluate(()=>window.backstage.refreshGame());
    const a=snapshot.state.profiles.find(p=>p.name==="a"),b=snapshot.state.profiles.find(p=>p.name==="b");assert.equal(snapshot.state.activeProfileId,a.id);
    const manual={...snapshot.state,followGameCharacter:false,activeProfileId:b.id};manual.profiles.find(p=>p.id===b.id).notes="private journal";
    await page.evaluate(state=>window.backstage.saveState(state),manual);
    let state=await page.evaluate(()=>window.backstage.bootstrap()).then(b=>b.state);
    assert.equal(state.activeProfileId,b.id);
    state=await page.evaluate(state=>window.backstage.saveState({...state,followGameCharacter:true}),state);
    assert.equal(state.activeProfileId,a.id,"Re-enabling follow uses already saved active without another game save");assert.equal(state.profiles.find(p=>p.id===b.id).notes,"private journal");
    // A different account can advance b despite an older account-wide observedAt.
    const other=path.join(roots[0],"WTF","Account","OtherSynthetic","SavedVariables","BackstageForever.lua");await fs.mkdir(path.dirname(other),{recursive:true});
    await fs.writeFile(other,save(1794182300,"b",[c("b",20,1794182300)]));
    snapshot=await page.evaluate(()=>window.backstage.refreshGame());assert.equal(snapshot.state.profiles.find(p=>p.name==="b").level,20);assert.equal(snapshot.state.activeProfileId,a.id);
    await fs.writeFile(account,save(1794182250,"b",[c("b",21,1794182350)]));
    snapshot=await page.evaluate(()=>window.backstage.refreshGame());assert.equal(snapshot.state.profiles.find(p=>p.name==="b").level,21,"An older account-wide clock cannot suppress a newer character observation");assert.equal(snapshot.state.activeProfileId,a.id);
    state=await page.evaluate(state=>window.backstage.saveState({...state,followGameCharacter:false}),snapshot.state);
    state=await page.evaluate(state=>window.backstage.saveState({...state,followGameCharacter:true}),state);
    assert.equal(state.activeProfileId,a.id,"Cached follow cannot override the newer previously observed active selection");
    await app.evaluate(()=>{fixture.waitLaunch=true;});
    await page.evaluate(()=>{window.pendingLaunch=window.backstage.launchGame();});
    await app.evaluate(async()=>{while(!fixture.releaseLaunch)await new Promise(r=>setTimeout(r,10));});
    await page.evaluate(()=>window.backstage.disconnectGame());await app.evaluate(()=>fixture.releaseLaunch());
    snapshot=await page.evaluate(()=>window.pendingLaunch);assert.equal(snapshot.gameStatus.connected,false);assert.equal(snapshot.launchResult.state,"cancelled");assert.equal(await app.evaluate(()=>fixture.launches),1);
    await app.evaluate(()=>{fixture.waitDiscovery=true;});
    await page.evaluate(()=>{window.pendingStart=window.backstage.startCompanion();});
    await app.evaluate(async()=>{while(!fixture.releaseDiscovery)await new Promise(r=>setTimeout(r,10));});
    await page.evaluate(()=>window.backstage.resetData());await app.evaluate(()=>fixture.releaseDiscovery());
    snapshot=await page.evaluate(()=>window.pendingStart);assert.equal(snapshot.gameStatus.connected,false);assert.equal(snapshot.state.profiles.length,0);
    await assert.rejects(fs.stat(path.join(dir,"data","game-connection.private.json")),{code:"ENOENT"});
    console.log("Living backend Electron IPC: no/one/multiple setup, no picker, stub launch, cached follow, cross-account updates, disconnect/reset races PASS");
  }finally{await app?.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
