"use strict";
// Pinned upstream creatures.json files (Efficient Games, CC BY 4.0) for the creature reference.
const COMMIT='423d6c9645cd102406782e7400805a7c738e2d69';
const ATTRIBUTION='Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.';
const meta=(clientBuild,first,last,sources,combatLogUploads)=>({attribution:ATTRIBUTION,clientBuild,collectedOn:{first,last},...(combatLogUploads?{combatLogUploads}:{}),dataset:'creatures',license:'CC BY 4.0',product:'wowf',schemaVersion:1,sources});
const source=(build,bytes,sha256,m)=>({name:'creatures.json',build,bytes,sha256,url:`https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${COMMIT}/data/wowf/${build}/creatures.json`,meta:m});
// Newest first. The first build is the pack's own (the current client build).
const SOURCES=Object.freeze([
 source('1.60.1.71037',766718,'9a89515458b02082a155ad5ca9aa144c4563e110aab4d1659b3eef9d9dc0c354',meta('1.60.1.71037','2026-11-21','2026-11-23',6,4)),
 source('1.60.1.70959',1324794,'b9d6e15d7d899d8a3a56c20c6aa99944c401535013e2ec14afc795c474499d36',meta('1.60.1.70959','2026-11-17','2026-11-23',10,9)),
 source('1.60.1.70938',1543619,'679d1f39aabbafe1fcde53742f864e414a8a27ded7ebe503d9c16803c35dcfeb',meta('1.60.1.70938','2026-11-13','2026-11-21',8,15)),
 source('1.60.1.70888',892316,'5eb4de9246d15f2109586786502672e875b1da2f005534ac4a8a9293754a9b97',meta('1.60.1.70888','2026-11-10','2026-11-21',4,10)),
 source('1.60.1.70862',1154158,'950d90482d3990b0d6444219de01ce79976a57ba93bf7a4d33ebbf72a87c4f58',meta('1.60.1.70862','2026-11-07','2026-11-21',5,11)),
 source('1.60.1.70840',195916,'88d70d4da4d28b4a2c8a1292e8bfd9b7a63a154f7ce03357c752eecd6b1091a6',meta('1.60.1.70840','2026-11-09','2026-11-21',3)),
 source('1.60.1.70790',1122140,'53a792c56a04d81ec1b0c649a3be8a2729f7f235fe208d25bc6d063ef4bf70a6',meta('1.60.1.70790','2026-11-05','2026-11-21',4,13)),
 source('1.60.1.70532',4939,'58566485e790709774a39af9e6a7185498d984e1ccebceb7f9005e9f55dbb9d2',meta('1.60.1.70532','2026-11-10','2026-11-10',1)),
 source('1.60.1.70450',162403,'7dd5eb4fcd991fa861d960c24ae1ce56f105c24e2b5e3a5c7f819e52d3ca3740',meta('1.60.1.70450','2026-11-10','2026-11-10',1)),
 source('1.60.1.70425',76305,'c2b0153fe90cf73168eaf0b0f9f40318ccd120a7168a4fd43d838ec7c11f92f8',meta('1.60.1.70425','2026-11-10','2026-11-10',1)),
 source('1.60.1.70374',62296,'52ead128fc2932a478d9f0a92c23b34279d11e89e68fc03184693a26bd9cdd08',meta('1.60.1.70374','2026-11-10','2026-11-10',1)),
 source('1.60.1.70338',100261,'4c7b359afba5a9be8a7d4391e49a996120cfb701abdd9b95050ac1dfc1985599',meta('1.60.1.70338','2026-11-10','2026-11-10',1)),
 source('1.60.1.70334',56899,'bc74d2fbd273cb0e1cdd3eb67aa08d669bcf545a30bb6845b7b7ef237303289e',meta('1.60.1.70334','2026-11-10','2026-11-10',1)),
 source('1.60.1.70291',17596,'c44abf279cbb07f1d299053df070b0ca045dc277a1cd6bfaa625cff119c2632a',meta('1.60.1.70291','2026-11-10','2026-11-10',1)),
 source('1.60.1.70205',53951,'d280db273f61d077767c94e769df7aed9011a8380522fedc4b297e57e2f077d1',meta('1.60.1.70205','2026-11-10','2026-11-10',1)),
].map(Object.freeze));
const BUILD=SOURCES[0].build,BUILDS=Object.freeze(SOURCES.map(s=>s.build));
const LICENSE={bytes:18659,sha256:'5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0'};
module.exports={COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES,LICENSE};
