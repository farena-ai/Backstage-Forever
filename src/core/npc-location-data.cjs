"use strict";
const {createHash}=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {COMMIT,BUILD,ATTRIBUTION,SOURCE}=require('./npc-location-sources.cjs');
const RAW_LIMIT=2*1024*1024,PACK_LIMIT=256*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');
const id=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const text=s=>typeof s==='string'&&s.length>0&&s.length<=200&&!/[\x00-\x1f\x7f]/.test(s);
const day=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const fail=()=>{throw Error('Invalid NPC location reference.');};
function keys(o,allowed){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))fail();}
function point(p){keys(p,['mapId','x','y']);if(!id(p.mapId)||!['x','y'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1))fail();}
function validateNpcLocationPack(p){
 keys(p,['schemaVersion','kind','product','build','sourceCommit','license','attribution','source','npcs']);
 if(p.schemaVersion!==1||p.kind!=='forever-npc-locations'||p.product!=='wowf'||p.build!==BUILD||p.sourceCommit!==COMMIT||p.license!=='CC BY 4.0'||p.attribution!==ATTRIBUTION||!isDeepStrictEqual(p.source,SOURCE)||!Array.isArray(p.npcs)||p.npcs.length>1000)fail();
 const seen=new Set();for(const n of p.npcs){keys(n,['id','name','lastSeen','contributingFiles','positions']);if(!id(n.id)||seen.has(n.id)||!text(n.name)||!day(n.lastSeen)||n.lastSeen>p.source.meta.collectedOn.last||!id(n.contributingFiles)||n.contributingFiles>p.source.meta.sources||!Array.isArray(n.positions)||n.positions.length>8)fail();seen.add(n.id);const points=new Set();for(const q of n.positions){point(q);const key=JSON.stringify(q);if(points.has(key))fail();points.add(key);}}
 if(Buffer.byteLength(JSON.stringify(p))>PACK_LIMIT)fail();return p;
}
function normalizeNpcLocations(rawBytes){
 if(!Buffer.isBuffer(rawBytes)||rawBytes.length>RAW_LIMIT||rawBytes.length!==SOURCE.bytes||hash(rawBytes)!==SOURCE.sha256)fail();
 const raw=JSON.parse(rawBytes);if(!isDeepStrictEqual(raw.meta,SOURCE.meta)||!raw.npcs||typeof raw.npcs!=='object'||Array.isArray(raw.npcs)||Object.keys(raw.npcs).length>1000)fail();
 const npcs=Object.entries(raw.npcs).map(([key,n])=>{if(!id(+key)||String(+key)!==key||!Array.isArray(n.positions))fail();const positions=[];for(const p of n.positions){const q={mapId:p.uiMap,x:p.mapX,y:p.mapY};point(q);if(!positions.some(v=>v.mapId===q.mapId&&v.x===q.x&&v.y===q.y))positions.push(q);}return {id:+key,name:n.name,lastSeen:n.lastSeen,contributingFiles:n.sources,positions};}).sort((a,b)=>a.id-b.id);
 return validateNpcLocationPack({schemaVersion:1,kind:'forever-npc-locations',product:'wowf',build:BUILD,sourceCommit:COMMIT,license:'CC BY 4.0',attribution:ATTRIBUTION,source:structuredClone(SOURCE),npcs});
}
module.exports={normalizeNpcLocations,validateNpcLocationPack,RAW_LIMIT,PACK_LIMIT,hash};
