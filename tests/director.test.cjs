"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { buildDirector, createDirectorSession } = require("../src/core/director.cjs");
const { buildGuidance } = require("../src/core/guidance.cjs");
const { buildBrief } = require("../src/core/adventure.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { applyJourneyAction } = require("../src/core/journeys.cjs");
const now = Date.parse("2026-11-09T12:00:00.000Z");
const quest = (id, extra = {}) => ({ id, title: `Quest ${id}`, complete: false, objectives: [{text:"Observed",done:false}], ...extra });
const profile = (extra = {}) => ({id:"p",name:"Synthetic",realm:"Test",className:"Mage",level:12,notes:"PRIVATE_NOTE",goals:[{id:"g",text:"PRIVATE_GOAL",done:false}],source:{kind:"wow-addon",id:"PRIVATE_SOURCE",updatedAt:new Date(now).toISOString()},clientBuild:"1.15.8.64000",location:{zone:"Forest",mapId:1,x:0.2,y:0.2},quests:[quest(1),quest(2),quest(3),quest(4)],history:{recent:[],completedIdsKnown:true,completedIds:[]},...extra});
const state = (p = profile()) => ({...defaultState(),profiles:[p],activeProfileId:p.id});
const hooks = () => {let n=0;return {now,id:()=>`synthetic-${++n}`};};
const director = (p, options={}) => buildDirector(p,buildGuidance(p,{now,minutes:60,...options}));
test("pure Director ranks ready, current local, compatible reference, level and id with three choices", () => {
  const p=profile({quests:[quest(9,{complete:true}),quest(8,{level:12}),quest(7,{zone:"Forest",level:60}),quest(6,{level:12}),quest(5,{level:11})]});
  const knowledge={details:()=>({status:"match"}),followUps:()=>[],destination:(_p,id)=>id===8?{mapId:1,x:0.3,y:0.3,approximate:true,evidence:"observed-objective-gain"}:null};
  const g=buildGuidance(p,{now,minutes:60,knowledge}), before=structuredClone({p,g}), d=buildDirector(p,g);
  assert.deepEqual(d.choices.map(c=>c.questId),[9,7,8]);assert.equal(d.primary.questId,9);assert.deepEqual(d.alternatives.map(c=>c.questId),[7,8]);
  assert.equal(d.choices[2].sourceKind,"reference");assert.match(d.choices[2].reason,/approximate/i);
  assert.deepEqual({p,g},before);d.choices[0].objectives.push({});assert.deepEqual({p,g},before);
  assert.deepEqual(director(profile({quests:[quest(9,{level:13}),quest(4,{level:11}),quest(1,{level:40})]})).choices.map(c=>c.questId),[4,9,1]);
});
test("Director ranks every actionable observed candidate before capping choices, preserving visible guidance limits",()=>{
  const p=profile({quests:Array.from({length:25},(_,i)=>quest(i+1,{level:i===24?99:12}))});
  const knowledge={details:()=>({status:"match"}),followUps:()=>[],destination:(_p,id)=>id===25?{mapId:1,x:0.3,y:0.3,approximate:true,evidence:"observed-objective-gain"}:null};
  for(const [minutes,count] of [[15,3],[30,5],[60,8]]){const g=buildGuidance(p,{now,minutes,knowledge});assert.equal(g.steps.length,count);assert.equal(g.counts.shown,count);assert.equal(buildDirector(p,g).primary.questId,25);const out=createDirectorSession(state(p),"p",{minutes},{...hooks(),knowledge});assert.equal(out.state.journeys[0].steps[0].quest.id,25);}
});
test("current destination wins over reference and mentioned NPCs remain clues",()=>{
  const p=profile({quests:[quest(1,{destination:{mapId:2,x:0.2,y:0.2}}),quest(2)]});
  const g=buildGuidance(p,{now,knowledge:{details:()=>({status:"match"}),followUps:()=>[],destination:(_p,id)=>({mapId:1,x:0.2,y:0.2,approximate:true,evidence:id===1?"observed-objective-gain":"mentioned-in-objective"})}});
  const d=buildDirector(p,g);assert.equal(d.choices[0].questId,1);assert.equal(d.primary.sourceKind,"game-snapshot");assert.equal(d.primary.distance,null);
  assert.equal(d.choices[1].sourceKind,"reference-clue");assert.match(d.choices[1].reason,/clue/i);
});
test("distance is same-map geometry only and unknown location has no invented identity",()=>{
  const p=profile({quests:[quest(1,{destination:{mapId:1,x:0.5,y:0.6}})]});
  assert.ok(Math.abs(director(p).primary.distance-0.5)<1e-10);
  const d=director(profile({race:undefined,faction:undefined,location:undefined}));
  assert.equal(d.character.race,null);assert.equal(d.character.faction,null);assert.equal(d.character.location,null);assert.equal(d.primary.distance,null);
  assert.doesNotMatch(JSON.stringify(d.character),/PRIVATE_/);assert.match(d.limitations.join(" "),/straight-line/);
});
test("geometry never overrides the documented reported-level and numeric-ID tie-breaks",()=>{
  const p=profile({quests:[quest(1,{level:40,destination:{mapId:1,x:0.2,y:0.2}}),quest(2,{level:12,destination:{mapId:1,x:0.8,y:0.8}}),quest(3,{level:12,destination:{mapId:1,x:0.21,y:0.21}})]});
  assert.deepEqual(director(p).choices.map(s=>s.questId),[2,3,1]);
});
test("unknown, manual, empty and preparation facts remain honest; pending goals are bounded local-only",()=>{
  for(const p of [null,profile({source:undefined}),profile({quests:undefined})]){const d=director(p);assert.equal(d.status,"unavailable");assert.equal(d.primary,null);assert.equal(d.session.available,false);}
  assert.equal(director(profile({quests:[]})).status,"empty");
  const p=profile({readiness:{bags:{free:2,total:20}},goals:[{id:"done",text:"DONE",done:true},...Array.from({length:5},(_,i)=>({id:`g${i}`,text:`PRIVATE_${i}`,done:false}))]});
  const d=director(p);assert.equal(d.preparation.bags.free,2);assert.equal(d.privateGoals.length,3);assert.equal(d.privateGoals[0].text,"PRIVATE_0");
  assert.doesNotMatch(JSON.stringify(d.choices),/PRIVATE_|DONE/);assert.equal(director(profile()).preparation,null);
});
test("bag preparation preserves the native zero-through-two boundary and saved positive-capacity guards",()=>{
  for(const [free,expected] of [[0,true],[2,true],[3,false],[4,false]]){
    const d=director(profile({readiness:{bags:{free,total:20}}}));
    assert.equal(Boolean(d.preparation),expected,`${free} free slots`);
    if(expected)assert.deepEqual(d.preparation.bags,{free,total:20});
  }
  for(const extra of [{readiness:undefined},{readiness:{}},{readiness:{bags:{free:0,total:0}}},{source:undefined,readiness:{bags:{free:0,total:20}}}])assert.equal(director(profile(extra)).preparation,null);
});
test("brief attaches Director without changing detailed guidance",()=>{const p=profile(),brief=buildBrief(p,{now});assert.deepEqual(brief.guidance,buildGuidance(p,{now}));assert.deepEqual(brief.director,buildDirector(p,brief.guidance));});
test("sessions atomically track 1/2/3 server-owned current-log baselines and detached state",()=>{
  for(const [minutes,count] of [[15,1],[30,2],[60,3]]){const s=state(),before=structuredClone(s),out=createDirectorSession(s,"p",{minutes,focus:"balanced"},hooks());assert.equal(out.created,true);assert.equal(out.state.journeys.length,1);assert.equal(out.state.journeys[0].steps.length,count);assert.equal(out.journeyId,out.state.journeys[0].id);for(const step of out.state.journeys[0].steps){assert.equal(step.profileId,"p");assert.equal(step.quest.baselineAt,s.profiles[0].source.updatedAt);assert.equal(step.quest.build,s.profiles[0].clientBuild);assert.equal(step.quest.baselineCompleted,false);assert.equal(step.observed,undefined);}assert.doesNotMatch(JSON.stringify(out.state.journeys),/PRIVATE_/);assert.deepEqual(s,before);out.state.profiles[0].notes="changed";assert.deepEqual(s,before);}
});
test("renamed exact sessions reuse without consuming IDs; changed source/build/baselines do not",()=>{
  const first=createDirectorSession(state(),"p",{minutes:30},hooks());
  const renamed=applyJourneyAction(first.state,{type:"rename",journeyId:first.journeyId,title:"My own title"});
  const reuse=createDirectorSession(renamed,"p",{minutes:30},{now,id:()=>{throw Error("must not allocate");}});assert.equal(reuse.created,false);assert.equal(reuse.journeyId,first.journeyId);assert.notEqual(reuse.state,renamed);
  for(const change of [p=>p.source.id+="new",p=>p.clientBuild="1.15.8.64001",p=>p.source.updatedAt="2026-11-09T12:01:00.000Z",p=>p.history.completedIds=[1],p=>p.history.recent=[{id:1,title:"Quest 1",completedAt:Math.floor(now/1000)-1}]]){const s=structuredClone(renamed);change(s.profiles[0]);let n=10;const out=createDirectorSession(s,"p",{minutes:30},{now,id:()=>`next-${++n}`});assert.equal(out.created,true);assert.equal(out.state.journeys.length,2);}
});
test("adding a manual note preserves identical quest-session reuse but extra tracked quests do not",()=>{
  const first=createDirectorSession(state(),"p",{minutes:15},hooks());
  const withNote=applyJourneyAction(first.state,{type:"add-note",journeyId:first.journeyId,text:"Private session note"},{now,id:()=>"manual-note"});
  const reused=createDirectorSession(withNote,"p",{minutes:15},{now,id:()=>{throw Error("identical tracked selection must reuse");}});assert.equal(reused.created,false);assert.equal(reused.state.journeys[0].steps.length,2);
  const extra=applyJourneyAction(withNote,{type:"add-quest",journeyId:first.journeyId,profileId:"p",questId:4},{now,id:()=>"extra-quest"});
  let n=100;assert.equal(createDirectorSession(extra,"p",{minutes:15},{now,id:()=>`new-${++n}`}).created,true);
});
test("selection/options/source rejection and failures never leave a partial plan",()=>{
  for(const s of [state(profile({source:undefined})),state(profile({clientBuild:undefined})),state(profile({quests:[]})),{...state(),activeProfileId:null}]) assert.throws(()=>createDirectorSession(s,"p",{},hooks()));
  const s=state(),before=structuredClone(s);for(const options of [null,[],{minutes:1},{questIds:[1]},{focus:"combat"},{now}])assert.throws(()=>createDirectorSession(s,"p",options,hooks()));
  assert.throws(()=>createDirectorSession(s,"other",{},hooks()));assert.throws(()=>createDirectorSession(s,"p",{minutes:60},{now,id:()=>"collision"}));assert.deepEqual(s,before);
  const full=structuredClone(s);full.journeys=Array.from({length:20},(_,i)=>({id:`j${i}`,title:"Full",createdAt:new Date(now).toISOString(),steps:[]}));assert.throws(()=>createDirectorSession(full,"p",{},hooks()));assert.equal(full.journeys.length,20);
});
