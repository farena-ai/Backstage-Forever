"use strict";
// 1.26 (roadmap E3, guild part): /bf guild craft NAME asks sharing guild members who can make
// something; their addons answer from the recipes they know. Rate-limited, bounded, strictly checked.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const GUILD = "dofile('addon/BackstageForever/BackstageForeverGuild.lua')\n";
const FILES = "dofile('addon/BackstageForever/BackstageForeverParty.lua')\ndofile('addon/BackstageForever/BackstageForeverLfg.lua')\n" + GUILD;
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end} end
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local sent={}
C_ChatInfo={RegisterAddonMessagePrefix=function() end,SendAddonMessage=function(p,t,ch) sent[#sent+1]={p,t,ch} end}
local clock=1000 GetTime=function() return clock end
local guilded=true IsInGuild=function() return guilded end
IsInGroup=function() return false end IsInRaid=function() return false end
UnitName=function(u) if u=='player' then return 'Me' end end
UnitLevel=function() return 42 end GetRealZoneText=function() return 'Tanaris' end
Ambiguate=function(n) return (n:gsub('%-.*$','')) end
local timers={} C_Timer={After=function(s,fn) timers[#timers+1]=fn end,NewTicker=function() end}
local function runTimers() local t=timers timers={} for _,fn in ipairs(t) do fn() end end
local callbacks={} EventRegistry={RegisterCallback=function(_,name,fn) callbacks[name]=fn end}
local opened={} ChatFrame_OpenChat=function(text) opened[#opened+1]=text end
local function from(who,text,channel) fire('CHAT_MSG_ADDON','BFParty',text,channel or 'GUILD',who) end
local RECIPES={readiness={workshop={professions={items={{name='Tailoring',rank=250}}},recipes={items={{id=1,name='Ghost Dye'},{id=2,name='Ghostweave Belt'},{id=3,name='Ghostweave Gloves'},{id=4,name='Runecloth Bag'},{id=5,name='Ghost Dye'},{id=6}}}}}}
`;

test("messages: a search text and a recipe name; bounded out, strict in", () => lua(GUILD + String.raw`
local Q,A,K,F,W,R=BackstageForeverCraftQuery,BackstageForeverCraftAsk,BackstageForeverCraftAsked,BackstageForeverCraftFind,BackstageForeverCraftAnswer,BackstageForeverCraftAnswered
assert(Q('  Ghost   Dye ')=='Ghost Dye' and Q('|cff1eff00|Hitem:9210|h[Ghost Dye]|h|r')=='Ghost Dye' and Q('Transmute: Iron to Gold')=='Transmute Iron to Gold')
assert(Q('ab')==nil and Q('')==nil and Q('|')==nil and Q(nil)==nil and Q(5)==nil and #Q(string.rep('g',90))==40 and Q(string.rep('g',500))==nil)
assert(A('Ghost Dye')=='X|Ghost Dye' and A('x')==nil and A('a|b,c:d')=='X|a b c d')
assert(K('X|Ghost Dye')=='Ghost Dye' and K('X|'..string.rep('g',40))==string.rep('g',40))
for _,bad in ipairs({'X|ab','X|','X|Ghost|Dye','X| Ghost Dye','X|Ghost  Dye','X|Ghost,Dye','X|Ghost:Dye','X|Gho\1st','X|'..string.rep('g',41),'XGhost Dye','x|Ghost Dye','',5,nil}) do assert(K(bad)==nil,tostring(bad)) end
local mine={{name='Ghost Dye'},{name='Ghostweave Belt'},{name='Ghostweave Gloves'},{name='Runecloth Bag'},{name='Ghost Dye'},{},'junk',{name=7}}
local found=F(mine,'ghost') assert(#found==2 and found[1]=='Ghost Dye' and found[2]=='Ghostweave Belt','two answers at most, each name once')
assert(#F(mine,'GHOST DYE')==1 and #F(mine,'bag')==1 and #F(mine,'mooncloth')==0 and #F(mine,'gh')==0 and #F(nil,'ghost')==0 and #F(mine,nil)==0)
assert(#F(mine,'ghost',5)==3 and #F({{name='100% Cotton (a.b)'}},'% cotton (a.')==1,'the search text is plain text, never a pattern')
assert(W('ghost','Ghost Dye')=='Y|ghost|Ghost Dye' and W('ghost','Runecloth Bag')==nil and W('gh','Ghost Dye')==nil and W('ghost',nil)==nil)
assert(#W('ghost',string.rep('Ghost ',40))<=2+5+1+48)
assert(R('Y|ghost|Ghost Dye','ghost')=='Ghost Dye' and R('Y|GHOST|Ghost Dye','ghost')=='Ghost Dye')
for _,bad in ipairs({'Y|ghost|Runecloth Bag','Y|other|Ghost Dye','Y|ghost|','Y|ghost','Y|ghost|Ghost Dye|x','Y|ghost| Ghost Dye','Y|ghost|Ghost,Dye','Y|ghost|Gh\1ost Dye',
  'Y|ghost|'..string.rep('Ghost',20),'Yghost|Ghost Dye','',5,nil}) do assert(R(bad,'ghost')==nil,tostring(bad)) end
assert(R('Y|ghost|Ghost Dye',nil)==nil)
-- The answers kept: twenty at most, each member and recipe once, names checked.
local results={}
local S=BackstageForeverCraftStore
assert(S(results,'Ann','Ghost Dye') and S(results,'Ann','Ghostweave Belt') and S(results,'Bob-Realm','Ghost Dye') and not S(results,'Ann','Ghost Dye') and not S(results,'B0b','Ghost Dye') and not S(results,nil,'x') and not S(nil,'Ann','x'))
for i=1,40 do S(results,'M'..string.char(97+math.floor(i/26))..string.char(97+i%26),'Ghost Dye') end
assert(#results==20)
local lines=BackstageForeverCraftLines('ghost',{{who='Ann',name='Ghost Dye'},{who='Bob',name='Ghostweave Belt'}},true)
assert(#lines==3 and lines[1]=='Guild members who can make "ghost": 2.' and lines[2]=='  Ann: Ghost Dye |cff71d5ff|Haddon:BackstageForever:gcraft:1|h[whisper]|h|r' and lines[3]:find('gcraft:2',1,true),lines[2])
lines=BackstageForeverCraftLines('ghost',{{who='Ann',name='Ghost Dye'}},false) assert(lines[2]=='  Ann: Ghost Dye','no link when the game does not report clicks')
assert(BackstageForeverCraftLines('ghost',{},true)[1]:find('No sharing guild member answered for "ghost"',1,true) and #BackstageForeverCraftLines('ghost',nil,true)==1)
`));

test("in game: asked and answered only while sharing is on, rate-limited both ways, a click fills the chat box", () => lua(STUBS + FILES + String.raw`
fire('PLAYER_LOGIN')
BackstageForeverGuildUpdate(RECIPES)
-- Sharing off: no question goes out and none is answered.
BackstageForeverGuildCommand('guild craft Ghost Dye') assert(#sent==0 and last():find('Guild sharing is off',1,true))
from('Ann','X|ghost') assert(#sent==0)
BackstageForeverGuildCommand('guild on') sent={}
-- A member asks: you answer with what you know, two recipes at most, on the guild channel.
from('Ann','X|ghost')
assert(#sent==2 and sent[1][3]=='GUILD' and sent[1][2]=='Y|ghost|Ghost Dye' and sent[2][2]=='Y|ghost|Ghostweave Belt',sent[1] and sent[1][2])
from('Bob','X|runecloth') assert(#sent==2,'at most one answer every five seconds')
clock=1006 from('Bob','X|runecloth') assert(#sent==3 and sent[3][2]=='Y|runecloth|Runecloth Bag')
clock=1020 from('Bob','X|mooncloth') from('Bob','X|gh') from('Bob','X|ghost|x') from('Bob','Xghost') assert(#sent==3,'nothing known or not a clean question: silence')
from('Me','X|ghost') from('Ann','X|ghost','PARTY') from('Ann','X|ghost','WHISPER') assert(#sent==3,'your own question and other channels are not answered')
-- You ask: one question, then the answers that fit it, from members only once each.
sent={} said={} clock=1100
BackstageForeverGuildCommand('guild craft |cff1eff00|Hitem:9210|h[Ghost Dye]|h|r')
assert(#sent==1 and sent[1][2]=='X|Ghost Dye' and sent[1][3]=='GUILD' and last():find('Asked sharing guild members who can make "Ghost Dye"',1,true),sent[1] and sent[1][2])
from('Ann','Y|Ghost Dye|Ghost Dye') from('Ann','Y|Ghost Dye|Ghost Dye') from('Bob-Realm','Y|ghost dye|Ghost Dye')
from('Cy','Y|other|Ghost Dye') from('Cy','Y|Ghost Dye|Runecloth Bag') from('Cy','Y|Ghost Dye|Ghost Dye|extra') from('D4ve','Y|Ghost Dye|Ghost Dye')
runTimers()
assert(said[#said-2]=='Backstage Forever: Guild members who can make "Ghost Dye": 2.',said[#said-2])
assert(said[#said-1]=='  Ann: Ghost Dye |cff71d5ff|Haddon:BackstageForever:gcraft:1|h[whisper]|h|r' and last()=='  Bob: Ghost Dye |cff71d5ff|Haddon:BackstageForever:gcraft:2|h[whisper]|h|r',last())
-- The click: "/w Name " in the chat box. Nothing is sent.
local n=#sent
callbacks.SetItemRef(nil,'addon:BackstageForever:gcraft:2') assert(#opened==1 and opened[1]=='/w Bob ' and #sent==n)
assert(BackstageForeverCraftLinkClick('addon:BackstageForever:gcraft:9')==false and BackstageForeverCraftLinkClick('addon:Other:gcraft:1')==false and BackstageForeverCraftLinkClick('item:1')==false and BackstageForeverCraftLinkClick(nil)==false and #opened==1)
-- Asking again within 30 seconds only prints what you have; no words prints the answers again.
BackstageForeverGuildCommand('guild craft Runecloth Bag') assert(#sent==n and last():find('You asked a moment ago',1,true))
said={} BackstageForeverGuildCommand('guild craft') assert(#said==3 and said[1]:find('can make "Ghost Dye": 2',1,true))
-- Answers stop counting after a minute; a bad name is refused before anything is sent.
clock=1170 from('Eve','Y|Ghost Dye|Ghost Dye') said={} BackstageForeverGuildCommand('guild craft') assert(said[1]:find(': 2.',1,true))
BackstageForeverGuildCommand('guild craft ab') assert(#sent==n and last():find('at least three letters',1,true))
-- Nobody answers: said plainly.
clock=1300 BackstageForeverGuildCommand('guild craft Mooncloth') runTimers()
assert(last():find('No sharing guild member answered for "Mooncloth"',1,true))
-- Not in a guild, or sharing switched off again: silent.
guilded=false clock=1400 n=#sent BackstageForeverGuildCommand('guild craft Ghost Dye') assert(#sent==n and last()=='Backstage Forever: You are not in a guild.')
guilded=true BackstageForeverGuildCommand('guild off') n=#sent clock=1500 from('Ann','X|ghost') from('Ann','Y|Mooncloth|Mooncloth') assert(#sent==n)
-- The older words still work as before.
BackstageForeverGuildCommand('guild') assert(last():find('Guild sharing is off',1,true))
`));

test("wiring: the craft question is part of guild sharing and is explained in the game and on the Commands page", () => {
  const guild = read("addon/BackstageForever/BackstageForeverGuild.lua");
  assert.match(guild, /BackstageForeverPartyHandle\('X',onCraftAsked,'GUILD'\)\s+BackstageForeverPartyHandle\('Y',onCraftAnswer,'GUILD'\)/);
  assert.doesNotMatch(guild, /SendChatMessage|:Click\(/, "the whisper is only put in the chat box");
  assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), /'\/bf guild craft NAME - /);
  const { CATALOG } = require("../src/renderer/commands.js");
  assert.ok(CATALOG.some((c) => c.command === "/bf guild craft NAME" && /whisper/.test(c.what)));
});
