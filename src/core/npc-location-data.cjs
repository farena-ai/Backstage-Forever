"use strict";
const {createHash}=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES}=require('./npc-location-sources.cjs');
// Raw single-build input bound; the merged multi-build bundle has its own bound.
const RAW_LIMIT=2*1024*1024,PACK_LIMIT=256*1024,MAX_NPCS=3000,MAX_POSITIONS=8,MAX_BUILDS=12;
const BUILD_RE=/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/,COMMIT_RE=/^[a-f0-9]{40}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
const id=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const text=s=>typeof s==='string'&&s.length>0&&s.length<=200&&!/[\x00-\x1f\x7f]/.test(s);
const day=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const fail=()=>{throw Error('Invalid NPC location reference.');};
function keys(o,allowed){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))fail();}
function point(p){keys(p,['mapId','x','y']);if(!id(p.mapId)||!['x','y'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1))fail();}
function checkSource(s,commit){
 keys(s,['name','build','bytes','sha256','url','meta']);keys(s.meta,['attribution','clientBuild','collectedOn','dataset','license','product','schemaVersion','sources']);
 if(s.name!=='npcs.json'||!BUILD_RE.test(s.build)||!Number.isSafeInteger(s.bytes)||s.bytes<1||s.bytes>RAW_LIMIT||!/^[a-f0-9]{64}$/.test(s.sha256)||s.url!==`https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${commit}/data/wowf/${s.build}/npcs.json`||s.meta.attribution!==ATTRIBUTION||s.meta.clientBuild!==s.build||s.meta.dataset!=='npcs'||s.meta.license!=='CC BY 4.0'||s.meta.product!=='wowf'||s.meta.schemaVersion!==1||!id(s.meta.sources)||!day(s.meta.collectedOn?.first)||!day(s.meta.collectedOn?.last)||s.meta.collectedOn.first>s.meta.collectedOn.last)fail();
}
/** Strict validator. pinned (default) also requires the exact bundled provenance. */
function validateNpcLocationPack(p,{pinned=true}={}){
 keys(p,['schemaVersion','kind','product','build','builds','sourceCommit','license','attribution','sources','npcs']);
 if(p.schemaVersion!==1||p.kind!=='forever-npc-locations'||p.product!=='wowf'||p.license!=='CC BY 4.0'||p.attribution!==ATTRIBUTION||!COMMIT_RE.test(p.sourceCommit)||!Array.isArray(p.sources)||!p.sources.length||p.sources.length>MAX_BUILDS||!Array.isArray(p.builds)||!Array.isArray(p.npcs)||p.npcs.length>MAX_NPCS)fail();
 for(const s of p.sources)checkSource(s,p.sourceCommit);
 if(!isDeepStrictEqual(p.builds,p.sources.map(s=>s.build))||new Set(p.builds).size!==p.builds.length||p.build!==p.builds[0])fail();
 if(pinned&&(p.build!==BUILD||p.sourceCommit!==COMMIT||!isDeepStrictEqual(p.builds,BUILDS)||!isDeepStrictEqual(p.sources,SOURCES)))fail();
 const last=p.sources.map(s=>s.meta.collectedOn.last).sort().at(-1),most=Math.max(...p.sources.map(s=>s.meta.sources));
 const seen=new Set();for(const n of p.npcs){keys(n,['id','name','build','lastSeen','contributingFiles','positions']);if(!id(n.id)||seen.has(n.id)||!text(n.name)||!p.builds.includes(n.build)||!day(n.lastSeen)||n.lastSeen>last||!id(n.contributingFiles)||n.contributingFiles>most||!Array.isArray(n.positions)||n.positions.length>MAX_POSITIONS)fail();seen.add(n.id);const points=new Set();for(const q of n.positions){point(q);const key=JSON.stringify(q);if(points.has(key))fail();points.add(key);}}
 if(Buffer.byteLength(JSON.stringify(p))>PACK_LIMIT)fail();return p;
}
/** One build's npcs.json, verified against its pinned source, as a single-build pack. */
function normalizeNpcLocations(rawBytes,source=SOURCES[0],commit=COMMIT){
 checkSource(source,commit);
 if(!Buffer.isBuffer(rawBytes)||rawBytes.length>RAW_LIMIT||rawBytes.length!==source.bytes||hash(rawBytes)!==source.sha256)fail();
 const raw=JSON.parse(rawBytes);if(!isDeepStrictEqual(raw.meta,source.meta)||!raw.npcs||typeof raw.npcs!=='object'||Array.isArray(raw.npcs)||Object.keys(raw.npcs).length>MAX_NPCS)fail();
 const npcs=Object.entries(raw.npcs).map(([key,n])=>{if(!id(+key)||String(+key)!==key||!Array.isArray(n.positions))fail();const positions=[];for(const p of n.positions){const q={mapId:p.uiMap,x:p.mapX,y:p.mapY};point(q);if(positions.length<MAX_POSITIONS&&!positions.some(v=>v.mapId===q.mapId&&v.x===q.x&&v.y===q.y))positions.push(q);}return {id:+key,name:n.name,build:source.build,lastSeen:n.lastSeen,contributingFiles:n.sources,positions};}).sort((a,b)=>a.id-b.id);
 return validateNpcLocationPack({schemaVersion:1,kind:'forever-npc-locations',product:'wowf',build:source.build,builds:[source.build],sourceCommit:commit,license:'CC BY 4.0',attribution:ATTRIBUTION,sources:[structuredClone(source)],npcs},{pinned:false});
}
/** Newest-first merge: union of NPCs and positions (exact dedupe, cap 8); newest name wins. */
function mergeNpcLocationPacks(packs,{pinned=false}={}){
 if(!Array.isArray(packs)||!packs.length||packs.length>MAX_BUILDS)fail();
 const valid=packs.map(p=>validateNpcLocationPack(p,{pinned:false}));
 if(valid.some(p=>p.sourceCommit!==valid[0].sourceCommit))fail();
 const sources=[],seenBuild=new Set();for(const p of valid)for(const s of p.sources)if(!seenBuild.has(s.build)){seenBuild.add(s.build);sources.push(structuredClone(s));}
 const byId=new Map();
 for(const p of valid)for(const n of p.npcs){const m=byId.get(n.id);
  if(!m){byId.set(n.id,structuredClone(n));continue;}
  if(n.lastSeen>m.lastSeen)m.lastSeen=n.lastSeen;m.contributingFiles=Math.max(m.contributingFiles,n.contributingFiles);
  for(const q of n.positions)if(m.positions.length<MAX_POSITIONS&&!m.positions.some(v=>v.mapId===q.mapId&&v.x===q.x&&v.y===q.y))m.positions.push({...q});}
 const npcs=[...byId.values()].sort((a,b)=>a.id-b.id);
 return validateNpcLocationPack({schemaVersion:1,kind:'forever-npc-locations',product:'wowf',build:sources[0].build,builds:sources.map(s=>s.build),sourceCommit:valid[0].sourceCommit,license:'CC BY 4.0',attribution:ATTRIBUTION,sources,npcs},{pinned});
}
module.exports={normalizeNpcLocations,mergeNpcLocationPacks,validateNpcLocationPack,RAW_LIMIT,PACK_LIMIT,MAX_POSITIONS,hash};
