"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {registerCompanyHandlers,mergeOrdinaryState}=require("../src/core/company-ipc.cjs");
const {defaultState}=require("../src/core/validation.cjs");
const {applyJourneyAction}=require("../src/core/journeys.cjs");
const at="2026-01-01T00:00:00.000Z",later="2026-01-02T00:00:00.000Z";
const p=(id,extra={})=>({id,name:id,realm:"Synthetic",className:"Mage",level:10,notes:"Private",goals:[],...extra});
const seeded=()=>({...defaultState(),profiles:[p("p",{source:{kind:"wow-addon",id:"private-source",updatedAt:at},clientBuild:"1.15.8.64000",quests:[{id:1,title:"Saved quest",complete:false,objectives:[]}],history:{recent:[],completedIdsKnown:true,completedIds:[]},readiness:{bags:{free:2,total:20}}})],activeProfileId:"p"});
test("handlers enforce exact arity/actions and read latest saved reconciled state synchronously",()=>{
  let current=seeded(),writes=0;const handlers={};
  registerCompanyHandlers({handle:(name,fn)=>handlers[name]=fn,getState:()=>current,saveState:next=>{writes++;current=structuredClone(next);current.onboarded=true;return {ignored:true};}});
  assert.throws(()=>handlers.companyBrief({}));
  assert.equal(handlers.companyBrief().characters.length,1);
  for(const args of [[],[null],[{type:"create",title:"Plan",id:"forged"}],[{type:["create"],title:"Plan"}],[{type:"create",title:"Plan"},{}]]) assert.throws(()=>handlers.journeyAction(...args),/Invalid journey request\./);
  assert.equal(writes,0);
  const result=handlers.journeyAction({type:"create",title:"Plan",template:"quest-session",profileId:"p"});
  assert.equal(writes,1);assert.equal(result.state.onboarded,true);assert.equal(result.company.journeys[0].steps.length,3);
  result.state.profiles[0].notes="changed";assert.equal(current.profiles[0].notes,"Private");
  current=defaultState();assert.equal(handlers.companyBrief().characters.length,0);
  assert.throws(()=>handlers.journeyAction({type:"rename",journeyId:"PRIVATE_SENTINEL",title:"x"}),e=>e.message==="Invalid journey request.");
});
test("ordinary base and legacy saves retain owned journeys and captured fields while applying notes/goals",()=>{
  const base=seeded();let current=applyJourneyAction(base,{type:"create",title:"Owned plan"});
  current.profiles[0].source.updatedAt=later;current.profiles[0].level=20;current.profiles[0].history.completedIds=[1];
  const edited=structuredClone(base);edited.profiles[0].notes="Changed journal";edited.journeys=[];
  edited.profiles[0].source.id="FORGED";edited.profiles[0].clientBuild="1.15.9.64001";edited.profiles[0].quests=[];edited.profiles[0].history.completedIds=[2];
  for(const b of [base,undefined]) {
    const out=mergeOrdinaryState(current,edited,b);
    assert.deepEqual(out.journeys,current.journeys);assert.equal(out.profiles[0].notes,"Changed journal");
    for(const key of ["source","level","quests","history","readiness","clientBuild"]) assert.deepEqual(out.profiles[0][key],current.profiles[0][key]);
  }
  assert.equal(current.profiles[0].notes,"Private");
});
test("ordinary saves reject new captured fields and forged base identities but preserve deliberate imported manual evidence",()=>{
  const original={...defaultState(),profiles:[p("manual")],activeProfileId:"manual"};
  for(const field of ["source","quests","history","readiness","clientBuild","location","progress","locale","captureVersion"]) {
    const edit=structuredClone(original),values={source:seeded().profiles[0].source,quests:[],history:{recent:[]},readiness:{bags:{free:0,total:10}},clientBuild:"1.15.8.64000",location:{zone:"Forged"},progress:{current:0,max:1},locale:"enUS",captureVersion:"0.7.0"};
    edit.profiles[0][field]=values[field]; assert.throws(()=>mergeOrdinaryState(original,edit),/Captured game data/);
    const base=structuredClone(edit);assert.throws(()=>mergeOrdinaryState(original,edit,base),/Captured game data/);
  }
  const edit=structuredClone(original);edit.profiles.push({...seeded().profiles[0],id:"new"});
  assert.throws(()=>mergeOrdinaryState(original,edit),/Captured game data/);
  const owned=structuredClone(original);owned.profiles[0].quests=[];
  const notes=structuredClone(owned);notes.profiles[0].notes="new";notes.profiles[0].quests=[{id:1,title:"Forged",complete:true,objectives:[]}];
  const out=mergeOrdinaryState(owned,notes);assert.deepEqual(out.profiles[0].quests,[]);assert.equal(out.profiles[0].notes,"new");
});
