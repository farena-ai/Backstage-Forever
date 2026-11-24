"use strict";
const COMMIT='423d6c9645cd102406782e7400805a7c738e2d69';
const ATTRIBUTION='Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0.';
const meta=(clientBuild,first,last,sources)=>({attribution:ATTRIBUTION,clientBuild,collectedOn:{first,last},dataset:'npcs',license:'CC BY 4.0',product:'wowf',schemaVersion:1,sources});
const source=(build,bytes,sha256,m)=>({name:'npcs.json',build,bytes,sha256,url:`https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/${COMMIT}/data/wowf/${build}/npcs.json`,meta:m});
// Newest first. The first build is the pack's own (the current client build).
const SOURCES=Object.freeze([
 source('1.60.1.71037',320980,'c24b5d7f67b59b8c1274b74aa0d83e20474b6628ce26a4c174b8429947b7a052',meta('1.60.1.71037','2026-11-22','2026-11-23',6)),
 source('1.60.1.70959',541944,'ca242c3507d2bd9f354834a8dfcb81d2e7dce2fefc519e741c738ce00ee8719a',meta('1.60.1.70959','2026-11-19','2026-11-23',10)),
 source('1.60.1.70938',591462,'25707c9ea017a905cda6b01206cd6d3bf496e6f77c823034c33d5907d951752c',meta('1.60.1.70938','2026-11-20','2026-11-21',8)),
 source('1.60.1.70888',363618,'e03cc30ff79ebf02f50bdc6baf3463b5b8c65569175a1e112102fcfc9ea74274',meta('1.60.1.70888','2026-11-20','2026-11-21',4)),
 source('1.60.1.70862',732509,'64ca5ce997d82cc0ce9aa1ea1f96ea2c363b28bb3ebf3af460e2d16693915cdc',meta('1.60.1.70862','2026-11-09','2026-11-21',5)),
 source('1.60.1.70840',123058,'d657fb35416b2da2d9d75cbb3ff870f517111ce092a405301afdfb5fee4ef94b',meta('1.60.1.70840','2026-11-09','2026-11-21',3)),
 source('1.60.1.70790',882823,'e732c47ad4bde79fa6ea1acba656d7498c39ac46e8cc4afc29f43239e4f128b4',meta('1.60.1.70790','2026-11-09','2026-11-21',4)),
 source('1.60.1.70532',5407,'de8700eede68781242ccf8017b19ebcfd912fff118a6a85107b6c3cdc3788cbe',meta('1.60.1.70532','2026-11-10','2026-11-10',1)),
 source('1.60.1.70450',140714,'b1fea842fd6c48594f66b46b77974bbc541a9c5446290e1598048be386539275',meta('1.60.1.70450','2026-11-10','2026-11-10',1)),
 source('1.60.1.70425',69761,'3e5ea50d971616c92a754b9253376869786235b3c71e819c27020cd8ce966b33',meta('1.60.1.70425','2026-11-10','2026-11-10',1)),
 source('1.60.1.70374',57387,'f5fab3af27b7cb32e827f50fe103b62f45170a00067087f5caf7fa6f13eaf31b',meta('1.60.1.70374','2026-11-10','2026-11-10',1)),
 source('1.60.1.70338',72156,'e320694c15be5eabbab5502ca3b1e1b8c390886ae39d4017bfcb7f4c25e1ff55',meta('1.60.1.70338','2026-11-10','2026-11-10',1)),
 source('1.60.1.70334',19101,'7688c54638895c08b12c762c90d5424a48d0b980eba82a30c7a71a724352af53',meta('1.60.1.70334','2026-11-10','2026-11-10',1)),
 source('1.60.1.70291',5521,'b4be64bcd034ac11ebbfb3081a4e932b0735f8b3f0f456c857cd82497fdd6a3f',meta('1.60.1.70291','2026-11-10','2026-11-10',1)),
 source('1.60.1.70205',14245,'757b3026f1248b6925ff0cbedd419934a45a5a7baa052a1b3dd8ca971cd30409',meta('1.60.1.70205','2026-11-10','2026-11-10',1)),
].map(Object.freeze));
const BUILD=SOURCES[0].build,BUILDS=Object.freeze(SOURCES.map(s=>s.build));
const LICENSE={bytes:18659,sha256:'5eebefd3682e32d661f307a28539b304e5e52fb1eb33ba214e61d7a57663e4f0'};
// Bounded labels agree with the existing sourced travel map associations.
const MAP_LABELS=Object.freeze({1453:'Stormwind City',1454:'Orgrimmar',1455:'Ironforge',1456:'Thunder Bluff',1457:'Darnassus',1458:'Undercity'});
module.exports={COMMIT,BUILD,BUILDS,ATTRIBUTION,SOURCES,LICENSE,MAP_LABELS};
