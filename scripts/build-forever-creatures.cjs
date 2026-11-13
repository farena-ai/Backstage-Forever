"use strict";
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES,LICENSE}=require('../src/core/creature-sources.cjs');
const {normalizeCreatures,mergeCreaturePacks,validateCreaturePack,RAW_LIMIT,PACK_LIMIT,hash}=require('../src/core/creature-data.cjs');
const dir=path.join(__dirname,'../data/forever-creatures');
// Pinned merged coverage for the bundled builds.
const COVERAGE={creatures:3272,elite:222,hostile:1223};
const LOCK={schemaVersion:1,product:'wowf',build:BUILD,builds:BUILDS,commit:COMMIT,license:'CC BY 4.0',attribution:ATTRIBUTION,files:SOURCES.map(s=>structuredClone(s))};
const coverage=p=>({creatures:p.creatures.length,elite:p.creatures.filter(c=>c.elite).length,hostile:p.creatures.filter(c=>c.hostileTo.length).length});
/** sourceDir holds one subdirectory per pinned build: sourceDir/<build>/creatures.json. */
function compile(sourceDir){
 const packs=SOURCES.map(s=>{const file=path.join(sourceDir,s.build,'creatures.json');if(fs.statSync(file).size>RAW_LIMIT)throw Error('Creature source too large.');return normalizeCreatures(fs.readFileSync(file),s,COMMIT);});
 const pack=JSON.stringify(mergeCreaturePacks(packs,{pinned:true}))+'\n';
 return {pack,lock:JSON.stringify({...LOCK,compiled:{bytes:Buffer.byteLength(pack),sha256:hash(pack)}},null,2)+'\n'};
}
function checkBundle(){
 const lock=JSON.parse(fs.readFileSync(path.join(dir,'source-lock.json')));const {compiled,...source}=lock;if(!isDeepStrictEqual(source,JSON.parse(JSON.stringify(LOCK))))throw Error('Creature source lock mismatch.');
 const file=path.join(dir,'pack.json');if(fs.statSync(file).size>PACK_LIMIT)throw Error('Creature bundle too large.');const b=fs.readFileSync(file);if(!isDeepStrictEqual(compiled,{bytes:b.length,sha256:hash(b)}))throw Error('Creature compiled checksum mismatch.');
 const p=validateCreaturePack(JSON.parse(b));if(!isDeepStrictEqual(coverage(p),COVERAGE))throw Error('Creature pinned coverage mismatch.');
 const license=fs.readFileSync(path.join(dir,'LICENSE'));if(license.length!==LICENSE.bytes||hash(license)!==LICENSE.sha256)throw Error('Creature license mismatch.');const notice=fs.readFileSync(path.join(dir,'NOTICE'),'utf8');if(![COMMIT,ATTRIBUTION,'normalization','hostileTo','approximate',...BUILDS].every(t=>notice.includes(t)))throw Error('Creature attribution missing.');return true;
}
if(require.main===module){const args=process.argv.slice(2);if(args.length===1&&args[0]==='--check'){checkBundle();console.log(`Offline creature source, bundle, ${COVERAGE.creatures}/${COVERAGE.elite}/${COVERAGE.hostile} coverage and license check passed.`);}else if(args.length===2&&args[0]==='--source-dir'){const r=compile(args[1]);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'pack.json'),r.pack);fs.writeFileSync(path.join(dir,'source-lock.json'),r.lock);console.log(JSON.stringify(coverage(JSON.parse(r.pack))),Buffer.byteLength(r.pack));}else throw Error('Use --check or --source-dir <directory>.');}
module.exports={compile,checkBundle,COVERAGE,coverage};
