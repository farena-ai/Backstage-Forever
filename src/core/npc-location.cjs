"use strict";
const {validateNpcLocationPack}=require('./npc-location-data.cjs');
const {MAP_LABELS}=require('./npc-location-sources.cjs');
const normalize=s=>String(s).toLowerCase().replace(/[’‘']/g,'').replace(/\s+/g,' ').trim();
const PLACES={org:'Orgrimmar',orgrimmar:'Orgrimmar',tb:'Thunder Bluff','thunder bluff':'Thunder Bluff',thunderbluff:'Thunder Bluff',uc:'Undercity',undercity:'Undercity',sw:'Stormwind City',stormwind:'Stormwind City','stormwind city':'Stormwind City',ironforge:'Ironforge',darnassus:'Darnassus'};
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
 const entity=(bare?'NPC #'+bare[1]:m[2]).replace(/[?!.]+$/,'').trim(),explicit=/^npc\b/i.test(entity),query=entity.replace(/^npc\s*/i,'').trim();
 if(!explicit&&(nonNpc.test(query)||geography.has(normalize(query))))return null;
 const numeric=query.match(/^#?\s*([1-9]\d*)$/),id=numeric?Number(numeric[1]):null;
 return {query,explicit,id,place:m?.[1]?PLACES[normalize(m[1])]||m[1]:null,multiple:/\s+(?:and|&)\s+/i.test(query)};
}
function matches(query,name){const a=normalize(query),b=normalize(name);return a===b||(a.length>=3&&a.split(' ').every(t=>t.length>=3&&b.split(' ').includes(t)));}
function resolveNpcLocation(prompt,{profile,shareProfile=false,currentIndex,historicalPack}={}){
 const intent=parseNpcLocationIntent(prompt);if(!intent)return null;
 let historical=null;try{historical=validateNpcLocationPack(historicalPack);}catch{}
 const current=shareProfile&&currentIndex?.compatible(profile)?currentIndex:null;
 const records=[];
 if(current)for(const n of Object.values(current.pack.npcs||{}))if(n.kind==='npc')records.push({id:n.id,name:n.name,lastSeen:n.lastSeen,contributingFiles:n.sources,positions:n.positions,build:current.pack.build,sourceCommit:current.pack.sourceCommit,evidenceTier:'exact-build-observation'});
 if(historical)for(const n of historical.npcs)records.push({...n,build:n.build||historical.build,sourceCommit:historical.sourceCommit,evidenceTier:'historical-reference'});
 const matchedIds=new Set(records.filter(n=>intent.id?n.id===intent.id:matches(intent.query,n.name)).map(n=>n.id));
 // A name discovers IDs; all evidence for those IDs participates in identity.
 const candidates=records.filter(n=>matchedIds.has(n.id));
 const known=Boolean(candidates.length);
 if(!intent.explicit&&!intent.id&&!known&&!intent.place&&!/^[\p{Lu}][\p{L}\p{N}'’() +.-]{1,100}$/u.test(intent.query)&&!intent.multiple)return null;
 const dto={status:'unknown',headline:'',entities:[],candidates:[],omittedCandidates:0,cautions:[],sources:[]};
 const result=text=>{dto.headline=text.split('\n')[0];dto.answer??=text;return {text,dto};};
 if(!historical&&!candidates.length){dto.status='unavailable';return result('The local NPC reference is unavailable for this NPC. Keep the exact NPC name or ID and try again later. No AI location was guessed.');}
 if(intent.multiple){dto.status='ambiguous';return result('Which NPC should I look up first? Ask for one exact name or NPC ID.');}
 const identities=[...new Map(candidates.map(n=>[intent.id?n.id:`${n.id}:${normalize(n.name)}`,n])).values()].sort((a,b)=>a.id-b.id);
 if(identities.length>1){dto.status='ambiguous';dto.candidates=identities.slice(0,5).map(n=>({id:n.id,name:n.name}));dto.omittedCandidates=Math.max(0,identities.length-5);return result('Which NPC do you mean?\n'+dto.candidates.map(n=>`- ${n.name} — NPC #${n.id}`).join('\n')+(dto.omittedCandidates?`\n${dto.omittedCandidates} more matches; use an exact NPC ID.`:''));}
 if(!identities.length)return result(intent.explicit||intent.id?`I don't have a verified location for ${intent.query} in this local reference. Check the exact NPC name or ID.`:'Do you mean an NPC? Give its exact name or NPC ID so I can check the local reference.');
 const entity=candidates.find(n=>n.positions?.length)||identities[0];
 if(!entity.positions?.length)return result(`I don't have a verified location for ${entity.name} in this local reference. No coordinates were guessed.`);
 const hasRequestedPlace=!intent.place||entity.positions.some(p=>normalize(MAP_LABELS[p.mapId]||'')===normalize(intent.place));
 const positions=entity.positions.slice(0,3).map(p=>({...p,...(MAP_LABELS[p.mapId]?{mapLabel:MAP_LABELS[p.mapId]}:{})}));
 const out={id:entity.id,name:entity.name,evidenceTier:entity.evidenceTier,build:entity.build,sourceCommit:entity.sourceCommit,lastSeen:entity.lastSeen||null,contributingFiles:entity.contributingFiles,positions,additionalPositions:Math.max(0,entity.positions.length-3)};
 dto.status='found';dto.entities=[out];dto.cautions=['Approximate historical player interaction points, not guaranteed spawns or live NPC locations.'];
 const url=`https://github.com/JIVESCORP/eg-link-output-wowf/tree/${entity.sourceCommit}/data/wowf/${entity.build}`;dto.sources=[{publisher:'Efficient Games',url,build:entity.build,sourceCommit:entity.sourceCommit}];
 const lines=positions.map(p=>`${p.mapLabel||'Map '+p.mapId}, around ${(p.x*100).toFixed(1)}, ${(p.y*100).toFixed(1)} (Map ${p.mapId})`);
 let text=`The reference I have for ${entity.name} is in ${lines[0]}.`;
 if(lines.length>1)text+='\nOther observed interaction points:\n'+lines.slice(1).map(x=>'- '+x).join('\n');
 if(out.additionalPositions)text+=`\n${out.additionalPositions} additional historical points are not shown.`;
 if(!hasRequestedPlace)text+=` I don't have a verified ${intent.place} location for this NPC.`;
 text+=`\n\n${entity.evidenceTier==='historical-reference'?'Older Forever build':'Observed character-build reference'} ${entity.build} · last observed ${entity.lastSeen||'date unknown'}. Approximate interaction point; not a live location.`;
 dto.answer=text;
 return result(text+`\nSource: Efficient Games · CC BY 4.0 · ${url}`);
}
module.exports={parseNpcLocationIntent,resolveNpcLocation};
