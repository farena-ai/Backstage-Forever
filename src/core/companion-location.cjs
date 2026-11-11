"use strict";
const {CITIES}=require('./travel-sources.cjs');
const aliases=new Map(CITIES.flatMap(([,name,list])=>list.map(alias=>[alias,name])));
function validReport(value){return value&&value.source==='user-report'&&[...aliases.values()].includes(value.zone)?{zone:value.zone,source:'user-report'}:null;}
function reportedLocationState(prompt){
 if(typeof prompt!=='string'||prompt.length>12000||/[`">]/.test(prompt))return {location:null,conflict:false};
 const reports=[];
 for(const sentence of prompt.replace(/[’‘]/g,"'").split(/[.!?]\s*/)){
  const match=sentence.trim().match(/^(?:no[,!]\s*)?i(?:'m|\s+am)\s+(?:(?:now|already|currently)\s+)?(?:in|at)\s+(.+?)\s*$/i);if(!match)continue;
  const value=match[1].toLowerCase().replace(/[,;]\s*not\b.*$/,'').replace(/\s+(?:now|already|currently)$/,'').replace(/[,;]$/,'').trim();
  const zone=aliases.get(value);if(zone)reports.push(zone);
 }
 const conflict=new Set(reports).size>1;
 return {location:reports.length&&!conflict?{zone:reports[0],source:'user-report'}:null,conflict};
}
const parseReportedCurrentLocation=prompt=>reportedLocationState(prompt).location;
function publicLocation(value){if(!value||typeof value!=='object')return undefined;const out={};for(const key of ['zone','subZone'])if(typeof value[key]==='string'&&value[key].length<=200&&!/[\x00-\x1f\x7f]/.test(value[key]))out[key]=value[key];for(const key of ['mapId','x','y'])if(Number.isFinite(value[key])&&value[key]>=0&&(key==='mapId'?Number.isSafeInteger(value[key]):value[key]<=1))out[key]=value[key];return Object.keys(out).length?out:undefined;}
function applyLocationContext(out,profile,reported){
 const report=validReport(reported)||validReport(profile.reportedLocation);
 if(report){const saved=publicLocation(profile.locationSource==='user-report'?profile.savedLocation:profile.location);if(saved)out.savedLocation=saved;out.location={zone:report.zone};out.locationSource='user-report';out.reportedLocation=report;}
 else if(out.location)out.locationSource='saved-snapshot';
 return out;
}
module.exports={parseReportedCurrentLocation,reportedLocationState,validReport,publicLocation,applyLocationContext};
