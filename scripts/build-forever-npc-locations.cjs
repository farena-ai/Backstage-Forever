"use strict";
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {COMMIT,BUILD,ATTRIBUTION,SOURCE,LICENSE}=require('../src/core/npc-location-sources.cjs');
const {normalizeNpcLocations,validateNpcLocationPack,RAW_LIMIT,PACK_LIMIT,hash}=require('../src/core/npc-location-data.cjs');
const dir=path.join(__dirname,'../data/forever-npc-locations');
const LOCK={schemaVersion:1,product:'wowf',build:BUILD,commit:COMMIT,license:'CC BY 4.0',attribution:ATTRIBUTION,files:{'npcs.json':SOURCE}};
function compile(sourceDir){const file=path.join(sourceDir,'npcs.json');if(fs.statSync(file).size>RAW_LIMIT)throw Error('NPC source too large.');const pack=JSON.stringify(normalizeNpcLocations(fs.readFileSync(file)))+'\n';return {pack,lock:JSON.stringify({...LOCK,compiled:{bytes:Buffer.byteLength(pack),sha256:hash(pack)}},null,2)+'\n'};}
function checkBundle(){
 const lock=JSON.parse(fs.readFileSync(path.join(dir,'source-lock.json')));const {compiled,...source}=lock;if(!isDeepStrictEqual(source,LOCK))throw Error('NPC source lock mismatch.');
 const file=path.join(dir,'pack.json');if(fs.statSync(file).size>PACK_LIMIT)throw Error('NPC bundle too large.');const b=fs.readFileSync(file);if(!isDeepStrictEqual(compiled,{bytes:b.length,sha256:hash(b)}))throw Error('NPC compiled checksum mismatch.');
 const p=validateNpcLocationPack(JSON.parse(b));if(p.npcs.length!==616||p.npcs.reduce((a,n)=>a+n.positions.length,0)!==758)throw Error('NPC pinned coverage mismatch.');
 const license=fs.readFileSync(path.join(dir,'LICENSE'));if(license.length!==LICENSE.bytes||hash(license)!==LICENSE.sha256)throw Error('NPC license mismatch.');const notice=fs.readFileSync(path.join(dir,'NOTICE'),'utf8');if(![COMMIT,ATTRIBUTION,'normalization','lastSeen','historical'].every(t=>notice.includes(t)))throw Error('NPC attribution missing.');return true;
}
if(require.main===module){const args=process.argv.slice(2);if(args.length===1&&args[0]==='--check'){checkBundle();console.log('Offline NPC source, bundle, 616/758 coverage and license check passed.');}else if(args.length===2&&args[0]==='--source-dir'){const r=compile(args[1]);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'pack.json'),r.pack);fs.writeFileSync(path.join(dir,'source-lock.json'),r.lock);}else throw Error('Use --check or --source-dir <directory>.');}
module.exports={compile,checkBundle};
