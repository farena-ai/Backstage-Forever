"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture({detailsUnavailable=false,restoreResult,restoreError}={}) {
  const handlers={},nodes={};
  for(const key of ["automatic","create","refresh","clear","preview","restore","latest","count","select","preview-text","status"])nodes[key]={dataset:{},innerHTML:"",textContent:""};
  const card={querySelector:s=>nodes[s.match(/data-recovery-(.+)\]/)[1]]};
  const root={addEventListener:(t,f)=>(handlers[t]??=[]).push(f),querySelector:()=>card};
  const context={window:{},InteractionGuard:{create:()=>({defer:()=>false,invalidate(){}})}};vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve("../src/renderer/recovery.js"),"utf8"),context);
  let failHistory=false,failDetails=detailsUnavailable,restores=0,details=0,detailRead=null;
  const point={id:"point",sha256:"hash",createdAt:"2026-11-10T12:00:00Z",reason:"manual",profileCount:1,journeyCount:0,bytes:300};
  context.window.Recovery.init({root,esc:String,active:()=>true,api:{recoveryList:async()=>{if(failHistory)throw Error("PRIVATE_HISTORY_PATH");return {status:{phase:"ready",automatic:true,count:1},points:[point]};},previewCheckpoint:async()=>point},restore:async()=>{restores++;if(restoreError)throw restoreError;return restoreResult === null ? null : {detailsUnavailable:failDetails};},refreshDetails:async()=>{details++;return detailRead ? await detailRead : !failDetails;}});
  const click=async kind=>{const target={dataset:{},closest:()=>target,hasAttribute:a=>a===`data-recovery-${kind}`};handlers.click.forEach(f=>f({target}));await settle();};
  return {nodes,click,context,setHistory:v=>failHistory=v,setDetails:v=>failDetails=v,setDetailRead:v=>detailRead=v,restores:()=>restores,details:()=>details};
}
test("committed restore followed by unavailable history remains truthful and history retry never replaces again",async()=>{
  const f=fixture();await f.click("refresh");await f.click("preview");f.setHistory(true);await f.click("restore");
  assert.match(f.nodes.status.textContent,/Journal restored.*history.*unavailable/);
  assert.doesNotMatch(f.nodes.status.textContent,/not replaced|PRIVATE_HISTORY_PATH/);
  assert.equal(f.nodes.restore.disabled,true,"Committed preview is retired");
  await f.click("refresh");assert.match(f.nodes.status.textContent,/Journal restored/);
  f.setHistory(false);await f.click("refresh");assert.match(f.nodes.status.textContent,/history is ready/);
  assert.equal(f.restores(),1);assert.equal(f.nodes.restore.disabled,true);
});
test("committed restore with unavailable details offers display-only retry even when history succeeds",async()=>{
  const f=fixture({detailsUnavailable:true});await f.click("refresh");await f.click("preview");await f.click("restore");
  assert.match(f.nodes.status.textContent,/Journal restored.*details.*unavailable/);
  assert.match(f.nodes.status.textContent,/Refresh recovery history/);assert.equal(f.nodes.restore.disabled,true);
  f.setDetails(false);await f.click("refresh");assert.equal(f.details(),1);assert.equal(f.restores(),1);
  assert.match(f.nodes.status.textContent,/history is ready/);
});

test("obsolete display retry cannot rearm details refresh after Recovery invalidation",async()=>{
  const f=fixture({detailsUnavailable:true});await f.click("refresh");await f.click("preview");await f.click("restore");
  let release;f.setDetailRead(new Promise(resolve=>release=resolve));await f.click("refresh");
  f.context.window.Recovery.invalidate();release(false);await settle();
  await f.click("refresh");assert.equal(f.details(),1,"Old detail completion must not mutate the new view's retry state");
  assert.match(f.nodes.status.textContent,/history is ready/);assert.equal(f.nodes.restore.disabled,true);
});

test("pre-commit failure preserves no-replacement guidance and retires the failed preview",async()=>{
  const f=fixture({restoreError:Error("PRIVATE_PRECOMMIT_PATH")});await f.click("refresh");await f.click("preview");await f.click("restore");
  assert.equal(f.nodes.status.textContent,"Recovery is unavailable. Your journal was not replaced. Check local storage and try again.");
  assert.equal(f.nodes.restore.disabled,true);assert.equal(f.restores(),1);assert.equal(f.details(),0);
});
test("native cancel preserves the reviewed preview and never initiates detail refresh",async()=>{
  const f=fixture({restoreResult:null});await f.click("refresh");await f.click("preview");await f.click("restore");
  assert.equal(f.nodes.status.textContent,"Restore cancelled. Your journal is unchanged.");assert.equal(f.nodes.restore.disabled,false);assert.equal(f.details(),0);
});
