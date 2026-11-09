"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const {defaultState}=require("../src/core/validation.cjs");
const {mergeOrdinaryState}=require("../src/core/company-ipc.cjs");
const seed=()=>({...defaultState(),activeProfileId:"p",profiles:[{id:"p",name:"Synthetic",realm:"Test",className:"Mage",level:10,notes:"PRIVATE_NOTE",goals:[{id:"g",text:"PRIVATE_GOAL",done:false}],source:{kind:"wow-addon",id:"PRIVATE_SOURCE",updatedAt:"2026-11-09T12:00:00.000Z"},clientBuild:"1.60.1.70862",readiness:{workshop:{professions:{observedAt:"2026-11-09T12:00:00.000Z",complete:true,items:[{skillLineId:171,professionId:1,name:"Alchemy",rank:20,maxRank:75}]},recipes:{observedAt:"2026-11-09T12:00:00.000Z",complete:true,items:[{id:100,skillLineId:171,name:"WORKSHOP_PRIVATE_RECIPE",reagentsKnown:true,reagents:[{itemId:200,required:3,name:"WORKSHOP_PRIVATE_HERB"}]}]},materials:{observedAt:"2026-11-09T12:00:00.000Z",complete:true,scope:"bags-0-4",items:[{itemId:200,count:2}]}}}}]});
const setup=()=>{let current=seed(),writes=0;const handlers={};require("../src/core/preparation-ipc.cjs").registerPreparationHandlers({handle:(name,fn)=>handlers[name]=fn,getState:()=>current,saveState:next=>{writes++;current=structuredClone(next);current.onboarded=true;}});return{handlers,get current(){return current;},set current(next){current=next;},get writes(){return writes;}};};
test("trusted preparation methods require exactly two arguments and strict actual options",()=>{
 const f=setup();for(const method of ["preparationBrief","createPreparationJourney"])for(const args of [[],["p"],["p",{},{}],["p",undefined],["p",null],["p",[]],["p",{recipeId:"100"}],["p",{crafts:21}],["p",{source:{id:"FORGED"}}],["p",{reagents:[]}],["p",{now:0}]])assert.throws(()=>f.handlers[method](...args),method+JSON.stringify(args));assert.equal(f.writes,0);
 assert.equal(f.handlers.preparationBrief(null,{}).status,"unavailable");assert.throws(()=>f.handlers.createPreparationJourney(null,{recipeId:100}));
});
test("brief reads latest owned state and checklist saves once, returns detached latest saved state",()=>{
 const f=setup(),brief=f.handlers.preparationBrief("p",{recipeId:100,crafts:2});assert.equal(brief.shoppingRows[0].missing,4);assert.equal(f.writes,0);assert.equal(typeof brief.then,"undefined");
 f.current.profiles[0].readiness.workshop.materials.items[0].count=5;const out=f.handlers.createPreparationJourney("p",{recipeId:100,crafts:2});assert.equal(f.writes,1);assert.equal(out.state.onboarded,true);assert.match(out.state.journeys[0].steps[0].text,/shortfall: 1/);out.state.profiles[0].notes="changed";assert.equal(f.current.profiles[0].notes,"PRIVATE_NOTE");
 f.current=defaultState();assert.throws(()=>f.handlers.createPreparationJourney("p",{recipeId:100}));assert.equal(f.writes,1);
 f.current=seed();f.current.activeProfileId=null;assert.throws(()=>f.handlers.createPreparationJourney("p",{recipeId:100}));assert.equal(f.writes,1);
});
test("ordinary saves cannot forge workshop evidence or remove a main-created checklist; provider context stays private",()=>{
 const f=setup(),before=structuredClone(f.current);f.handlers.createPreparationJourney("p",{recipeId:100});
 const edited=structuredClone(before);edited.profiles[0].notes="Saved draft";edited.profiles[0].readiness.workshop.materials.items[0].count=999;edited.journeys=[];
 const merged=mergeOrdinaryState(f.current,edited,before);assert.equal(merged.journeys.length,1);assert.equal(merged.profiles[0].readiness.workshop.materials.items[0].count,2);assert.equal(merged.profiles[0].notes,"Saved draft");
 const approved=require("../src/core/providers.cjs").approvedProfile(merged.profiles[0]);assert.doesNotMatch(JSON.stringify(approved),/PRIVATE_|WORKSHOP_|workshop|journeys/);
});
test("preload exposes preparation methods and forwards extra arguments for main rejection",async()=>{
 let api,request;vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../src/preload.cjs"),"utf8"),{require:()=>({contextBridge:{exposeInMainWorld:(_n,a)=>api=a},ipcRenderer:{invoke:(...args)=>{request=args;return Promise.resolve();}}})});
 for(const method of ["preparationBrief","createPreparationJourney"]){assert.equal(typeof api[method],"function");await api[method]("p",{recipeId:100},"extra");assert.deepEqual(Array.from(request),[`backstage:${method}`,"p",{recipeId:100},"extra"]);}
});

test("trusted brief enriches from the offline seller bundle without changing captured inventory or provider whitelist", () => {
 const f = setup(); f.current.profiles[0].faction = "Horde";
 f.current.profiles[0].readiness.workshop.recipes.items[0].reagents[0].itemId = 2320;
 const before = structuredClone(f.current), model = f.handlers.preparationBrief("p", { recipeId: 100 });
 assert.ok(model.shoppingRows[0].historicalSellers, "Trusted main read must enrich historical sellers");
 assert.equal(model.shoppingRows[0].historicalSellers.status, "historical-suggestions");
 assert.ok(model.shoppingRows[0].historicalSellers.suggestions.length <= 3);
 assert.equal(model.sellerReference.source.sourceCommit, "23f9636486d3d60479dc0bcee2356053c33faf2c");
 assert.deepEqual(f.current, before); assert.equal(f.writes, 0);
 assert.doesNotMatch(JSON.stringify(require("../src/core/providers.cjs").approvedProfile(f.current.profiles[0])), /historicalSellers|sellerReference|workshop|PRIVATE_/);
});
