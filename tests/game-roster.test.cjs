"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const { combineSnapshots }=require("../src/core/game-roster.cjs");
const c=(id,n=1)=>({id,updatedAt:`2026-01-0${n}T00:00:00.000Z`,name:id,level:n});
const s=(characters,activeId,day=2)=>({characters,activeId,observedAt:`2026-01-0${day}T00:00:00.000Z`});
test("composite keeps newest per identity across accounts and latest saved active/null with deterministic ties",()=>{
  const a=s([c("a",3),c("b")],"a",3),b=s([c("b",2),c("c")],"c",4);
  const result=combineSnapshots([a,b]);
  assert.equal(result.snapshot.characters.length,3);assert.equal(result.snapshot.characters.find(x=>x.id==="b").level,2);assert.equal(result.snapshot.activeId,"c");
  assert.deepEqual(result,combineSnapshots([b,a]));assert.equal(combineSnapshots([a,s([],null,4)]).snapshot.activeId,null);
  const tie=s([{...c("a",3),name:"tie"}],"a",3);
  assert.deepEqual(combineSnapshots([a,tie]),combineSnapshots([tie,a]));
});
test("composite cap retains latest active and reports omissions without account identifiers",()=>{
  const many=Array.from({length:100},(_,i)=>c(String(i),3));
  const result=combineSnapshots([s(many,"0",3),s([c("old-active")],"old-active",4)]);
  assert.equal(result.snapshot.characters.length,100);assert.ok(result.snapshot.characters.some(x=>x.id==="old-active"));assert.equal(result.coverage.omittedCharacterCount,1);
});
