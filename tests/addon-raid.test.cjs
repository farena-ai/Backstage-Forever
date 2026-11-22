"use strict";
// 1.26 (roadmap G9): raid comms over the RAID addon channel. Its own switch, off by default; notes and
// assignments only from the leader or an assistant; everything checked and bounded; no timers.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const PURE = "dofile('addon/BackstageForever/BackstageForeverCrew.lua')\ndofile('addon/BackstageForever/BackstageForeverRaid.lua')\n";
const FILES = "dofile('addon/BackstageForever/BackstageForeverParty.lua')\ndofile('addon/BackstageForever/BackstageForeverLfg.lua')\n" + PURE;
// A raid of five: Lead (leader), Ann (assistant), Bob, Cy and Me. Who "Me" is in the roster is set per test.
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end} end
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local sent={}
C_ChatInfo={RegisterAddonMessagePrefix=function() end,SendAddonMessage=function(p,t,ch) sent[#sent+1]={p,t,ch} end}
local clock=1000 GetTime=function() return clock end
local combat=false InCombatLockdown=function() return combat end
local raid=true IsInGroup=function() return true end IsInRaid=function() return raid end
local myRank=0
local roster={{'Lead-Realm',2},{'Ann',1},{'Bob',0},{'Cy',0},{'Me',0}}
GetRaidRosterInfo=function(i) local r=roster[i] if not r then return nil end if r[1]=='Me' then return 'Me',myRank end return r[1],r[2] end
local target=nil
UnitName=function(u) if u=='player' then return 'Me' end if u=='target' then return target end end
UnitIsPlayer=function() return false end
Ambiguate=function(n) return (n:gsub('%-.*$','')) end
GetInventoryItemDurability=function(slot) if slot==5 then return 20,100 end end
GetContainerNumFreeSlots=function(bag) return bag==0 and 3 or 0 end
BackstageForeverKitLowCount=function() return 2 end
local timers={} C_Timer={After=function(s,fn) timers[#timers+1]=fn end}
local function runTimers() local t=timers timers={} for _,fn in ipairs(t) do fn() end end
local function from(who,text,channel) fire('CHAT_MSG_ADDON','BFParty',text,channel or 'RAID',who) end
`;

test("messages: a boss and a note, a player and a job; bounded out, strict in", () => lua(PURE + String.raw`
local B,NE,ND,JE,JD=BackstageForeverRaidBoss,BackstageForeverRaidNoteEncode,BackstageForeverRaidNoteDecode,BackstageForeverRaidJobEncode,BackstageForeverRaidJobDecode
assert(B('  Lucifron ')=='Lucifron' and B('Majordomo Executus')=='Majordomo Executus' and B("Kel'Thuzad")=="Kel'Thuzad" and B('Boss: One')=='Boss One')
assert(B('x')==nil and B('')==nil and B(nil)==nil and B('|')==nil and #B(string.rep('b',90))==32)
assert(NE('Lucifron','Decurse the tanks first')=='N|Lucifron|Decurse the tanks first')
assert(NE('Lucifron','')==nil and NE('',' x')==nil and NE(nil,'x')==nil and NE('Lucifron',nil)==nil)
assert(NE('Luci|fron','a|b\nc')=='N|Lucifron|ab c','nothing typed can add a field')
assert(#NE(string.rep('b',90),string.rep('t',900))==2+32+1+120)
local boss,text=ND('N|Lucifron|Decurse the tanks first') assert(boss=='Lucifron' and text=='Decurse the tanks first')
for _,bad in ipairs({'N|Lucifron','N|Lucifron|','N||text','N|Lucifron|a|b','N|L|text','N| Lucifron|text','N|Luci:fron|text','N|Lucifron|text ','N|Lucifron|te\1xt','N|Lucifron|'..string.rep('t',121),
  'N|'..string.rep('b',33)..'|text','NLucifron|text','n|Lucifron|text','',5,nil,'N|Lucifron|'..string.rep('t',300)}) do assert(ND(bad)==nil,tostring(bad)) end
assert(JE('Thrall','dispel the left side')=='J|Thrall|dispel the left side' and JE('Thrall-Realm','x')=='J|Thrall-Realm|x')
assert(JE('Thr4ll','x')==nil and JE('Thrall','')==nil and JE('Thrall',nil)==nil and JE('','x')==nil and #JE('Thrall',string.rep('t',900))==2+6+1+100)
local who,job=JD('J|Thrall|dispel the left side') assert(who=='Thrall' and job=='dispel the left side')
for _,bad in ipairs({'J|Thrall','J|Thrall|','J|Thr4ll|x','J|Two Words|x','J|Thrall|a|b','J|Thrall|'..string.rep('t',101),'J|Thrall|x ','Jx','',nil}) do assert(JD(bad)==nil,tostring(bad)) end
-- What follows "/bf raid note".
local a,b=BackstageForeverRaidNoteArgs('Majordomo Executus: kill the healers first') assert(a=='Majordomo Executus' and b=='kill the healers first')
a,b=BackstageForeverRaidNoteArgs('Lucifron decurse') assert(a=='Lucifron' and b=='decurse')
a,b=BackstageForeverRaidNoteArgs('Lucifron:') assert(a=='Lucifron' and b==nil,'no text: the note is removed')
a,b=BackstageForeverRaidNoteArgs('Lucifron') assert(a=='Lucifron' and b==nil)
assert(BackstageForeverRaidNoteArgs('')==nil and BackstageForeverRaidNoteArgs(': text')==nil and BackstageForeverRaidNoteArgs(nil)==nil and BackstageForeverRaidNoteArgs(string.rep('x',400))==nil)
`));

test("rank, the note list, the note for your target, and the roll-up", () => lua(PURE + String.raw`
local R=BackstageForeverRaidRank
local roster={{name='Lead-Realm',rank=2},{name='Ann',rank=1},{name='Bob',rank=0},{name='Odd',rank=7},'junk'}
assert(R(roster,'Lead')==2 and R(roster,'lead-Other')==2 and R(roster,'Ann')==1 and R(roster,'Bob')==0 and R(roster,'Zed')==nil and R(roster,'Odd')==nil and R(roster,nil)==nil and R(nil,'Ann')==nil and R(roster,'')==nil)
local S,M=BackstageForeverRaidStore,BackstageForeverRaidMatch
local notes={}
assert(S(notes,'Lucifron','decurse',nil,1)=='set' and S(notes,'lucifron','decurse fast','Lead',2)=='set' and #notes==1 and notes[1].text=='decurse fast' and notes[1].from=='Lead','one note per boss')
assert(S(notes,'Magmadar',nil,nil,3)==nil and S(notes,'Magmadar','',nil,3)==nil and S(notes,'x','text',nil,3)==nil and S(nil,'Boss','text',nil,3)==nil and #notes==1)
assert(S(notes,'Lucifron','|',nil,4)==nil and notes[1].text=='decurse fast','a note that cleans to nothing changes nothing')
assert(S(notes,'LUCIFRON',nil,nil,5)=='gone' and #notes==0)
for i=1,14 do S(notes,'Boss '..string.char(64+i),'note '..i,nil,i) end
assert(#notes==BackstageForeverRaidNoteLimit and #notes==10 and notes[1].boss=='Boss E','ten at most, the oldest makes room')
local list={{boss='Majordomo',text='healers first'},{boss='Lucifron',text='decurse'},{boss='Rag',text='too short to match a part'},{boss='Golemagg the Incinerator',text='dogs last'}}
assert(M(list,'Lucifron').text=='decurse' and M(list,'LUCIFRON').text=='decurse' and M(list,'Majordomo Executus').text=='healers first')
assert(M(list,'Golemagg the Incinerator').text=='dogs last' and M(list,'Golemagg')==nil,'the target name must hold the note name, not the other way round')
assert(M(list,'Ragnaros')==nil and M(list,'Wolf')==nil and M(list,'')==nil and M(list,nil)==nil and M(nil,'Lucifron')==nil)
local lines=BackstageForeverRaidNoteLines({{boss='Lucifron',text='decurse'}},{{boss='Magmadar',text='tranq shot',from='Lead'}})
assert(#lines==3 and lines[1]=='Raid notes: 2.' and lines[2]=='  Lucifron: decurse' and lines[3]=='  Magmadar: tranq shot (Lead)')
assert(BackstageForeverRaidNoteLines({},{})[1]:find('No raid notes yet',1,true))
local D=BackstageForeverCheckDecode
local members={'Ann','Bob','Cy','Dee'}
lines=BackstageForeverRaidRollup(members,{Ann=D('A|-|-|-|80|12|0'),Bob=D('A|-|-|-|22|3|2'),Cy=D('A|-|-|-|-|-|-')})
assert(lines[1]=='Raid readiness: 3 of 4 answered.' and lines[2]=='  Class kit items low: Bob 2.' and lines[3]=='  Most worn gear under 30%: Bob 22%.' and lines[4]=='  Fewer than 5 bag slots free: Bob 3.',lines[3])
assert(#lines==5 and lines[5]=='  No answer from 1 (no addon, raid comms off, or answers off).')
lines=BackstageForeverRaidRollup({'Ann'},{Ann=D('A|-|-|-|80|12|0')}) assert(#lines==2 and lines[2]:find('stocked, repaired and has bag space',1,true))
local forty,answers={},{} for i=1,40 do forty[i]='P'..string.char(64+math.floor(i/26))..string.char(65+i%26) answers[forty[i]]=D('A|-|-|-|10|0|3') end
lines=BackstageForeverRaidRollup(forty,answers)
assert(lines[1]=='Raid readiness: 40 of 40 answered.' and #lines==4 and lines[2]:find(' +32.',1,true) and #lines[2]<200,'bounded: '..lines[2])
lines=BackstageForeverRaidRollup({},{}) assert(#lines==1 and lines[1]=='Raid readiness: 0 of 0 answered.')
`));

test("in game: off until switched on; notes and jobs only from the leader or an assistant; one line on target", () => lua(STUBS + FILES + String.raw`
fire('PLAYER_LOGIN')
-- Off by default: nothing is read, nothing is sent, even from the leader.
assert(BackstageForeverRaidOn()==false)
from('Lead-Realm','N|Lucifron|decurse') from('Lead-Realm','J|Me|tank') from('Lead-Realm','K?')
assert(#sent==0 and #BackstageForeverRaidNotes==0)
BackstageForeverRaidCommand('raid') assert(said[#said-1]:find('Raid comms are off',1,true))
BackstageForeverRaidCommand('raid check') assert(#sent==0 and last():find('Raid comms are off',1,true))
BackstageForeverRaidCommand('raid on') assert(BackstageForeverRaidOn()==true and last():find('Raid comms: on',1,true))
-- Notes: from the leader and the assistant, never from a member or someone outside the roster.
from('Lead-Realm','N|Lucifron|decurse the tanks') from('Ann','N|Magmadar|tranq shot on frenzy')
from('Bob','N|Gehennas|member note') from('Zed','N|Garr|outsider') from('Lead-Realm','N|Bad') from('Lead-Realm','N|Shazzrah|a|b')
assert(#BackstageForeverRaidNotes==2 and BackstageForeverRaidNotes[1].from=='Lead' and BackstageForeverRaidNotes[2].boss=='Magmadar')
-- Not on the raid channel: ignored. (PARTY needs party sync and is not a raid note anyway.)
from('Lead-Realm','N|Garr|wrong channel','PARTY') from('Lead-Realm','N|Garr|wrong channel','GUILD') from('Lead-Realm','N|Garr|wrong channel','WHISPER')
assert(#BackstageForeverRaidNotes==2)
-- A flood from one player stops at twenty notes a minute; the list never grows past ten.
for i=1,60 do from('Ann','N|Boss '..string.char(65+i%26)..string.char(65+math.floor(i/26))..'|x') end
assert(#BackstageForeverRaidNotes==10)
clock=1100 from('Lead-Realm','N|Lucifron|decurse the tanks') from('Lead-Realm','N|Majordomo|healers first')
-- Target the boss: one line, quiet in combat, not again for two minutes.
said={} target='Lucifron' fire('PLAYER_TARGET_CHANGED')
assert(#said==1 and said[1]=='Backstage Forever: Raid note for Lucifron: decurse the tanks',said[1])
fire('PLAYER_TARGET_CHANGED') assert(#said==1)
target='Majordomo Executus' combat=true fire('PLAYER_TARGET_CHANGED') assert(#said==1,'quiet in combat')
combat=false fire('PLAYER_TARGET_CHANGED') assert(#said==2 and said[2]=='Backstage Forever: Raid note for Majordomo: healers first')
target='A Wolf' fire('PLAYER_TARGET_CHANGED') target=nil fire('PLAYER_TARGET_CHANGED') assert(#said==2)
clock=1300 target='Lucifron' fire('PLAYER_TARGET_CHANGED') assert(#said==3)
-- Assignments: only yours, only from a leader or assistant, shown after combat when given in a fight.
said={} from('Lead-Realm','J|Bob|not for me') from('Bob','J|Me|from a member') from('Zed','J|Me|from outside') from('Ann','J|Me')
assert(#said==0)
from('Ann','J|Me|dispel the left side') assert(#said==1 and said[1]=='Backstage Forever: Your job: dispel the left side (from Ann)')
from('Ann','J|Me|spam') assert(#said==1,'at most one every three seconds from a player')
clock=1310 combat=true from('Lead-Realm','J|me|kite the adds') assert(#said==1) combat=false fire('PLAYER_REGEN_ENABLED')
assert(#said==2 and said[2]=='Backstage Forever: Your job: kite the adds (from Lead)')
-- A readiness question from the leader: one short status on the raid channel, at most every 30 seconds; a member cannot ask.
from('Bob','K?') assert(#sent==0)
from('Lead-Realm','K?') assert(#sent==1 and sent[1][3]=='RAID' and sent[1][2]=='A|-|-|-|20|3|2',sent[1] and sent[1][2])
from('Ann','K?') assert(#sent==1) from('Lead-Realm','K?extra') assert(#sent==1)
BackstageForeverPartySettings={answerChecks=false} clock=1400 from('Lead-Realm','K?') assert(#sent==1,'answers off covers the raid too')
BackstageForeverPartySettings.answerChecks=true
-- As a member you cannot write notes, assign or ask.
BackstageForeverRaidCommand('raid note Garr: banish') assert(#sent==1 and last():find('Only the raid leader or an assistant',1,true))
BackstageForeverRaidCommand('raid assign Bob tank') assert(#sent==1 and last():find('Only the raid leader or an assistant',1,true))
BackstageForeverRaidCommand('raid check') assert(#sent==1)
said={} BackstageForeverRaidCommand('raid notes') assert(said[1]:find('Raid notes: 10.',1,true) and #said==11)
-- Leaving the raid forgets what others sent; off does too.
raid=false fire('GROUP_ROSTER_UPDATE') assert(#BackstageForeverRaidNotes==0)
from('Lead-Realm','N|Lucifron|not in a raid') assert(#BackstageForeverRaidNotes==0)
`));

test("in game as an assistant: notes are saved and shared, assignments reach one player, the roll-up counts answers", () => lua(STUBS + FILES + String.raw`
fire('PLAYER_LOGIN') myRank=1
BackstageForeverRaidCommand('raid on')
BackstageForeverRaidCommand('raid note Lucifron: decurse the tanks first')
assert(#sent==1 and sent[1][1]=='BFParty' and sent[1][3]=='RAID' and sent[1][2]=='N|Lucifron|decurse the tanks first',sent[1] and sent[1][2])
assert(#BackstageForeverRaidSettings.notes==1 and said[#said]:find('Raid note for Lucifron saved',1,true))
BackstageForeverRaidCommand('raid note Magmadar tranq') assert(#sent==1 and last():find('one a second',1,true) and #BackstageForeverRaidSettings.notes==2,'saved, sent later')
BackstageForeverRaidCommand('raid note') assert(last():find('Use /bf raid note Boss: text',1,true))
BackstageForeverRaidCommand('raid note Garr:') assert(last():find('Write a short note',1,true))
BackstageForeverRaidCommand('raid note Magmadar:') assert(#BackstageForeverRaidSettings.notes==1 and last()=='Backstage Forever: Raid note for Magmadar removed.')
-- Your own note shows on target too.
said={} target='Lucifron' fire('PLAYER_TARGET_CHANGED') assert(said[1]=='Backstage Forever: Raid note for Lucifron: decurse the tanks first')
-- Share again: every note of yours, at most every 30 seconds.
clock=1010 sent={} BackstageForeverRaidCommand('raid note Garr: banish two')
BackstageForeverRaidCommand('raid notes share') assert(#sent==3 and last()=='Backstage Forever: Shared 2 raid notes with your raid.')
BackstageForeverRaidCommand('raid notes share') assert(#sent==3 and last():find('a moment ago',1,true))
-- Assign: the player must be in the raid and the name clean.
sent={} clock=1020
BackstageForeverRaidCommand('raid assign Zed tank') assert(#sent==0 and last():find('not in your raid',1,true))
BackstageForeverRaidCommand('raid assign B0b tank') assert(#sent==0 and last():find('Use /bf raid assign Player text',1,true))
BackstageForeverRaidCommand('raid assign Bob') assert(#sent==0)
BackstageForeverRaidCommand('raid assign Bob dispel the |cffff0000left|r side')
assert(#sent==1 and sent[1][2]=='J|Bob|dispel the left side' and last():find('Assignment sent to Bob: dispel the left side',1,true),sent[1] and sent[1][2])
BackstageForeverRaidCommand('raid assign Cy heal') assert(#sent==1 and last():find('Wait a few seconds',1,true))
-- The roll-up: asked once, answers only from raid members, lines after a few seconds.
sent={} said={} clock=1100
BackstageForeverRaidCommand('raid check') assert(#sent==1 and sent[1][2]=='K?' and sent[1][3]=='RAID' and last():find('The roll-up follows',1,true))
from('Bob','A|-|-|-|22|3|2') from('Cy','A|-|-|-|90|20|0') from('Zed','A|-|-|-|1|0|9') from('Ann','A|sm|1|1|50|5|0') from('Lead-Realm','A|-|-|-|10|1')
runTimers()
assert(said[#said-4]=='Backstage Forever: Raid readiness: 2 of 4 answered.',said[#said-4])
assert(said[#said-3]=='Backstage Forever:   Class kit items low: Bob 2.' and said[#said-2]=='Backstage Forever:   Most worn gear under 30%: Bob 22%.' and said[#said-1]=='Backstage Forever:   Fewer than 5 bag slots free: Bob 3.')
assert(last()=='Backstage Forever:   No answer from 2 (no addon, raid comms off, or answers off).')
BackstageForeverRaidCommand('raid check') assert(#sent==1 and last():find('a moment ago',1,true))
-- Outside a raid a note is kept for later and nothing is sent; off sends nothing either.
raid=false sent={} BackstageForeverRaidCommand('raid note Onyxia: stay out of the whelps')
assert(#sent==0 and last():find('kept for later',1,true) and #BackstageForeverRaidSettings.notes==3)
BackstageForeverRaidCommand('raid assign Bob tank') assert(#sent==0 and last():find('Join a raid first',1,true))
raid=true BackstageForeverRaidCommand('raid off') clock=1200 BackstageForeverRaidCommand('raid note Onyxia: deep breath')
assert(#sent==0 and last():find('Raid comms are off, so the note is not shared',1,true))
assert(BackstageForeverPartySend('N|x|y','RAID')==false,'the channel itself refuses while the switch is off')
-- Saved notes are checked again when read back, and clear forgets them.
BackstageForeverRaidCommand('raid clear') assert(#BackstageForeverRaidSettings.notes==0)
`));

test("party sync is unchanged: it never sends to a raid, and raid letters do nothing on the party channel", () => lua(STUBS + FILES + String.raw`
fire('PLAYER_LOGIN') myRank=2
assert(BackstageForeverPartySend('Chello')==false,'in a raid the party channel stays silent')
BackstageForeverRaidCommand('raid on')
assert(BackstageForeverPartySend('Chello')==false and BackstageForeverPartySend('N|Boss|text','RAID')==true and sent[1][3]=='RAID')
assert(BackstageForeverPartySend(string.rep('x',256),'RAID')==false and BackstageForeverPartySend('','RAID')==false)
raid=false assert(BackstageForeverPartySend('N|Boss|text','RAID')==false,'not in a raid')
-- A party readiness question that arrives on the raid channel is not answered by the party handler.
raid=true sent={} from('Lead-Realm','C|sm','RAID') from('Lead-Realm','M|ask|Me','RAID') from('Lead-Realm','S|1|1/1|Me=Sword','RAID')
assert(#sent==0)
`));

test("wiring: file listed after its channel code, command routed and catalogued, the switch off by default, no timers", () => {
  const { ADDON_FILES } = require("../src/core/game-sync.cjs");
  assert.ok(ADDON_FILES.includes("BackstageForeverRaid.lua"));
  const toc = read("addon/BackstageForever/BackstageForever.toc").split(/\r?\n/);
  assert.ok(toc.indexOf("BackstageForeverRaid.lua") > toc.indexOf("BackstageForeverCrew.lua") && toc.indexOf("BackstageForeverCrew.lua") > toc.indexOf("BackstageForeverParty.lua"));
  assert.match(toc.join("\n"), /^## SavedVariablesPerCharacter:.*\bBackstageForeverRaidSettings\b/m);
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /word=='raid' then\s+if type\(BackstageForeverRaidCommand\)=='function' then pcall\(BackstageForeverRaidCommand,message\)end/);
  assert.match(read("addon/BackstageForever/BackstageForeverOptions.lua"), /switch\('Raid comms',[^\n]*off\('BackstageForeverRaidSettings','enabled'\),'raid'\)/);
  const source = read("addon/BackstageForever/BackstageForeverRaid.lua");
  assert.doesNotMatch(source, /SendChatMessage|NewTicker|OnUpdate|PlaySound|RaidNotice|:Click\(/, "text lines only: no timers, no sounds, no raid warnings, nothing sent to chat");
  assert.equal((source.match(/C_Timer/g) || []).length, 1, "one delay: printing the roll-up you asked for");
  const party = read("addon/BackstageForever/BackstageForeverParty.lua");
  assert.match(party, /elseif channel=='RAID' then\s+if not raidOn\(\) or call\(IsInRaid\)~=true then return false end/);
  assert.match(party, /if channel=='RAID' then[^\n]*\n[^\n]*\n\s+if not raidOn\(\) or call\(IsInRaid\)~=true then return end/);
});
