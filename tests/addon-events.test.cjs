"use strict";
// Guild events and sign-ups (roadmap "Social and guild"): the messages, who may change what,
// the merge every addon ends up agreeing on, expiry and history, the time handling around clock
// changes, matching a run to its event, the saved block for the desktop app, and the live flow
// over the guild channel behind its own switch (off by default).
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const PURE = "dofile('addon/BackstageForever/BackstageForeverEvents.lua')\n";
const FILES = "dofile('addon/BackstageForever/BackstageForeverParty.lua')\ndofile('addon/BackstageForever/BackstageForeverLfg.lua')\ndofile('addon/BackstageForever/BackstageForeverCrew.lua')\ndofile('addon/BackstageForever/BackstageForeverWish.lua')\ndofile('addon/BackstageForever/BackstageForeverGuild.lua')\ndofile('addon/BackstageForever/BackstageForeverPanels.lua')\n" + PURE;
const HEAD = String.raw`
local NOW=1795000000
local function ctx(extra) local c={now=NOW,rand=7,dungeons={mc=true,brd=true,ubrs=true}} for k,v in pairs(extra or {}) do c[k]=v end return c end
local function event(over) local e={id='abc123',ver=1,creator='Anna',at=NOW+86400,dungeon='mc',roles={t=2,h=4,d=14},title='Molten Core',note='Bring fire resist'} for k,v in pairs(over or {}) do e[k]=v end return e end
`;
// A guild of five in the game's list: Lead is the guild leader (rank 0), Ann an officer (1), the rest members (4).
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end} end
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local sent={}
C_ChatInfo={RegisterAddonMessagePrefix=function() end,SendAddonMessage=function(p,t,ch) sent[#sent+1]={p,t,ch} end}
local clock=1000 GetTime=function() return clock end
local NOW=1795000000
local wall=NOW
time=function(t) if t then return os.time(t) end return wall end
date=os.date
local combat=false InCombatLockdown=function() return combat end
local inGuild=true IsInGuild=function() return inGuild end
IsInGroup=function() return false end IsInRaid=function() return false end
local me='Me'
UnitName=function(u) if u=='player' then return me end end
Ambiguate=function(n) return (n:gsub('%-.*$','')) end
GetGuildInfo=function() return 'Night Watch' end
local guild={{'Lead-Realm',0,'WARRIOR'},{'Ann-Realm',1,'PRIEST'},{'Bob-Realm',4,'MAGE'},{'Cy-Realm',4,'ROGUE'},{'Me-Realm',4,'HUNTER'}}
GetNumGuildMembers=function() return #guild end
GetGuildRosterInfo=function(i) local r=guild[i] if not r then return nil end return r[1],'rank',r[2],60,'Class','Zone','','',true,0,r[3] end
local after={} C_Timer={After=function(s,fn) after[#after+1]=fn end,NewTicker=function() end}
local function runAfter() local t=after after={} for _,fn in ipairs(t) do fn() end end
math.random=function() return 0.5 end
local function from(who,text,channel) fire('CHAT_MSG_ADDON','BFParty',text,channel or 'GUILD',who) end
local function pumpAll() for i=1,80 do BackstageForeverEventsPump() end end
local function texts(prefix) local out={} for _,m in ipairs(sent) do if m[2]:sub(1,#prefix)==prefix then out[#out+1]=m[2] end end return out end
BackstageForeverAtlasData={{'mc','Molten Core','r',60,60,'B',1427,.35,.84,{},{}},{'brd','Blackrock Depths','d',52,60,'B',1427,.35,.84,{},{}}}
`;

test("text is plain: colour and link codes go, a web address refuses the whole text", () => lua(PURE + String.raw`
local X=BackstageForeverEventText
assert(X('  Molten  Core ',40)=='Molten Core' and X('|cffff0000Red|r run',40)=='Red run' and X('|Hitem:1:0|h[Sword]|h night',40)=='[Sword] night')
assert(X('a|b\nc',40)=='a b c' and X('',40)==nil and X(nil,40)==nil and X(5,40)==nil and X('   ',40)==nil)
assert(#X(string.rep('t',90),40)==40 and X('caf'..string.rep('\195\169',30),40):sub(-1)=='\169' and #X('caf'..string.rep('\195\169',30),40)==39,'cut on a whole letter')
for _,bad in ipairs({'join https://x.y/z','see www.site.example','discord.gg/abc','buy gold at cheapgold.com now','visit shop.net','my.org today','stream on a.tv'}) do assert(X(bad,80)==nil,bad) end
for _,fine in ipairs({'MC at 8. Bring pots','Dr. Weavil later','Ony, then UBRS','v2.0 of the plan'}) do assert(X(fine,80)==fine,fine) end
assert(BackstageForeverEventLinky('HTTP://X') and not BackstageForeverEventLinky('plain') and not BackstageForeverEventLinky(nil))
`));

test("messages: one event in at most 255 bytes, strict on the way in", () => lua(PURE + HEAD + String.raw`
local E,D=BackstageForeverEventEncode,BackstageForeverEventDecode
local m=E(event()) assert(m=='E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten Core|Bring fire resist',m)
local e=D(m,NOW) assert(e.id=='abc123' and e.ver==1 and e.creator=='Anna' and e.editor==nil and e.at==NOW+86400 and e.dungeon=='mc' and e.roles.t==2 and e.roles.h==4 and e.roles.d==14 and e.title=='Molten Core' and e.note=='Bring fire resist' and e.cancelled==nil)
assert(E(event({note=false,editor='Bob-Realm',cancelled=true,ver=12}))==nil,'a note must be text')
local plainEvent=event({editor='Bob-Realm',cancelled=true,ver=12}) plainEvent.note=nil
m=E(plainEvent) assert(m=='E|abc123|12|Anna|Bob-Realm|1795086400|mc|2.4.14|x|Molten Core|-',m)
e=D(m,NOW) assert(e.editor=='Bob-Realm' and e.cancelled==true and e.note==nil and e.ver==12)
-- The longest allowed fields still fit; a long note is cut, never the message.
local long=E(event({creator=string.rep('n',24)..'-'..string.rep('r',23),editor=string.rep('m',24)..'-'..string.rep('q',23),title=string.rep('t',40),note=string.rep('n',80),ver=9999,id='abcdefghij',dungeon='stocksxx',roles={t=9,h=9,d=40}}))
assert(long and #long<=255,long and #long) assert(D(long,NOW),'and what was sent reads back')
assert(#E(event({title=string.rep('t',90),note=string.rep('n',300)}))==#('E|abc123|1|Anna|-|1795086400|mc|2.4.14|-||')+40+80)
-- Nothing typed can add a field.
assert(E(event({title='a|b|c',note='x|y'}))=='E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|a b c|x y')
for _,bad in ipairs({{id='AB'},{id='abc'},{id='abcdefghijk'},{ver=0},{ver=10000},{ver=1.5},{creator='An na'},{creator='Ann4'},{creator='A'},{at=5},{dungeon='MC'},{dungeon='9mc'},{dungeon='toolongname'},
  {roles={t=10,h=0,d=0}},{roles={t=0,h=-1,d=0}},{roles={t=0,h=0,d=41}},{roles={}},{title='x'},{title=''},{title='see www.x.y'},{note='http://x.y'}}) do assert(E(event(bad))==nil,next(bad)) end
local good='E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten Core|Bring fire resist'
for _,bad in ipairs({'E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten Core','E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten Core|a|b','E|abc123|01|Anna|-|1795086400|mc|2.4.14|-|Molten Core|-',
  'E|abc123|0|Anna|-|1795086400|mc|2.4.14|-|Molten Core|-','E|abc123|10000|Anna|-|1795086400|mc|2.4.14|-|Molten Core|-','E|ABC123|1|Anna|-|1795086400|mc|2.4.14|-|Molten Core|-',
  'E|abc123|1|An na|-|1795086400|mc|2.4.14|-|Molten Core|-','E|abc123|1|Anna|Anna|1795086400|mc|2.4.14|-|Molten Core|-','E|abc123|1|Anna|B0b|1795086400|mc|2.4.14|-|Molten Core|-',
  'E|abc123|1|Anna|-|179508640|mc|2.4.14|-|Molten Core|-','E|abc123|1|Anna|-|17950864000|mc|2.4.14|-|Molten Core|-','E|abc123|1|Anna|-|1795086400|MC|2.4.14|-|Molten Core|-',
  'E|abc123|1|Anna|-|1795086400|mc|2.4.41|-|Molten Core|-','E|abc123|1|Anna|-|1795086400|mc|2.4.07|-|Molten Core|-','E|abc123|1|Anna|-|1795086400|mc|2.4|-|Molten Core|-',
  'E|abc123|1|Anna|-|1795086400|mc|2.4.14|y|Molten Core|-','E|abc123|1|Anna|-|1795086400|mc|2.4.14|-| Molten Core|-','E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten  Core|-',
  'E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten Core|note ','E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten\1Core|-','E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|M|-',
  'E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|'..string.rep('t',41)..'|-','E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten Core|'..string.rep('n',81),
  'E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|go to www.gold.example|-','E|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten Core|https://x.y','e|abc123|1|Anna|-|1795086400|mc|2.4.14|-|Molten Core|-',
  good..string.rep('x',200),'',5,nil}) do assert(D(bad,NOW)==nil,tostring(bad)) end
assert(D(good,NOW) and D(good,nil),'the good one reads')
-- Time: nothing that is over, nothing more than half a year ahead.
assert(D('E|abc123|1|Anna|-|'..(NOW-4*3600)..'|mc|2.4.14|-|Molten Core|-',NOW) and not D('E|abc123|1|Anna|-|'..(NOW-4*3600-1)..'|mc|2.4.14|-|Molten Core|-',NOW))
assert(D('E|abc123|1|Anna|-|'..(NOW+180*86400)..'|mc|2.4.14|-|Molten Core|-',NOW) and not D('E|abc123|1|Anna|-|'..(NOW+180*86400+1)..'|mc|2.4.14|-|Molten Core|-',NOW))
`));

test("messages: a sign-up, the creator's list and the guild leader's rules", () => lua(PURE + HEAD + String.raw`
local SE,SD=BackstageForeverEventSignEncode,BackstageForeverEventSignDecode
assert(SE('abc123',3,'t')=='U|abc123|3|t' and SE('abc123',1,'x')==nil and SE('ABC',1,'t')==nil and SE('abc123',0,'t')==nil and SE('abc123',10000,'t')==nil)
local id,ver,s=SD('U|abc123|3|h') assert(id=='abc123' and ver==3 and s=='h')
for _,bad in ipairs({'U|abc123|3','U|abc123|3|x','U|abc123|03|t','U|abc123|0|t','U|abc|3|t','U|abc123|3|t|','U|abc123|99999|t','u|abc123|3|t','',nil,7}) do assert(SD(bad)==nil,tostring(bad)) end
-- The creator's list, in name order, cut into messages of at most 255 bytes.
local e=event({signups={Zed={s='d',v=2},Ann={s='t',v=1},['Bob-Realm']={s='m',v=9}}})
local list=BackstageForeverEventRosterEncode(e) assert(#list==1 and list[1]=='L|abc123|Ann:t:1,Bob-Realm:m:9,Zed:d:2',list[1])
local rid,rows=BackstageForeverEventRosterDecode(list[1]) assert(rid=='abc123' and #rows==3 and rows[2].n=='Bob-Realm' and rows[2].s=='m' and rows[2].v==9)
local many={signups={}} for i=1,40 do many.signups['Member'..string.char(96+math.floor((i-1)/26)+1)..string.char(97+(i-1)%26)]={s='d',v=i} end many.id='abc123'
local chunks=BackstageForeverEventRosterEncode(many) assert(#chunks==4,'forty names, twelve a message: '..#chunks)
local total=0 for _,c in ipairs(chunks) do assert(#c<=255) local _,r=BackstageForeverEventRosterDecode(c) total=total+#r end assert(total==40)
assert(#BackstageForeverEventRosterEncode(many,2)==2 and #BackstageForeverEventRosterEncode({id='abc123',signups={}})==0 and #BackstageForeverEventRosterEncode(nil)==0)
for _,bad in ipairs({'L|abc123|','L|abc123|Ann:t','L|abc123|Ann:x:1','L|abc123|Ann:t:1,','L|abc123|,Ann:t:1','L|abc123|Ann:t:1,,Bob:t:1','L|abc123|Ann:t:1,ann:h:2','L|abc123|An4:t:1','L|abc123|Ann:t:01',
  'L|ABC|Ann:t:1','L|abc123|Ann:t:1|x','L|abc123|'..string.rep('Abcdefgh:t:1,',12)..'Last:t:1','',nil}) do assert(BackstageForeverEventRosterDecode(bad)==nil,tostring(bad)) end
-- The rules.
local PE,PD=BackstageForeverEventPolicyEncode,BackstageForeverEventPolicyDecode
assert(PE({ver=1})=='P|1|-|-' and PE({ver=4,propose=2,edit=1})=='P|4|2|1' and PE({ver=0})==nil and PE({ver=1,propose=10})==nil and PE({ver=1,edit=-1})==nil and PE(nil)==nil)
local p=PD('P|4|2|1') assert(p.ver==4 and p.propose==2 and p.edit==1) p=PD('P|1|-|-') assert(p.ver==1 and p.propose==nil and p.edit==nil)
for _,bad in ipairs({'P|0|-|-','P|1|10|-','P|1|-','P|1|-|-|-','P|01|-|-','P|1|a|-','p|1|-|-','',nil}) do assert(PD(bad)==nil,tostring(bad)) end
local A=BackstageForeverEventAllowed
assert(A(nil,'propose',nil) and A({},'propose',9) and not A({},'edit',0),'by default anyone proposes and only the creator edits')
assert(A({propose=2},'propose',2) and A({propose=2},'propose',0) and not A({propose=2},'propose',3) and not A({propose=2},'propose',nil),'a rank that is not known is not let in')
assert(A({edit=1},'edit',1) and A({edit=1},'edit',0) and not A({edit=1},'edit',2) and not A({edit=1},'edit',nil) and not A({edit=1},'other',0))
`));

test("merge: the creator's word counts, hearsay only introduces, the higher version wins, ties end the same everywhere", () => lua(PURE + HEAD + String.raw`
local M=BackstageForeverEventMerge
local db={}
assert(M(db,event(),'Anna',ctx())=='new' and db.events.abc123.title=='Molten Core' and db.events.abc123.relayed==nil)
assert(M(db,event(),'Anna',ctx())==nil,'the same again changes nothing')
assert(M(db,event({ver=2,title='Molten Core 8pm'}),'Anna',ctx())=='changed' and db.events.abc123.title=='Molten Core 8pm')
assert(M(db,event({ver=1,title='Old'}),'Anna',ctx())==nil and db.events.abc123.title=='Molten Core 8pm','an older version loses')
-- Somebody else cannot change a known event, by a copy or under their own name.
assert(M(db,event({ver=9,title='Hijacked'}),'Mallory',ctx())==nil and db.events.abc123.title=='Molten Core 8pm','a copy never changes what the creator said')
assert(M(db,event({ver=9,title='Hijacked',editor='Mallory'}),'Mallory',ctx())==nil,'only the creator edits by default')
assert(M(db,event({ver=9,title='Hijacked',cancelled=true}),'Mallory',ctx())==nil and not db.events.abc123.cancelled)
assert(M(db,event({ver=9,creator='Mallory'}),'Mallory',ctx())==nil,'nor take the event over: the creator of an id never changes')
-- Sign-ups, who was there and loot survive an edit.
db.events.abc123.signups={Bob={s='t',v=1}} db.events.abc123.present={'Bob'} db.events.abc123.reminded=true
assert(M(db,event({ver=3,title='Molten Core 8pm'}),'Anna',ctx())=='changed')
assert(db.events.abc123.signups.Bob.s=='t' and db.events.abc123.present[1]=='Bob' and db.events.abc123.reminded==true)
assert(M(db,event({ver=4,at=NOW+2*86400}),'Anna',ctx())=='changed' and db.events.abc123.reminded==nil,'a new time reminds again')
assert(M(db,event({ver=5,cancelled=true}),'Anna',ctx())=='cancelled' and db.events.abc123.cancelled==true)
assert(M(db,event({ver=5,cancelled=true}),'Anna',ctx())==nil)
-- A copy passed on by another member: taken only for an event you did not know, and marked.
local other={}
assert(M(other,event(),'Bob',ctx())=='new' and other.events.abc123.relayed=='Bob')
assert(M(other,event({ver=2,title='Copy two'}),'Cy',ctx())=='changed' and other.events.abc123.relayed=='Cy','a newer copy replaces an older copy')
assert(M(other,event({ver=2,title='Copy again'}),'Bob',ctx())==nil)
-- Its creator speaks: that replaces the copy, even one that claimed a higher version.
assert(M(other,event({ver=9,title='Forged',cancelled=true}),'Mallory',ctx()) and other.events.abc123.cancelled)
assert(M(other,event({ver=2,title='Molten Core'}),'Anna',ctx())=='new' and other.events.abc123.relayed==nil and other.events.abc123.title=='Molten Core' and not other.events.abc123.cancelled)
assert(M(other,event({ver=7,title='Forged again'}),'Mallory',ctx())==nil,'and from then on copies are ignored')
-- The same copy confirmed by its creator is no news.
local quiet={} M(quiet,event(),'Bob',ctx()) assert(M(quiet,event(),'Anna',ctx())=='quiet' and quiet.events.abc123.relayed==nil)
-- The guild leader's rules: who may propose, and a rank that may edit other members' events.
local ranks={Anna=4,Offi=1,Lead=0}
local ruled={policy={ver=1,propose=1,edit=1}}
local rank=function(name) return ranks[name] end
assert(M(ruled,event(),'Anna',ctx({rank=rank}))==nil,'her rank may not propose')
assert(M(ruled,event({creator='Offi'}),'Offi',ctx({rank=rank}))=='new')
assert(M(ruled,event({creator='Ghost'}),'Ghost',ctx({rank=rank}))==nil,'a rank the guild list does not show is not let in')
assert(M(ruled,event({creator='Offi',id='copy01'}),'Anna',ctx({rank=rank}))=='new','a copy of an allowed creator is fine')
assert(M(ruled,event({creator='Anna',id='copy02'}),'Offi',ctx({rank=rank}))==nil,'a copy of somebody who may not propose is not')
assert(M(ruled,event({creator='Offi',editor='Lead',ver=2,title='Moved by the leader'}),'Lead',ctx({rank=rank}))=='changed' and ruled.events.abc123.editor=='Lead')
assert(M(ruled,event({creator='Offi',editor='Anna',ver=3,title='No'}),'Anna',ctx({rank=rank}))==nil)
assert(M(ruled,event({creator='Offi',editor='Lead',ver=3,title='No'}),'Anna',ctx({rank=rank}))==nil,'an edit under another name is a copy, and copies do not edit')
-- Two allowed edits with the same version: the later name wins, whichever arrives first.
local a,b={policy={ver=1,edit=1}},{policy={ver=1,edit=1}}
for _,d in ipairs({a,b}) do M(d,event({creator='Offi'}),'Offi',ctx({rank=rank})) end
local byLead,byOffi=event({creator='Offi',editor='Lead',ver=2,title='Lead says'}),event({creator='Offi',ver=2,title='Offi says'})
M(a,byLead,'Lead',ctx({rank=rank})) M(a,byOffi,'Offi',ctx({rank=rank}))
M(b,byOffi,'Offi',ctx({rank=rank})) M(b,byLead,'Lead',ctx({rank=rank}))
assert(a.events.abc123.title=='Offi says' and b.events.abc123.title=='Offi says','both ends agree: '..a.events.abc123.title..' / '..b.events.abc123.title)
-- Bounded: twenty events, five per creator; what is over or too far ahead is refused.
local full={}
for i=1,20 do assert(M(full,event({id='event'..string.format('%02d',i),creator='Member'..string.char(96+math.ceil(i/5)),at=NOW+i*3600}),'Member'..string.char(96+math.ceil(i/5)),ctx())=='new',i) end
assert(M(full,event({id='event21',creator='Zoe'}),'Zoe',ctx())==nil,'the list is full')
local five={} for i=1,5 do M(five,event({id='mine0'..i}),'Anna',ctx()) end
assert(M(five,event({id='mine06'}),'Anna',ctx())==nil and M(five,event({id='mine06',cancelled=true}),'Anna',ctx())=='quiet','a sixth is refused; a called-off one is only remembered')
assert(M({},event({at=NOW-4*3600-1}),'Anna',ctx())==nil and M({},event({at=NOW+181*86400}),'Anna',ctx())==nil)
assert(M({},event(),'An na',ctx())==nil and M({},event(),nil,ctx())==nil and M({},event({title=' padded'}),'Anna',ctx())==nil and M(nil,event(),'Anna',ctx())==nil and M({},event(),'Anna',{})==nil)
-- When the list is full, events that are over make room first.
local stale={} for i=1,20 do M(stale,event({id='old0'..string.format('%02d',i),creator='Member'..string.char(96+math.ceil(i/5)),at=NOW+60}),'Member'..string.char(96+math.ceil(i/5)),ctx()) end
assert(M(stale,event({id='fresh01',creator='Zoe',at=NOW+6*3600}),'Zoe',ctx({now=NOW+5*3600}))=='new' and #stale.past==20)
`));

test("sign-ups: you speak for yourself, the creator may pass answers on, the higher version wins", () => lua(PURE + HEAD + String.raw`
local S=BackstageForeverEventSign
local db={} BackstageForeverEventMerge(db,event(),'Anna',ctx())
local e=db.events.abc123
assert(S(db,'abc123','Bob','t',1,'Bob',NOW) and e.signups.Bob.s=='t' and e.signups.Bob.r==nil)
assert(not S(db,'abc123','Bob','t',1,'Bob',NOW) and not S(db,'abc123','Bob','h',1,'Bob',NOW),'the same version again is ignored')
assert(S(db,'abc123','Bob','h',2,'Bob',NOW) and e.signups.Bob.s=='h')
assert(not S(db,'abc123','Bob','n',9,'Mallory',NOW) and e.signups.Bob.s=='h','nobody else answers for Bob')
assert(not S(db,'abc123','Bob','n',2,'Anna',NOW) and S(db,'abc123','Bob','m',3,'Anna',NOW) and e.signups.Bob.r==true,'the creator may pass on a newer answer')
assert(S(db,'abc123','Bob','d',3,'Bob',NOW) and e.signups.Bob.s=='d' and e.signups.Bob.r==nil,'what Bob says himself replaces what was passed on')
assert(S(db,'abc123','bob','n',4,'BOB',NOW) and e.signups.Bob.s=='n' and e.signups.bob==nil,'one row per member, however the name is written')
assert(S(db,'abc123','Cy','t',1,'Anna',NOW) and e.signups.Cy.r==true)
for _,bad in ipairs({{'nope12','Dee','t',1,'Dee'},{'abc123','De4','t',1,'De4'},{'abc123','Dee','x',1,'Dee'},{'abc123','Dee','t',0,'Dee'},{'abc123','Dee','t',1.5,'Dee'},{'abc123','Dee','t',1,nil}}) do
  assert(not S(db,bad[1],bad[2],bad[3],bad[4],bad[5],NOW),bad[2]) end
assert(not S(db,'abc123','Dee','t',1,'Dee',e.at+4*3600+1),'not after the event is over')
-- Forty sign-ups an event.
for i=1,38 do assert(S(db,'abc123','Member'..string.char(96+math.floor((i-1)/26)+1)..string.char(97+(i-1)%26),'d',1,'Anna',NOW),i) end
assert(not S(db,'abc123','Late','d',1,'Late',NOW) and S(db,'abc123','Cy','h',2,'Cy',NOW),'full: no new name, but an answer can still change')
local c=BackstageForeverEventCounts(e) assert(c.t==0 and c.h==1 and c.d==38 and c.m==0 and c.n==1)
local names,n=BackstageForeverEventNames(e,'h') assert(names=='Cy' and n==1)
-- A called-off event takes no sign-ups.
BackstageForeverEventMerge(db,event({ver=2,cancelled=true}),'Anna',ctx()) assert(not S(db,'abc123','Dee','t',1,'Dee',NOW))
`));

test("your own events: create, change, call off, answer; with reasons when it cannot be done", () => lua(PURE + HEAD + String.raw`
local C,H,A=BackstageForeverEventCreate,BackstageForeverEventChange,BackstageForeverEventAnswer
local db={}
local fields={title='  Molten |cffff0000Core|r ',at=NOW+86400,dungeon='mc',roles={t=2,h=4,d=14},note=' fire  resist '}
local e=C(db,fields,'Me',ctx())
assert(e and e.ver==1 and e.creator=='Me' and e.title=='Molten Core' and e.note=='fire resist' and e.id:match('^[%l%d]+$') and #e.id>=6 and #e.id<=10 and db.events[e.id]==e,e and e.id)
assert(BackstageForeverEventDecode(BackstageForeverEventEncode(e),NOW),'what you made can be sent')
local second=C(db,fields,'Me',ctx()) assert(second and second.id~=e.id,'two made in the same second get different ids')
for why,bad in pairs({title={title='x'},time={at=NOW},place={dungeon='nowhere'},roles={roles={t=0,h=0,d=99}}}) do
  local f={} for k,v in pairs(fields) do f[k]=v end for k,v in pairs(bad) do f[k]=v end
  local made,reason=C({},f,'Me',ctx()) assert(made==nil and reason==why,why..' '..tostring(reason))
end
local _,reason=C({},{title='join www.site.example',at=NOW+60,dungeon='mc',roles={t=1,h=1,d=1}},'Me',ctx()) assert(reason=='title','no links in a title')
_,reason=C({},{title='Fine',at=NOW+60,dungeon='mc',roles={t=1,h=1,d=1},note='https://x.y'},'Me',ctx()) assert(reason=='title','nor in a note')
assert(C({},{title='Fine',at=NOW+60,dungeon='other',roles={t=0,h=0,d=0},note='   '},'Me',ctx()).note==nil,'other is always a place; an empty note is no note')
_,reason=C({},fields,'Me',ctx({now=NOW-181*86400})) assert(reason=='time','more than half a year ahead')
_,reason=C({policy={ver=1,propose=1}},fields,'Me',ctx({rank=function() return 4 end})) assert(reason=='rank')
assert(C({policy={ver=1,propose=1}},fields,'Me',ctx({rank=function() return 1 end})))
local many={} for i=1,5 do assert(C(many,fields,'Me',ctx({rand=i}))) end
_,reason=C(many,fields,'Me',ctx({rand=9})) assert(reason=='many')
local full={} for i=1,20 do BackstageForeverEventMerge(full,event({id='event'..string.format('%02d',i),creator='Member'..string.char(96+math.ceil(i/5))}),'Member'..string.char(96+math.ceil(i/5)),ctx()) end
_,reason=C(full,fields,'Me',ctx()) assert(reason=='full')
-- Change: the creator, or a rank the guild leader allowed. The version goes up; an editor is named.
local changed=H(db,e.id,{title='Molten Core 8pm',at=NOW+90000,dungeon='mc',roles={t=2,h=5,d=13}},'Me',ctx())
assert(changed==e and e.ver==2 and e.title=='Molten Core 8pm' and e.roles.h==5 and e.note==nil and e.editor==nil)
_,reason=H(db,e.id,{title='Mine now',at=NOW+90000,dungeon='mc',roles={t=2,h=5,d=13}},'Bob',ctx()) assert(reason=='rank' and e.title=='Molten Core 8pm')
db.policy={ver=1,edit=1}
assert(H(db,e.id,{title='Moved',at=NOW+90000,dungeon='mc',roles={t=2,h=5,d=13}},'Bob',ctx({rank=function() return 1 end})) and e.editor=='Bob' and e.ver==3)
_,reason=H(db,e.id,{title='x',at=NOW+90000,dungeon='mc',roles={t=2,h=5,d=13}},'Me',ctx()) assert(reason=='title' and e.ver==3)
assert(H(db,e.id,{title='Mine again',at=NOW+90000,dungeon='mc',roles={t=2,h=5,d=13}},'Me',ctx()) and e.editor==nil and e.ver==4)
-- Your answer.
assert(A(db,e.id,'Me','t',NOW)==1 and A(db,e.id,'Me','m',NOW)==2 and BackstageForeverEventMine(e,'me')=='m' and A(db,e.id,'Me','x',NOW)==nil and A(db,'nope12','Me','t',NOW)==nil)
-- Call off: nothing more can be done with it.
assert(H(db,e.id,{cancelled=true},'Me',ctx()) and e.cancelled and e.ver==5)
_,reason=H(db,e.id,{cancelled=true},'Me',ctx()) assert(reason=='gone') assert(A(db,e.id,'Me','t',NOW)==nil)
_,reason=H(db,'nope12',{cancelled=true},'Me',ctx()) assert(reason=='gone')
`));

test("the list, the reminder, expiry into history, and what is kept is bounded", () => lua(PURE + HEAD + String.raw`
local db={}
local M=BackstageForeverEventMerge
M(db,event({id='late01',at=NOW+3*86400,title='Later'}),'Anna',ctx())
M(db,event({id='soon01',at=NOW+600,title='Soon',dungeon='brd',roles={t=1,h=1,d=3}}),'Anna',ctx())
M(db,event({id='gone01',at=NOW+7200,title='Called off',ver=2,cancelled=true}),'Anna',ctx())
M(db,event({id='mine01',at=NOW+900,title='Mine',creator='Me'}),'Me',ctx())
M(db,event({id='nope01',at=NOW+800,title='Said no'}),'Anna',ctx())
local list=BackstageForeverEventList(db,NOW) assert(#list==4 and list[1].id=='soon01' and list[2].id=='nope01' and list[3].id=='mine01' and list[4].id=='late01')
BackstageForeverEventSign(db,'soon01','Me','h',1,'Me',NOW) BackstageForeverEventSign(db,'nope01','Me','n',1,'Me',NOW) BackstageForeverEventSign(db,'soon01','Bob','t',1,'Bob',NOW)
local lines=BackstageForeverEventLines(db,NOW,'Me',function(at) return 'T+'..(at-NOW) end,function(id) return id:upper() end)
assert(#lines==5 and lines[1]=='Guild events ahead: 4.' and lines[2]=='  1. T+600: Soon, BRD. Tanks 1 of 1, healers 1 of 1, damage 0 of 3. Your answer: healer.',lines[2])
assert(lines[3]:find('Your answer: no.',1,true) and lines[4]:find('You have not answered.',1,true))
assert(BackstageForeverEventLines({},NOW,'Me')[1]:find('No guild events ahead',1,true))
-- The reminder: within 15 minutes, for events you created or said yes or maybe to, once.
local due=BackstageForeverEventDue(db,NOW,'Me')
assert(#due==2 and due[1].id=='soon01' and due[2].id=='mine01','not the one you said no to, not the far one: '..#due)
assert(#BackstageForeverEventDue(db,NOW,'Me')==0,'once only')
local fresh={} M(fresh,event({id='soon02',at=NOW+901}),'Anna',ctx()) BackstageForeverEventSign(fresh,'soon02','Me','m',1,'Me',NOW)
assert(#BackstageForeverEventDue(fresh,NOW,'Me')==0 and #BackstageForeverEventDue(fresh,NOW+1,'Me')==1 and #BackstageForeverEventDue(fresh,NOW+902,'Me')==0,'not before the quarter hour, not after it began')
-- Four hours after it began an event becomes history; a called-off one just goes.
db.events.soon01.present={'Me','Bob'} db.events.soon01.loot={{i=18803,w='Bob',at=NOW+700}}
assert(BackstageForeverEventPrune(db,NOW+600+4*3600)==0 and BackstageForeverEventPrune(db,NOW+3*3600+4*3600)==4,'soon, the two near ones and the called-off one')
assert(#db.past==3 and db.past[1].id=='soon01' and db.events.late01 and not db.events.gone01)
local past=db.past[1]
assert(past.title=='Soon' and #past.signups==2 and past.signups[1].n=='Bob' and past.signups[1].s=='t' and past.present[2]=='Bob' and past.loot[1].i==18803 and past.roles.d==3)
-- History: thirty events, ninety days.
local h={events={},past={}} for i=1,40 do h.past[i]={id='past'..string.format('%02d',i),title='Old',dungeon='mc',at=NOW-i*86400,creator='Anna',roles={t=1,h=1,d=1},signups={},present={},loot={}} end
h.past[41]={id='ancient',title='Old',dungeon='mc',at=NOW-91*86400,creator='Anna',roles={t=1,h=1,d=1},signups={},present={},loot={}} h.past[42]='junk'
BackstageForeverEventPrune(h,NOW) assert(#h.past==30 and h.past[30].id=='past01' and h.past[1].id=='past30','the newest thirty, oldest first')
-- Saved data is checked again when it is read back.
local saved={on=true,loot='yes',events={abc123=event({signups={Bob={s='t',v=1},['B4d']={s='t',v=1},Cy={s='zz',v=1}},present={'Bob','n0'},loot={{i=1,w='Bob',at=NOW},{i='x',w='Bob',at=NOW}},relayed='Cy',reminded=true}),
  other1=event({id='differs'}),bad001={id='bad001',title='|cffff0000x'},evil01=event({id='evil01',title='see www.x.example'})},
  past={{id='past01',title='Old',dungeon='mc',at=NOW-86400,creator='Anna',roles={t=1,h=1,d=1},signups={{n='Bob',s='t'},{n='B4d',s='t'}},present={'Bob'},loot={}},'junk',{id='x'}},
  book={Ann={at=NOW-100,l=60,z='Winterspring',p={{n='Tailoring',r=300}},crafts={'Mooncloth'}},['B4d']={at=NOW},Old={at=NOW-61*86400,l=10},Odd={at='x'}},policy={ver=2,propose=3,edit='x'}}
BackstageForeverEventClean(saved,NOW)
assert(saved.on==true and saved.loot==false and saved.policy==nil,'a damaged rule is dropped whole')
local n=0 for _ in pairs(saved.events) do n=n+1 end assert(n==1 and saved.events.abc123.signups.Bob.s=='t' and saved.events.abc123.signups.B4d==nil and saved.events.abc123.signups.Cy==nil)
assert(#saved.events.abc123.present==1 and #saved.events.abc123.loot==1 and saved.events.abc123.relayed=='Cy' and saved.events.abc123.reminded==true)
assert(#saved.past==1 and #saved.past[1].signups==1 and saved.book.Ann.l==60 and saved.book.B4d==nil and saved.book.Old==nil and saved.book.Odd==nil)
assert(BackstageForeverEventClean(nil,NOW).on==false and BackstageForeverEventClean({policy={ver=2,propose=3}},NOW).policy.propose==3)
`));

test("time: a day and time on your clock to seconds, the skipped hour, the hour that happens twice, the realm clock", () => lua(PURE + String.raw`
-- A made-up zone on the US rules of 2026: UTC-6, and UTC-5 from 8 March 02:00 to 1 November 02:00.
local function days(y,m,d) -- days since 1970 (civil calendar)
  y=m<=2 and y-1 or y local era=math.floor(y/400) local yoe=y-era*400
  local doy=math.floor((153*(m+(m>2 and -3 or 9))+2)/5)+d-1
  return era*146097+yoe*365+math.floor(yoe/4)-math.floor(yoe/100)+doy-719468
end
local function civil(z) z=z+719468 local era=math.floor(z/146097) local doe=z-era*146097
  local yoe=math.floor((doe-math.floor(doe/1460)+math.floor(doe/36524)-math.floor(doe/146096))/365)
  local y=yoe+era*400 local doy=doe-(365*yoe+math.floor(yoe/4)-math.floor(yoe/100)) local mp=math.floor((5*doy+2)/153)
  local d=doy-math.floor((153*mp+2)/5)+1 local m=mp<10 and mp+3 or mp-9 return m<=2 and y+1 or y,m,d end
local START,END=days(2026,3,8)*86400+8*3600,days(2026,11,1)*86400+7*3600 -- 02:00 standard, 02:00 summer
local function offset(at) return (at>=START and at<END) and -5*3600 or -6*3600 end
local function toParts(at) local l=at+offset(at) local y,m,d=civil(math.floor(l/86400)) local s=l%86400 return {year=y,month=m,day=d,hour=math.floor(s/3600),min=math.floor(s%3600/60)} end
-- time(): reads the fields as standard time first, like the C library does when it is not told.
local function toEpoch(t) local wall=days(t.year,t.month,t.day)*86400+t.hour*3600+t.min*60+(t.sec or 0) local at=wall+6*3600 if offset(at-3600)==-5*3600 and offset(at)==-5*3600 then at=wall+5*3600 elseif offset(at)==-5*3600 then at=at end return at end
local E=BackstageForeverEventEpoch
local function utc(y,m,d,h,mi) return days(y,m,d)*86400+h*3600+mi*60 end
assert(E(2026,1,15,20,0,toEpoch,toParts)==utc(2026,1,16,2,0),'winter: six hours behind')
assert(E(2026,7,15,20,0,toEpoch,toParts)==utc(2026,7,16,1,0),'summer: five hours behind')
-- 8 March: 02:30 does not exist; 01:59 and 03:00 do, one minute apart.
local at,why=E(2026,3,8,2,30,toEpoch,toParts) assert(at==nil and why=='gap',tostring(why))
assert(E(2026,3,8,1,59,toEpoch,toParts)==utc(2026,3,8,7,59) and E(2026,3,8,3,0,toEpoch,toParts)==utc(2026,3,8,8,0))
-- 1 November: 01:30 happens twice; the first one is taken and the caller is told.
at,why=E(2026,11,1,1,30,toEpoch,toParts) assert(at==utc(2026,11,1,6,30) and why=='twice',tostring(at)..' '..tostring(why))
at,why=E(2026,11,1,2,30,toEpoch,toParts) assert(at==utc(2026,11,1,8,30) and why==nil)
at,why=E(2026,11,1,0,30,toEpoch,toParts) assert(at==utc(2026,11,1,5,30) and why==nil)
-- A day that does not exist.
at,why=E(2026,2,30,20,0,toEpoch,toParts) assert(at==nil and why=='bad') at,why=E(2026,4,31,20,0,toEpoch,toParts) assert(at==nil and why=='bad')
for _,bad in ipairs({{1999,1,1,0,0},{2026,13,1,0,0},{2026,1,32,0,0},{2026,1,1,24,0},{2026,1,1,0,60},{2026,1,1.5,0,0}}) do local a,w=E(bad[1],bad[2],bad[3],bad[4],bad[5],toEpoch,toParts) assert(a==nil and w=='bad') end
assert(E(2026,1,1,0,0,nil,toParts)==nil and E(2026,1,1,0,0,function() error('x') end,toParts)==nil)
-- Stepping a day never skips or repeats one across a clock change.
local S=BackstageForeverEventDayStep
local d=S({year=2026,month=3,day=7},1,toEpoch,toParts) assert(d.month==3 and d.day==8) d=S(d,1,toEpoch,toParts) assert(d.day==9)
d=S({year=2026,month=10,day=31},1,toEpoch,toParts) assert(d.month==11 and d.day==1) d=S(d,1,toEpoch,toParts) assert(d.month==11 and d.day==2) d=S(d,-2,toEpoch,toParts) assert(d.month==10 and d.day==31)
d=S({year=2026,month=12,day=31},1,toEpoch,toParts) assert(d.year==2027 and d.month==1 and d.day==1)
assert(S({year=2026,month=1,day=1},0.5,toEpoch,toParts)==nil and S(nil,1,toEpoch,toParts)==nil)
-- The realm clock against another clock, to the quarter hour.
local O=BackstageForeverEventClockOffset
assert(O(19,0,20,0)==60 and O(20,0,19,0)==-60 and O(23,30,0,30)==60 and O(0,30,23,30)==-60 and O(12,0,12,0)==0)
assert(O(12,0,12,7)==0 and O(12,0,12,8)==15 and O(12,3,17,31)==330,'seconds apart never make a new offset')
assert(O(0,0,12,0)==720 and O(12,0,0,0)==720 and O(0,0,13,0)==-660 and O(24,0,0,0)==nil and O(0,0,0,60)==nil)
`));

test("a run belongs to an event by place and time; who was there and who won what are bounded notes", () => lua(PURE + HEAD + String.raw`
local F=BackstageForeverEventForRun
local db={}
local M=BackstageForeverEventMerge
M(db,event({id='raid01',at=NOW+3600,dungeon='mc'}),'Anna',ctx())
M(db,event({id='raid02',at=NOW+8*3600,dungeon='mc'}),'Anna',ctx())
M(db,event({id='dung01',at=NOW+3600,dungeon='brd'}),'Anna',ctx())
M(db,event({id='gone01',at=NOW+3600,dungeon='ubrs',ver=2,cancelled=true}),'Anna',ctx())
assert(F(db,{'mc'},NOW+1800).id=='raid01' and F(db,{'mc'},NOW+1799)==nil,'from half an hour before')
assert(F(db,{'mc'},NOW+3600+4*3600).id=='raid01','to four hours after it began (the next one starts later)')
assert(F(db,{'mc'},NOW+8*3600-1800).id=='raid02','the nearer event wins where two overlap')
assert(F(db,{'brd'},NOW+3600).id=='dung01' and F(db,{'lbrs','ubrs'},NOW+3600)==nil and F(db,{'zg'},NOW+3600)==nil and F(db,nil,NOW)==nil and F(db,{'mc'},NOW+13*3600)==nil)
local e=db.events.raid01
assert(BackstageForeverEventPresent(e,{'Me','Bob','Cy'})==3 and BackstageForeverEventPresent(e,{'bob','Dee','B4d',5})==1 and #e.present==4)
local many={} for i=1,60 do many[i]='Raider'..string.char(96+math.floor((i-1)/26)+1)..string.char(97+(i-1)%26) end
BackstageForeverEventPresent(e,many) assert(#e.present==40)
-- Loot: rare or better by the colour of the link; the item id and the winner only.
local Q=BackstageForeverEventLootQuality
assert(Q('Bob receives loot: |cffa335ee|Hitem:18803::::::::60:::::|h[Finkle\'s Lava Dredger]|h|r.')==4 and Q('x |cff0070dd|Hitem:1|h[Blue]|h|r')==3 and Q('x |cffff8000|Hitem:1|h[Orange]|h|r')==5)
assert(Q('x |cff1eff00|Hitem:1|h[Green]|h|r')==nil and Q('x |cffffffff|Hitem:1|h[White]|h|r')==nil and Q('x |cnIQ4:|Hitem:1|h[New style]|h|r')==4 and Q('x |cnIQ2:|Hitem:1|h[Green]|h|r')==nil and Q(nil)==nil and Q('no link')==nil)
local L=BackstageForeverEventLoot
assert(L(e,18803,'Bob',NOW+5000) and not L(e,18803,'Bob',NOW+5002) and L(e,18803,'Bob',NOW+5010) and L(e,18803,'Cy',NOW+5010),'the same line twice is one note')
assert(not L(e,0,'Bob',NOW) and not L(e,18803,'B0b',NOW) and not L(e,18803,nil,NOW) and not L(nil,18803,'Bob',NOW) and not L(e,18803,'Bob',5))
for i=1,80 do L(e,1000+i,'Bob',NOW+6000+i*10) end assert(#e.loot==60)
`));

test("the book of sharing members and the block for the desktop app", () => lua(PURE + HEAD + String.raw`
local book={}
local Seen,Forget,Craft=BackstageForeverGuildBookSeen,BackstageForeverGuildBookForget,BackstageForeverGuildBookCraft
assert(Seen(book,'Ann',{level=60,zone='Winterspring',profs={{name='Tailoring',rank=300},{name='Enchanting',rank=285}},lfd='brd'},'PRIEST',NOW))
assert(book.Ann.l==60 and book.Ann.z=='Winterspring' and book.Ann.c=='PRIEST' and book.Ann.lfd=='brd' and book.Ann.p[2].n=='Enchanting' and book.Ann.p[2].r==285 and book.Ann.at==NOW)
assert(Craft(book,'Ann','Mooncloth',NOW) and not Craft(book,'Ann','mooncloth',NOW) and Craft(book,'Ann','Ghost Dye',NOW) and #book.Ann.crafts==2)
assert(Seen(book,'Ann',{level=60,profs={}},nil,NOW+60) and book.Ann.c=='PRIEST' and #book.Ann.crafts==2 and book.Ann.z==nil,'a later share keeps the class and the recipes, and drops what is no longer told')
assert(not Seen(book,'An4',{level=1},nil,NOW) and not Seen(book,'Bob',nil,nil,NOW) and not Seen(book,'Bob',{level=1},nil,5) and Seen(book,'Bob',{level=1},'not a class',NOW) and book.Bob.c==nil)
assert(Craft(book,'Cy','Runecloth Bag',NOW) and book.Cy.l==nil and #book.Cy.crafts==1,'an answer from a member not seen yet')
for i=1,20 do Craft(book,'Cy','Recipe '..string.char(64+i),NOW) end assert(#book.Cy.crafts==12 and book.Cy.crafts[12]=='Recipe T','the newest twelve')
assert(Forget(book,'Ann') and book.Ann==nil and not Forget(book,'Ann'),'a member who stops sharing is forgotten')
for i=1,120 do Seen(book,'Member'..string.char(96+math.floor((i-1)/26)+1)..string.char(97+(i-1)%26),{level=10},nil,NOW+i) end
local n=0 for _ in pairs(book) do n=n+1 end assert(n==100,'a hundred members: '..n)
book.Old={at=NOW-61*86400,l=5} book.Future={at=NOW+2*86400+200,l=5} book.Odd='x'
BackstageForeverGuildBookPrune(book,NOW+121) assert(book.Old==nil and book.Future==nil and book.Odd==nil)
-- The block.
local db={on=true,loot=false,book={Ann={at=NOW-100,l=60,z='Winterspring',c='PRIEST',p={{n='Tailoring',r=300}},crafts={'Mooncloth'}}}}
BackstageForeverEventMerge(db,event({note='Bring fire resist'}),'Anna',ctx()) BackstageForeverEventMerge(db,event({id='copy01',at=NOW+7200,title='A copy'}),'Bob',ctx())
BackstageForeverEventSign(db,'abc123','Me','t',1,'Me',NOW) BackstageForeverEventSign(db,'abc123','Bob','m',2,'Bob',NOW)
db.past={{id='past01',title='Old',dungeon='mc',at=NOW-86400,creator='Anna',roles={t=1,h=2,d=3},signups={{n='Bob',s='t'}},present={'Bob','Me'},loot={{i=18803,w='Bob',at=NOW-80000}}}}
local block,lists=BackstageForeverEventsExport(db,NOW,{me='Me',guild='Night |cffff0000Watch',realmOffset=60})
assert(block.v==1 and block.at==NOW and block.on==true and block.loot==false and block.me=='Me' and block.guild=='Night Watch' and block.realmOffset==60)
assert(#block.events==2 and block.events[1].id=='copy01' and block.events[1].relayed==true and block.events[2].id=='abc123' and block.events[2].relayed==nil)
local e=block.events[2] assert(e.ver==1 and e.title=='Molten Core' and e.t==2 and e.h==4 and e.d==14 and e.note=='Bring fire resist' and #e.signups==2 and e.signups[1].n=='Bob' and e.signups[1].s=='m' and e.signups[1].v==2)
assert(#block.past==1 and block.past[1].ver==nil and block.past[1].present[2]=='Me' and block.past[1].loot[1].w=='Bob' and block.past[1].d==3)
assert(#block.members==1 and block.members[1].n=='Ann' and block.members[1].c=='PRIEST' and block.members[1].p[1].r==300 and block.members[1].crafts[1]=='Mooncloth')
-- Every list inside is handed over so the capture can mark it (an empty Lua table would otherwise be written as an object).
local marked={} for _,t in ipairs(lists) do marked[t]=true end
assert(marked[block.events] and marked[block.past] and marked[block.members] and marked[e.signups] and marked[e.present] and marked[e.loot] and marked[block.members[1].p] and marked[block.members[1].crafts] and marked[block.past[1].signups])
assert(BackstageForeverEventsExport({},NOW,{})==nil and BackstageForeverEventsExport({on=true},NOW,{}).on==true and BackstageForeverEventsExport(db,5,{})==nil and BackstageForeverEventsExport(nil,NOW)==nil)
assert(BackstageForeverEventsExport(db,NOW,{me='B4d',realmOffset=9999}).me==nil and BackstageForeverEventsExport(db,NOW,{realmOffset=9999}).realmOffset==nil)
-- A rate limit by count and window.
local R,state=BackstageForeverEventRate,{}
for i=1,3 do assert(R(state,'k',100,3,60)) end assert(not R(state,'k',159,3,60) and R(state,'k',160,3,60) and R(state,'other',100,1,60) and not R(state,'other',100,1,60) and R(state,'k',10,3,60),'a clock that went back does not lock it')
`));

test("in game: off until switched on; events, answers and the list travel on the guild channel only", () => lua(STUBS + FILES + String.raw`
fire('PLAYER_LOGIN')
-- Off by default: nothing is sent, nothing is read, nothing answers.
assert(BackstageForeverEventsOn()==false)
from('Ann','E|abc123|1|Ann|-|'..(NOW+86400)..'|mc|2.4.14|-|Molten Core|-') from('Ann','E?') runAfter() pumpAll()
assert(#sent==0 and next(BackstageForeverEventsDB.events)==nil)
BackstageForeverEventCommand('events') assert(#sent==0 and last():find('Guild events are off',1,true))
BackstageForeverEventCommand('event') assert(last():find('Guild events are off',1,true))
assert(BackstageForeverEventsSnapshot()==nil,'nothing to save while it was never on')
-- On: one question to the guild, through the queue.
BackstageForeverEventCommand('event on') assert(said[#said]:find('Guild events: on',1,true))
pumpAll() assert(#sent==1 and sent[1][1]=='BFParty' and sent[1][2]=='E?' and sent[1][3]=='GUILD')
-- An event arrives from its creator: kept, announced, on the list.
from('Ann','E|abc123|1|Ann|-|'..(NOW+86400)..'|mc|2.4.14|-|Molten Core|Bring fire resist')
assert(BackstageForeverEventsDB.events.abc123.title=='Molten Core' and last():find('New guild event from Ann: Molten Core',1,true) and last():find('your time',1,true),last())
-- Not from the party, a whisper or another addon; not from yourself; not when it is malformed.
from('Bob','E|party1|1|Bob|-|'..(NOW+86400)..'|mc|2.4.14|-|Party|-','PARTY') from('Bob','E|whisp1|1|Bob|-|'..(NOW+86400)..'|mc|2.4.14|-|Whisper|-','WHISPER')
fire('CHAT_MSG_ADDON','Other','E|other1|1|Bob|-|'..(NOW+86400)..'|mc|2.4.14|-|Other|-','GUILD','Bob') from('Me','E|self01|1|Me|-|'..(NOW+86400)..'|mc|2.4.14|-|Self|-')
from('Bob','E|bad001|1|Bob|-|'..(NOW+86400)..'|mc|2.4.14|-||cffff0000Red|r|-') from('Bob','E|link01|1|Bob|-|'..(NOW+86400)..'|mc|2.4.14|-|go to www.gold.example|-')
local n=0 for _ in pairs(BackstageForeverEventsDB.events) do n=n+1 end assert(n==1,'kept: '..n)
-- Your answer goes out as one message; others' answers come in; nobody answers for you.
BackstageForeverEventCommand('event yes tank') assert(last()=='Backstage Forever: Signed up as tank: Molten Core.',last())
pumpAll() assert(sent[#sent][2]=='U|abc123|1|t')
from('Bob','U|abc123|1|h') from('Cy','U|abc123|1|m') from('Mallory','U|abc123|5|n') from('Ann','L|abc123|Dee:d:1,Me:n:9')
local e=BackstageForeverEventsDB.events.abc123
assert(e.signups.Bob.s=='h' and e.signups.Cy.s=='m' and e.signups.Mallory.s=='n' and e.signups.Dee.s=='d' and e.signups.Me.s=='t','the creator may pass on Dee, never speak for you')
BackstageForeverEventCommand('event maybe 1') pumpAll() assert(sent[#sent][2]=='U|abc123|2|m' and e.signups.Me.s=='m')
BackstageForeverEventCommand('event yes') assert(last():find('Say the role',1,true))
BackstageForeverEventCommand('event no 7') assert(last():find('No event has that number',1,true))
-- The list in chat.
said={} BackstageForeverEventCommand('events')
assert(#said==2 and said[1]=='Backstage Forever: Guild events ahead: 1.' and said[2]:find('Molten Core, Molten Core. Tanks 0 of 2, healers 1 of 4, damage 1 of 14. Your answer: maybe.',1,true),said[2])
-- Your own event: made, sent, changed and called off by number.
local made=BackstageForeverEventsApi.create({title='Blackrock Depths',at=NOW+7200,dungeon='brd',roles={t=1,h=1,d=3},note='Keys'})
assert(made and made.creator=='Me') pumpAll() assert(sent[#sent][2]=='E|'..made.id..'|1|Me|-|'..(NOW+7200)..'|brd|1.1.3|-|Blackrock Depths|Keys',sent[#sent][2])
local none,why=BackstageForeverEventsApi.create({title='x',at=NOW+7200,dungeon='brd',roles={t=1,h=1,d=3}}) assert(none==nil and why:find('title',1,true))
none,why=BackstageForeverEventsApi.create({title='Night out',at=NOW+7200,dungeon='nowhere',roles={t=1,h=1,d=3}}) assert(none==nil and why:find('dungeon or raid',1,true),'only a place the Instance Atlas lists, or Other')
assert(BackstageForeverEventsApi.mayEdit(made) and not BackstageForeverEventsApi.mayEdit(e))
BackstageForeverEventCommand('event cancel 2') assert(last():find('Only',1,true)==nil and last():find('guild rank',1,true),'Ann\'s event is not yours to call off: '..last())
BackstageForeverEventCommand('event cancel 1') assert(last()=='Backstage Forever: Guild event called off: Blackrock Depths.',last())
pumpAll() assert(sent[#sent][2]=='E|'..made.id..'|2|Me|-|'..(NOW+7200)..'|brd|1.1.3|x|Blackrock Depths|Keys')
BackstageForeverEventCommand('event cancel') assert(last():find('Name the event by its number',1,true))
-- Somebody asks what you know: after a short wait you answer with your own events, the copies, your answers; at most once in two minutes.
local before=#sent
from('Bob','E?') assert(#sent==before,'not at once') runAfter() pumpAll()
local events,signs=texts('E|'),texts('U|')
assert(sent[#sent][3]=='GUILD' and #sent-before==3,'Ann\'s event as a copy, your called-off one, your answer: '..(#sent-before))
from('Cy','E?') runAfter() pumpAll() assert(#sent-before==3,'one answer per two minutes')
-- While you wait to answer, an event somebody else already sent is left out.
clock=clock+200 before=#sent
from('Cy','E?') from('Ann','E|abc123|1|Ann|-|'..(NOW+86400)..'|mc|2.4.14|-|Molten Core|Bring fire resist') runAfter() pumpAll()
assert(#sent-before==2,'only your own event and your answer: '..(#sent-before))
-- Off again: the queue is dropped, nothing more is read, what you have stays.
BackstageForeverEventsApi.answer('abc123','t') BackstageForeverEventCommand('event off') pumpAll()
assert(sent[#sent][2]~='U|abc123|3|t' and last():find('Guild events: off',1,true))
from('Ann','E|after1|1|Ann|-|'..(NOW+86400)..'|mc|2.4.14|-|After|-') assert(BackstageForeverEventsDB.events.after1==nil and BackstageForeverEventsDB.events.abc123)
-- Not in a guild: nothing is sent.
inGuild=false BackstageForeverEventCommand('event on') assert(last():find('not in a guild',1,true)) BackstageForeverEventCommand('events') assert(last()=='Backstage Forever: You are not in a guild.')
`));

test("in game: the guild leader's rules, a flood, the reminder outside combat, the run of an event, the saved block", () => lua(STUBS + FILES + String.raw`
fire('PLAYER_LOGIN') BackstageForeverEventCommand('event on') pumpAll() sent={}
fire('GUILD_ROSTER_UPDATE')
-- Rules come from the guild leader only (as the game's guild list names them).
from('Ann','P|1|1|1') assert(BackstageForeverEventsDB.policy==nil,'an officer cannot set them')
from('Lead','P|2|1|1') assert(BackstageForeverEventsDB.policy.propose==1 and BackstageForeverEventsDB.policy.edit==1)
from('Lead','P|1|-|-') assert(BackstageForeverEventsDB.policy.propose==1,'an older rule does not come back')
from('Bob','E|bob001|1|Bob|-|'..(NOW+86400)..'|mc|2.4.14|-|Bob runs MC|-') assert(BackstageForeverEventsDB.events.bob001==nil,'Bob\'s rank may not propose now')
from('Ann','E|ann001|1|Ann|-|'..(NOW+86400)..'|mc|2.4.14|-|Ann runs MC|-') assert(BackstageForeverEventsDB.events.ann001)
from('Lead','E|ann001|2|Ann|Lead|'..(NOW+90000)..'|mc|2.4.14|-|Moved by the leader|-') assert(BackstageForeverEventsDB.events.ann001.title=='Moved by the leader' and last():find('Guild event changed by Lead',1,true))
local none,why=BackstageForeverEventsApi.create({title='Mine',at=NOW+7200,dungeon='mc',roles={t=1,h=1,d=3}}) assert(none==nil and why:find('guild rank',1,true))
BackstageForeverEventCommand('event policy') assert(said[#said-1]:find('guild rank 1 and above',1,true) and last():find('guild rank 1 and above',1,true))
BackstageForeverEventCommand('event policy propose anyone') assert(last():find('Only the guild leader',1,true))
-- As the guild leader you set them, and they go out.
me='Lead' BackstageForeverEventCommand('event policy propose anyone') pumpAll()
assert(BackstageForeverEventsDB.policy.ver==3 and BackstageForeverEventsDB.policy.propose==nil and BackstageForeverEventsDB.policy.edit==1 and sent[#sent][2]=='P|3|-|1',sent[#sent][2])
BackstageForeverEventCommand('event policy edit creator') pumpAll() assert(sent[#sent][2]=='P|4|-|-')
BackstageForeverEventCommand('event policy edit 12') assert(last():find('guild rank number',1,true))
me='Me'
-- A flood from one member stops at forty messages a minute.
for i=1,60 do from('Cy','U|ann001|'..i..'|t') end
assert(BackstageForeverEventsDB.events.ann001.signups.Cy.v==40,'forty were read: '..BackstageForeverEventsDB.events.ann001.signups.Cy.v)
clock=clock+61 from('Cy','U|ann001|61|h') assert(BackstageForeverEventsDB.events.ann001.signups.Cy.v==61)
-- Many arrivals at once are one line, not twenty.
said={} combat=true
for i=1,6 do local who=i<=3 and 'Ann' or 'Lead' from(who,'E|many0'..i..'|1|'..who..'|-|'..(NOW+86400+i)..'|brd|1.1.3|-|Night '..i..'|-') end
assert(#said==0,'nothing is printed in combat') combat=false fire('PLAYER_REGEN_ENABLED')
assert(#said==1 and said[1]=='Backstage Forever: Guild events: 6 new or changed. /bf events lists them.',said[1])
from('Ann','E|many07|1|Ann|-|'..(NOW+86400)..'|brd|1.1.3|-|Night 7|-') from('Ann','E|many08|1|Ann|-|'..(NOW+86400)..'|brd|1.1.3|-|Night 8|-')
assert(BackstageForeverEventsDB.events.many07 and not BackstageForeverEventsDB.events.many08,'five events a member')
-- The reminder: a quarter of an hour before, outside combat, once.
BackstageForeverEventsDB.events={} BackstageForeverEventsDB.policy=nil
from('Ann','E|soon01|1|Ann|-|'..(NOW+800)..'|mc|2.4.14|-|Molten Core|-') BackstageForeverEventsApi.answer('soon01','h')
said={} combat=true BackstageForeverEventsRemind() assert(#said==0) combat=false BackstageForeverEventsRemind()
assert(#said==1 and said[1]=='Backstage Forever: Guild event in 13 minutes: Molten Core, Molten Core.',said[1]) BackstageForeverEventsRemind() assert(#said==1)
-- Inside the event's raid around its time: who is in your group; loot notes only with their own switch.
LOOT_ITEM='%s receives loot: %s.' LOOT_ITEM_SELF='You receive loot: %s.'
local instance={'Molten Core','raid',1,'',40,0,false,409}
GetInstanceInfo=function() return (table.unpack or unpack)(instance) end
IsInRaid=function() return true end GetRaidRosterInfo=function(i) return ({'Me','Ann-Realm','Bob'})[i] end
wall=NOW+900 fire('PLAYER_ENTERING_WORLD')
local e=BackstageForeverEventsDB.events.soon01 assert(#e.present==3 and e.present[2]=='Ann',e.present[2])
fire('CHAT_MSG_LOOT','Bob receives loot: |cffa335ee|Hitem:18803::::::::60:::::|h[Finkle\'s Lava Dredger]|h|r.') assert(e.loot==nil or #e.loot==0,'off until you switch it on')
BackstageForeverEventCommand('event loot on') assert(last():find('Guild-run loot notes: on',1,true))
fire('CHAT_MSG_LOOT','Bob receives loot: |cffa335ee|Hitem:18803::::::::60:::::|h[Finkle\'s Lava Dredger]|h|r.')
fire('CHAT_MSG_LOOT','You receive loot: |cff0070dd|Hitem:17011::::::::60:::::|h[Lava Core]|h|r.')
fire('CHAT_MSG_LOOT','Bob receives loot: |cff1eff00|Hitem:7909::::::::60:::::|h[Aquamarine]|h|r.') fire('CHAT_MSG_LOOT','Bob has selected Need for: |cffa335ee|Hitem:18803::::::::60:::::|h[x]|h|r')
assert(#e.loot==2 and e.loot[1].i==18803 and e.loot[1].w=='Bob' and e.loot[2].i==17011 and e.loot[2].w=='Me','rare or better, loot lines only: '..#e.loot)
-- Another place, or no event near: nothing is noted.
instance[8]=230 fire('PLAYER_ENTERING_WORLD') fire('CHAT_MSG_LOOT','Bob receives loot: |cffa335ee|Hitem:11684::::::::60:::::|h[Ironfoe]|h|r.') assert(#e.loot==2)
-- What sharing guild members tell you is kept for the desktop page, with the class from the guild list; "off" forgets.
BackstageForeverGuildCommand('guild on')
from('Ann','G|60|Winterspring|Tailoring:300|-') from('Bob','G|42|Tanaris|-|brd')
assert(BackstageForeverEventsDB.book.Ann.c=='PRIEST' and BackstageForeverEventsDB.book.Ann.p[1].n=='Tailoring' and BackstageForeverEventsDB.book.Bob.lfd=='brd')
from('Bob','G|off') assert(BackstageForeverEventsDB.book.Bob==nil)
-- The saved block.
local block,lists=BackstageForeverEventsSnapshot()
assert(block.v==1 and block.on==true and block.loot==true and block.me=='Me' and block.guild=='Night Watch' and #block.events==1 and block.events[1].id=='soon01' and #block.events[1].present==3 and #block.members==1 and #lists>=6)
-- Four hours after it began the event is history, with its sign-ups, group and loot.
wall=NOW+800+4*3600+1 BackstageForeverEventsRemind()
block=BackstageForeverEventsSnapshot() assert(#block.events==0 and #block.past==1 and block.past[1].signups[1].n=='Me' and block.past[1].signups[1].s=='h' and #block.past[1].loot==2)
`));

test("wiring: the files load after the party channel, own their saved table, and the capture carries the optional blocks", () => {
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  const order = toc.split(/\r?\n/).filter((l) => l.endsWith(".lua"));
  for (const file of ["BackstageForeverEvents.lua", "BackstageForeverEventsWindow.lua", "BackstageForeverLockouts.lua"]) {
    assert.ok(order.includes(file), file);
    assert.ok(require("../src/core/game-sync.cjs").ADDON_FILES.includes(file), file);
  }
  assert.ok(order.indexOf("BackstageForeverEvents.lua") > order.indexOf("BackstageForeverParty.lua") && order.indexOf("BackstageForeverEvents.lua") > order.indexOf("BackstageForeverGuild.lua"));
  assert.ok(order.indexOf("BackstageForeverEventsWindow.lua") > order.indexOf("BackstageForeverEvents.lua"));
  assert.match(toc, /SavedVariablesPerCharacter:.*BackstageForeverEventsDB/, "a per-character table; account-wide ones break the desktop's reader");
  const main = read("addon/BackstageForever/BackstageForever.lua");
  assert.match(main, /character\.guild=guild/); assert.match(main, /character\.lockouts=lockouts/);
  assert.match(main, /discard\(chars\[i\],'guild'\);discard\(chars\[i\],'lockouts'\)/, "both are shed early when the saved file is full");
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  assert.match(hud, /word=='event' or word=='events' then\s+if type\(BackstageForeverEventCommand\)=='function' then pcall\(BackstageForeverEventCommand,message\)end/);
  assert.match(hud, /word=='lockouts' then\s+if type\(BackstageForeverLockoutsCommand\)=='function' then pcall\(BackstageForeverLockoutsCommand,message\)end/);
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  assert.match(options, /switch\('Guild events',[^\n]*off\('BackstageForeverEventsDB','on'\),'event'\)/);
  assert.match(options, /switch\('Guild-run loot notes',[^\n]*off\('BackstageForeverEventsDB','loot'\),'event loot'\)/);
  // Only the guild channel, only through the shared sender, and nothing that touches a network or the game's input.
  const source = read("addon/BackstageForever/BackstageForeverEvents.lua") + read("addon/BackstageForever/BackstageForeverEventsWindow.lua") + read("addon/BackstageForever/BackstageForeverLockouts.lua");
  assert.equal((source.match(/BackstageForeverPartySend/g) || []).length, 1, "one way out");
  assert.match(source, /pcall\(fn,text,'GUILD'\)/);
  for (const banned of ["SendChatMessage", "SendAddonMessage", "'WHISPER'", "'RAID'", "'PARTY'", "RunMacroText", "CastSpell", "loadstring", "http"]) assert.ok(!source.includes(banned), banned);
});

test("the window: fixed widths, no word wrap on names, closed in combat, every rule reached through the api", () => {
  const w = read("addon/BackstageForever/BackstageForeverEventsWindow.lua");
  assert.match(w, /local WIDTH,HEIGHT=600,440/);
  assert.match(w, /f:RegisterEvent\('PLAYER_REGEN_DISABLED'\)/); assert.match(w, /f:SetScript\('OnEvent',function\(\) f:Hide\(\) end\)/);
  assert.match(w, /if not api\(\) or busy\(\) then return false end/);
  assert.match(w, /SetMaxLetters\(40\)/); assert.match(w, /SetMaxLetters\(80\)/);
  assert.equal((w.match(/SetAutoFocus\(false\)/g) || []).length, 2, "a typing box never grabs the keyboard by itself");
  // Every text has a width; only the note, the hints and the messages wrap, inside a fixed box.
  assert.match(w, /if height then s:SetSize\(width,height\);s:SetJustifyV\('TOP'\);s:SetWordWrap\(true\) else s:SetWidth\(width\);s:SetWordWrap\(false\) end/);
  for (const m of w.matchAll(/CreateFontString\(nil,'OVERLAY','(\w+)'\)\s*\n\s*([^\n]+)/g)) assert.match(m[2], /SetWidth|SetPoint\('TOP',0,-16\)/, `a text without a width: ${m[2].slice(0, 80)}`);
  assert.ok(!/BackstageForeverEventMerge|BackstageForeverEventSign\b|BackstageForeverEventsDB/.test(w), "the window holds no rules and no data");
  // The list pane fits: rows, groups, answer buttons and the footer do not run into each other.
  const [, top, row, rows] = /local LIST_X,LIST_TOP,LIST_ROW,LIST_ROWS,LIST_WIDTH=\d+,(-?\d+),(\d+),(\d+),\d+/.exec(w).map(Number);
  assert.ok(-top + row * rows <= 440 - 74 - 8, "the list ends above the rule");
  assert.ok(138 + 5 * 29 <= 288 && 332 + 22 <= 440 - 74, "groups end above your answer; the answer buttons end above the rule");
});
