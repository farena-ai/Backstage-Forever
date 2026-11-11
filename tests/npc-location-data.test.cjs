"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
let data;try{data=require('../src/core/npc-location-data.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
test('NPC data compiler and strict runtime validator exist',()=>assert.equal(typeof data?.normalizeNpcLocations,'function'));
test('pinned compilation preserves 616 NPCs and 758 points, excludes narrative/private/world fields',()=>{
 assert.ok(data,'NPC data compiler required');const raw=fs.existsSync('work/npc-source/npcs.json')?fs.readFileSync('work/npc-source/npcs.json'):null;
 const p=raw?data.normalizeNpcLocations(raw):data.validateNpcLocationPack(JSON.parse(fs.readFileSync('data/forever-npc-locations/pack.json')));assert.equal(p.npcs.length,616);assert.equal(p.npcs.reduce((n,r)=>n+r.positions.length,0),758);
 const cairne=p.npcs.find(r=>r.id===3057);assert.equal(cairne.lastSeen,'2026-11-05');assert.deepEqual(cairne.positions,[{mapId:1456,x:.5989,y:.5167}]);
 assert.doesNotMatch(JSON.stringify(p),/"(?:worldX|worldY|options|approached|objects|windows|side)":|Gossip|Greetings/);assert.deepEqual(data.validateNpcLocationPack(p),p);
 if(raw)assert.equal(JSON.stringify(data.normalizeNpcLocations(raw)),JSON.stringify(p));
});
test('raw hash, metadata and limits are enforced',()=>{assert.ok(data);const b=Buffer.from('{"meta":{"clientBuild":"1.60.1.999"}}');assert.throws(()=>data.normalizeNpcLocations(Buffer.concat([b,Buffer.from(' ')])));assert.throws(()=>data.normalizeNpcLocations(Buffer.alloc(2097153)));assert.throws(()=>data.normalizeNpcLocations(b));});
test('runtime rejects unknown keys, duplicate identities, invalid coordinates/dates/provenance/oversize',()=>{
 assert.ok(data);const original=JSON.parse(fs.readFileSync('data/forever-npc-locations/pack.json'));
 for(const edit of [p=>p.private='secret',p=>p.npcs[0].worldX=1,p=>p.npcs.push(p.npcs[0]),p=>p.npcs[0].positions[0].x=NaN,p=>p.npcs[0].positions[0].y=1.1,p=>p.npcs[0].lastSeen='2026-02-30',p=>p.sourceCommit='bad',p=>p.npcs[0].name='x'.repeat(201),p=>p.npcs[0].positions=Array(9).fill(p.npcs[0].positions[0]),p=>p.npcs=Array(1001).fill(p.npcs[0])]){const p=structuredClone(original);edit(p);assert.throws(()=>data.validateNpcLocationPack(p));}
});
