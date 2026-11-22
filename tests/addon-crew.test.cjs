"use strict";
// 1.25: the party readiness check (G8), the mentor link (S3) and the soft-reserve list (G12).
// All three ride on party sync. Every incoming message is treated as untrusted.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const CREW = "dofile('addon/BackstageForever/BackstageForeverCrew.lua')\n";
const FILES = "dofile('addon/BackstageForever/BackstageForeverParty.lua')\ndofile('addon/BackstageForever/BackstageForeverLfg.lua')\n" + CREW;
// A party of three: Me (leader unless told otherwise), Ann and Bob. Messages sent land in `sent`.
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end} end
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local sent={}
C_ChatInfo={RegisterAddonMessagePrefix=function() end,SendAddonMessage=function(p,t,ch) sent[#sent+1]={p,t,ch} end}
local clock=1000 GetTime=function() return clock end
local combat=false InCombatLockdown=function() return combat end
local grouped,raid,leader=true,false,'player'
IsInGroup=function() return grouped end IsInRaid=function() return raid end
local party={'Ann','Bob'}
UnitName=function(u) if u=='player' then return 'Me' end local i=tonumber(u:match('^party(%d)$')) return i and party[i] or nil end
UnitIsGroupLeader=function(u) return u==leader end
Ambiguate=function(n) return (n:gsub('%-.*$','')) end
local timers={} C_Timer={After=function(s,fn) timers[#timers+1]=fn end}
local function runTimers() local t=timers timers={} for _,fn in ipairs(t) do fn() end end
local function from(who,text,channel) fire('CHAT_MSG_ADDON','BFParty',text,channel or 'PARTY',who) end
local function last() return said[#said] end
local function texts() local t={} for i,m in ipairs(sent) do t[i]=m[2] end return t end
`;

test("shared helpers: text from players is made plain, names are checked, the rate limit holds", () => lua(CREW + String.raw`
local S=BackstageForeverChatSafe
assert(S('  hello   there ')=='hello there' and S('|cffff0000red|r alert')=='red alert')
assert(S('look |cff0070dd|Hitem:1234::::|h[Krol Blade]|h|r here')=='look [Krol Blade] here','a link becomes its bare name')
assert(S('a|b|c')=='abc' and S('line\none\ttwo')=='line one two' and S('')==nil and S('   ')==nil and S('|')==nil and S(5)==nil and S(nil)==nil)
assert(#S(string.rep('x',300))==120 and #S(string.rep('x',300),40)==40)
local cut=S(string.rep('\195\164',100),11) assert(cut==string.rep('\195\164',5),'never cut inside a letter')
assert(not S('|TInterface\\Icons\\x:0|t boo'):find('|',1,true))
local N=BackstageForeverCrewName
assert(N('Ann')=='Ann' and N('Ann-Realm')=='Ann-Realm' and N('\195\132nne')=='\195\132nne')
for _,bad in ipairs({'A','Ann1','An n','Ann|','Ann=x','Ann;x','Ann.','-Ann',string.rep('a',49),5}) do assert(N(bad)==nil,tostring(bad)) end
local r={}
local R=BackstageForeverCrewRate
assert(R(r,'a',100,10) and not R(r,'a',105,10) and not R(r,'a',109.9,10) and R(r,'a',110,10) and R(r,'b',110,10))
assert(R(r,'a',50,10),'a clock that went backwards does not lock it') assert(not R(nil,'a',1,1) and not R(r,'a','x',1))
`));

test("readiness messages: six bounded fields, and anything else is refused", () => lua(CREW + String.raw`
assert(BackstageForeverCheckRequest('sm')=='C|sm' and BackstageForeverCheckRequest(nil)=='C|-' and BackstageForeverCheckRequest('Not A Dungeon')=='C|-')
assert(BackstageForeverCheckAsked('C|sm')=='sm' and BackstageForeverCheckAsked('C|-')=='-' and BackstageForeverCheckAsked('C|aq40')=='aq40')
for _,bad in ipairs({'C','C|','C|SM','C|sm|x','C|toolongname','C|s m','C|1sm','A|sm',5}) do assert(BackstageForeverCheckAsked(bad)==nil,tostring(bad)) end
local E,D=BackstageForeverCheckEncode,BackstageForeverCheckDecode
assert(E({dungeon='sm',quests=2,key=true,durability=43,free=12,low=1})=='A|sm|2|1|43|12|1')
assert(E({})=='A|-|-|-|-|-|-' and E(nil)=='A|-|-|-|-|-|-')
assert(E({dungeon='brd',quests=0,key=false,durability=100,free=0,low=0})=='A|brd|0|0|100|0|0')
assert(E({dungeon='x y',quests=99,key='yes',durability=101,free=-1,low=1/0})=='A|-|-|-|-|-|-','out of range is sent as not known')
assert(E({durability=43.9,free=12.2})=='A|-|-|-|43|12|-')
local s=D('A|sm|2|1|43|12|1')
assert(s.dungeon=='sm' and s.quests==2 and s.key==true and s.durability==43 and s.free==12 and s.low==1)
s=D('A|-|-|-|-|-|-') assert(s and s.dungeon==nil and s.quests==nil and s.key==nil and s.durability==nil and s.free==nil and s.low==nil)
s=D('A|brd|0|0|100|999|20') assert(s.key==false and s.free==999 and s.low==20)
for _,bad in ipairs({'A|sm|2|1|43|12','A|sm|2|1|43|12|1|9','A|sm|2|2|43|12|1','A|sm|41|1|43|12|1','A|sm|2|1|101|12|1','A|sm|2|1|43|1000|1','A|sm|2|1|43|12|21',
  'A|SM|2|1|43|12|1','A|sm|-2|1|43|12|1','A|sm|2.5|1|43|12|1','A|sm|0x2|1|43|12|1','A|sm|2|1|43|12|1e1','A|sm| 2|1|43|12|1','A|sm|2|1|43|12|1 ','A|sm|2|1|43|12|',
  'A|sm|2|1|43|12|1'..string.rep('1',30),'B|sm|2|1|43|12|1','',5,nil}) do assert(D(bad)==nil,tostring(bad)) end
-- Quests: ids from the Instance Atlas, counted once.
local data={{'sm','Scarlet Monastery','d',26,45,'B',1420,.8,.3,{},{{1049,'Compendium of the Fallen'},{1053,'In the Name of the Light'},{1113,'Hearts of Zeal'}}},{'brd','Blackrock Depths','d',52,60,'B',1,0,0,{},{}}}
local Q=BackstageForeverCheckQuests
assert(Q(data,'sm',{{id=1053},{id=5},{id=1049},{id=1053}})==2 and Q(data,'sm',{})==0 and Q(data,'brd',{{id=1053}})==0)
assert(Q(data,'nope',{{id=1053}})==nil and Q(data,'sm',nil)==nil and Q(nil,'sm',{})==nil)
-- The lines.
local L=BackstageForeverCheckLine
assert(L('Ann',D('A|sm|2|1|43|12|1'),'Scarlet Monastery')=='Ann: 2 quests for Scarlet Monastery, has the key, most worn gear at 43%, 12 bag slots free, 1 kit item low.')
assert(L('Bob',D('A|sm|0|0|100|0|0'),'Scarlet Monastery')=='Bob: no quest for Scarlet Monastery, no key, most worn gear at 100%, 0 bag slots free, class kit fine.')
assert(L('Cy',nil,'Scarlet Monastery')=='Cy: no answer (no addon, or answers are off).')
assert(L('Dee',D('A|-|-|-|-|-|-'))=='Dee: answered, but nothing was readable.')
assert(L('Eve',D('A|-|-|-|80|5|-'))=='Eve: most worn gear at 80%, 5 bag slots free.')
local lines=BackstageForeverCheckReport('-',D('A|-|-|-|80|5|-'),{'Ann','Bob'},{Ann=D('A|-|-|-|50|1|0')})
assert(#lines==4 and lines[1]=='Readiness check:' and lines[2]=='  You: most worn gear at 80%, 5 bag slots free.' and lines[3]:find('Ann: most worn gear at 50%',1,true) and lines[4]=='  Bob: no answer (no addon, or answers are off).')
for name,id in pairs(BackstageForeverCheckKeys) do assert(type(name)=='string' and type(id)=='number' and id>0) end
`));

test("readiness check in game: asked on the party channel, answered once per ten seconds, only the six fields, off means silent", () => lua(STUBS + String.raw`
BackstageForeverAtlasData={{'sm','Scarlet Monastery','d',26,45,'B',1420,.8,.3,{},{{1049,'Compendium'},{1053,'In the Name of the Light'}}}}
GetInventoryItemDurability=function(slot) if slot==5 then return 43,100 end if slot==16 then return 90,90 end end
GetContainerNumFreeSlots=function(bag) return bag<2 and 6 or 0 end
local carried={[7146]=1} GetItemCount=function(id) return carried[id] or 0 end
BackstageForeverKitLowCount=function() return 1 end
`+ FILES + String.raw`
fire('PLAYER_LOGIN')
BackstageForeverCrewUpdate({quests={{id=1053},{id=7}}})
-- Someone asks: one answer with the six fields, one chat line that says so.
from('Ann','C|sm')
-- 1.26: for a named dungeon a second message says where each of its quests stands for you.
assert(#sent==2 and sent[1][1]=='BFParty' and sent[1][3]=='PARTY' and sent[1][2]=='A|sm|1|1|43|12|1',sent[1] and sent[1][2])
assert(sent[2][3]=='PARTY' and sent[2][2]:match('^D|sm|[%d;lrd]*$'),sent[2][2])
table.remove(sent,2)
assert(last():find('Ann asked for a readiness check',1,true))
from('Bob','C|sm') from('Ann','C|sm')
assert(#sent==1,'at most one answer in ten seconds')
clock=1011 from('Ann','C|-')
assert(#sent==2 and sent[2][2]=='A|-|-|-|43|12|1','no dungeon: no quest or key field')
clock=1030 from('Ann','C|SM; DROP') from('Ann','C|sm|extra') from('Ann','Cgarbage')
assert(#sent==2,'a malformed question gets no answer')
-- Answers off.
BackstageForeverCheckCommand('check answers off')
assert(BackstageForeverPartySettings.answerChecks==false and BackstageForeverCheckAnswers()==false)
clock=1060 from('Ann','C|sm') assert(#sent==2)
BackstageForeverCheckCommand('check answers on') from('Ann','C|sm') assert(#sent==4 and sent[3][2]:sub(1,2)=='A|' and sent[4][2]:sub(1,5)=='D|sm|')
-- Asking: one question, then one line per member after the answers arrive.
clock=1100 sent={} said={}
BackstageForeverCheckCommand('check sm')
assert(#sent==1 and sent[1][2]=='C|sm' and last()=='Backstage Forever: Asked your party. The answers follow in a few seconds.')
from('Ann','A|sm|2|0|80|3|0')
from('Zed','A|sm|2|1|80|3|0') -- not in the party list: ignored
from('Bob','A|brd|2|1|80|3|0') -- another dungeon than asked: ignored
from('Bob','A|sm|2|1|80|3|0|x') -- malformed
runTimers()
assert(said[#said-3]=='Backstage Forever: Readiness check for Scarlet Monastery:',said[#said-3])
assert(said[#said-2]=='Backstage Forever:   You: 1 quest for Scarlet Monastery, has the key, most worn gear at 43%, 12 bag slots free, 1 kit item low.',said[#said-2])
assert(said[#said-1]=='Backstage Forever:   Ann: 2 quests for Scarlet Monastery, no key, most worn gear at 80%, 3 bag slots free, class kit fine.',said[#said-1])
assert(last()=='Backstage Forever:   Bob: no answer (no addon, or answers are off).')
BackstageForeverCheckCommand('check')
assert(#sent==1 and last():find('You asked a moment ago',1,true),'asking is rate-limited too')
local before=#said BackstageForeverCheckCommand('check show') assert(#said==before+4)
clock=1200 from('Bob','A|sm|0|0|10|0|3') BackstageForeverCheckCommand('check show')
assert(last():find('Bob: no answer',1,true),'an answer long after the question is not taken')
BackstageForeverCheckCommand('check nowhere') assert(last():find('not known',1,true) and #sent==1)
-- Never to a raid, never with party sync off, never alone.
raid=true BackstageForeverCheckCommand('check sm') assert(last():find('Join a party first',1,true) and #sent==1) raid=false
grouped=false BackstageForeverCheckCommand('check sm') assert(last():find('Join a party first',1,true)) grouped=true
BackstageForeverPartyCommand('party off') sent={}
BackstageForeverCheckCommand('check sm') assert(#sent==0 and last():find('Party sync is off',1,true))
clock=1300 from('Ann','C|sm') assert(#sent==0,'party sync off: no answer either')
`));

test("mentor messages: strict shapes, plain text, bounded", () => lua(CREW + String.raw`
local E,D=BackstageForeverMentorEncode,BackstageForeverMentorDecode
assert(E('ask','Ann')=='M|ask|Ann' and E('yes','Ann')=='M|yes|Ann' and E('end','Ann')=='M|end|Ann' and E('req','Ann')=='M|req|Ann')
assert(E('say','Ann','go  north |cffff0000now|r')=='M|say|Ann|go north now')
assert(E('way','Ann',1413,51.52,30.94,'Crossroads')=='M|way|Ann|1413|51.5|30.9|Crossroads' and E('way','Ann',1413,5,5,nil)=='M|way|Ann|1413|5.0|5.0|')
assert(E('step','Ann','Route 3/90: Accept |Hquest:1|h[Sarkoth]|h')=='M|step|Ann|Route 3/90: Accept [Sarkoth]')
assert(E('boo','Ann')==nil and E('ask','An n')==nil and E('say','Ann','')==nil and E('say','Ann',nil)==nil and E('way','Ann',0,5,5)==nil and E('way','Ann',1,101,5)==nil and E('way','Ann','x',5,5)==nil)
assert(#E('say','Ann',string.rep('x',400))<=255)
local m=D('M|way|Ann|1413|51.5|30.9|Crossroads')
assert(m.kind=='way' and m.to=='Ann' and m.map==1413 and m.x==51.5 and m.y==30.9 and m.label=='Crossroads')
assert(D('M|way|Ann|1413|51.5|30.9|').label=='a spot' and D('M|say|Ann|hello there').text=='hello there' and D('M|ask|Ann').kind=='ask')
for _,bad in ipairs({'M|ask','M|ask|','M|ask|Ann|extra','M|ASK|Ann','M|boo|Ann','M|ask|An n','M|say|Ann','M|say|Ann|','M|say|Ann|a|b','M|way|Ann|1413|51.5|30.9',
  'M|way|Ann|1413|151.5|30.9|x','M|way|Ann|0|51.5|30.9|x','M|way|Ann|1413|-5|30.9|x','M|way|Ann|1413|5e1|30.9|x','M|way|Ann|1413|51.5|30.9|x|y','M|way|Ann|x|51.5|30.9|x',
  'M|step|Ann|'..string.rep('x',260),'N|ask|Ann','',5,nil}) do assert(D(bad)==nil,tostring(bad)) end
assert(#D('M|say|Ann|'..string.rep('x',200)).text==120,'a long note is cut, not trusted')
assert(BackstageForeverMentorStep({text='Accept Sarkoth',index=3,total=90})=='Route 3/90: Accept Sarkoth')
assert(BackstageForeverMentorStep(nil,{{complete=true},{complete=false},{}})=='No guided route step. Quests in the log: 3, ready to hand in: 1.')
assert(BackstageForeverMentorStep(nil,nil)=='No next step is known right now.' and #BackstageForeverMentorStep({text=string.rep('x',400)})<=120)
`));

test("mentor link rules: only who you asked, only who you accepted, nothing by itself", () => lua(CREW + String.raw`
local R=BackstageForeverMentorReceive
-- The mentee's side.
local s={}
assert(R(s,'Me','Ann','M|ask|Other',10)==nil and s.offer==nil,'a message for someone else is ignored')
local r=R(s,'Me','Ann','M|ask|Me',10)
assert(r.say:find('Ann offers to be your mentor',1,true) and r.say:find('/bf mentor accept',1,true) and s.offer.from=='Ann' and s.mentor==nil,'asking accepts nothing')
assert(R(s,'Me','Ann','M|req|Me',11)==nil and R(s,'Me','Ann','M|way|Me|1|5|5|x',11)==nil and R(s,'Me','Ann','M|say|Me|hi',11)==nil,'before accepting, nothing else is taken')
s.mentor='Ann' s.offer=nil
assert(R(s,'Me','Bob','M|req|Me',12)==nil and R(s,'Me','Bob','M|way|Me|1|5|5|x',12)==nil and R(s,'Me','Bob','M|say|Me|hi',12)==nil,'only the mentor you accepted')
assert(R(s,'Me','Ann','M|req|Me',12).reply=='step')
r=R(s,'Me','Ann','M|way|Me|1413|51.5|30.9|Crossroads',13)
assert(r.way and r.say=='Your mentor Ann suggests a waypoint: Crossroads at 51.5, 30.9. Type /bf mentor go to follow it.',r.say)
assert(s.way.map==1413 and s.way.x==51.5 and s.way.from=='Ann')
assert(R(s,'Me','Ann','M|say|Me|kill the |cffff0000boars|r first',14)==nil,'a note with a colour code in it is not a clean note')
assert(R(s,'Me','Ann','M|say|Me|kill the boars first',14).say=='Your mentor Ann: kill the boars first')
assert(R(s,'Me','Bob','M|ask|Me',15)==nil,'no second mentor while you have one')
assert(R(s,'Me','Bob','M|end|Me',15)==nil and s.mentor=='Ann')
assert(R(s,'Me','Ann','M|end|Me',16).say=='Ann ended the mentor link.' and s.mentor==nil and s.way==nil)
-- The mentor's side.
local m={}
assert(R(m,'Me','Bob','M|yes|Me',10)==nil and m.mentee==nil,'nobody becomes your mentee uninvited')
m.asked={name='Bob',at=10}
assert(R(m,'Me','Ann','M|yes|Me',20)==nil,'only the player you asked')
assert(R(m,'Me','Bob','M|yes|Me',200)==nil,'not after two minutes')
m.asked={name='Bob',at=190}
assert(R(m,'Me','Bob','M|yes|Me',200).say:find('Bob accepted',1,true) and m.mentee=='Bob' and m.asked==nil)
assert(R(m,'Me','Ann','M|step|Me|Route 1/2: x',201)==nil)
assert(R(m,'Me','Bob','M|step|Me|Route 1/2: Accept Sarkoth',201).say=='Bob, next step: Route 1/2: Accept Sarkoth')
assert(R(m,'Me','Bob','M|way|Me|1|5|5|x',202)==nil and R(m,'Me','Bob','M|say|Me|hi',202)==nil,'a mentee cannot send waypoints or notes')
assert(R(m,'Me','Bob','M|end|Me',203).say and m.mentee==nil)
assert(R(m,'Me','Bob','junk',1)==nil and R(m,nil,'Bob','M|ask|Me',1)==nil and R(nil,'Me','Bob','M|ask|Me',1)==nil)
`));

test("mentor link in game: ask, accept, step on request, waypoint only when the mentee types go", () => lua(STUBS + String.raw`
local ways={} BackstageForeverWay=function(m) ways[#ways+1]=m end
BackstageForeverRouteNow=function() return {text='Accept Sarkoth',index=3,total=90} end
C_Map={GetBestMapForUnit=function() return 1411 end,GetPlayerMapPosition=function() return {GetXY=function() return .4,.6 end} end}
local heard EventRegistry={RegisterCallback=function(self,event,fn,owner) assert(event=='SetItemRef') heard=function(link) fn(owner,link) end end}
`+ FILES + String.raw`
fire('PLAYER_LOGIN')
-- As the mentor.
BackstageForeverMentorCommand('mentor Zed') assert(#sent==0 and last():find('not in your party',1,true))
BackstageForeverMentorCommand('mentor step') assert(#sent==0 and last():find('no mentee yet',1,true))
BackstageForeverMentorCommand('mentor ann')
assert(#sent==1 and sent[1][2]=='M|ask|Ann' and sent[1][3]=='PARTY' and BackstageForeverMentorState.asked.name=='Ann')
from('Bob','M|yes|Me') assert(BackstageForeverMentorState.mentee==nil)
from('Ann','M|yes|Me') assert(BackstageForeverMentorState.mentee=='Ann' and last():find('Ann accepted',1,true))
BackstageForeverMentorCommand('mentor step') assert(sent[#sent][2]=='M|req|Ann')
BackstageForeverMentorCommand('mentor step') assert(last():find('Wait a few seconds',1,true) and #sent==2)
from('Ann','M|step|Me|Route 7/90: Kill 8 boars') assert(last()=='Backstage Forever: Ann, next step: Route 7/90: Kill 8 boars')
BackstageForeverMentorCommand('mentor way Boar field') assert(sent[#sent][2]=='M|way|Ann|1411|40.0|60.0|Boar field',sent[#sent][2])
BackstageForeverMentorCommand('mentor say Stay near the |cffff0000road|r') assert(sent[#sent][2]=='M|say|Ann|Stay near the road')
BackstageForeverMentorCommand('mentor Bob') assert(last():find('already mentor Ann',1,true))
BackstageForeverMentorCommand('mentor end') assert(sent[#sent][2]=='M|end|Ann' and BackstageForeverMentorState.mentee==nil)
-- As the mentee.
sent={} clock=2000
from('Ann','M|way|Me|1413|51.5|30.9|Trap') from('Ann','M|say|Me|hello') from('Ann','M|req|Me')
assert(#sent==0 and BackstageForeverMentorState.way==nil,'nothing from a player you have not accepted')
BackstageForeverMentorCommand('mentor accept') assert(#sent==0 and last():find('Nobody has asked',1,true))
from('Ann','M|ask|Me') assert(last():find('Ann offers to be your mentor',1,true) and #sent==0,'the request itself shares nothing')
BackstageForeverMentorCommand('mentor accept')
assert(sent[1][2]=='M|yes|Ann' and BackstageForeverMentorState.mentor=='Ann')
from('Ann','M|req|Me') assert(sent[2][2]=='M|step|Ann|Route 3/90: Accept Sarkoth',sent[2] and sent[2][2])
from('Ann','M|req|Me') assert(#sent==2,'the step is sent at most once in ten seconds')
from('Ann','M|way|Me|1413|51.5|30.9|Crossroads')
assert(#ways==0,'a suggestion never sets a waypoint by itself')
assert(last()=='Backstage Forever: Your mentor Ann suggests a waypoint: Crossroads at 51.5, 30.9. Type /bf mentor go to follow it. |cff71d5ff|Haddon:BackstageForever:mentorgo|h[follow it]|h|r',last())
from('Ann','M|way|Me|1413|51.5|30.9||Hitem:1|h[x]|h') assert(#ways==0 and BackstageForeverMentorState.way.label=='Crossroads','a label carrying a link is refused whole')
from('Ann','M|say|Me|type /bf mentor go') assert(#ways==0 and last()=='Backstage Forever: Your mentor Ann: type /bf mentor go')
combat=true BackstageForeverMentorCommand('mentor go') assert(#ways==0 and last():find('leave combat',1,true)) combat=false
BackstageForeverMentorCommand('mentor go') assert(#ways==1 and ways[1]=='way 1413 51.5 30.9 Ann: Crossroads',ways[1])
heard('addon:BackstageForever:mentorgo') assert(#ways==2,'or a click on the addon\'s own link')
heard('addon:BackstageForever:other') heard('item:1') assert(#ways==2)
-- The link ends when the mentor leaves the party.
party={'Bob'} fire('GROUP_ROSTER_UPDATE')
assert(BackstageForeverMentorState.mentor==nil and BackstageForeverMentorState.way==nil and last():find('Mentor link with Ann ended',1,true))
BackstageForeverMentorCommand('mentor go') assert(#ways==2)
`));

test("soft reserves: a short bounded list, chunked like party sync, every entry checked again on arrival", () => lua(CREW + String.raw`
local list={}
local A=BackstageForeverSoftAdd
assert(A(list,'Ann','Hand of Justice')[2]=='Hand of Justice')
assert(A(list,'Bob','|cffa335ee|Hitem:11815::::::::60:::::|h[Hand of Justice]|h|r')[2]=='Hand of Justice','a shift-clicked link becomes its name')
assert(select(2,A(list,'ann','hand of justice'))=='twice' and select(2,A(list,'An n','x'))=='name' and select(2,A(list,'Ann',''))=='item' and select(2,A(list,'Ann','|'))=='item')
assert(A(list,'Cy','Iron=foe; the |best|')[2]=='Iron foe the best','the characters the message is built from are taken out')
assert(#A(list,'Dee',string.rep('x',90))[2]==40)
for i=1,6 do assert(A(list,'P'..string.char(96+i)..'x','Item '..string.char(96+i))) end
assert(#list==10 and select(2,A(list,'Zed','One more'))=='full','ten at most')
assert(BackstageForeverSoftRemove(list,'ANN')==1 and #list==9 and BackstageForeverSoftRemove(list,'Nobody')==0)
local parts=BackstageForeverSoftEncode(list,7)
assert(#parts>=1 and #parts<=4)
for _,p in ipairs(parts) do assert(#p<=255,#p) end
assert(parts[1]:match('^S|7|1/'..#parts..'|Bob=Hand of Justice;Cy=Iron foe the best;'))
local s={}
local got
for i=#parts,1,-1 do got=BackstageForeverSoftReceive(s,'Lead',parts[i]) assert((got~=nil)==(i==1)) end
assert(#got==9 and got[1][1]=='Bob' and got[1][2]=='Hand of Justice' and got[9][1]=='Pfx')
assert(BackstageForeverSoftEncode({},3)[1]=='S|3|1/1|' and #BackstageForeverSoftReceive(s,'Lead','S|3|1/1|')==0,'an empty list clears')
-- The longest allowed names and items still fit the four chunks.
local big={} for i=1,10 do BackstageForeverSoftAdd(big,string.rep(string.char(96+i),24),string.rep('y',40)) end
assert(#big==10 and BackstageForeverSoftAdd({},string.rep('a',25),'x')==nil)
local chunks=BackstageForeverSoftEncode(big,1) assert(#chunks==4) for _,p in ipairs(chunks) do assert(#p<=255) end
local back for _,p in ipairs(chunks) do back=BackstageForeverSoftReceive(s,'Lead',p) end assert(#back==10)
-- Untrusted input.
got=BackstageForeverSoftReceive(s,'Lead','S|1|1/1|Ann=Good Item;B0b=Bad Name;NoEquals;Cy=;=x;Dee=Fine;Ann=Good Item;Eve='..string.rep('z',60))
assert(#got==3 and got[1][2]=='Good Item' and got[2][1]=='Dee' and #got[3][2]==40,'bad entries are dropped, long ones cut, repeats merged')
local many={} for i=1,30 do many[i]='P'..string.char(97+i%26)..string.char(97+math.floor(i/26))..'=i'..i end
assert(#BackstageForeverSoftReceive(s,'Lead','S|1|1/1|'..table.concat(many,';'))==10,'never more than ten rows from one message')
for _,bad in ipairs({'S|1|0/1|x','S|1|2/1|x','S|1|1/5|x','S|1|1/1|Ann=a|b','S|1234|1/1|Ann=x','S|-1|1/1|Ann=x','S||1/1|x','S|1|1/1','Sjunk','S|1|1/1|'..string.rep('x',300),5}) do
  assert(BackstageForeverSoftReceive(s,'Lead',bad)==nil,tostring(bad)) end
assert(BackstageForeverSoftLines({},nil)[1]:find('list is empty',1,true) and BackstageForeverSoftLines({},'Ann')[1]=='Ann keeps no soft reserves right now.')
local lines=BackstageForeverSoftLines({{'Ann','Ironfoe'}},'Lead')
assert(#lines==2 and lines[1]:find('Soft reserves kept by Lead: 1.',1,true) and lines[1]:find('nothing is rolled or handed out',1,true) and lines[2]=='  Ann: Ironfoe')
`));

test("soft reserves in game: the leader keeps the list, the party sees it, a raid never does", () => lua(STUBS + FILES + String.raw`
fire('PLAYER_LOGIN')
BackstageForeverSoftCommand('sr add Ann Hand of Justice')
assert(last()=='Backstage Forever: Soft reserve added: Ann, Hand of Justice.' and #sent==1 and sent[1][3]=='PARTY' and sent[1][2]:match('^S|%d+|1/1|Ann=Hand of Justice$'),sent[1] and sent[1][2])
BackstageForeverSoftCommand('sr add Bob Ironfoe')
assert(#sent==1,'two changes in a row are sent together a moment later')
clock=1005 runTimers()
assert(#sent==2 and sent[2][2]:match('|Ann=Hand of Justice;Bob=Ironfoe$'))
BackstageForeverSoftCommand('sr') assert(said[#said-2]:find('Your soft-reserve list: 2.',1,true) and last()=='Backstage Forever:   Bob: Ironfoe')
BackstageForeverSoftCommand('sr add Ann') assert(last():find('/bf sr add Player Item',1,true))
BackstageForeverSoftCommand('sr what') assert(last():find('Only the party leader changes the list',1,true))
assert(#BackstageForeverCrewSettings.sr==2,'your own list survives a /reload')
-- A member asks; the leader answers at most once in ten seconds.
clock=1020 from('Ann','S?') assert(#sent==3) from('Bob','S?') assert(#sent==3)
clock=1040 BackstageForeverSoftCommand('sr remove bob') assert(last():find('Removed 1',1,true) and sent[#sent][2]:match('|Ann=Hand of Justice$'))
-- In a raid nothing is sent.
raid=true clock=1060 local n=#sent
BackstageForeverSoftCommand('sr add Cy Drake Fang') assert(#sent==n and last():find('never sends to a raid',1,true)) raid=false
clock=1080 BackstageForeverSoftCommand('sr clear') assert(sent[#sent][2]:match('^S|%d+|1/1|$') and #BackstageForeverCrewSettings.sr==0)
-- As a member: only the leader's list is taken, and only the leader may change it.
leader='party1' sent={} clock=1200
BackstageForeverSoftCommand('sr add Bob Ironfoe') assert(#sent==0 and last():find('Only the party leader changes',1,true))
BackstageForeverSoftCommand('sr list') assert(sent[1][2]=='S?' and last():find('Asked again',1,true))
from('Bob','S|1|1/1|Bob=Everything') BackstageForeverSoftCommand('sr list') assert(last():find('Asked again',1,true),'a list from someone who is not the leader is ignored')
from('Ann','S|1|1/1|Bob=Ironfoe;Me=Hand of |cffff0000Justice') BackstageForeverSoftCommand('sr list') assert(last():find('Asked again',1,true),'a message with a colour code in it is refused whole')
from('Ann','S|2|1/1|Bob=Ironfoe')
assert(last()=='Backstage Forever: Ann shared a soft-reserve list. /bf sr list shows it.')
BackstageForeverSoftCommand('sr list')
assert(said[#said-1]:find('Soft reserves kept by Ann: 1.',1,true) and last()=='Backstage Forever:   Bob: Ironfoe')
for _,m in ipairs(said) do assert(not m:find('|Hitem',1,true) and not m:find('|cffff0000',1,true)) end
-- Leaving the party forgets it.
grouped=false fire('GROUP_ROSTER_UPDATE') grouped=true
assert(BackstageForeverSoftState.theirs==nil)
`));

test("wiring: files listed, words routed and catalogued, the answer switch in the options, no string is ever run", () => {
  const source = read("addon/BackstageForever/BackstageForeverCrew.lua");
  for (const never of ["loadstring", "RunScript", "SendChatMessage", "'WHISPER'", "'RAID'", "'GUILD'", "SendAddonMessage"]) assert.ok(!source.includes(never), never);
  const party = read("addon/BackstageForever/BackstageForeverParty.lua");
  assert.equal((party.match(/SendAddonMessage/g) || []).length, 3, "party sync sends in one place, the helpers on top of it in one more");
  const order = read("addon/BackstageForever/BackstageForever.toc").split(/\r?\n/).filter((l) => l.endsWith(".lua"));
  for (const before of ["BackstageForeverParty.lua", "BackstageForeverKits.lua", "BackstageForeverPanels.lua", "BackstageForeverLfg.lua"]) assert.ok(order.indexOf(before) < order.indexOf("BackstageForeverCrew.lua"), before);
  assert.ok(require("../src/core/game-sync.cjs").ADDON_FILES.includes("BackstageForeverCrew.lua"));
  assert.match(read("addon/BackstageForever/BackstageForever.toc"), /BackstageForeverCrewSettings/);
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  for (const [word, fn] of [["check", "BackstageForeverCheckCommand"], ["mentor", "BackstageForeverMentorCommand"], ["sr", "BackstageForeverSoftCommand"]]) {
    assert.ok(hud.includes(`if word=='${word}' then\n                if type(${fn})=='function' then pcall(${fn},message)end`), word);
    assert.ok(require("../src/renderer/commands.js").CATALOG.some((c) => c.word === word), word);
    assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), new RegExp(`'/bf ${word} `));
  }
  assert.match(read("addon/BackstageForever/BackstageForever.lua"), /pcall\(BackstageForeverCrewUpdate,character\)/);
  assert.ok(read("addon/BackstageForever/BackstageForeverOptions.lua").includes("on('BackstageForeverPartySettings','answerChecks'),'check answers'"));
  assert.match(read("addon/BackstageForever/BackstageForeverKits.lua"), /function BackstageForeverKitLowCount\(\)/);
});
