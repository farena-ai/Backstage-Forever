"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
let data;try{data=require('../src/core/npc-location-data.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
test('NPC data compiler and strict runtime validator exist',()=>assert.equal(typeof data?.normalizeNpcLocations,'function'));
test('pinned multi-build compilation preserves 978 NPCs and 1786 points, excludes narrative/private/world fields',()=>{
 assert.ok(data,'NPC data compiler required');
 const p=data.validateNpcLocationPack(JSON.parse(fs.readFileSync('data/forever-npc-locations/pack.json')));assert.equal(p.npcs.length,978);assert.equal(p.npcs.reduce((n,r)=>n+r.positions.length,0),1786);
 assert.equal(p.build,'1.60.1.70888');assert.deepEqual(p.builds,['1.60.1.70888','1.60.1.70862','1.60.1.70840','1.60.1.70790']);
 const cairne=p.npcs.find(r=>r.id===3057);assert.equal(cairne.lastSeen,'2026-11-05');assert.equal(cairne.build,'1.60.1.70790');assert.deepEqual(cairne.positions,[{mapId:1456,x:.5989,y:.5167}]);
 for(const mapId of [1429,1436,1433,1453,1438])assert.ok(p.npcs.filter(n=>n.positions.some(q=>q.mapId===mapId)).length>=10,'Alliance map '+mapId);
 assert.doesNotMatch(JSON.stringify(p),/"(?:worldX|worldY|options|approached|objects|windows|side)":|Gossip|Greetings/);assert.deepEqual(data.validateNpcLocationPack(p),p);
});
test('per-build NPC packs merge newest-first: union of NPCs and points, newest name, capped and deduped',()=>{
 const {SOURCES,COMMIT}=require('../src/core/npc-location-sources.cjs');
 const single=(source,npcs)=>data.validateNpcLocationPack({schemaVersion:1,kind:'forever-npc-locations',product:'wowf',build:source.build,builds:[source.build],sourceCommit:COMMIT,license:'CC BY 4.0',attribution:source.meta.attribution,sources:[source],npcs:npcs.map(n=>({build:source.build,lastSeen:'2026-11-09',contributingFiles:1,...n}))},{pinned:false});
 const pt=(x,mapId=1429)=>({mapId,x,y:.5});
 const newer=single(SOURCES[0],[{id:1,name:'New Name',positions:[pt(.1),pt(.2)]},{id:2,name:'Only New',positions:[pt(.3)]}]);
 const older=single(SOURCES[1],[{id:1,name:'Old Name',lastSeen:'2026-11-11',contributingFiles:3,positions:[pt(.2),...Array.from({length:7},(_,i)=>pt(i/10+.05,1436))]},{id:3,name:'Only Old',positions:[pt(.4)]}]);
 const m=data.mergeNpcLocationPacks([newer,older]);
 assert.deepEqual(m.builds,[SOURCES[0].build,SOURCES[1].build]);assert.deepEqual(m.npcs.map(n=>n.id),[1,2,3]);
 const one=m.npcs[0];assert.equal(one.name,'New Name');assert.equal(one.build,SOURCES[0].build);assert.equal(one.lastSeen,'2026-11-11');assert.equal(one.contributingFiles,3);
 assert.equal(one.positions.length,data.MAX_POSITIONS);assert.deepEqual(one.positions.slice(0,2),[pt(.1),pt(.2)]);
 assert.equal(m.npcs[2].build,SOURCES[1].build);
 assert.throws(()=>data.validateNpcLocationPack(m),'a partial merge is not the pinned bundle');
 assert.throws(()=>data.mergeNpcLocationPacks([]));
});
test('raw hash, metadata and limits are enforced',()=>{assert.ok(data);const b=Buffer.from('{"meta":{"clientBuild":"1.60.1.999"}}');assert.throws(()=>data.normalizeNpcLocations(Buffer.concat([b,Buffer.from(' ')])));assert.throws(()=>data.normalizeNpcLocations(Buffer.alloc(2097153)));assert.throws(()=>data.normalizeNpcLocations(b));});
test('runtime rejects unknown keys, duplicate identities, invalid coordinates/dates/provenance/oversize',()=>{
 assert.ok(data);const original=JSON.parse(fs.readFileSync('data/forever-npc-locations/pack.json'));
 for(const edit of [p=>p.private='secret',p=>p.npcs[0].worldX=1,p=>p.npcs.push(p.npcs[0]),p=>p.npcs[0].positions[0].x=NaN,p=>p.npcs[0].positions[0].y=1.1,p=>p.npcs[0].lastSeen='2026-02-30',p=>p.sourceCommit='bad',p=>p.npcs[0].name='x'.repeat(201),p=>p.npcs[0].positions=Array(9).fill(p.npcs[0].positions[0]),p=>p.npcs=Array(1001).fill(p.npcs[0])]){const p=structuredClone(original);edit(p);assert.throws(()=>data.validateNpcLocationPack(p));}
});
