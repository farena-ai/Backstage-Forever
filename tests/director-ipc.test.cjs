"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const {registerDirectorHandlers}=require("../src/core/director-ipc.cjs");
const {defaultState}=require("../src/core/validation.cjs");
const {mergeOrdinaryState}=require("../src/core/company-ipc.cjs");
const seed=()=>({...defaultState(),activeProfileId:"p",profiles:[{id:"p",name:"Synthetic",realm:"Test",className:"Mage",level:10,notes:"PRIVATE_NOTE",goals:[{id:"g",text:"PRIVATE_GOAL",done:false}],source:{kind:"wow-addon",id:"PRIVATE_SOURCE",updatedAt:"2026-11-09T12:00:00.000Z"},clientBuild:"1.15.8.64000",quests:[{id:1,title:"Quest",complete:true,objectives:[]}]}]});
test("Director IPC validates exact arity and trusted options without writes",()=>{
  let current=seed(),writes=0;const handlers={};registerDirectorHandlers({handle:(name,fn)=>handlers[name]=fn,getState:()=>current,saveState:()=>writes++,knowledge:{index:()=>undefined}});
  for(const args of [[],["p"],["p",{},{}],[null,{}],["p",null],["p",{questIds:[1]}],["p",{source:{id:"FORGED"}}],["p",{minutes:16}],["p",{focus:"combat"}]])assert.throws(()=>handlers.startDirectorSession(...args));
  assert.equal(writes,0);
});
test("Director IPC reads current selection synchronously, saves once, returns latest saved detached state and reuses",()=>{
  let current=seed(),writes=0;const handlers={};registerDirectorHandlers({handle:(name,fn)=>handlers[name]=fn,getState:()=>current,saveState:next=>{writes++;current=structuredClone(next);current.onboarded=true;},knowledge:{index:()=>undefined}});
  const stale=structuredClone(current),out=handlers.startDirectorSession("p",{minutes:15});assert.equal(typeof out.then,"undefined");assert.equal(writes,1);assert.equal(out.state.onboarded,true);assert.equal(out.created,true);
  out.state.profiles[0].notes="changed";assert.equal(current.profiles[0].notes,"PRIVATE_NOTE");
  current.journeys[0].title="Renamed";const reuse=handlers.startDirectorSession("p",{minutes:15});assert.equal(reuse.created,false);assert.equal(reuse.journeyId,out.journeyId);assert.equal(writes,1);
  stale.profiles[0].notes="Saved draft";current=mergeOrdinaryState(current,stale);assert.equal(current.journeys.length,1);assert.equal(current.profiles[0].notes,"Saved draft");
  current=defaultState();assert.throws(()=>handlers.startDirectorSession("p",{}));assert.equal(writes,1);
  current=seed();current.activeProfileId=null;assert.throws(()=>handlers.startDirectorSession("p",{}));assert.equal(writes,1);
});
test("preload forwards Director arguments including extras for main rejection",async()=>{
  let api,request;vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/preload.cjs"),"utf8"),{require:()=>({contextBridge:{exposeInMainWorld:(_n,a)=>api=a},ipcRenderer:{invoke:(...args)=>{request=args;return Promise.resolve();}}})});
  assert.equal(typeof api.startDirectorSession,"function");await api.startDirectorSession("p",{minutes:15},"extra");assert.deepEqual(Array.from(request),["backstage:startDirectorSession","p",{minutes:15},"extra"]);
});
test("guidance IPC attaches Director while preserving old response fields",()=>{
  const main=path.resolve(__dirname,"../src/main.cjs"),source=fs.readFileSync(main,"utf8");let handler;
  vm.runInNewContext(source.slice(source.indexOf('  handle("guidancePlan"'),source.indexOf('  handle("gameStatus"')),{handle:(_n,fn)=>handler=fn,v:require("../src/core/validation.cjs"),store:{state:seed()},knowledge:{index:()=>undefined},require:require("node:module").createRequire(main)});
  const result=handler("p",{minutes:15});assert.equal(result.status,"ready");assert.equal(result.steps[0].questId,1);assert.equal(result.director.primary.questId,1);assert.doesNotMatch(JSON.stringify(result.steps),/PRIVATE_/);
});
