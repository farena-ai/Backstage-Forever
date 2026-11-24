"use strict";
// 1.26: chain steps in quest tooltips (Q6), time to arrive and "behind you" on the step scroll (Q3),
// who in the party still needs each dungeon quest (G6), and the large-buttons setting (P7).
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
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end} end
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local sent={}
C_ChatInfo={RegisterAddonMessagePrefix=function() end,SendAddonMessage=function(p,t,ch) sent[#sent+1]={p,t,ch} end}
local clock=1000 GetTime=function() return clock end
local combat=false InCombatLockdown=function() return combat end
IsInGroup=function() return true end IsInRaid=function() return false end
local party={'Ann','Bob','Cy'}
UnitName=function(u) if u=='player' then return 'Me' end local i=tonumber(u:match('^party(%d)$')) return i and party[i] or nil end
UnitIsGroupLeader=function(u) return u=='player' end
UnitFactionGroup=function() return 'Horde' end
Ambiguate=function(n) return (n:gsub('%-.*$','')) end
local timers={} C_Timer={After=function(s,fn) timers[#timers+1]=fn end}
local function runTimers() local t=timers timers={} for _,fn in ipairs(t) do fn() end end
local function from(who,text,channel) fire('CHAT_MSG_ADDON','BFParty',text,channel or 'PARTY',who) end
local function last() return said[#said] end
`;

test("Q6: a quest in a chain gets its step and the quest the chain ends with; a lone quest gets nothing", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverChain.lua')
local q={[10]={title='One',next=20},[20]={title='Two',next=30},[30]={title='The |cffff0000End|r'},[40]={title='Alone'},[50]={title='A',next=60},[60]={next=70},[70]={}}
local T=BackstageForeverChainTip
local lines=T(q,20) assert(#lines==2 and lines[1]=='Step 2 of 3 in its quest chain.' and lines[2]=='The chain ends with: The ||cffff0000End||r.',lines[2])
lines=T(q,30) assert(#lines==2 and lines[1]=='Step 3 of 3 in its quest chain.' and lines[2]=='This is the last step of the chain.')
lines=T(q,50) assert(#lines==1 and lines[1]=='Step 1 of 3 in its quest chain.','no title for the last quest: only the step is said')
assert(T(q,40)==nil and T(q,999)==nil and T(nil,10)==nil and T(q,'10')==nil)
local L=BackstageForeverChainLinkQuest
assert(L('quest:20:15')==20 and L('|cffffff00|Hquest:870:14|h[The Forgotten Pools]|h|r')==870 and L('item:20')==nil and L('quest:abc')==nil and L('quest:0')==nil and L(nil)==nil and L(string.rep('x',500))==nil)
-- The tooltip: lines are added after the game's own, and only while the switch is on and outside combat.
BackstageForeverReference={quests=q}
local added,shown={},0
local tip={AddLine=function(_,text,r,g,b,wrap) added[#added+1]=text end,Show=function() shown=shown+1 end}
assert(BackstageForeverChainTipsOn()==true,'on unless switched off')
assert(BackstageForeverChainTooltip(tip,20)==2 and #added==2 and added[1]=='Step 2 of 3 in its quest chain.' and shown==1)
assert(BackstageForeverChainTooltip(tip,40)==0 and #added==2,'a quest that stands alone adds nothing')
local busy=true InCombatLockdown=function() return busy end
assert(BackstageForeverChainTooltip(tip,20)==0 and #added==2,'quiet in combat') busy=false
assert(BackstageForeverChainTooltip({},20)==0 and BackstageForeverChainTooltip(nil,20)==0)
-- The switch, and the hook: only through the game's own hook function, on the two link tooltips.
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
BackstageForeverChainCommand('chain tips off')
assert(BackstageForeverPanelSettings.chainTips==false and BackstageForeverChainTipsOn()==false and said[#said]:find('Chain steps in quest tooltips: off',1,true))
assert(BackstageForeverChainTooltip(tip,20)==0 and #added==2)
BackstageForeverChainCommand('chain tips on') assert(BackstageForeverChainTipsOn()==true and BackstageForeverChainTooltip(tip,20)==2)
BackstageForeverChainCommand('chain tips') assert(said[#said]:find('Chain steps in quest tooltips: on',1,true),'no word only reports')
`));

test("Q6: the hook is placed after login on the link tooltips and survives a tooltip that errors", () => lua(String.raw`
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end} end
local hooks={}
hooksecurefunc=function(tip,name,fn) hooks[#hooks+1]={tip,name,fn} end
local added={}
ItemRefTooltip={SetHyperlink=function() end,AddLine=function(_,t) added[#added+1]=t end,Show=function() end}
GameTooltip={SetHyperlink=function() end,AddLine=function() error('broken tooltip') end,Show=function() end}
dofile('addon/BackstageForever/BackstageForeverChain.lua')
assert(#hooks==0,'nothing is hooked while the file loads')
for _,h in ipairs(handlers) do h(nil,'PLAYER_LOGIN') end
assert(#hooks==2 and hooks[1][1]==ItemRefTooltip and hooks[1][2]=='SetHyperlink' and hooks[2][1]==GameTooltip)
BackstageForeverReference={quests={[10]={title='One',next=20},[20]={title='Two'}}}
hooks[1][3](ItemRefTooltip,'quest:10:5') assert(#added==2 and added[1]=='Step 1 of 2 in its quest chain.' and added[2]=='The chain ends with: Two.')
hooks[1][3](ItemRefTooltip,'item:10') hooks[1][3](ItemRefTooltip,nil) hooks[1][3](ItemRefTooltip,{}) assert(#added==2,'only quest links')
hooks[2][3](GameTooltip,'quest:10:5') -- a tooltip that errors is swallowed
`));

test("Q3: distance, time at your current speed, and behind you in words", () => lua(String.raw`
dofile('addon/BackstageForever/BackstageForeverRoute.lua')
local B,A=BackstageForeverArrivalBehind,BackstageForeverArrivalText
local pi=math.pi
-- facing 0 = north. east/south are yards from you to the spot.
assert(B(0,0,-100)==false,'straight ahead (north)')
assert(B(0,0,100)==true,'due south while facing north')
assert(B(0,100,0)==false and B(0,-100,0)==false,'to the side is not behind')
assert(B(0,60,100)==true and B(0,100,10)==false,'more than 100 degrees off counts')
assert(B(pi/2,100,0)==true and B(pi/2,-100,0)==false,'facing west: east is behind, west is ahead')
assert(B(pi,0,100)==false and B(pi,0,-100)==true,'facing south')
assert(B(3*pi/2,100,0)==false and B(2*pi,0,100)==true and B(-pi/2,-100,0)==true,'any angle the game gives')
assert(B(nil,0,100)==false and B(0,0,0)==false and B(0/0,0,100)==false and B(0,'x',1)==false,'no reading: never claimed')
assert(A(420,7,false)=='420 yd · about 1 min' and A(420.4,7,true)=='420 yd · about 1 min · behind you')
assert(A(100,7,false)=='100 yd · about 15 s' and A(20,7,false)=='20 yd · about 5 s' and A(350,7,false)=='350 yd · about 50 s')
assert(A(2000,7,false)=='2000 yd · about 5 min' and A(1200,14,false)=='1200 yd · about 1 min','a mount halves it')
assert(A(420,0,false)=='420 yd' and A(420,nil,true)=='420 yd · behind you' and A(420,.5,false)=='420 yd','standing still: no time is guessed')
assert(A(5,7,false)=='5 yd','almost there: no time')
assert(A(90000,1,false)=='90000 yd','more than an hour is not printed as a time')
assert(A(nil,7)==nil and A(-1,7)==nil and A(0/0,7)==nil and A(1e9,7)==nil)
`));

test("Q3: the scroll has one arrival line that never wraps, and stays quiet in combat", () => {
  const route = read("addon/BackstageForever/BackstageForeverRoute.lua");
  assert.match(route, /lines\.arrive=text\('GameFontHighlightSmall',-91,12\)\s+if lines\.arrive then method\(lines\.arrive,'SetWordWrap',false\) end/);
  assert.match(route, /local function arrivalLine\(\)\s+local s=steps\[index\]\s+if not s or not s\.x or not s\.y or combat\(\) then return nil end/);
  assert.match(route, /method\(frame,'SetHeight',line~='' and 118 or 104\)/, "the scroll grows only while the line shows");
  assert.match(route, /call\(GetPlayerFacing\)/); assert.match(route, /call\(GetUnitSpeed,'player'\)/);
  assert.doesNotMatch(route.slice(route.indexOf("local function arrivalLine"), route.indexOf("local shownArrival")), /SetUserWaypoint|SetSuperTracked/, "reading only: no waypoint is set from the timer");
});

test("G6: dungeon quest messages are bounded and strict", () => lua(CREW + String.raw`
local E,D=BackstageForeverCheckQuestEncode,BackstageForeverCheckQuestDecode
assert(E('sm',{{id=2040,state='l'},{id=2041,state='r'},{id=2046,state='d'}})=='D|sm|2040l;2041r;2046d')
assert(E('sm',{})=='D|sm|' and E('sm',nil)=='D|sm|' and E('Not A Dungeon',{})==nil and E(nil,{})==nil)
assert(E('sm',{{id=1,state='x'},{id=0,state='l'},{id=1.5,state='l'},{id=5,state='l'},{id=5,state='d'},'junk',{id=99999999,state='l'}})=='D|sm|5l','bad rows and doubles are left out')
local many,wide={},{} for i=1,60 do many[i]={id=9000+i,state='l'} wide[i]={id=9000000+i,state='l'} end
local text=E('scholo',many) assert(#text<=255 and select(2,text:gsub(';',''))==29,'thirty quests at most: '..#text)
local full=E('scholo',wide) assert(#full<=255 and #full>240 and D(full)=='scholo','never more than one message: '..#full)
local d,s=D('D|sm|2040l;2041r;2046d') assert(d=='sm' and s[2040]=='l' and s[2041]=='r' and s[2046]=='d')
d,s=D('D|sm|') assert(d=='sm' and next(s)==nil,'nothing in the log is a clean answer')
d,s=D(text) assert(d=='scholo' and s[9030]=='l' and s[9031]==nil)
for _,bad in ipairs({'D|sm','D|sm|2040','D|sm|2040x','D|sm|l','D|sm|2040l;','D|sm|;2040l','D|sm|2040l;;2041l','D|sm|2040l;2040d','D|SM|2040l','D|sm|2040l|x','D|sm|02040l',
  'D|sm|12345678l','D|sm|2040l 2041l','D|sm|-5l','D||2040l','D|not a dungeon|1l','Dsm|1l','D|sm|'..string.rep('1l;',100)..'1l','',5,nil}) do assert(D(bad)==nil,tostring(bad)) end
local over={} for i=1,31 do over[i]=i..'l' end assert(D('D|sm|'..table.concat(over,';'))==nil,'more than thirty is refused')
-- Where each listed quest stands for you.
local data={{'sm','Scarlet Monastery','d',34,45,'B',1420,.85,.32,{},{{200,'Bookie Herod'},{328,'The Hidden Key'},{1053,'In the Name of the Light'},{7,'Unknown'},'junk'}}}
local stand={[200]='done',[328]='ready',[1053]='log',[7]='weird'}
local states=BackstageForeverCheckQuestStates(data,'sm',function(id) return stand[id] end)
assert(#states==3 and states[1].id==200 and states[1].state=='d' and states[2].state=='r' and states[3].state=='l')
assert(E('sm',states)=='D|sm|200d;328r;1053l')
assert(BackstageForeverCheckQuestStates(data,'brd',function() end)==nil and BackstageForeverCheckQuestStates(nil,'sm',function() end)==nil and BackstageForeverCheckQuestStates(data,'sm',nil)==nil)
assert(#BackstageForeverCheckQuestStates(data,'sm',function() error('api gone') end)==0,'a failing read is no state')
-- Who still needs what: done and ready-to-hand-in do not count; a member who did not answer is not guessed.
local quests={{id=200,title='Bookie Herod'},{id=328,title='The Hidden Key'},{id=1053,title='In the Name of the Light'}}
local need=BackstageForeverCheckQuestNeeders(quests,{[200]='d',[328]='l'},{'Ann','Bob','Cy'},{Ann={[200]='l',[328]='r',[1053]='d'},Bob={}})
assert(table.concat(need[200],',')=='Ann,Bob' and table.concat(need[328],',')=='You,Bob' and table.concat(need[1053],',')=='You,Bob',table.concat(need[1053],','))
local lines=BackstageForeverCheckQuestLines(quests,{[200]='d',[328]='l'},{'Ann','Bob','Cy'},{Ann={[200]='l',[328]='r',[1053]='d'},Bob={}})
assert(#lines==5 and lines[1]=='Dungeon quests somebody still needs: 3 of 3.' and lines[2]=='  Bookie Herod: still needed by Ann, Bob.' and lines[3]=='  The Hidden Key: still needed by You, Bob.',lines[2])
assert(lines[5]=='  No quest answer from: Cy.',lines[5])
lines=BackstageForeverCheckQuestLines(quests,{[200]='d',[328]='r',[1053]='d'},{'Ann'},{Ann={[200]='d',[328]='d',[1053]='r'}})
assert(#lines==1 and lines[1]=='Dungeon quests: everyone who answered has them done or ready to hand in.')
lines=BackstageForeverCheckQuestLines(quests,{},{'Ann'},{Ann={}},2)
assert(#lines==4 and lines[4]=='  and 1 more.','bounded: '..#lines)
assert(#BackstageForeverCheckQuestLines({},{},{'Ann'},{})==0 and #BackstageForeverCheckQuestLines(nil,nil,nil,nil)==0)
local evil=BackstageForeverCheckQuestLines({{id=1,title='|cffff0000Bad|r |Hitem:1|h[x]|h'}},{},{},{})
assert(not evil[2]:find('|',1,true),'a title is printed as plain text')
`));

test("G6 in game: the answer to a named dungeon carries quest states, and the check lists who still needs each quest", () => lua(STUBS + String.raw`
BackstageForeverAtlasData={{'sm','Scarlet Monastery','d',34,45,'B',1420,.85,.32,{},{{200,'Bookie Herod',35,'B','',0,0,0},{328,'The Hidden Key',37,'B','',0,0,0},{1053,'In the Name of the Light',40,'A','',0,0,0},{96800,'Past Due',38,'H','',0,0,0}}}}
local done,log,complete={[200]=true},{[328]=true,[96800]=true},{[96800]=true}
C_QuestLog={IsQuestFlaggedCompleted=function(id) return done[id]==true end,IsOnQuest=function(id) return log[id]==true end,IsComplete=function(id) return complete[id]==true end}
dofile('addon/BackstageForever/BackstageForeverParty.lua')
dofile('addon/BackstageForever/BackstageForeverLfg.lua')
dofile('addon/BackstageForever/BackstageForeverAtlas.lua')
`+ CREW + String.raw`
fire('PLAYER_LOGIN')
-- Someone asks about a dungeon: the six fields, then the quest states. No dungeon: no quest message.
from('Ann','C|sm')
assert(#sent==2 and sent[1][2]:sub(1,5)=='A|sm|' and sent[2][2]=='D|sm|200d;328l;96800r' and sent[2][3]=='PARTY',sent[2] and sent[2][2])
clock=1020 from('Ann','C|-') assert(#sent==3 and sent[3][2]:sub(1,4)=='A|-|','no dungeon, no quest message')
-- Answers off: neither message goes out.
BackstageForeverCheckCommand('check answers off') clock=1040 from('Ann','C|sm') assert(#sent==3)
BackstageForeverCheckCommand('check answers on')
-- Asking: quest answers are kept only from party members, for the dungeon asked, while the check is fresh.
clock=1100 sent={} said={}
BackstageForeverCheckCommand('check sm') assert(#sent==1 and sent[1][2]=='C|sm')
assert(BackstageForeverCheckNeeders('brd')==nil)
from('Ann','A|sm|1|1|80|3|0') from('Ann','D|sm|200l;328d')
from('Bob','D|sm|200d;328d;96800d')
from('Zed','D|sm|200l') from('Cy','D|brd|200l') from('Cy','D|sm|200l;bad')
runTimers()
local text=table.concat(said,'\n')
assert(text:find('Dungeon quests somebody still needs: 3 of 3.',1,true),text)
assert(text:find('  Bookie Herod: still needed by Ann.',1,true) and text:find('  The Hidden Key: still needed by You.',1,true) and text:find('  Past Due: still needed by Ann.',1,true),text)
assert(not text:find('In the Name of the Light',1,true),'the other side\'s quest is not listed')
assert(last()=='Backstage Forever:   No quest answer from: Cy.',last())
local need=BackstageForeverCheckNeeders('sm')
assert(need[200]=='Ann' and need[328]=='You' and need[96800]=='Ann' and BackstageForeverCheckNeeders('brd')==nil)
-- Late answers are ignored.
clock=1200 from('Cy','D|sm|200l') assert(BackstageForeverCheckNeeders('sm')[200]=='Ann')
`));

test("G6: the atlas quest list shows the names from the last check, in a line that never wraps", () => {
  const atlas = read("addon/BackstageForever/BackstageForeverAtlas.lua");
  assert.match(atlas, /pcall\(BackstageForeverCheckNeeders,place\[1\]\)/);
  assert.match(atlas, /\(who and \('  \|cffff9933'\.\.T\('needs:'\)\.\.' '\.\.who\.\.'\|r'\) or ''\)/);
  assert.match(atlas, /line\.text:SetAllPoints\(\);line\.text:SetJustifyH\('LEFT'\);line\.text:SetWordWrap\(false\)/);
  assert.match(read("addon/BackstageForever/BackstageForeverCrew.lua"), /BackstageForeverPartyHandle\('D',onCheckQuests\)/);
});

test("P7: large buttons scale the windows and the owl further, on top of larger text, outside combat only", () => lua(String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local combat=false InCombatLockdown=function() return combat end
local scales={}
for _,name in ipairs({'BackstageForeverCompass','BackstageForeverOptions','BackstageForeverWelcome','BackstageForeverRouteFrame','BackstageForeverAskButton'}) do
  _G[name]={SetScale=function(_,s) scales[name]=s end}
end
dofile('addon/BackstageForever/BackstageForeverSocial.lua')
assert(BackstageForeverTextScale()==1 and BackstageForeverButtonScale()==1,'off until switched on')
assert(BackstageForeverAccessCommand('access large on')==true and last()=='Backstage Forever: Large buttons — On')
assert(BackstageForeverSocialSettings.large==true and BackstageForeverButtonScale()==1.3 and BackstageForeverTextScale()==1.3)
assert(scales.BackstageForeverCompass==1.3 and scales.BackstageForeverRouteFrame==1.3 and scales.BackstageForeverOptions==1.3 and scales.BackstageForeverAskButton==1.3)
-- With larger text too, windows take both; the owl takes the button size only.
BackstageForeverAccessCommand('access text on')
assert(math.abs(scales.BackstageForeverCompass-1.495)<1e-9 and scales.BackstageForeverAskButton==1.3)
local late={SetScale=function(self,s) self.scale=s end}
assert(BackstageForeverApplyButtonSize(late)==true and late.scale==1.3 and BackstageForeverApplyButtonSize(nil)==false and BackstageForeverApplyButtonSize({})==false)
combat=true BackstageForeverAccessCommand('access large off') assert(last():find('outside combat',1,true) and BackstageForeverSocialSettings.large==true) combat=false
assert(BackstageForeverAccessCommand('access large off')==false and scales.BackstageForeverAskButton==1 and scales.BackstageForeverCompass==1.15)
`));

test("P7 and Q6 wiring: switches with plain sentences, the owl and the scroll take the size when they are built", () => {
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  assert.match(options, /switch\('Large buttons',[^\n]*off\('BackstageForeverSocialSettings','large'\),'access large'\)/);
  assert.match(options, /switch\('Chain steps in tooltips',[^\n]*on\('BackstageForeverPanelSettings','chainTips'\),'chain tips'\)/);
  assert.match(read("addon/BackstageForever/BackstageForeverAsk.lua"), /pcall\(BackstageForeverApplyButtonSize,button\)/);
  assert.match(read("addon/BackstageForever/BackstageForeverRoute.lua"), /pcall\(BackstageForeverApplyTextSize,frame\)/);
  assert.match(read("addon/BackstageForever/BackstageForeverPanels.lua"), /pcall\(BackstageForeverChainTooltip,GameTooltip,quest\.questId\)/);
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /pcall\(BackstageForeverChainCommand,message\)/);
});
