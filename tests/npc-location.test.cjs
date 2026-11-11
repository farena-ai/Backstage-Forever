"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
let npc;try{npc=require('../src/core/npc-location.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const pack=JSON.parse(fs.readFileSync('data/forever-npc-locations/pack.json'));const resolve=(q,opts={})=>{assert.ok(npc);return npc.resolveNpcLocation(q,{historicalPack:pack,...opts});};
test('local NPC resolver exists',()=>assert.equal(typeof npc?.resolveNpcLocation,'function'));
test('full, short, ID and apostrophe queries yield qualified historical points',()=>{for(const q of ['where in org is Cairne Bloodhoof','Where is Cairne?','Where can I find NPC #3057?','NPC #3057']){const r=resolve(q);assert.equal(r.dto.status,'found');assert.equal(r.dto.entities[0].id,3057);assert.match(r.text,/Thunder Bluff.*59.9, 51.7/);assert.match(r.text,/2026-11-05/);assert.match(r.text,/1.60.1.70790/);assert.doesNotMatch(r.text,/last observed 2026-11-11/);}for(const q of ["Where is Vol'jin?",'Where is Voljin?','Where is Vol’jin?'])assert.equal(resolve(q).dto.entities[0].id,10540);assert.equal(resolve('Where is Sylvanas?').dto.entities[0].id,10181);assert.match(resolve('where in org is Cairne Bloodhoof').text,/verified Orgrimmar location/);});
test('real duplicate names ask a bounded choice without choosing coordinates',()=>{const r=resolve('Where is Valennia Stormfist?');assert.equal(r.dto.status,'ambiguous');assert.equal(r.dto.candidates.length,3);assert.equal(r.dto.entities.length,0);assert.doesNotMatch(r.text,/around/);});
test('ordinary material, item, bank, geography and non-location requests stay out of NPC path',()=>{for(const q of ['Where is the bank?','Where can I find copper ore?','Where is Orgrimmar?','Where is Bloodhoof Village?','Where can I find Peacebloom?','Where is my hearthstone?','Where should I level?','Explain my quest route','How do I get from Org to TB?'])assert.equal(resolve(q),null,q);assert.equal(resolve('Where is Cairn?').dto.status,'unknown');assert.equal(resolve('Where is Zorblax?').dto.status,'unknown');});
test('unknown explicit NPC and absent/corrupt data never invent locations',()=>{assert.equal(resolve('Where is NPC Zorblax?').dto.status,'unknown');for(const p of [null,{bad:true}]){const r=resolve('Where is NPC Cairne?',{historicalPack:p});assert.equal(r.dto.status,'unavailable');assert.equal(r.dto.entities.length,0);}const p=structuredClone(pack);p.npcs.find(n=>n.id===3057).positions=[];assert.equal(resolve('Where is Cairne?',{historicalPack:p}).dto.status,'unknown');});
test('only exact observed current build outranks the separate historical point',()=>{const profile={clientBuild:'1.60.1.70862',source:{kind:'wow-addon',updatedAt:'2026-11-11T00:00:00Z'}};const index={compatible:p=>p.source?.kind==='wow-addon'&&p.clientBuild==='1.60.1.70862',pack:{build:'1.60.1.70862',sourceCommit:'a'.repeat(40),npcs:{'npc:3057':{id:3057,kind:'npc',name:'Cairne Bloodhoof',sources:2,lastSeen:'2026-11-10',positions:[{mapId:1454,x:.3,y:.4}]}}}};const exact=resolve('Where is Cairne?',{profile,shareProfile:true,currentIndex:index});assert.equal(exact.dto.entities[0].evidenceTier,'exact-build-observation');assert.equal(exact.dto.entities[0].positions[0].mapId,1454);for(const o of [{shareProfile:false,profile},{shareProfile:true,profile:{...profile,source:{kind:'manual'}}}])assert.equal(resolve('Where is Cairne?',{...o,currentIndex:index}).dto.entities[0].evidenceTier,'historical-reference');index.pack.npcs['npc:3057'].positions=[];assert.equal(resolve('Where is Cairne?',{profile,shareProfile:true,currentIndex:index}).dto.entities[0].evidenceTier,'historical-reference');});
test('quoted publisher names are literal and multi-name queries ask which one',()=>{assert.equal(resolve('Where are Cairne and Thrall?').dto.status,'ambiguous');const p=structuredClone(pack);p.npcs[0].name='Trader (A+B)';assert.equal(resolve('Where is Trader (A+B)?',{historicalPack:p}).dto.entities[0].id,p.npcs[0].id);});
test('missing historical tier with empty matching current evidence reports unavailable safely',()=>{assert.equal(resolve('where in org is Cairne Bloodhoof',{historicalPack:null,shareProfile:true,currentIndex:{compatible:()=>true,pack:{npcs:{}}}}).dto.status,'unavailable');for(const q of ['Where is Linen Cloth?','Where can I find Light Leather?','Where is a healing potion?'])assert.equal(resolve(q),null);});
test('original city-premise query remains safe-local even lowercase with no historical pack or sharing',()=>{for(const pack of [null,{corrupt:true}])assert.equal(resolve('where in org is cairne bloodhoof',{historicalPack:pack,shareProfile:false}).dto.status,'unavailable');});

function conflictingIndex(positions=[{mapId:1454,x:.3,y:.4}]){return {compatible:()=>true,pack:{build:'1.60.1.70862',sourceCommit:'a'.repeat(40),npcs:{'npc:3057':{id:3057,kind:'npc',name:'Cairne the Elder',sources:2,lastSeen:'2026-11-10',positions}}}};}
test('name lookup reconciles conflicting names in all evidence tiers for a matched ID',()=>{
 const opts={shareProfile:true,currentIndex:conflictingIndex()};
 for(const name of ['Cairne Bloodhoof','Cairne the Elder']){
  const r=resolve('Where is '+name+'?',opts);assert.equal(r.dto.status,'ambiguous');
  assert.deepEqual(r.dto.candidates.map(n=>[n.id,n.name]),[[3057,'Cairne the Elder'],[3057,'Cairne Bloodhoof']]);assert.equal(r.dto.entities.length,0);
 }
});
test('exact ID resolves conflicting names using qualified evidence in tier order',()=>{
 const index=conflictingIndex(),opts={shareProfile:true,currentIndex:index};
 let r=resolve('Where is NPC #3057?',opts);assert.equal(r.dto.status,'found');assert.equal(r.dto.entities[0].name,'Cairne the Elder');assert.equal(r.dto.entities[0].evidenceTier,'exact-build-observation');assert.match(r.text,/Observed character-build reference 1.60.1.70862/);
 index.pack.npcs['npc:3057'].positions=[];
 r=resolve('Where is NPC #3057?',opts);assert.equal(r.dto.status,'found');assert.equal(r.dto.entities[0].name,'Cairne Bloodhoof');assert.equal(r.dto.entities[0].evidenceTier,'historical-reference');assert.match(r.text,/Older Forever build 1.60.1.70790/);
});
test('display truncation cannot deny a requested city present in the complete chosen evidence',()=>{
 const points=[{mapId:1456,x:.1,y:.1},{mapId:1456,x:.2,y:.2},{mapId:1456,x:.3,y:.3},{mapId:1454,x:.4,y:.4}];
 const index=conflictingIndex(points);index.pack.npcs['npc:3057'].name='Cairne Bloodhoof';
 const r=resolve('where in org is Cairne Bloodhoof',{shareProfile:true,currentIndex:index});
 assert.equal(r.dto.status,'found');assert.equal(r.dto.entities[0].positions.length,3);assert.equal(r.dto.entities[0].additionalPositions,1);assert.match(r.text,/1 additional historical points are not shown/);assert.doesNotMatch(r.text,/don't have a verified Orgrimmar location/);
});
