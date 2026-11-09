"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {defaultState,validateState}=require("../src/core/validation.cjs");
const {reconcileJourneys}=require("../src/core/journeys.cjs");
const at="2026-11-09T12:00:00.000Z", col=items=>({observedAt:at,complete:true,items});
const profile=(id="p")=>({id,name:id,realm:"Synthetic",className:"Mage",level:12,notes:"PRIVATE_NOTE",goals:[{id:"g",text:"PRIVATE_GOAL",done:false}],clientBuild:"1.60.1.70862",source:{kind:"wow-addon",id:`PRIVATE_SOURCE_${id}`,updatedAt:at},readiness:{bags:{free:4,total:16},equipment:[{slot:1,itemId:9}],workshop:{professions:col([{skillLineId:171,professionId:1,name:"Alchemy",rank:20,maxRank:75}]),recipes:col([{id:100,skillLineId:171,name:"Synthetic potion",reagentsKnown:true,reagents:[{itemId:200,required:3,name:"Herb"},{itemId:201,required:1}]}]),materials:{...col([{itemId:200,count:2}]),scope:"bags-0-4"}}}});
const state=()=>({...defaultState(),profiles:[profile(),profile("alt")],activeProfileId:"p"});
const core=()=>require("../src/core/preparation.cjs");
const hooks=()=>{let n=0;return{now:Date.parse(at),id:()=>`owned-${++n}`};};
test("planner returns detached dated selected facts, bounded exact batch shortfalls and separate other characters",()=>{
 const s=state(),before=structuredClone(s),p=core().buildPreparation(s,"p",{recipeId:100,crafts:2});
 assert.equal(p.status,"ready");assert.equal(p.selection.crafts,2);assert.equal(p.selectedRecipe.id,100);assert.equal(p.planning.inventoryExact,true);assert.equal(p.planning.checklistAvailable,true);
 assert.deepEqual(p.shoppingRows.map(r=>[r.itemId,r.required,r.have,r.missing,r.quantityKind]),[[200,6,2,4,"exact"],[201,2,0,2,"exact"]]);
 assert.equal(p.source.updatedAt,at);assert.equal(p.source.id,undefined);assert.equal(p.coverage.materials.status,"complete");assert.equal(p.otherCharacters.length,1);assert.equal(p.otherCharacters[0].character.id,"alt");assert.equal(p.otherCharacters[0].materials[0].count,2);assert.doesNotMatch(JSON.stringify(p),/PRIVATE_/);
 p.shoppingRows[0].required=999;p.professions[0].name="changed";assert.deepEqual(s,before);
});
test("partial, missing or older carried observations never prove exact missing quantities",()=>{
 for(const mutate of [w=>w.materials.complete=false,w=>delete w.materials,w=>w.materials.observedAt="2026-11-09T11:59:00.000Z"]){const s=state();mutate(s.profiles[0].readiness.workshop);const p=core().buildPreparation(s,"p",{recipeId:100});assert.equal(p.planning.inventoryExact,false);assert.equal(p.planning.checklistAvailable,true);assert.ok(p.shoppingRows.every(r=>r.missing===null&&r.quantityKind!=="exact"));assert.equal(p.shoppingRows[0].required,3);}
 const s=state();s.profiles[0].readiness.workshop.materials.items=[];assert.equal(core().buildPreparation(s,"p",{}).shoppingRows[0].missing,3);
});
test("unknown/empty/changed professions and unknown or reagent-free recipes stay honest",()=>{
 for(const mutate of [p=>delete p.source,p=>delete p.clientBuild,p=>delete p.readiness.workshop.professions,p=>p.readiness.workshop.professions.items=[],p=>p.readiness.workshop.recipes.items[0].skillLineId=999,p=>{p.readiness.workshop.recipes.items[0].reagentsKnown=false;p.readiness.workshop.recipes.items[0].reagents=[];},p=>p.readiness.workshop.recipes.items[0].reagents=[]]){const s=state();mutate(s.profiles[0]);const p=core().buildPreparation(s,"p",{recipeId:100});assert.equal(p.planning.checklistAvailable,false);assert.deepEqual(p.shoppingRows,[]);assert.doesNotMatch(JSON.stringify(p),/Ready to craft/);assert.throws(()=>core().createPreparationJourney(s,"p",{recipeId:100},hooks()));}
 const s=state();s.profiles[0].readiness.workshop.recipes.items=[];assert.equal(core().buildPreparation(s,"p",{}).status,"empty");assert.equal(core().buildPreparation(s,"absent",{}).status,"unavailable");
 delete s.profiles[0].readiness;assert.equal(core().buildPreparation(s,"p",{}).coverage.recipes.status,"unknown");
});
test("default uses a useful owned recipe; explicit stale recipe selection is never silently reassigned",()=>{
 const s=state(),recipes=s.profiles[0].readiness.workshop.recipes.items;recipes.unshift({...structuredClone(recipes[0]),id:99,skillLineId:999});assert.equal(core().buildPreparation(s,"p",{}).selectedRecipe.id,100);assert.equal(core().buildPreparation(s,"p",{recipeId:999}).selectedRecipe,null);assert.throws(()=>core().createPreparationJourney(s,"p",{recipeId:999},hooks()));
});
test("strict options are detached and require bounded actual integer recipe IDs and craft attempts",()=>{
 for(const options of [null,[],{recipeId:0},{recipeId:2147483648},{recipeId:"100"},{crafts:0},{crafts:21},{crafts:1.5},{crafts:"2"},{source:{}},{now:0}])assert.throws(()=>core().buildPreparation(state(),"p",options));
 assert.equal(core().buildPreparation(state(),"p",{crafts:20}).shoppingRows[0].required,60);assert.throws(()=>core().buildPreparation(state(),undefined,{}));
});
test("manual checklist uses existing journey ownership, exact missing or explicitly unknown carried total requirements",()=>{
 const s=state(),before=structuredClone(s),out=core().createPreparationJourney(s,"p",{recipeId:100,crafts:2},hooks());assert.equal(out.state.journeys.length,1);assert.equal(out.journeyId,"owned-1");assert.deepEqual(s,before);
 const j=out.state.journeys[0];assert.match(j.title,/Synthetic potion/);assert.ok(j.steps.every(step=>step.done===false&&step.profileId==="p"&&step.quest===undefined&&step.observed===undefined));assert.match(j.steps.map(x=>x.text).join(" "),/4.*Herb/);assert.doesNotMatch(JSON.stringify(j),/PRIVATE_/);assert.deepEqual(validateState(out.state),out.state);
 const supplied=structuredClone(out.state.profiles);supplied[0].readiness.workshop.materials.items=[{itemId:200,count:100},{itemId:201,count:100}];assert.deepEqual(reconcileJourneys(out.state.journeys,supplied),out.state.journeys);
 for(const missing of [false,true]){const partial=state();if(missing)delete partial.profiles[0].readiness.workshop.materials;else partial.profiles[0].readiness.workshop.materials.complete=false;const manual=core().createPreparationJourney(partial,"p",{recipeId:100,crafts:2},hooks());const texts=manual.state.journeys[0].steps.map(x=>x.text).join(" ");assert.match(texts,/carried supply.*(?:incomplete|unknown)/i);assert.match(texts,/6.*Herb/);assert.doesNotMatch(texts,/purchase|missing 4/i);}
 const all=state();all.profiles[0].readiness.workshop.materials.items=[{itemId:200,count:99},{itemId:201,count:99}];const checked=core().createPreparationJourney(all,"p",{recipeId:100},hooks());assert.match(checked.state.journeys[0].steps.map(x=>x.text).join(" "),/verify/i);assert.ok(checked.state.journeys[0].steps.every(x=>!x.done));
});
test("manual creation is current-active-source only and atomic across capacity, invalid options and ID collisions",()=>{
 for(const mutate of [s=>s.activeProfileId="alt",s=>delete s.profiles[0].source,s=>delete s.profiles[0].clientBuild,s=>s.profiles[0].readiness.workshop.recipes.items=[]]){const s=state();mutate(s);const before=structuredClone(s);assert.throws(()=>core().createPreparationJourney(s,"p",{recipeId:100},hooks()));assert.deepEqual(s,before);}
 const s=state(),before=structuredClone(s);assert.throws(()=>core().createPreparationJourney(s,"p",{}, {now:Date.parse(at),id:()=>"collision"}));assert.deepEqual(s,before);
 s.journeys=Array.from({length:20},(_,i)=>({id:`j${i}`,title:"Full",createdAt:at,steps:[]}));assert.throws(()=>core().createPreparationJourney(s,"p",{recipeId:100},hooks()));assert.equal(s.journeys.length,20);
});
test("null selection yields an explicit no-character unavailable read model",()=>{
 const p=core().buildPreparation(defaultState(),null,{});assert.equal(p.status,"unavailable");assert.equal(p.character.id,null);assert.equal(p.selectedRecipe,null);assert.equal(p.coverage.materials.status,"unknown");
});

test("preparation options are actual plain objects and recipe/skill data can be partial without inventing totals",()=>{
 for(const options of [new Date(),Object.create({recipeId:100}),{crafts:2n}])assert.throws(()=>core().buildPreparation(state(),"p",options));
 const s=state();s.profiles[0].readiness.workshop.professions.complete=false;s.profiles[0].readiness.workshop.recipes.complete=false;const model=core().buildPreparation(s,"p",{recipeId:100});assert.equal(model.planning.available,true);assert.equal(model.coverage.professions.status,"partial");assert.equal(model.coverage.recipes.status,"partial");
});

test("bounded historical seller enrichment keeps inventory, dates, partial labels and other characters separate", () => {
 const { normalizeVendors } = require("../src/core/vendor-facts.cjs"), { fixture, commit, build } = require("./fixtures/vendor-facts.cjs");
 const vendorPack = normalizeVendors(fixture(), { commit, build }), s = state(); s.profiles[0].faction = "Horde";
 s.profiles[0].readiness.workshop.recipes.items[0].reagents[0].itemId = 2320;
 s.profiles[0].readiness.workshop.materials.complete = false;
 const before = structuredClone(s), model = core().buildPreparation(s, "p", { recipeId: 100, crafts: 2 }, { vendorPack });
 assert.ok(model.shoppingRows[0].historicalSellers, "Preparation must expose qualified historical seller facts");
 assert.equal(model.shoppingRows[0].historicalSellers.suggestions[0].id, 10);
 assert.equal(model.shoppingRows[0].quantityKind, "lower-bound"); assert.equal(model.shoppingRows[0].missing, null);
 assert.equal(model.shoppingRows[0].required, 6); assert.equal(model.coverage.materials.observedAt, at);
 assert.equal(model.shoppingRows[1].historicalSellers.status, "unobserved");
 assert.equal(model.sellerReference.source.build, build); assert.match(model.sellerReference.limitation, /current stock, price and access are unverified/);
 assert.equal(model.otherCharacters[0].materials[0].count, 2); assert.deepEqual(s, before);
 assert.doesNotMatch(JSON.stringify(model), /PRIVATE_|waypoint|\/bf guide/);
 model.shoppingRows[0].historicalSellers.suggestions[0].name = "changed"; assert.equal(vendorPack.vendors[0].name, "Synthetic seller");
 s.profiles[0].faction = "Alliance";
 assert.equal(core().buildPreparation(s, "p", {}, { vendorPack }).shoppingRows[0].historicalSellers.status, "browse-only");
 assert.equal(core().buildPreparation(s, "p", {}).sellerReference, null);
});
