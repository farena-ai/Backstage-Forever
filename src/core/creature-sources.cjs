"use strict";
// Pinned upstream creatures.json files (Efficient Games, CC BY 4.0) for the creature reference.
const COMMIT='1bf749ba19be7e699822d6587db0cb85b1b0bc3b';
const ATTRIBUTION='Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.';
const meta=(clientBuild,first,last,sources,combatLogUploads)=>({attribution:ATTRIBUTION,clientBuild,collectedOn:{first,last},...(combatLogUploads?{combatLogUploads}:{}),dataset:'creatures',license:'CC BY 4.0',product:'wowf',schemaVersion:1,sources});
const source=(build,bytes,sha256,m)=>({name:'creatures.json',build,bytes,sha256,url:`https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${COMMIT}/data/wowf/${build}/creatures.json`,meta:m});
// Newest first. The first build is the pack's own (the current client build).
const SOURCES=Object.freeze([
 source('1.60.1.71037',144097,'7d4a71efb1a67a8bebe8b48c94ea6dddc709e2b95054bf55a734d7e54f5d0551',meta('1.60.1.71037','2026-11-21','2026-11-21',5)),
 source('1.60.1.70959',1186595,'a71714b4c3ab0382d4dda4cbf8b54c9bd24a27370a1b2bd218c84edc36df748c',meta('1.60.1.70959','2026-11-17','2026-11-21',10,9)),
 source('1.60.1.70938',1543619,'679d1f39aabbafe1fcde53742f864e414a8a27ded7ebe503d9c16803c35dcfeb',meta('1.60.1.70938','2026-11-13','2026-11-21',8,15)),
 source('1.60.1.70888',892316,'5eb4de9246d15f2109586786502672e875b1da2f005534ac4a8a9293754a9b97',meta('1.60.1.70888','2026-11-10','2026-11-21',4,10)),
 source('1.60.1.70862',1154158,'950d90482d3990b0d6444219de01ce79976a57ba93bf7a4d33ebbf72a87c4f58',meta('1.60.1.70862','2026-11-07','2026-11-21',5,11)),
 source('1.60.1.70840',195916,'88d70d4da4d28b4a2c8a1292e8bfd9b7a63a154f7ce03357c752eecd6b1091a6',meta('1.60.1.70840','2026-11-09','2026-11-21',3)),
 source('1.60.1.70790',1122140,'53a792c56a04d81ec1b0c649a3be8a2729f7f235fe208d25bc6d063ef4bf70a6',meta('1.60.1.70790','2026-11-05','2026-11-21',4,13)),
].map(Object.freeze));
const BUILD=SOURCES[0].build,BUILDS=Object.freeze(SOURCES.map(s=>s.build));
const LICENSE={bytes:18659,sha256:'5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0'};
module.exports={COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES,LICENSE};
