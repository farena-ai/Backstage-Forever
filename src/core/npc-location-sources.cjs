"use strict";
const COMMIT='1bf749ba19be7e699822d6587db0cb85b1b0bc3b';
const ATTRIBUTION='Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.';
const meta=(clientBuild,first,last,sources)=>({attribution:ATTRIBUTION,clientBuild,collectedOn:{first,last},dataset:'npcs',license:'CC BY 4.0',product:'wowf',schemaVersion:1,sources});
const source=(build,bytes,sha256,m)=>({name:'npcs.json',build,bytes,sha256,url:`https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${COMMIT}/data/wowf/${build}/npcs.json`,meta:m});
// Newest first. The first build is the pack's own (the current client build).
const SOURCES=Object.freeze([
 source('1.60.1.71037',74094,'67580353b535732055002b03d9f0943cfeceee08fcbdc76bfa30cff6a118bf98',meta('1.60.1.71037','2026-11-21','2026-11-21',5)),
 source('1.60.1.70959',473826,'09d8aebb9b58778f3a2b204b0be501210b0b12c7c54effc0567b5a034f5f57fa',meta('1.60.1.70959','2026-11-19','2026-11-21',10)),
 source('1.60.1.70938',591462,'25707c9ea017a905cda6b01206cd6d3bf496e6f77c823034c33d5907d951752c',meta('1.60.1.70938','2026-11-20','2026-11-21',8)),
 source('1.60.1.70888',363618,'e03cc30ff79ebf02f50bdc6baf3463b5b8c65569175a1e112102fcfc9ea74274',meta('1.60.1.70888','2026-11-20','2026-11-21',4)),
 source('1.60.1.70862',732509,'64ca5ce997d82cc0ce9aa1ea1f96ea2c363b28bb3ebf3af460e2d16693915cdc',meta('1.60.1.70862','2026-11-09','2026-11-21',5)),
 source('1.60.1.70840',123058,'d657fb35416b2da2d9d75cbb3ff870f517111ce092a405301afdfb5fee4ef94b',meta('1.60.1.70840','2026-11-09','2026-11-21',3)),
 source('1.60.1.70790',882823,'e732c47ad4bde79fa6ea1acba656d7498c39ac46e8cc4afc29f43239e4f128b4',meta('1.60.1.70790','2026-11-09','2026-11-21',4)),
].map(Object.freeze));
const BUILD=SOURCES[0].build,BUILDS=Object.freeze(SOURCES.map(s=>s.build));
const LICENSE={bytes:18659,sha256:'5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0'};
// Bounded labels agree with the existing sourced travel map associations.
const MAP_LABELS=Object.freeze({1453:'Stormwind City',1454:'Orgrimmar',1455:'Ironforge',1456:'Thunder Bluff',1457:'Darnassus',1458:'Undercity'});
module.exports={COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES,LICENSE,MAP_LABELS};
