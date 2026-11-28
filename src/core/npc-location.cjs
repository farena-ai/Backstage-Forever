"use strict";
const {validateNpcLocationPack}=require('./npc-location-data.cjs');
const {MAP_LABELS}=require('./npc-location-sources.cjs');
const {MAP_NAMES}=require('./map-names.cjs');
const normalize=s=>String(s).toLowerCase().replace(/[’‘']/g,'').replace(/\s+/g,' ').trim();
const PLACES={org:'Orgrimmar',orgrimmar:'Orgrimmar',tb:'Thunder Bluff','thunder bluff':'Thunder Bluff',thunderbluff:'Thunder Bluff',uc:'Undercity',undercity:'Undercity',sw:'Stormwind City',stormwind:'Stormwind City','stormwind city':'Stormwind City',ironforge:'Ironforge',darnassus:'Darnassus'};
const zoneLabels = new Map([...Object.values(MAP_NAMES), ...Object.values(MAP_LABELS)].map(name => [normalize(name), name]));
const knownPlace = value => {
 const key=normalize(value);
 return Object.hasOwn(PLACES,key)?PLACES[key]:zoneLabels.get(key);
};
const nonNpc=/\b(?:bank|auction house|mailbox|ore|copper|peacebloom|silverleaf|herb|herbs|hearthstone|material|materials|item|items|village|dungeon|profession|trainer supplies|cloth|leather|thread|reagent|potion|food)\b/i;
const geography=new Set(['orgrimmar','org','thunder bluff','tb','thunderbluff','stormwind','ironforge','undercity','crossroads','ratchet','booty bay','auberdine','gromgol','gromgol zeppelin tower']);
function parseNpcLocationIntent(prompt){
 if(typeof prompt!=='string'||prompt.length>12000)return null;
 // Only the final direct question is parsed; quoted/code requests never become actions.
 const q=prompt.trim().split(/(?<=[.!])\s+(?=where\b|find\b|location\b)/i).at(-1);
 if(/^[>"`]/.test(q))return null;
 const m=q.match(/^(?:where\s+in\s+(.{1,80}?)\s+(?:is|are)\s+|where\s+(?:is|are)\s+|where\s+can\s+i\s+find\s+|(?:location\s+of|find)\s+)(.{1,200}?)\s*[?!.]*$/i);
 const bare=q.match(/^npc\s*#?\s*([1-9]\d*)[?!.]*$/i);
 if(!m&&!bare)return null;
 let entity=(bare?'NPC #'+bare[1]:m[2]).replace(/[?!.]+$/,'').replace(/\s+in\s+(?:(?:wow|world of warcraft):?\s+)?forever$/i,'').trim();
 let place=m?.[1]?(knownPlace(m[1]) || m[1]):null;
 const nearby=!place&&entity.match(/^(.+?)\s+(?:near me|here|in (?:this|my current) zone)$/i);
 if(nearby)entity=nearby[1];
 const suffix=!place && entity.match(/^(.+?)\s+in\s+(.+)$/i);
 if(suffix && knownPlace(suffix[2])) { entity=suffix[1]; place=knownPlace(suffix[2]); }
 const explicit=/^npc\b/i.test(entity),query=entity.replace(/^npc\s*/i,'').trim();
 if(!explicit&&(nonNpc.test(query)||geography.has(normalize(query))))return null;
 const numeric=query.match(/^#?\s*([1-9]\d*)$/),id=numeric?Number(numeric[1]):null;
 return {query,explicit,id,place,nearby:Boolean(nearby),multiple:/\s+(?:and|&)\s+/i.test(query)};
}
function matches(query,name){const a=normalize(query),b=normalize(name);return a===b||(a.length>=3&&a.split(' ').every(t=>t.length>=3&&b.split(' ').includes(t)));}
function resolveNpcLocation(prompt,{profile,shareProfile=false,currentIndex,historicalPack,liveFrame}={}){
 const intent=parseNpcLocationIntent(prompt);if(!intent)return null;
 const liveMapId=shareProfile&&intent.nearby?liveFrame?.position?.mapId:null;
 const areaMapId=liveMapId||(shareProfile&&intent.nearby?profile?.location?.mapId:null);
 if(areaMapId)intent.place=MAP_LABELS[areaMapId]||MAP_NAMES[areaMapId]||`Map ${areaMapId}`;
 let historical=null;try{historical=validateNpcLocationPack(historicalPack);}catch{}
 const current=shareProfile&&currentIndex?.compatible(profile)?currentIndex:null;
 // The quest pack is exact only on its own build; on another build of the same patch it is a carried reference.
 const merged=Array.isArray(current?.pack.builds)&&current.pack.builds.length>1;
 const exact=!merged&&!(current&&profile?.clientBuild&&current.pack.build&&profile.clientBuild!==current.pack.build);
 const own=[],older=[];
 if(current)for(const n of Object.values(current.pack.npcs||{}))if(n.kind==='npc')own.push({id:n.id,name:n.name,lastSeen:n.lastSeen,contributingFiles:n.sources,positions:n.positions,build:merged?null:current.pack.build,sourceCommit:current.pack.sourceCommit,evidenceTier:merged?'merged-reference':exact?'exact-build-observation':'same-patch-reference'});
 if(historical)for(const n of historical.npcs)older.push({...n,build:n.build||historical.build,sourceCommit:historical.sourceCommit,evidenceTier:'historical-reference'});
 // An exact-build observation leads. Otherwise the per-NPC reference leads, because it names the build each NPC was seen on.
 const records=exact?[...own,...older]:[...older,...own];
 const matchedIds=new Set(records.filter(n=>intent.id?n.id===intent.id:matches(intent.query,n.name)).map(n=>n.id));
 // A name discovers IDs; all evidence for those IDs participates in identity.
 const candidates=records.filter(n=>matchedIds.has(n.id));
 const known=Boolean(candidates.length);
 if(!intent.explicit&&!intent.id&&!known&&!intent.place&&!/^[\p{Lu}][\p{L}\p{N}'’() +.-]{1,100}$/u.test(intent.query)&&!intent.multiple)return null;
 const dto={status:'unknown',headline:'',entities:[],candidates:[],omittedCandidates:0,cautions:[],sources:[]};
 const result=(text,usesLive=false)=>{dto.headline=text.split('\n')[0];dto.answer??=text;return {text,dto,usesLive};};
 if(!historical&&!candidates.length){dto.status='unavailable';return result('The local NPC reference is unavailable for this NPC. Keep the exact NPC name or ID and try again later. No AI location was guessed.');}
 if(intent.multiple){dto.status='ambiguous';return result('Which NPC should I look up first? Ask for one exact name or NPC ID.');}
 const inRequestedPlace=p=>areaMapId?p.mapId===areaMapId:[MAP_LABELS[p.mapId],MAP_NAMES[p.mapId]].some(label=>label&&normalize(label)===normalize(intent.place));
 const localCandidates=intent.place?candidates.filter(n=>n.positions?.some(inRequestedPlace)):[];
 const identityCandidates=localCandidates.length?localCandidates:candidates;
 const identities=[...new Map(identityCandidates.map(n=>[intent.id?n.id:`${n.id}:${normalize(n.name)}`,n])).values()].sort((a,b)=>a.id-b.id);
 if(identities.length>1){dto.status='ambiguous';dto.candidates=identities.slice(0,5).map(n=>({id:n.id,name:n.name}));dto.omittedCandidates=Math.max(0,identities.length-5);return result('Which NPC do you mean?\n'+dto.candidates.map(n=>`- ${n.name} — NPC #${n.id}`).join('\n')+(dto.omittedCandidates?`\n${dto.omittedCandidates} more matches; use an exact NPC ID.`:''));}
 if(!identities.length)return result(intent.explicit||intent.id?`I don't have a verified location for ${intent.query} in this local reference. Check the exact NPC name or ID.`:'Do you mean an NPC? Give its exact name or NPC ID so I can check the local reference.');
 const inPlace=intent.place&&candidates.find(n=>n.positions?.some(inRequestedPlace));
 const entity=inPlace||candidates.find(n=>n.positions?.length)||identities[0];
 if(!entity.positions?.length)return result(`I don't have a verified location for ${entity.name} in this local reference. No coordinates were guessed.`);
 const label=p=>{let town=null;try{town=require('./companion-intents.cjs').placeLabel(p);}catch{}return town||MAP_LABELS[p.mapId]||MAP_NAMES[p.mapId]||null;};
 const relevant=inPlace?[...entity.positions].sort((a,b)=>Number(inRequestedPlace(b))-Number(inRequestedPlace(a))):entity.positions;
 const positions=relevant.slice(0,3).map(p=>({...p,...(label(p)?{mapLabel:label(p)}:{})}));
 const out={id:entity.id,name:entity.name,evidenceTier:entity.evidenceTier,build:entity.build,sourceCommit:entity.sourceCommit,lastSeen:entity.lastSeen||null,contributingFiles:entity.contributingFiles,positions,additionalPositions:Math.max(0,relevant.length-3)};
 dto.status='found';dto.entities=[out];dto.cautions=['Approximate historical player interaction points, not guaranteed spawns or live NPC locations.'];
 const url=`https://github.com/JIVESCORP/eg-link-output-wowf/tree/${entity.sourceCommit}/data/wowf${entity.build?'/'+entity.build:''}`;dto.sources=[{publisher:'Efficient Games',url,build:entity.build,sourceCommit:entity.sourceCommit}];
 const lines=positions.map(p=>`${p.mapLabel||'Map '+p.mapId}, around ${(p.x*100).toFixed(1)}, ${(p.y*100).toFixed(1)}`);
 let text=`The reference I have for ${entity.name} is in ${lines[0]}.`;
 if(lines.length>1)text+='\nOther observed interaction points:\n'+lines.slice(1).map(x=>'- '+x).join('\n');
 if(out.additionalPositions)text+=`\n${out.additionalPositions} additional historical points are not shown.`;
 if(intent.place&&!inPlace)text+=` I don't have a verified ${intent.place} location for this NPC.`;
 if(intent.nearby&&areaMapId)text+=`\nArea checked: ${intent.place} · ${liveMapId?'live character location':'last saved character location'}.`;
 const provenance=entity.evidenceTier==='merged-reference'?'Merged Forever builds':entity.evidenceTier==='historical-reference'?`Older Forever build ${entity.build}`:entity.evidenceTier==='same-patch-reference'?`Forever reference from another build of this patch, ${entity.build}`:`Observed character-build reference ${entity.build}`;
 text+=`\n\n${provenance} · last observed ${entity.lastSeen||'date unknown'}. Approximate interaction point; not a live location.`;
 dto.answer=text;
 return result(text+`\nSource: Efficient Games · CC BY 4.0 · ${url}`,Boolean(liveMapId));
}
module.exports={parseNpcLocationIntent,resolveNpcLocation};
