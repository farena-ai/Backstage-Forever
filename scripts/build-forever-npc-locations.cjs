"use strict";
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES,LICENSE}=require('../src/core/npc-location-sources.cjs');
const {normalizeNpcLocations,mergeNpcLocationPacks,validateNpcLocationPack,RAW_LIMIT,PACK_LIMIT,hash}=require('../src/core/npc-location-data.cjs');
const dir=path.join(__dirname,'../data/forever-npc-locations');
// Pinned merged coverage (NPC identities / bounded map points) for the bundled builds.
const COVERAGE={npcs:978,positions:1786};
const LOCK={schemaVersion:1,product:'wowf',build:BUILD,builds:BUILDS,commit:COMMIT,license:'CC BY 4.0',attribution:ATTRIBUTION,files:SOURCES.map(s=>structuredClone(s))};
/** sourceDir holds one subdirectory per pinned build: sourceDir/<build>/npcs.json. */
function compile(sourceDir){
 const packs=SOURCES.map(s=>{const file=path.join(sourceDir,s.build,'npcs.json');if(fs.statSync(file).size>RAW_LIMIT)throw Error('NPC source too large.');return normalizeNpcLocations(fs.readFileSync(file),s,COMMIT);});
 const pack=JSON.stringify(mergeNpcLocationPacks(packs,{pinned:true}))+'\n';
 return {pack,lock:JSON.stringify({...LOCK,compiled:{bytes:Buffer.byteLength(pack),sha256:hash(pack)}},null,2)+'\n'};
}
function checkBundle(){
 const lock=JSON.parse(fs.readFileSync(path.join(dir,'source-lock.json')));const {compiled,...source}=lock;if(!isDeepStrictEqual(source,JSON.parse(JSON.stringify(LOCK))))throw Error('NPC source lock mismatch.');
 const file=path.join(dir,'pack.json');if(fs.statSync(file).size>PACK_LIMIT)throw Error('NPC bundle too large.');const b=fs.readFileSync(file);if(!isDeepStrictEqual(compiled,{bytes:b.length,sha256:hash(b)}))throw Error('NPC compiled checksum mismatch.');
 const p=validateNpcLocationPack(JSON.parse(b));if(p.npcs.length!==COVERAGE.npcs||p.npcs.reduce((a,n)=>a+n.positions.length,0)!==COVERAGE.positions)throw Error('NPC pinned coverage mismatch.');
 const license=fs.readFileSync(path.join(dir,'LICENSE'));if(license.length!==LICENSE.bytes||hash(license)!==LICENSE.sha256)throw Error('NPC license mismatch.');const notice=fs.readFileSync(path.join(dir,'NOTICE'),'utf8');if(![COMMIT,ATTRIBUTION,'normalization','lastSeen','historical',...BUILDS].every(t=>notice.includes(t)))throw Error('NPC attribution missing.');return true;
}
if(require.main===module){const args=process.argv.slice(2);if(args.length===1&&args[0]==='--check'){checkBundle();console.log(`Offline NPC source, bundle, ${COVERAGE.npcs}/${COVERAGE.positions} coverage and license check passed.`);}else if(args.length===2&&args[0]==='--source-dir'){const r=compile(args[1]);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'pack.json'),r.pack);fs.writeFileSync(path.join(dir,'source-lock.json'),r.lock);}else throw Error('Use --check or --source-dir <directory>.');}
module.exports={compile,checkBundle,COVERAGE};
