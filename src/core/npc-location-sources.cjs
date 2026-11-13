"use strict";
const COMMIT='164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1';
const ATTRIBUTION='Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.';
const meta=(clientBuild,first,last,sources)=>({attribution:ATTRIBUTION,clientBuild,collectedOn:{first,last},dataset:'npcs',license:'CC BY 4.0',product:'wowf',schemaVersion:1,sources});
const source=(build,bytes,sha256,m)=>({name:'npcs.json',build,bytes,sha256,url:`https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${COMMIT}/data/wowf/${build}/npcs.json`,meta:m});
// Newest first. The first build is the pack's own (the current client build).
const SOURCES=Object.freeze([
 source('1.60.1.70888',298166,'c2b1b2e0ab58c187835428223c23f87c5a43bb36af51d20f1c6fd1c28fa60722',meta('1.60.1.70888','2026-11-10','2026-11-12',4)),
 source('1.60.1.70862',732509,'fcde4f6d58a51f83a2d6b0dfa9fdb01b717378585b53200c4f6082878d59acbf',meta('1.60.1.70862','2026-11-09','2026-11-12',5)),
 source('1.60.1.70840',123058,'4ddc55031c196727591870ce56701f0fa34ec5173624174109d747ff31bd7c4d',meta('1.60.1.70840','2026-11-09','2026-11-12',3)),
 source('1.60.1.70790',882823,'e87240d379baa5de0eb030d76676f4d07ddf3b863d0833d33a43b4a3ec8b0775',meta('1.60.1.70790','2026-11-09','2026-11-12',4)),
].map(Object.freeze));
const BUILD=SOURCES[0].build,BUILDS=Object.freeze(SOURCES.map(s=>s.build));
const LICENSE={bytes:18659,sha256:'5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0'};
// Bounded labels agree with the existing sourced travel map associations.
const MAP_LABELS=Object.freeze({1453:'Stormwind City',1454:'Orgrimmar',1455:'Ironforge',1456:'Thunder Bluff',1457:'Darnassus',1458:'Undercity'});
module.exports={COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES,LICENSE,MAP_LABELS};
