"use strict";
// Creature reference: name, observed level range, classification flags and which factions
// observed the creature as hostile, merged newest-first from pinned Efficient Games builds.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const {COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES}=require('./creature-sources.cjs');
// Raw single-build input bound; the merged multi-build bundle has its own bound.
const RAW_LIMIT=2*1024*1024,PACK_LIMIT=400*1024,MAX_CREATURES=8000,MAX_BUILDS=12,MAX_LEVEL=63;
const FACTIONS=['Alliance','Horde'];
// UnitReaction scale seen in the data: 1 hated, 2 hostile, 3 unfriendly, 4 neutral, 5+ friendly.
// A faction "observed it hostile" when any of its reactions is 3 or lower (red name, attacks on sight).
const HOSTILE_MAX=3;
const CLASSIFICATIONS=['normal','elite','rareelite','rare','worldboss'];
const BUILD_RE=/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/,COMMIT_RE=/^[a-f0-9]{40}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
const id=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const level=n=>Number.isSafeInteger(n)&&n>=1&&n<=MAX_LEVEL;
const text=s=>typeof s==='string'&&s.length>0&&s.length<=200&&!/[\x00-\x1f\x7f]/.test(s);
const day=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const fail=()=>{throw Error('Invalid creature reference.');};
function keys(o,allowed){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))fail();}
function checkSource(s,commit){
 keys(s,['name','build','bytes','sha256','url','meta']);keys(s.meta,['attribution','clientBuild','collectedOn','combatLogUploads','dataset','license','product','schemaVersion','sources']);
 if(s.name!=='creatures.json'||!BUILD_RE.test(s.build)||!Number.isSafeInteger(s.bytes)||s.bytes<1||s.bytes>RAW_LIMIT||!/^[a-f0-9]{64}$/.test(s.sha256)||s.url!==`https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${commit}/data/wowf/${s.build}/creatures.json`||s.meta.attribution!==ATTRIBUTION||s.meta.clientBuild!==s.build||s.meta.dataset!=='creatures'||s.meta.license!=='CC BY 4.0'||s.meta.product!=='wowf'||s.meta.schemaVersion!==1||!id(s.meta.sources)||('combatLogUploads' in s.meta&&!id(s.meta.combatLogUploads))||!day(s.meta.collectedOn?.first)||!day(s.meta.collectedOn?.last)||s.meta.collectedOn.first>s.meta.collectedOn.last)fail();
}
const FLAGS=['elite','rare','worldboss','skull'];
/** Strict validator. pinned (default) also requires the exact bundled provenance. */
function validateCreaturePack(p,{pinned=true}={}){
 keys(p,['schemaVersion','kind','product','build','builds','sourceCommit','license','attribution','hostility','sources','creatures']);
 if(p.schemaVersion!==1||p.kind!=='forever-creatures'||p.product!=='wowf'||p.license!=='CC BY 4.0'||p.attribution!==ATTRIBUTION||p.hostility!==HOSTILITY||!COMMIT_RE.test(p.sourceCommit)||!Array.isArray(p.sources)||!p.sources.length||p.sources.length>MAX_BUILDS||!Array.isArray(p.builds)||!Array.isArray(p.creatures)||p.creatures.length>MAX_CREATURES)fail();
 for(const s of p.sources)checkSource(s,p.sourceCommit);
 if(!isDeepStrictEqual(p.builds,p.sources.map(s=>s.build))||new Set(p.builds).size!==p.builds.length||p.build!==p.builds[0])fail();
 if(pinned&&(p.build!==BUILD||p.sourceCommit!==COMMIT||!isDeepStrictEqual(p.builds,BUILDS)||!isDeepStrictEqual(p.sources,SOURCES)))fail();
 const most=Math.max(...p.sources.map(s=>s.meta.sources));let prev=0;
 for(const c of p.creatures){
  keys(c,['id','name','minLevel','maxLevel',...FLAGS,'hostileTo','sources']);
  if(!id(c.id)||c.id<=prev||(c.name!==null&&!text(c.name))||!id(c.sources)||c.sources>most)fail();prev=c.id;
  // Level -1 ("??", a skull) is kept as a flag; a skull-only creature has no numeric range.
  if(c.minLevel===null||c.maxLevel===null){if(c.minLevel!==null||c.maxLevel!==null||c.skull!==true)fail();}
  else if(!level(c.minLevel)||!level(c.maxLevel)||c.minLevel>c.maxLevel)fail();
  for(const f of FLAGS)if(f in c&&c[f]!==true)fail();
  if(!Array.isArray(c.hostileTo)||!isDeepStrictEqual(c.hostileTo,FACTIONS.filter(f=>c.hostileTo.includes(f)))||c.hostileTo.length!==new Set(c.hostileTo).size)fail();
 }
 if(Buffer.byteLength(JSON.stringify(p))>PACK_LIMIT)fail();return p;
}
const HOSTILITY='hostileTo lists factions with any observed UnitReaction of 3 (unfriendly) or lower.';
/** One build's creatures.json, verified against its pinned source, as a single-build pack. */
function normalizeCreatures(rawBytes,source=SOURCES[0],commit=COMMIT){
 checkSource(source,commit);
 if(!Buffer.isBuffer(rawBytes)||rawBytes.length>RAW_LIMIT||rawBytes.length!==source.bytes||hash(rawBytes)!==source.sha256)fail();
 const raw=JSON.parse(rawBytes);if(!isDeepStrictEqual(raw.meta,source.meta)||!raw.creatures||typeof raw.creatures!=='object'||Array.isArray(raw.creatures)||Object.keys(raw.creatures).length>MAX_CREATURES)fail();
 const creatures=[];
 for(const [key,c] of Object.entries(raw.creatures)){
  if(!id(+key)||String(+key)!==key||!c||typeof c!=='object')fail();
  // A few rows carry no name (the newest named build wins in the merge, else null).
  // Entries seen only in combat logs carry no classification or reaction: not part of this reference.
  if(!c.levels||!Array.isArray(c.classifications)||!c.reactions)continue;
  if(('name' in c&&!text(c.name))||!c.classifications.length||c.classifications.some(x=>!CLASSIFICATIONS.includes(x))||typeof c.levels!=='object'||typeof c.reactions!=='object')fail();
  const lv=Object.keys(c.levels).map(Number);if(!lv.length||lv.some(l=>l!==-1&&!level(l)))fail();
  const nums=lv.filter(l=>l>0);
  const hostileTo=[];for(const [f,rs] of Object.entries(c.reactions)){if(!FACTIONS.includes(f)||!Array.isArray(rs)||rs.some(r=>!Number.isSafeInteger(r)||r<1||r>8))fail();if(rs.some(r=>r<=HOSTILE_MAX))hostileTo.push(f);}
  const cls=c.classifications;
  creatures.push(row({id:+key,name:c.name??null,minLevel:nums.length?Math.min(...nums):null,maxLevel:nums.length?Math.max(...nums):null,
   elite:cls.includes('elite')||cls.includes('rareelite'),rare:cls.includes('rare')||cls.includes('rareelite'),worldboss:cls.includes('worldboss'),skull:lv.includes(-1),
   hostileTo:FACTIONS.filter(f=>hostileTo.includes(f)),sources:c.sources}));
 }
 creatures.sort((a,b)=>a.id-b.id);
 return validateCreaturePack(envelope([structuredClone(source)],commit,creatures),{pinned:false});
}
// Flags are present only when true, keeping the bundle small.
function row({id,name,minLevel,maxLevel,elite,rare,worldboss,skull,hostileTo,sources}){
 const r={id,name,minLevel,maxLevel};if(elite)r.elite=true;if(rare)r.rare=true;if(worldboss)r.worldboss=true;if(skull)r.skull=true;r.hostileTo=hostileTo;r.sources=sources;return r;
}
const envelope=(sources,commit,creatures)=>({schemaVersion:1,kind:'forever-creatures',product:'wowf',build:sources[0].build,builds:sources.map(s=>s.build),sourceCommit:commit,license:'CC BY 4.0',attribution:ATTRIBUTION,hostility:HOSTILITY,sources,creatures});
/** Newest-first merge: union of creatures; widest level range; flags and hostility unioned; newest name wins. */
function mergeCreaturePacks(packs,{pinned=false}={}){
 if(!Array.isArray(packs)||!packs.length||packs.length>MAX_BUILDS)fail();
 const valid=packs.map(p=>validateCreaturePack(p,{pinned:false}));
 if(valid.some(p=>p.sourceCommit!==valid[0].sourceCommit))fail();
 const sources=[],seenBuild=new Set();for(const p of valid)for(const s of p.sources)if(!seenBuild.has(s.build)){seenBuild.add(s.build);sources.push(structuredClone(s));}
 const byId=new Map();
 for(const p of valid)for(const c of p.creatures){const m=byId.get(c.id);
  if(!m){byId.set(c.id,structuredClone(c));continue;}
  const lo=[m.minLevel,c.minLevel].filter(l=>l!==null),hi=[m.maxLevel,c.maxLevel].filter(l=>l!==null);
  byId.set(c.id,row({id:m.id,name:m.name??c.name,minLevel:lo.length?Math.min(...lo):null,maxLevel:hi.length?Math.max(...hi):null,
   elite:m.elite||c.elite,rare:m.rare||c.rare,worldboss:m.worldboss||c.worldboss,skull:m.skull||c.skull,
   hostileTo:FACTIONS.filter(f=>m.hostileTo.includes(f)||c.hostileTo.includes(f)),sources:Math.max(m.sources,c.sources)}));}
 const creatures=[...byId.values()].sort((a,b)=>a.id-b.id);
 return validateCreaturePack(envelope(sources,valid[0].sourceCommit,creatures),{pinned});
}
let cached=null;
/** The bundled, validated pack (null-safe callers catch). */
function loadCreaturePack(file=path.join(__dirname,'../../data/forever-creatures/pack.json')){
 if(cached&&cached.file===file)return cached.pack;
 if(fs.statSync(file).size>PACK_LIMIT)fail();
 const pack=validateCreaturePack(JSON.parse(fs.readFileSync(file)));cached={file,pack};return pack;
}
/** id -> creature lookup over a validated pack. */
const indexes=new WeakMap();
function creatureIndex(pack){if(pack&&indexes.has(pack))return indexes.get(pack);const m=new Map();for(const c of pack?.creatures||[])m.set(c.id,c);if(pack&&typeof pack==='object')indexes.set(pack,m);return m;}
module.exports={normalizeCreatures,mergeCreaturePacks,validateCreaturePack,loadCreaturePack,creatureIndex,RAW_LIMIT,PACK_LIMIT,HOSTILE_MAX,HOSTILITY,hash};
