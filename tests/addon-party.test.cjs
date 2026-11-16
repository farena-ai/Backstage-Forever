"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: path.join(__dirname, ".."), input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

test("party messages: compact, chunked under 255 bytes, reassembled in any order, junk ignored", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverParty.lua')
local q={{id=101,obj={{3,8},{0,1}}},{id=202,complete=true},{id=303}}
local m=BackstageForeverPartyEncode(q,7)
assert(#m==1 and m[1]=='Q|7|1/1|101:3/8,0/1;202!;303',m[1])
local s={}
local got=BackstageForeverPartyReceive(s,'Ann',m[1])
assert(#got==3 and got[1].obj[1][1]==3 and got[1].obj[1][2]==8 and got[2].complete and #got[3].obj==0)
local many={} for i=1,40 do many[i]={id=100000+i,obj={{i,20},{1,1},{0,5}}} end
local parts=BackstageForeverPartyEncode(many,8)
assert(#parts>1 and #parts<=4)
for _,p in ipairs(parts) do assert(#p<=255,#p) end
assert(BackstageForeverPartyReceive(s,'Bob',parts[#parts])==nil)
for i=1,#parts-2 do assert(BackstageForeverPartyReceive(s,'Bob',parts[i])==nil) end
local all=BackstageForeverPartyReceive(s,'Bob',parts[#parts-1])
local total=0 for _,p in ipairs(parts) do local b=p:match('^Q|%d+|%d+/%d+|(.*)$') for _ in b:gmatch('[^;]+') do total=total+1 end end
assert(all and #all==total and all[1].id==100001)
assert(BackstageForeverPartyReceive(s,'Cy','Q|1|5/9|1')==nil and BackstageForeverPartyReceive(s,'Cy','hello')==nil and BackstageForeverPartyReceive(s,'Cy','Q|1|2/1|1')==nil)
local d=BackstageForeverPartyDecodeBody('12:1/2;x;;34!;56:9/9,bad')
assert(#d==3 and d[3].obj[1][1]==9)
local c=BackstageForeverPartyCompare({{id=1,obj={{2,5}}},{id=2}},{{id=1,obj={{4,5}}},{id=3}})
assert(#c.shared==1 and c.shared[1].them.obj[1][1]==4 and c.theyOnly[1]==3)
assert(BackstageForeverPartyProgress({complete=true})=='done' and BackstageForeverPartyProgress({obj={{3,8},{0,1}}})=='3/8, 0/1' and BackstageForeverPartyProgress({obj={}})=='in progress')
`));

test("sends to PARTY only, never in a raid; /bf party shows who needs what; waypoints are shared and followed; off means silent", () => lua(String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local handler
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handler=fn end end} end
local sent={} local prefixes={}
C_ChatInfo={RegisterAddonMessagePrefix=function(p) prefixes[#prefixes+1]=p end,SendAddonMessage=function(p,t,ch) sent[#sent+1]={p,t,ch} end}
local group,raid=false,false IsInGroup=function() return group end IsInRaid=function() return raid end
UnitName=function(u) if u=='player' then return 'Me' elseif u=='party1' then return 'Ann' end end
Ambiguate=function(n) return (n:gsub('%-.*','')) end
local t=100 GetTime=function() return t end
C_QuestLog={GetNumQuestLogEntries=function() return 2 end,
  GetInfo=function(i) return {questID=i==1 and 101 or 202,isHeader=false} end,
  IsComplete=function(id) return false end,
  GetQuestObjectives=function(id) return {{numFulfilled=id==101 and 2 or 1,numRequired=id==101 and 8 or 1}} end,
  GetTitleForQuestID=function(id) return ({[101]='Raptor Thieves',[202]='Bad Medicine',[303]='Lost in Battle'})[id] end}
C_Map={GetUserWaypoint=function() return nil end,GetBestMapForUnit=function() return 1413 end,GetPlayerMapPosition=function() return {GetXY=function() return .515,.309 end} end}
local way BackstageForeverWay=function(m) way=m end
dofile('addon/BackstageForever/BackstageForeverParty.lua')
handler(nil,'PLAYER_LOGIN')
assert(prefixes[1]=='BFParty')
handler(nil,'QUEST_LOG_UPDATE') assert(#sent==0,'not in a group: nothing sent')
group=true raid=true handler(nil,'GROUP_ROSTER_UPDATE') assert(#sent==0,'raids are left alone')
raid=false handler(nil,'GROUP_ROSTER_UPDATE')
assert(sent[1][2]=='R' and sent[2][2]:match('^Q|%d+|1/1|101:2/8;202:1/1$'),tostring(sent[2] and sent[2][2]))
for _,m in ipairs(sent) do assert(m[1]=='BFParty' and m[3]=='PARTY') end
local before=#sent t=103 handler(nil,'QUEST_LOG_UPDATE') assert(#sent==before,'at most one update every 10s')
handler(nil,'CHAT_MSG_ADDON','BFParty','Q|4|1/1|101:5/8;303:0/3','PARTY','Ann-Realm')
handler(nil,'CHAT_MSG_ADDON','BFParty','Q|4|1/1|999','WHISPER','Eve')
handler(nil,'CHAT_MSG_ADDON','Other','Q|4|1/1|999','PARTY','Ann')
said={} BackstageForeverPartyCommand('party')
assert(said[1]=='Backstage Forever: Ann: 2 quests, 1 shared with you.',said[1])
assert(said[2]=='Backstage Forever:   Raptor Thieves: them 5/8, you 2/8',said[2])
assert(said[3]:find('Only they have: Lost in Battle',1,true),said[3])
assert(#said==3,'whispers and other prefixes are ignored')
said={} BackstageForeverPartyCommand('party way')
assert(sent[#sent][2]=='W|51.5|30.9|1413|where I am',sent[#sent][2])
handler(nil,'CHAT_MSG_ADDON','BFParty','W|40.0|60.5|1411|Kolkar camp','PARTY','Ann')
assert(said[#said]:find('Ann shares a waypoint: Kolkar camp at 40.0, 60.5',1,true),said[#said])
BackstageForeverPartyCommand('party go') assert(way=='way 1411 40.0 60.5 Ann: Kolkar camp',way)
BackstageForeverPartyCommand('party off')
local n=#sent t=200 handler(nil,'QUEST_LOG_UPDATE') handler(nil,'CHAT_MSG_ADDON','BFParty','R','PARTY','Ann')
assert(#sent==n,'off sends nothing, even when asked')
group=false handler(nil,'GROUP_ROSTER_UPDATE') assert(next(BackstageForeverPartyState.members)==nil,'leaving the group forgets everyone')
`));

test("party sync stays within its rules", () => {
  const src = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForeverParty.lua"), "utf8");
  for (const banned of ["'RAID'", "'GUILD'", "'WHISPER'", "SendChatMessage", "hooksecurefunc", "QuestLogPushQuest", "AcceptQuest"]) assert.ok(!src.includes(banned), banned);
  const toc = fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForever.toc"), "utf8");
  assert.match(toc, /BackstageForeverPartySettings/); assert.match(toc, /BackstageForeverParty\.lua/);
});
