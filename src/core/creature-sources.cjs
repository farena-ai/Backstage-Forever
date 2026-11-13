"use strict";
// Pinned upstream creatures.json files (Efficient Games, CC BY 4.0) for the creature reference.
const COMMIT='164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1';
const ATTRIBUTION='Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.';
const meta=(clientBuild,first,last,sources,combatLogUploads)=>({attribution:ATTRIBUTION,clientBuild,collectedOn:{first,last},...(combatLogUploads?{combatLogUploads}:{}),dataset:'creatures',license:'CC BY 4.0',product:'wowf',schemaVersion:1,sources});
const source=(build,bytes,sha256,m)=>({name:'creatures.json',build,bytes,sha256,url:`https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${COMMIT}/data/wowf/${build}/creatures.json`,meta:m});
// Newest first. The first build is the pack's own (the current client build).
const SOURCES=Object.freeze([
 source('1.60.1.70888',565733,'1bf31b9f4462987773d6f76d269b179153b022442753ec8ead11092e84c2f13a',meta('1.60.1.70888','2026-11-10','2026-11-12',4,6)),
 source('1.60.1.70862',1154158,'e4519dad93fb2394335502f93ae8e33f0282c2e6fae6d1a6fc5fb63b462dbfe7',meta('1.60.1.70862','2026-11-07','2026-11-12',5,11)),
 source('1.60.1.70840',195916,'bfda9311a3698d144cae5feb97b3021a20dfe203f19293039f9a09b63a613b1c',meta('1.60.1.70840','2026-11-09','2026-11-12',3)),
 source('1.60.1.70790',1122140,'f4c92a425c4e6c5a2aa559471c29c8b43f7920509740b0fbcd9ea0e00dd46fb7',meta('1.60.1.70790','2026-11-05','2026-11-12',4,13)),
].map(Object.freeze));
const BUILD=SOURCES[0].build,BUILDS=Object.freeze(SOURCES.map(s=>s.build));
const LICENSE={bytes:18659,sha256:'5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0'};
module.exports={COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES,LICENSE};
