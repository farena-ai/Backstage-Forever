"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
let compiler;try{compiler=require('../scripts/build-forever-npc-locations.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
test('offline NPC bundle check and reproducible compiler exist',()=>assert.equal(typeof compiler?.checkBundle,'function'));
test('offline check validates pinned bundle, source lock and license; available raw-source recompilation is byte-identical',()=>{assert.ok(compiler);assert.equal(compiler.checkBundle(),true);if(fs.existsSync('work/npc-source/npcs.json')){const result=compiler.compile('work/npc-source');assert.equal(result.pack,fs.readFileSync('data/forever-npc-locations/pack.json','utf8'));assert.equal(result.lock,fs.readFileSync('data/forever-npc-locations/source-lock.json','utf8'));}});
