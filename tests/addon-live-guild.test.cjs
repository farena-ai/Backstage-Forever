"use strict";
// Backstage Live in the game: the guild link, the signals for the desktop app and their pace, what
// the app hands back at /reload (merge by version, pass on, storm control), the group plan and
// party state, live readiness, announcements the player switches on, and the realm board listing.
// Everything that arrives from another player or from the hand-off file is treated as untrusted.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const load = (...names) => names.map((n) => `dofile('addon/BackstageForever/BackstageForever${n}.lua')\n`).join("");
const PURE = "DEFAULT_CHAT_FRAME={AddMessage=function() end}\n" + load("Lfg", "Events", "LiveGuild", "LiveParty");
const ALL = load("Live", "Party", "Lfg", "Crew", "Guild", "Events", "LiveGuild", "LiveParty");
// A guild of six in the game's list: Lead is the guild leader (rank 0), Ann an officer (1), the rest
// members. `me` and `myRank` say who is playing. A party of three when `grouped`: Me, Ann, Bob.
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] or '' end
local function heard(part) for _,m in ipairs(said) do if m:find(part,1,true) then return true end end return false end
local handlers={}
UIParent={}
local frames={}
local function widget() local w={} return setmetatable(w,{__index=function(t,k) return function(self,...) if k=='SetText' then rawset(t,'text',(...)) elseif k=='Show' then rawset(t,'shown',true) elseif k=='Hide' then rawset(t,'shown',false) elseif k=='CreateFontString' or k=='CreateTexture' then return widget() elseif k=='RegisterEvent' then rawset(t,'event:'..tostring((...)),true) elseif k=='SetScript' then local a,b=... if a=='OnEvent' then handlers[#handlers+1]={t,b} end rawset(t,'on'..tostring(a),b) end end end}) end
CreateFrame=function(kind,name) local f=widget() if name then frames[name]=f _G[name]=f end return f end
-- A frame hears only the events it registered for, as in the game.
local function fire(event,...) local now={} for i,h in ipairs(handlers) do now[i]=h end for _,h in ipairs(now) do if rawget(h[1],'event:'..event) then h[2](nil,event,...) end end end
local sent={}
C_ChatInfo={RegisterAddonMessagePrefix=function() end,SendAddonMessage=function(p,t,ch) sent[#sent+1]={p,t,ch} end}
local chat={} SendChatMessage=function(text,channel) chat[#chat+1]={text,channel} end
local clock=1000 GetTime=function() return clock end
local NOW=1795000000
local wall=NOW
time=function(t) if t then return os.time(t) end return wall end
date=os.date
local combat=false InCombatLockdown=function() return combat end
local inGuild=true IsInGuild=function() return inGuild end
local grouped,raid,leader=false,false,'player'
IsInGroup=function() return grouped end IsInRaid=function() return raid end
GetNumGroupMembers=function() return grouped and 3 or 0 end
local me,myRank='Me',4
local party={'Ann','Bob'}
UnitName=function(u) if u=='player' then return me end local i=tonumber(u:match('^party(%d)$')) return grouped and i and party[i] or nil end
UnitIsGroupLeader=function(u) return u==leader end
UnitIsConnected=function() return true end
UnitClass=function(u) if u=='player' then return 'Hunter','HUNTER' end return 'Priest','PRIEST' end
UnitLevel=function(u) return u=='player' and 34 or 36 end
UnitGUID=function() return 'Player-1-00000001' end
GetRealmName=function() return 'Thunder Hold' end
UnitFactionGroup=function() return 'Horde' end
Ambiguate=function(n) return (n:gsub('%-.*$','')) end
GetGuildInfo=function() return 'Night Watch','rank',myRank end
local guild={{'Lead-Realm',0,'WARRIOR'},{'Ann-Realm',1,'PRIEST'},{'Bob-Realm',4,'MAGE'},{'Cy-Realm',4,'ROGUE'},{'Me-Realm',4,'HUNTER'},{'Anna-Realm',3,'MAGE'}}
GetNumGuildMembers=function() return #guild,#guild end
GetGuildRosterInfo=function(i) local r=guild[i] if not r then return nil end return r[1],'rank',(r[1]=='Me-Realm') and myRank or r[2],60,'Class','Zone','','',true,0,r[3] end
local after={} C_Timer={After=function(s,fn) after[#after+1]={s,fn} end,NewTicker=function() end}
local function runAfter() local t=after after={} for _,row in ipairs(t) do row[2]() end end
local rnd=0.5 math.random=function() return rnd end
local function from(who,text,channel) fire('CHAT_MSG_ADDON','BFParty',text,channel or 'GUILD',who) end
local function pumpAll() for i=1,80 do BackstageForeverEventsPump() end end
local function texts(prefix,channel) local out={} for _,m in ipairs(sent) do if m[2]:sub(1,#prefix)==prefix and (not channel or m[3]==channel) then out[#out+1]=m[2] end end return out end
BackstageForeverAtlasData={{'mc','Molten Core','r',60,60,'B',1427,.35,.84,{},{}},{'sm','Scarlet Monastery','d',30,45,'B',1420,.8,.3,{},{}}}
-- The live link is stubbed: what the addon hands to it is kept, and it can say busy or off.
local signals,linkSays={},nil
local function useFakeLink() BackstageForeverLiveSignal=function(text,key) if linkSays then return nil,linkSays end signals[#signals+1]={text=text,key=key} return #signals,1 end end
local function flushAll() for i=1,60 do clock=clock+2 BackstageForeverLiveFlush() end end
local function signalled(prefix) local out={} for _,s in ipairs(signals) do if s.text:sub(1,#prefix)==prefix then out[#out+1]=s.text end end return out end
`;
const event = String.raw`
local function event(over) local e={id='abc123',ver=1,creator='Anna',at=1795000000+86400,dungeon='mc',roles={t=2,h=4,d=14},title='Molten Core',note='Bring fire resist'} for k,v in pairs(over or {}) do e[k]=v end return e end
local NOW=1795000000
local ranks={lead=0,ann=1,bob=4,cy=4,me=4,anna=3}
local function ctx(extra) local c={now=NOW,rank=function(n) return ranks[n:lower()] end,member=function(n) return ranks[n:lower()]~=nil end,guild='Night Watch'} for k,v in pairs(extra or {}) do c[k]=v end return c end
`;

test("the guild link code: typed small or without dashes is put right, anything else is refused", () => lua(PURE + String.raw`
local C=BackstageForeverLinkCode
assert(C('BFG-7K2M-Q9XD')=='BFG-7K2M-Q9XD' and C('bfg-7k2m-q9xd')=='BFG-7K2M-Q9XD' and C('  bfg7k2mq9xd ')=='BFG-7K2M-Q9XD' and C('BFG - 7K2M - Q9XD')=='BFG-7K2M-Q9XD')
for _,bad in ipairs({'','BFG','BFG-7K2M','BFG-7K2M-Q9X','BFG-7K2M-Q9XDD','BFX-7K2M-Q9XD','BFG_7K2M_Q9XD','BFG-7K2M-Q9X!','BFG-7K2M-Q9X\195\169','|cffBFG-7K2M-Q9XD',string.rep('B',41),5,{},true}) do assert(C(bad)==nil,tostring(bad)) end
assert(C(nil)==nil)
assert(BackstageForeverLinkEncode('bfg7k2mq9xd')=='K|BFG-7K2M-Q9XD' and BackstageForeverLinkEncode('nope')==nil)
local D=BackstageForeverLinkDecode
local what,code=D('K|BFG-7K2M-Q9XD') assert(what=='code' and code=='BFG-7K2M-Q9XD')
assert(D('K?')=='ask' and D('K|-')=='off')
for _,bad in ipairs({'K','K|','K|bfg-7k2m-q9xd','K|BFG-7K2M-Q9XD ','K|BFG-7K2M-Q9XD|x','K|BFG7K2MQ9XD','K??','k?','K|--',5,string.rep('K',300)}) do assert(D(bad)==nil,tostring(bad)) end
`));

test("who may set and take away the link: the leader or the rank below sets it, only the leader removes it, and a code is one prompt", () => lua(PURE + String.raw`
local Take=BackstageForeverLinkTake
local s={}
assert(Take(s,'code','BFG-7K2M-Q9XD','Bob',4,100)==nil and s.code==nil,'a member cannot')
assert(Take(s,'code','BFG-7K2M-Q9XD','Bob',nil,100)==nil,'somebody whose rank is not known cannot')
assert(Take(s,'code','BFG-7K2M-Q9XD','Bob',2,100)==nil)
assert(Take(s,'code','bfg-7k2m-q9xd','Lead',0,100)==nil,'a code that is not exact is refused, never repaired')
assert(Take(s,'code','BFG-7K2M-Q9XD','B0b',0,100)==nil and Take(s,'code','BFG-7K2M-Q9XD',nil,0,100)==nil)
assert(Take(s,'code','BFG-7K2M-Q9XD','Ann',1,100)=='new' and s.code=='BFG-7K2M-Q9XD' and s.from=='Ann' and s.at==100)
s.prompted=s.code
assert(Take(s,'code','BFG-7K2M-Q9XD','Lead',0,200)=='same' and s.prompted==s.code and s.from=='Ann','the same code again asks nothing')
assert(Take(s,'code','BFG-AAAA-BBBB','Lead',0,300)=='new' and s.prompted==nil and s.code=='BFG-AAAA-BBBB','a new code (the leader rotated it) asks once more')
assert(Take(s,'off',nil,'Ann',1,400)==nil and s.code,'an officer cannot take it away')
assert(Take(s,'off',nil,'Lead',0,400)=='gone' and s.code==nil and s.from==nil)
assert(Take(s,'off',nil,'Lead',0,500)==nil,'nothing to take away')
assert(Take(nil,'code','BFG-7K2M-Q9XD','Lead',0,1)==nil and Take({},'weird',nil,'Lead',0,1)==nil and Take({},'code','BFG-7K2M-Q9XD','Lead',0,'x')==nil)
-- The pace helper.
local r={} local R=BackstageForeverLiveRate
assert(R(r,'a',100,10)==true and R(r,'a',105,10)==false and R(r,'a',110,10)==true and R(r,'b',110,10)==true)
assert(R(r,'a',50,10)==true,'a clock that went back does not lock it') assert(R(nil,'a',1,1)==false and R(r,'a','x',1)==false)
`));

test("signal encoders refuse what is not clean, cut what is too long and never let a bar or a control character through", () => lua(PURE + String.raw`
local me=BackstageForeverSignalMe('Abel','Thunder Hold') assert(me=='Abel-Thunder Hold')
for _,bad in ipairs({{'A','R'},{'Ab3l','R'},{'Abel',''},{'Abel','R|x'},{'Abel','R\nx'},{'Ab el','R'},{nil,'R'},{'Abel',nil},{'Abel',string.rep('r',61)}}) do assert(BackstageForeverSignalMe(bad[1],bad[2])==nil) end
local L=BackstageForeverSignalLink
assert(L(me,0,'A','bfg7k2mq9xd','Night  Watch')=='L1|Abel-Thunder Hold|0|A|BFG-7K2M-Q9XD|Night Watch')
assert(L(me,0,'A','BFG-7K2M-Q9XD','Night|cff Watch')=='L1|Abel-Thunder Hold|0|A|BFG-7K2M-Q9XD|Night cff Watch','a bar never travels')
assert(L(me,10,'H','BFG-7K2M-Q9XD','Night Watch')==nil and L(me,1,'N','BFG-7K2M-Q9XD','Night Watch')==nil and L(me,1,'H','nope','Night Watch')==nil and L(me,1,'H','BFG-7K2M-Q9XD','N')==nil and L('Abel',1,'H','BFG-7K2M-Q9XD','Night Watch')==nil and L(me,1.5,'H','BFG-7K2M-Q9XD','Night Watch')==nil)
assert(#L(me,1,'H','BFG-7K2M-Q9XD',string.rep('G',60))==#'L1|Abel-Thunder Hold|1|H|BFG-7K2M-Q9XD|'+24)
local E=BackstageForeverSignalEvent
assert(E(me,{id='abc123',ver=1,creator='Anna',at=1795806000,dungeon='mc',roles={t=2,h=8,d=30},title='Molten Core'})=='E1|Abel-Thunder Hold|abc123|1|Anna|-|1795806000|mc|2.8.30|-|Molten Core|-')
assert(E(me,{id='abc123',ver=1,creator='Anna',at=1795806000,dungeon='mc',roles={t=2,h=8,d=30},title='x'})==nil and E(me,nil)==nil and E(nil,{})==nil)
local long=E(me,{id='abc1234567',ver=9999,creator=string.rep('C',20)..'-'..string.rep('R',20),editor=string.rep('E',20)..'-'..string.rep('R',20),at=1795806000,dungeon='abcdefgh',roles={t=9,h=9,d=40},title=string.rep('t',40),note=string.rep('n',80)})
assert(long and #long<=BackstageForeverSignalMax,'the longest event fits one signal: '..#long)
local U=BackstageForeverSignalSignups
assert(U(me,'abc123',{{n='Bob',s='t',v=1},{n='bob',s='h',v=2},{n='B0b',s='t',v=1},{n='Cy',s='x',v=1},{n='Dee',s='n',v=0},'x',{n='Eve',s='m',v=3}})=='U1|Abel-Thunder Hold|abc123|Bob:t:1,Eve:m:3')
assert(U(me,'abc123',{})==nil and U(me,'ABC',{{n='Bob',s='t',v=1}})==nil and U(me,'abc123','x')==nil)
local many={} for i=1,20 do many[i]={n='N'..string.char(96+i)..'x',s='d',v=i} end
local _,commas=U(me,'abc123',many):gsub(',','') assert(commas==11,'twelve answers a signal')
local P=BackstageForeverSignalParty
assert(P(me,{members={}})=='P1|Abel-Thunder Hold|-|-|0|-|0')
assert(P(me,{leader='B0b',place='SM',planAt=5,members={{name='Abel',class=12,role='x',level=300,online=false,ready='yes'},{name='abel'},{name='A|b'},'x'}})=='P1|Abel-Thunder Hold|-|-|0|Abel:0:-:0:0:0|1')
local raid={} for i=1,40 do raid[i]={name=string.rep(string.char(64+(i-1)%26+1),11)..string.char(97+math.floor((i-1)/26)),class=1,role='d',level=60,online=true} end
local big=P(me,{leader=raid[1].name,place='mc',planAt=1795000000,members=raid})
assert(#big<=BackstageForeverSignalMax+4 and big:match('|40$'),'a raid is cut to what fits; the count says how many there are: '..#big)
local F=BackstageForeverSignalListing
assert(F(me,{id='abcdefgh12345678',kind='g',level=34,class=3,roles='hd',place='sm',note='a|b'})=='F1|Abel-Thunder Hold|abcdefgh12345678|g|34|3|hd|sm|-|a b')
assert(F(me,{id='abcdefgh12345678',gone=true})=='F1|Abel-Thunder Hold|abcdefgh12345678|x')
for _,bad in ipairs({{id='short',gone=true},{id='abcdefgh12345678',kind='q',level=34,roles='',place='sm'},{id='abcdefgh12345678',kind='g',level=0,roles='',place='sm'},{id='abcdefgh12345678',kind='g',level=34,roles='dh',place='sm'},{id='abcdefgh12345678',kind='g',level=34,roles='',place='SM'},{id='ABCDEFGH12345678',kind='g',level=34,roles='',place='sm'}}) do assert(F(me,bad)==nil) end
assert(F(me,{id='abcdefgh12345678',kind='m',level=60,roles='',place='brd',need={t=1,h=0,d=41}}):match('|brd|%-|%-$'),'a need that is off is left out')
`));

test("the waiting list in front of the live link: one entry per key, a cap, a pace, and other players' answers go first when it is full", () => lua(PURE + String.raw`
local Put,Next,Done=BackstageForeverOutboxPut,BackstageForeverOutboxNext,BackstageForeverOutboxDone
local box={}
assert(Put(box,'p','one') and Put(box,'e:abc','event') and Put(box,'p','two') and #box.list==2 and box.list[1].text=='two','the newer party state replaces the one still waiting, and keeps its place')
assert(Put(box,'p','')==false and Put(box,5,'x')==false and Put(box,'k',string.rep('x',700))==false and Put(nil,'k','x')==false)
assert(Next(box,100).text=='two') Done(box,100,true)
assert(Next(box,100.5)==nil and Next(box,101.4)==nil,'one signal every second and a half')
assert(Next(box,101.5).text=='event') Done(box,101.5,true)
assert(Next(box,200)==nil,'nothing waits')
-- Forty in five minutes, then it waits for the window to pass.
local at=1000
for i=1,40 do Put(box,'k'..i,'x') assert(Next(box,at)) Done(box,at,true) at=at+2 end
Put(box,'late','x') assert(Next(box,at)==nil and Next(box,1000+299)==nil and Next(box,1000+300).text=='x')
-- Given up (live link off): no pace is spent.
local b2={} Put(b2,'a','x') Put(b2,'b','y') assert(Next(b2,10)) Done(b2,10,false) assert(Next(b2,10).text=='y')
-- Full: an answer somebody else gave ("u:") goes before your own state.
local b3={}
Put(b3,'l','link') Put(b3,'u:abc:1','heard') for i=1,22 do Put(b3,'e:'..i,'e') end
assert(#b3.list==24) Put(b3,'p','party') assert(#b3.list==24 and b3.list[1].key=='l' and b3.list[2].key=='e:1' and b3.list[24].key=='p')
local b4={} for i=1,24 do Put(b4,'e:'..i,'e') end Put(b4,'p','party') assert(#b4.list==24 and b4.list[1].key=='e:2','without one, the oldest')
`));

test("answers handed over by the desktop app: only newer ones are taken, your own stay yours, Discord ones carry a mark that is kept but never exported", () => lua(PURE + event + String.raw`
local Relay,Sign=BackstageForeverEventSignRelay,BackstageForeverEventSign
local db={events={abc123=event()}} db.events.abc123.signups={}
assert(Relay(db,'abc123','Bob','h',2,'d','Me',NOW)==true)
local row=db.events.abc123.signups.Bob assert(row.s=='h' and row.v==2 and row.r==true and row.d==true)
assert(Relay(db,'abc123','Bob','t',2,'d','Me',NOW)==false and Relay(db,'abc123','Bob','t',1,'g','Me',NOW)==false,'the same or an older version changes nothing')
assert(Relay(db,'abc123','bob','t',3,'k','Me',NOW)==true and db.events.abc123.signups.Bob.s=='t' and db.events.abc123.signups.Bob.d==nil,'given in the app: no Discord mark')
assert(Sign(db,'abc123','Bob','d',1,'Bob',NOW)==true and db.events.abc123.signups.Bob.r==nil,'what Bob says himself in game replaces what was passed on')
-- Your own answer from Discord is yours: the version to beat next time is that one.
assert(Relay(db,'abc123','Me','m',4,'d','Me',NOW)==true and db.events.abc123.signups.Me.r==nil and db.events.abc123.signups.Me.d==true)
assert(BackstageForeverEventAnswer(db,'abc123','Me','t',NOW)==5 and db.events.abc123.signups.Me.d==nil,'answering in game clears the mark')
for _,bad in ipairs({{'nope12','Bob','h',9,'d'},{'abc123','B0b','h',9,'d'},{'abc123','Bob','x',9,'d'},{'abc123','Bob','h',0,'d'},{'abc123','Bob','h',10000,'d'},{'abc123','Bob','h',9.5,'d'},{'abc123','Bob','h',9,'z'},{'abc123','Bob','h',9,nil}}) do
  assert(Relay(db,bad[1],bad[2],bad[3],bad[4],bad[5],'Me',NOW)==false)
end
assert(Relay(db,'abc123','Bob','h',9,'d','Me',NOW+86400+4*3600+1)==false,'not after the event is over')
db.events.abc123.cancelled=true assert(Relay(db,'abc123','Bob','h',9,'d','Me',NOW)==false) db.events.abc123.cancelled=nil
-- Forty answers an event.
local full={events={abc123=event()}} full.events.abc123.signups={}
for i=1,45 do Relay(full,'abc123','N'..string.char(96+(i-1)%26+1)..string.char(97+math.floor((i-1)/26)),'d',1,'d','Me',NOW) end
local n=0 for _ in pairs(full.events.abc123.signups) do n=n+1 end assert(n==40)
-- The mark in the list, kept through a reload, never in the block for the desktop app.
Relay(db,'abc123','Cy','h',2,'d','Me',NOW) Relay(db,'abc123','Ann','h',1,'g','Me',NOW)
local names,count,discord=BackstageForeverEventNames(db.events.abc123,'h')
assert(names=='Ann, Cy (D)' and count==2 and discord==true,names)
local _,_,none=BackstageForeverEventNames(db.events.abc123,'t') assert(none==false)
db.on=true
local cleaned=BackstageForeverEventClean(db,NOW)
assert(cleaned.events.abc123.signups.Cy.d==true and cleaned.events.abc123.signups.Ann.d==nil)
local block=BackstageForeverEventsExport(cleaned,NOW,{me='Me',guild='Night Watch'})
for _,s in ipairs(block.events[1].signups) do for k in pairs(s) do assert(k=='n' or k=='s' or k=='v','the saved block keeps its shape: '..k) end end
-- The message that passes them on.
local Enc,Dec=BackstageForeverEventRelayEncode,BackstageForeverEventRelayDecode
local out=Enc('abc123',{{n='Bob',s='h',v=2,via='d'},{n='Cy',s='m',v=1,via='k'},{n='B0b',s='h',v=2,via='d'},{n='Dee',s='h',v=2,via='x'}})
assert(#out==1 and out[1]=='V|abc123|Bob:h:2:d,Cy:m:1:k',out[1])
local id,rows=Dec(out[1]) assert(id=='abc123' and #rows==2 and rows[1].n=='Bob' and rows[1].via=='d' and rows[2].s=='m' and rows[2].v==1)
local many={} for i=1,30 do many[i]={n=string.rep('N',40)..string.char(96+i%26+1)..string.char(97+math.floor(i/26)),s='d',v=9999,via='d'} end
local chunks=Enc('abc123',many,10) assert(#chunks>=3) for _,c in ipairs(chunks) do assert(#c<=255 and Dec(c)=='abc123') end
assert(#Enc('abc123',many)==4,'four messages at most unless asked otherwise') assert(#Enc('ABC',many)==0 and #Enc('abc123','x')==0)
for _,bad in ipairs({'V|abc123|','V|abc123|Bob:h:2','V|abc123|Bob:h:2:z','V|abc123|Bob:h:0:d','V|abc123|Bob:h:02:d','V|abc123|Bob:h:2:d,','V|abc123|,Bob:h:2:d','V|abc123|Bob:h:2:d,,Cy:h:1:d','V|abc123|Bob:h:2:d,bob:t:3:d','V|ABC123|Bob:h:2:d','V|abc123|B0b:h:2:d','V|abc123|Bob:h:2:d|x','V|abc123|Bob:h:12345:d','V|abc123|'..string.rep('x',260),5}) do assert(Dec(bad)==nil,tostring(bad)) end
local thirteen={} for i=1,13 do thirteen[i]='N'..string.char(96+i)..'x:d:1:d' end assert(Dec('V|abc123|'..table.concat(thirteen,','))==nil)
`));

test("events handed over by the desktop app merge by version: newer wins, ties go to the later name, your own app edit is yours, strangers and text with codes are refused", () => lua(PURE + event + String.raw`
local Desk,Merge=BackstageForeverEventMergeDesk,BackstageForeverEventMerge
-- An event you did not know: taken as a copy (the creator's rank must be allowed to propose).
local db={events={}}
assert(Desk(db,event(),'Me',ctx())=='new' and db.events.abc123.relayed=='Me')
assert(Desk(db,event(),'Me',ctx())==nil,'the same again')
assert(Desk(db,event({ver=2,title='Molten Core late'}),'Me',ctx())=='changed' and db.events.abc123.ver==2)
assert(Desk(db,event({ver=1}),'Me',ctx())==nil,'an older copy never goes back')
-- A copy you heard from its author in game: the service's higher version still replaces it...
local direct={events={}} assert(Merge(direct,event({ver=2}),'Anna',ctx())=='new' and direct.events.abc123.relayed==nil)
assert(Desk(direct,event({ver=2}),'Me',ctx())==nil,'same version, same author: nothing')
assert(Desk(direct,event({ver=1,title='Old'}),'Me',ctx())==nil)
assert(Desk(direct,event({ver=3,title='Moved'}),'Me',ctx())=='changed' and direct.events.abc123.title=='Moved' and direct.events.abc123.ver==3 and direct.events.abc123.relayed=='Me')
-- ...and what the author then says in game replaces the copy again.
assert(Merge(direct,event({ver=3,title='Moved'}),'Anna',ctx())=='quiet' and direct.events.abc123.relayed==nil)
-- Ties: the same version from the later name wins (as in the guild channel), the earlier name loses.
local tie={events={},policy={ver=1,edit=3}}
assert(Merge(tie,event({ver=2,editor='Bob'}),'Bob',ctx({rank=function(n) return n=='Bob' and 1 or 3 end}))=='new')
assert(Desk(tie,event({ver=2,editor='Ann',title='From Ann'}),'Me',ctx({rank=function() return 1 end}))==nil,'Ann sorts before Bob')
assert(Desk(tie,event({ver=2,editor='Cy',title='From Cy'}),'Me',ctx({rank=function() return 1 end}))=='changed' and tie.events.abc123.title=='From Cy' and tie.events.abc123.ver==2)
-- An editor whose rank may not edit is refused, and the copy you had stays exactly as it was.
local strict={events={},policy={ver=1,edit=1}}
Merge(strict,event({ver=2}),'Anna',ctx())
assert(Desk(strict,event({ver=5,editor='Bob',title='Hijack'}),'Me',ctx())==nil and strict.events.abc123.ver==2 and strict.events.abc123.relayed==nil and strict.events.abc123.title=='Molten Core')
-- Another creator under the same id is refused.
assert(Desk(direct,event({ver=9,creator='Bob'}),'Me',ctx())==nil)
-- Your own edit made in the app is yours (direct), so it also beats a copy others hold.
local mine={events={}} local own=BackstageForeverEventCreate(mine,{title='My run',at=NOW+7200,dungeon='mc',roles={t=1,h=1,d=3}},'Me',{now=NOW,rank=function() return 4 end,rand=1})
assert(own and Desk(mine,{id=own.id,ver=2,creator='Me',at=NOW+9000,dungeon='mc',roles={t=1,h=1,d=3},title='My run, later'},'Me',ctx())=='changed' and mine.events[own.id].relayed==nil and mine.events[own.id].at==NOW+9000)
-- Hostile rows: codes, links, bad numbers, events long over or far ahead.
local hostile={events={}}
for _,bad in ipairs({event({title='|cffff0000Red|r'}),event({title='join www.site.example'}),event({note='a\nb'}),event({ver=0}),event({ver=10000}),event({at=NOW-5*3600}),event({at=NOW+200*86400}),event({id='ABC'}),event({dungeon='MC'}),event({roles={t=10,h=1,d=1}}),event({creator='An na'}),'x',5,nil}) do
  assert(Desk(hostile,bad,'Me',ctx())==nil)
end
assert(next(hostile.events)==nil and Desk(nil,event(),'Me',ctx())==nil and Desk(hostile,event(),'M3',ctx())==nil and Desk(hostile,event(),'Me',{})==nil)
-- The whole hand-off: a guild name that is not yours, a creator who is not in your guild, no guild list.
local guild={id='g_a',name='Night Watch',events={event(),event({id='stranger1',creator='Zed'})},signups={{id='abc123',n='Bob',s='h',v=2,via='d'},{id='abc123',n='Zed',s='t',v=1,via='d'},{id='stranger1',n='Bob',s='t',v=1,via='g'}}}
local store={events={}}
local news,why=BackstageForeverDeskMerge(store,{id='g_a',name='Other Guild',events=guild.events,signups=guild.signups},'Me',ctx()) assert(news.count==0 and why=='other' and next(store.events)==nil)
news,why=BackstageForeverDeskMerge(store,guild,'Me',ctx({member=false})) assert(news.count==0 and why=='list' and next(store.events)==nil,'without the guild list nothing is merged')
news=BackstageForeverDeskMerge(store,guild,'Me',ctx())
assert(news.count==2 and #news.events==1 and news.events[1].id=='abc123' and #news.signups.abc123==1 and news.signups.abc123[1].n=='Bob' and store.events.stranger1==nil)
assert(BackstageForeverDeskMerge(store,guild,'Me',ctx()).count==0,'the next reload brings nothing new')
`));

test("passing news on: what the guild already said is left out, your own answer goes as yours, and twenty members who reload together do not storm", () => lua(PURE + event + String.raw`
local Messages,Delay=BackstageForeverRelayMessages,BackstageForeverRelayDelay
local news={events={event({ver=3}),event({id='def456',ver=1,title='Second'})},signups={abc123={{n='Bob',s='h',v=2,via='d'},{n='Me',s='t',v=4,via='d'},{n='Cy',s='m',v=1,via='k'}},def456={{n='Bob',s='n',v=1,via='d'}}}}
local function none() return 0 end
local all=Messages(news,'Me',none)
assert(#all==5 and all[1]:sub(1,11)=='E|abc123|3|' and all[2]:sub(1,9)=='E|def456|' and all[3]=='U|abc123|4|t' and all[4]=='V|abc123|Bob:h:2:d,Cy:m:1:k' and all[5]=='V|def456|Bob:n:1:d',table.concat(all,' / '))
-- Somebody was faster: the same or a newer version heard in the channel is not sent again.
local heardOf={['eabc123']=3,['sabc123:bob']=2,['sdef456:bob']=5}
local rest=Messages(news,'Me',function(k) return heardOf[k] or 0 end)
assert(#rest==3 and rest[1]:sub(1,9)=='E|def456|' and rest[2]=='U|abc123|4|t' and rest[3]=='V|abc123|Cy:m:1:k',table.concat(rest,' / '))
heardOf['eabc123']=2 assert(#Messages(news,'Me',function(k) return heardOf[k] or 0 end)==4,'an older version heard does not count')
assert(#Messages(nil,'Me',none)==0 and #Messages(news,'Me',nil)==0 and #Messages({},'Me',none)==0)
-- Caps: 15 events, 30 messages.
local big={events={},signups={}}
for i=1,25 do big.events[i]=event({id='ev'..(1000+i),title='Run '..i}) end
for i=1,25 do local rows={} for j=1,30 do rows[j]={n='N'..string.char(96+j%26+1)..string.char(97+math.floor(j/26))..'x',s='d',v=1,via='d'} end big.signups['ev'..(1000+i)]=rows end
local capped=Messages(big,'Me',none) local ev=0 for _,m in ipairs(capped) do if m:sub(1,2)=='E|' then ev=ev+1 end assert(#m<=255) end
assert(ev==15 and #capped==30)
-- The wait: two seconds plus a random part that grows with the guild members online, 6 to 30 seconds.
assert(Delay(0,0)==2 and Delay(0,500)==2 and Delay(.5,1)==5 and Delay(.5,10)==9.5 and Delay(.999,20)<32.001 and Delay(.5,400)==17 and Delay(5,20)==2 and Delay('x',nil)==2)
-- Twenty members reload at the same moment with the same news. Each waits its own random time; a
-- message is heard by the others three tenths of a second after it was sent.
local function storm(seed)
  local state=seed
  local function rand() state=(state*1103515245+12345)%2147483648 return state/2147483648 end
  local members={}
  for i=1,20 do members[i]={name='M'..string.char(96+i)..'x',at=Delay(rand(),20)} end
  table.sort(members,function(a,b) return a.at<b.at end)
  local log,total,senders={},0,0
  for _,m in ipairs(members) do
    local known={}
    for _,row in ipairs(log) do if row.at+.3<=m.at then if (known[row.key] or 0)<row.ver then known[row.key]=row.ver end end end
    local out=Messages(news,'Nobody',function(k) return known[k] or 0 end)
    if #out>0 then senders=senders+1 end
    total=total+#out
    for _,text in ipairs(out) do
      local e=BackstageForeverEventDecode(text,NOW)
      if e then log[#log+1]={at=m.at,key='e'..e.id,ver=e.ver}
      else local id,rows=BackstageForeverEventRelayDecode(text) for _,r in ipairs(rows or {}) do log[#log+1]={at=m.at,key='s'..id..':'..r.n:lower(),ver=r.v} end end
    end
  end
  -- Everything was said at least once.
  local said={} for _,row in ipairs(log) do said[row.key]=true end
  for _,k in ipairs({'eabc123','edef456','sabc123:bob','sabc123:cy','sabc123:me','sdef456:bob'}) do assert(said[k],k) end
  return total,senders
end
local worst,sum=0,0
for seed=1,200 do local total,senders=storm(seed) sum=sum+senders if senders>worst then worst=senders end assert(total<=4*4,'seed '..seed..': '..total..' messages') end
assert(worst<=4 and sum/200<1.6,'of twenty, nearly always one talks: worst '..worst..', mean '..sum/200)
`));

test("your board listing: what you type becomes a listing, plain words only, and it leaves after two hours", () => lua(PURE + String.raw`
local Parse,Make=BackstageForeverListingParse,BackstageForeverListingMake
local p=Parse('sm healer') assert(p.place=='sm' and p.roles=='h' and p.need==nil and p.note==nil)
p=Parse('Scarlet Monastery DPS Tank : Have the Key') assert(p.place=='sm' and p.roles=='td' and p.note=='Have the Key',p.roles)
p=Parse('brd need 1 0 2 : fast run') assert(p.place=='brd' and p.need.t==1 and p.need.h==0 and p.need.d==2 and p.roles=='' and p.note=='fast run')
p=Parse('need 1 1 3 molten core') assert(p.place=='mc' and p.need.d==3)
local _,why=Parse('nowhere healer') assert(why=='place')
_,why=Parse('sm need 0 0 0') assert(why=='need') _,why=Parse('sm need 1') assert(why=='need') _,why=Parse('sm need 10 0 0') assert(why=='need') _,why=Parse('sm need 1 0 41') assert(why=='need')
_,why=Parse('sm healer : join www.site.example') assert(why=='note')
p=Parse('sm : |cffff0000red|r note') assert(p.note=='red note','codes are taken out of the note')
assert(Parse(nil)==nil and Parse(string.rep('x',201))==nil and Parse('')==nil)
local n=0 local function rand() n=n+1 return (n*7%36)/36 end
local l=Make(Parse('sm healer : have key'),34,3,1795000000,rand)
assert(#l.id==16 and l.id:match('^[%l%d]+$') and l.kind=='g' and l.level==34 and l.class==3 and l.roles=='h' and l.place=='sm' and l.note=='have key' and l.at==1795000000)
local again=Make(Parse('sm tank'),35,3,1795000100,rand,l) assert(again.id==l.id and again.roles=='t','the id stays while the listing stands')
assert(Make(Parse('brd need 1 0 2'),60,nil,1795000000,rand).kind=='m' and Make(Parse('brd need 1 0 2'),60,12,1795000000,rand).class==0)
assert(Make(nil,34,3,1795000000,rand)==nil and Make(Parse('sm'),0,3,1795000000,rand)==nil and Make(Parse('sm'),34,3,5,rand)==nil)
assert(#Make(Parse('sm'),34,3,1795000000,nil).id==16 and #Make(Parse('sm'),34,3,1795000000,function() return 'x' end).id==16)
local W=BackstageForeverListingWanted
assert(W({kind='g',roles='hd'})=='plays healer, damage' and W({kind='g',roles=''})=='wants a group' and W({kind='m',need={t=1,h=0,d=2}})=='needs 1 tank, 2 damage' and W({kind='m',roles=''})=='players' and W(nil)=='')
local X=BackstageForeverListingExpired
assert(X(l,1795000000+7199)==false and X(l,1795000000+7200)==true and X(l,1795000000-400)==true and X(nil,1)==true and X({at='x'},1)==true)
-- The rows the board paints: age as of the reload, never "now".
local rows,more=BackstageForeverLfgBoardRows({{id='a',kind='g',who='Cy',level=34,roles='d',place='sm',at=1795000000-30},{id='b',kind='m',who='Dee',level=60,place='brd',need={t=1,h=0,d=2},note='fast run',at=1795000000-3*3600}},1795000000,1)
assert(#rows==1 and more==1 and rows[1].dungeon=='Scarlet Monastery' and rows[1].who=='Cy (34)' and rows[1].wanted=='plays damage' and rows[1].age=='1 min',rows[1].age)
rows=BackstageForeverLfgBoardRows({{id='b',kind='m',who='Dee',level=60,place='brd',need={t=1,h=0,d=2},note='fast run',at=1795000000-3*3600}},1795000000)
assert(rows[1].age=='3 h' and rows[1].wanted:find('needs 1 tank, 2 damage',1,true) and rows[1].wanted:find('fast run',1,true))
assert(#BackstageForeverLfgBoardRows(nil,1)==0)
`));

test("the group plan and party state: strict messages, who may set a plan, roles, and the lines a member reads", () => lua(PURE + String.raw`
local SE,SD=BackstageForeverCrewStateEncode,BackstageForeverCrewStateDecode
assert(SE({class=5,level=34,role='h',ready=true})=='B|5|34|h|1' and SE({})=='B|0|0|-|0' and SE({class=12,level=300,role='x',ready='yes'})=='B|0|0|-|0' and SE(nil)==nil)
local s=SD('B|5|34|h|1') assert(s.class==5 and s.level==34 and s.role=='h' and s.ready==true)
s=SD('B|0|0|-|0') assert(s.class==nil and s.level==nil and s.role==nil and s.ready==false)
for _,bad in ipairs({'B','B|5|34|h','B|5|34|h|2','B|5|34|x|1','B|10|34|h|1','B|5|101|h|1','B|5|034|h|1','B|5|34|h|1|','B|5|-1|h|1','b|5|34|h|1',5,'B|5|34|h|1 '}) do assert(SD(bad)==nil,tostring(bad)) end
-- The plan as messages, and back.
local plan={at=1795000000,place='sm',note='Meet at the stone',members={{name='Abel',role='h',bring='Skeleton Key'},{name='Bob',role='t'},{name='Cy'}}}
local msgs=BackstageForeverPlanEncode(plan)
assert(#msgs==4 and msgs[1]=='T|1795000000|sm|3|Meet at the stone' and msgs[2]=='t|1795000000|1|Abel|h|Skeleton Key' and msgs[3]=='t|1795000000|2|Bob|t|-' and msgs[4]=='t|1795000000|3|Cy|-|-')
for _,m in ipairs(msgs) do assert(#m<=255) end
local state={} local got
for i,m in ipairs(msgs) do got=BackstageForeverPlanReceive(state,'Lead',m) assert((got~=nil)==(i==4)) end
assert(got.at==1795000000 and got.place=='sm' and got.note=='Meet at the stone' and #got.members==3 and got.members[1].bring=='Skeleton Key' and got.members[2].role=='t' and got.members[3].role==nil and state.Lead==nil)
-- Rows in any order; a row for another plan, twice, or out of range drops the unfinished plan.
state={} BackstageForeverPlanReceive(state,'Lead',msgs[1]) assert(BackstageForeverPlanReceive(state,'Lead',msgs[4])==nil and BackstageForeverPlanReceive(state,'Lead',msgs[2])==nil and BackstageForeverPlanReceive(state,'Lead',msgs[3]).members[3].name=='Cy')
for _,bad in ipairs({'t|1795000001|1|Abel|h|-','t|1795000000|4|Abel|h|-','t|1795000000|0|Abel|h|-','t|1795000000|1|Ab3l|h|-','t|1795000000|1|Abel|x|-','t|1795000000|1|Abel|h|a|b','t|1795000000|1|Abel|h|  padded','t|1795000000|1|Abel|h|'..string.rep('b',61)}) do
  state={} BackstageForeverPlanReceive(state,'Lead',msgs[1])
  assert(BackstageForeverPlanReceive(state,'Lead',bad)==nil and state.Lead==nil,bad)
end
state={} BackstageForeverPlanReceive(state,'Lead',msgs[1]) BackstageForeverPlanReceive(state,'Lead',msgs[2]) assert(BackstageForeverPlanReceive(state,'Lead',msgs[2])==nil and state.Lead==nil,'the same row twice')
state={} assert(BackstageForeverPlanReceive(state,'Lead',msgs[2])==nil,'a row without a head')
for _,bad in ipairs({'T|5|sm|3|-','T|1795000000|SM|3|-','T|1795000000|sm|11|-','T|1795000000|sm|3|a|b','T|1795000000|sm|3|'..string.rep('n',81),'T|1795000000|sm|x|-','T|17950000000|sm|3|-'}) do state={} assert(BackstageForeverPlanReceive(state,'Lead',bad)==nil and state.Lead==nil,bad) end
state={} local empty=BackstageForeverPlanReceive(state,'Lead','T|1795000000|sm|0|-') assert(empty and #empty.members==0 and empty.place=='sm','a place without roles is a plan too')
assert(#BackstageForeverPlanEncode({at=1795000000,members={}})==0 and #BackstageForeverPlanEncode({at=5,place='sm',members={}})==0 and #BackstageForeverPlanEncode(nil)==0)
local eleven={} for i=1,14 do eleven[i]={name='N'..string.char(96+i)..'x',role='d'} end assert(#BackstageForeverPlanEncode({at=1795000000,members=eleven})==11,'ten members at most')
-- Who may set it.
local Take=BackstageForeverPlanTake
assert(Take(nil,got,'Bob',false,1795000100)==true,'the first plan counts, whoever made it')
assert(Take({at=1795000000,by='Bob'},{at=1795000050,members={}},'Cy',false,1795000100)==true and Take({at=1795000000,by='Bob'},{at=1794999999,members={}},'Cy',false,1795000100)==false,'among members the newer one wins')
assert(Take({at=1795000500,by='Bob'},{at=1795000000,members={}},'Lead',true,1795000600)==true,'the leader wins over a member, even with an older plan')
assert(Take({at=1795000000,by='Lead',leader=true},{at=1795000999,members={}},'Bob',false,1795001000)==false,'a member never replaces the leader\'s plan')
assert(Take({at=1795000000,by='Lead',leader=true},{at=1795000001,members={}},'Lead',true,1795000100)==true and Take({at=1795000000,by='Lead',leader=true},{at=1795000000,members={}},'Lead',true,1795000100)==false)
assert(Take({at=1795000000,by='Old',leader=true},{at=1795000000,members={}},'New',true,1795000100)==true,'a new leader')
assert(Take(nil,{at=1795000000+601,members={}},'Lead',true,1795000000)==false,'a plan from the future is refused')
assert(Take(nil,nil,'Lead',true,1)==false and Take(nil,got,'L3ad',true,1795000100)==false and Take(nil,{at='x'},'Lead',true,1795000100)==false)
-- Setting roles.
local p=BackstageForeverPlanSetRole(nil,'Bob','t',1795000000) assert(p.at==1795000000 and #p.members==1 and p.members[1].role=='t')
BackstageForeverPlanSetRole(p,'bob','h',1795000000) assert(#p.members==1 and p.members[1].role=='h' and p.at==1795000001,'every change is newer than the last')
BackstageForeverPlanSetRole(p,'Bob',nil,1795000500) assert(p.members[1].role==nil and p.at==1795000500)
local _,why=BackstageForeverPlanSetRole(p,'B0b','t',1795000000) assert(why=='name') _,why=BackstageForeverPlanSetRole(p,'Bob','x',1795000000) assert(why=='name')
local fullPlan={members={}} for i=1,10 do fullPlan.members[i]={name='N'..string.char(96+i)..'x'} end _,why=BackstageForeverPlanSetRole(fullPlan,'Zed','t',1795000000) assert(why=='full')
-- What a member reads.
plan.by='Lead'
assert(BackstageForeverPlanMyLine(plan,'abel')=='Your role: Healer. Bring: Skeleton Key.' and BackstageForeverPlanMyLine(plan,'Bob')=='Your role: Tank.' and BackstageForeverPlanMyLine(plan,'Cy')==nil and BackstageForeverPlanMyLine(plan,'Zed')==nil)
local lines=BackstageForeverPlanLines(plan,'Abel',{bob={ready=true}},function(id) return id=='sm' and 'Scarlet Monastery' or id end)
assert(#lines==5 and lines[1]=='Group plan: Scarlet Monastery (from Lead).' and lines[2]=='  Meet at the stone' and lines[3]=='Your role: Healer. Bring: Skeleton Key.' and lines[4]=='  Bob: Tank, ready' and lines[5]=='  Cy: no role yet',table.concat(lines,' / '))
assert(BackstageForeverPlanLines(nil,'Abel')[1]:find('No group plan yet',1,true))
assert(BackstageForeverPlanLines({at=1,members={}},'Abel')[1]=='Group plan.')
`));

test("announcements: party or guild chat only, a pace, plain text, and only objectives that just became finished", () => lua(PURE + String.raw`
local Ch=BackstageForeverSayChannel
assert(Ch('party',true,false,true)=='PARTY' and Ch('party',true,true,true)==nil and Ch('party',false,false,true)==nil,'a party line goes to a party of five, never a raid')
assert(Ch('guild',false,false,true)=='GUILD' and Ch('guild',true,false,false)==nil)
for _,other in ipairs({'say','yell','channel','SAY','raid','whisper','officer',true,nil,5}) do assert(Ch(other,true,true,true)==nil,tostring(other)) end
local Pass=BackstageForeverSayPass
local st={}
assert(Pass(st,'quest',100)==true and Pass(st,'quest',107)==false and Pass(st,'quest',108)==true and Pass(st,'objective',108)==true and Pass(st,'objective',120)==false and Pass(st,'objective',123)==true)
assert(Pass(st,'ready',124)==true and Pass(st,'quest',130)==true and Pass(st,'quest',140)==false and Pass(st,'ready',150)==false,'six lines in five minutes')
assert(Pass(st,'quest',100+300)==true,'then the window passed')
assert(Pass(st,'dance',1)==false and Pass(nil,'quest',1)==false and Pass(st,'quest','x')==false)
local Text=BackstageForeverSayText
assert(Text('quest','Raptor Thieves')=='Quest done: Raptor Thieves.' and Text('objective','Raptor Head: 8/8')=='Objective done: Raptor Head: 8/8.' and Text('ready','Scarlet Monastery')=='Ready for Scarlet Monastery.' and Text('ready',nil)=='Ready.')
assert(Text('quest','|cffff0000Red|r |Hquest:1|h[Link]|h')=='Quest done: Red [Link].' and Text('quest','a\nb')=='Quest done: a b.' and Text('quest',nil)==nil and Text('quest','   ')==nil and Text('dance','x')==nil)
assert(#Text('quest',string.rep('q',300))<=120)
local Done=BackstageForeverObjectivesDone
local before={['1:1']={done=false,text='Raptor Head: 7/8'},['1:2']={done=true,text='Old'},['2:1']={done=false,text='Other'}}
local after={['1:1']={done=true,text='Raptor Head: 8/8'},['1:2']={done=true,text='Old'},['2:1']={done=false,text='Other'},['3:1']={done=true,text='New quest, already done'}}
local out=Done(before,after) assert(#out==1 and out[1]=='Raptor Head: 8/8','only what just became finished; a quest new in the log says nothing')
assert(#Done(nil,after)==0 and #Done(before,nil)==0 and #Done(after,before)==0)
`));

test("live link: signals wait behind your own questions, replace by key, never go up in combat, and say why when they cannot", () => lua(String.raw`
local t=1 GetTime=function() return t end
local combat=false InCombatLockdown=function() return combat end
UnitGUID=function() return 'Player-1-00000001' end
time=function() return 1795000000 end
dofile('addon/BackstageForever/BackstageForeverLive.lua')
BackstageForeverLiveSettings={enabled=true,hairlineOnce=true}
local S,W=BackstageForeverLiveSignal,BackstageForeverLiveSignalsWaiting
local id,pages=S('P1|Me-Realm|-|-|0|-|0','p') assert(id==1 and pages==2 and W()==1)
local id2=S('P1|Me-Realm|Me|sm|0|-|0','p') assert(id2==2 and W()==1,'the newer state replaces the one that has not started')
assert(S('E1|x','e:1') and S('E1|y','e:2') and W()==3)
local none,why=S('E1|z','e:3') assert(none==nil and why=='busy' and W()==3,'three wait at most; the caller tries again')
none,why=S('','k') assert(why=='invalid') none,why=S('a\nb','k') assert(why=='invalid') none,why=S(string.rep('x',595),'k') assert(why=='invalid') none,why=S(5,'k') assert(why=='invalid')
combat=true none,why=S('L1|x','l') assert(none==nil and why=='combat') combat=false
BackstageForeverLiveSettings.enabled=false none,why=S('L1|x','l') assert(none==nil and why=='off') BackstageForeverLiveSettings.enabled=true
-- A question the player typed shares the id counter and goes first.
local q=BackstageForeverLiveQuestion('where is the flight master') assert(q==5,'ids never collide: '..tostring(q))
local status=BackstageForeverLiveQuestionStatus() assert(status and status.id==5 and status.waiting==1,'the status speaks of questions only')
`));

test("guild link in game: the leader's code goes to addons and never to chat, a member is asked once, an officer answers a request once, only the leader unlinks", () => lua(STUBS + ALL + String.raw`
useFakeLink()
fire('PLAYER_LOGIN')
-- A member cannot set it, a wrong code is refused, and nobody is in doubt why.
BackstageForeverGuildCommand('guild link BFG-7K2M-Q9XD') assert(last():find('Only the guild leader or the rank below',1,true) and #texts('K|')==0)
me,myRank='Lead',0
BackstageForeverGuildCommand('guild link hello') assert(last():find('not a guild link code',1,true) and #texts('K|')==0)
said={}
BackstageForeverGuildCommand('guild link bfg-7k2m-q9xd')
assert(#texts('K|','GUILD')==1 and texts('K|')[1]=='K|BFG-7K2M-Q9XD','the code goes to the guild\'s addons')
for _,m in ipairs(said) do assert(not m:find('7K2M',1,true) and not m:find('7k2m',1,true),'the code is never printed: '..m) end
assert(#chat==0,'and never sent to chat')
assert(heard('Guild link set') and BackstageForeverLiveGuildDB.code=='BFG-7K2M-Q9XD' and BackstageForeverLiveGuildDB.prompted=='BFG-7K2M-Q9XD','the one who set it is not asked to join by a prompt')
-- Again on request, at most every ten seconds by hand.
BackstageForeverGuildCommand('guild link') assert(#texts('K|')==1 and last():find('a moment ago',1,true))
flushAll() assert(#signalled('L1|')==1 and signalled('L1|')[1]=='L1|Lead-Thunder Hold|0|H|BFG-7K2M-Q9XD|Night Watch')
sent={sent[1]}
clock=clock+11 BackstageForeverGuildCommand('guild link') assert(#texts('K|')==2 and heard('again'))
-- A member who came online asks: one answer after a short wait, then quiet for three minutes.
clock=clock+200 from('Bob','K?') runAfter() assert(#texts('K|')==3)
clock=clock+30 from('Cy','K?') runAfter() assert(#texts('K|')==3,'at most every three minutes')
clock=clock+200 from('Cy','K?') from('Ann','K|BFG-7K2M-Q9XD') runAfter() assert(#texts('K|')==3,'somebody else answered while this one waited')
-- The member's side.
me,myRank='Me',4
BackstageForeverLiveGuildDB={} signals={} said={}
clock=clock+10 from('Bob','K|BFG-7K2M-Q9XD') assert(BackstageForeverLiveGuildDB.code==nil and #said==0,'a member\'s word is not enough')
clock=clock+10 from('Lead','K|bfg-7k2m-q9xd') from('Lead','K|BFG-7K2M') assert(BackstageForeverLiveGuildDB.code==nil)
clock=clock+10 from('Ann','K|BFG-7K2M-Q9XD')
assert(BackstageForeverLiveGuildDB.code=='BFG-7K2M-Q9XD' and #said==1 and said[1]=='Backstage Forever: Your guild uses Backstage Forever events. Open the desktop app to join.')
assert(frames.BackstageForeverGuildPrompt and frames.BackstageForeverGuildPrompt.shown==true,'one clear prompt')
flushAll() assert(#signalled('L1|')==1 and signalled('L1|')[1]=='L1|Me-Thunder Hold|4|H|BFG-7K2M-Q9XD|Night Watch','guild.link: the code heard, guild, realm, side, character and rank')
clock=clock+10 from('Lead','K|BFG-7K2M-Q9XD') assert(#said==1,'the same code again asks nothing')
-- In combat the prompt waits.
BackstageForeverLiveGuildDB={} said={} combat=true
clock=clock+10 from('Lead','K|BFG-AAAA-BBBB') assert(#said==0 and BackstageForeverLiveGuildDB.code=='BFG-AAAA-BBBB')
combat=false fire('PLAYER_REGEN_ENABLED') assert(#said==1 and BackstageForeverLiveGuildDB.prompted=='BFG-AAAA-BBBB')
-- Unlink: an officer cannot, the leader can; members hear it and the desktop app is told.
signals={} clock=clock+10 from('Ann','K|-') assert(BackstageForeverLiveGuildDB.code)
clock=clock+10 from('Lead','K|-') assert(BackstageForeverLiveGuildDB.code==nil and last():find('took away',1,true))
flushAll() assert(signalled('X1|')[1]=='X1|Me-Thunder Hold|H|Night Watch')
BackstageForeverGuildCommand('guild unlink') assert(last():find('Only the guild leader takes',1,true))
me,myRank='Lead',0 BackstageForeverLiveGuildDB={code='BFG-7K2M-Q9XD'}
BackstageForeverGuildCommand('guild unlink') assert(texts('K|')[#texts('K|')]=='K|-' and BackstageForeverLiveGuildDB.code==nil and last():find('Delete guild in the desktop app',1,true))
-- The switch: off means nothing is queued and link messages are not read.
me,myRank='Me',4 BackstageForeverLiveGuildDB={} signals={}
BackstageForeverGuildCommand('guild desk off') assert(BackstageForeverLiveGuildDB.desk==false and last():find('To the desktop app: off',1,true))
clock=clock+10 from('Lead','K|BFG-7K2M-Q9XD') flushAll() assert(BackstageForeverLiveGuildDB.code==nil and #signals==0 and BackstageForeverLiveSend('p','P1|x')==false)
BackstageForeverGuildCommand('guild desk on') assert(BackstageForeverLiveGuildDB.desk==true)
-- The old words still work.
BackstageForeverGuildCommand('guild') assert(last():find('Guild sharing is off',1,true))
`));

test("events and answers reach the desktop app at once and your guild at once; the pace of the link is kept", () => lua(STUBS + ALL + String.raw`
useFakeLink()
fire('PLAYER_LOGIN')
BackstageForeverEventCommand('event on') sent={} signals={}
clock=clock+10
-- Your own event: the guild message leaves in the same moment (no wait for the next tick), and the signal follows.
local e=BackstageForeverEventsApi.create({title='Molten Core',at=NOW+86400,dungeon='mc',roles={t=2,h=4,d=14},note='Bring fire resist'})
assert(e and #texts('E|','GUILD')==1,'sent at once')
BackstageForeverLiveFlush() assert(#signalled('E1|Me-Thunder Hold|'..e.id..'|1|Me|-|')==1)
clock=clock+10 assert(BackstageForeverEventsApi.answer(e.id,'h') and texts('U|')[1]=='U|'..e.id..'|1|h','your answer too')
clock=clock+2 BackstageForeverLiveFlush() assert(signalled('U1|')[1]=='U1|Me-Thunder Hold|'..e.id..'|Me:h:1')
-- A burst is still spread out: the second of two messages in the same moment waits for the queue.
clock=clock+10 local before=#sent
BackstageForeverEventsApi.answer(e.id,'t') BackstageForeverEventsApi.change(e.id,{cancelled=true})
assert(#sent==before+1) pumpAll() assert(#sent==before+2)
flushAll()
-- Heard in the guild channel: an event is signalled, answers are gathered for five seconds.
signals={} clock=clock+10
from('Anna','E|abc123|1|Anna|-|'..(NOW+86400)..'|mc|2.4.14|-|Guild night|-')
from('Bob','U|abc123|1|t') from('Cy','U|abc123|2|m')
flushAll() assert(#signalled('E1|Me-Thunder Hold|abc123|1|Anna|-|')==1 and #signalled('U1|')==0,'answers wait to go together')
runAfter() flushAll()
local u=signalled('U1|') assert(#u==1 and (u[1]=='U1|Me-Thunder Hold|abc123|Bob:t:1,Cy:m:2' or u[1]=='U1|Me-Thunder Hold|abc123|Cy:m:2,Bob:t:1'),u[1])
-- The same message again is not news and signals nothing.
signals={} from('Anna','E|abc123|1|Anna|-|'..(NOW+86400)..'|mc|2.4.14|-|Guild night|-') from('Bob','U|abc123|1|t') runAfter() flushAll() assert(#signals==0)
-- The link is busy or the player is in combat: the entry waits. The link is off: it is given up (the saved file has it).
linkSays='busy' BackstageForeverLiveSend('p','P1|Me-Thunder Hold|-|-|0|-|0') flushAll() assert(#signals==0)
linkSays=nil combat=true flushAll() assert(#signals==0) combat=false flushAll() assert(#signals==1)
linkSays='off' BackstageForeverLiveSend('p','P1|Me-Thunder Hold|Me|-|0|-|0') flushAll() linkSays=nil flushAll() assert(#signals==1)
-- The block for the saved file carries your own answers and the link, so nothing is lost without the live link.
BackstageForeverLiveGuildDB.code='BFG-7K2M-Q9XD'
BackstageForeverEventsApi.answer('abc123','d')
local block,lists=BackstageForeverLiveGuildSnapshot()
assert(block.v==1 and block.me=='Me-Thunder Hold' and block.faction=='H' and block.link.code=='BFG-7K2M-Q9XD' and block.link.guild=='Night Watch' and block.link.rank==4 and #block.mine==1 and block.mine[1].id=='abc123' and block.mine[1].s=='d' and lists[1]==block.mine)
BackstageForeverLiveGuildDB.desk=false assert(BackstageForeverLiveGuildSnapshot()==nil,'with the switch off the saved file says nothing either')
`));

test("after a reload the hand-off is merged and passed on once: a random wait, the guild's own words first, Discord answers marked, strangers left out", () => lua(STUBS + ALL + String.raw`
useFakeLink()
BackstageForeverEventsDB={on=true}
BackstageForeverDesktopData={schema=1,characters={},guild={id='g_abc',n='Night Watch',discord='connected',
  events={{'abc123',3,'Anna','',NOW+86400,'mc',2,8,30,0,'Molten Core','Bring fire'},{'def456',1,'Lead','',NOW+2*86400,'mc',2,8,30,0,'Second night',''},{'zed999',1,'Zed','',NOW+86400,'mc',1,1,1,0,'From a stranger',''},{'bad111',1,'Anna','',NOW+86400,'mc',1,1,1,0,'|cffff0000Red|r',''}},
  signups={{'abc123','Bob','h',2,'d'},{'abc123','Me','t',4,'d'},{'abc123','Zed','t',1,'d'},{'def456','Cy','m',1,'k'}}},
  lfg={r='Thunder Hold',f='H',rows={{'abcdefgh12345678','g','Cy','Thunder Hold',34,3,'d','sm','',-1,-1,-1,NOW-600}}}}
fire('PLAYER_LOGIN') sent={}
runAfter()
local store=BackstageForeverEventsDB.events
assert(store.abc123 and store.abc123.ver==3 and store.def456 and store.zed999==nil and store.bad111==nil,'merged; the stranger and the coloured title are left out')
assert(store.abc123.signups.Bob.d==true and store.abc123.signups.Me.s=='t' and store.abc123.signups.Me.v==4 and store.abc123.signups.Zed==nil and store.def456.signups.Cy.s=='m')
assert(heard('From the desktop app: 5 new or changed'),last())
assert(BackstageForeverLiveGuildDB.joined==nil,'no code was heard yet')
assert(#texts('E|')==0 and #texts('V|')==0,'nothing is passed on before the wait is over')
local wait=0 for _,row in ipairs(after) do if row[1]>wait then wait=row[1] end end
assert(wait>=2 and wait<=32,'a random wait: '..wait)
-- While this member waits, a guild mate who reloaded first says one event and one answer.
from('Ann','E|abc123|3|Anna|-|'..(NOW+86400)..'|mc|2.8.30|-|Molten Core|Bring fire')
from('Ann','V|abc123|Bob:h:2:d')
clock=clock+60 runAfter() pumpAll()
local e,v,u=texts('E|','GUILD'),texts('V|','GUILD'),texts('U|','GUILD')
assert(#e==1 and e[1]:sub(1,11)=='E|def456|1|','only the event the guild has not heard: '..table.concat(e,' / '))
assert(#v==1 and v[1]=='V|def456|Cy:m:1:k',table.concat(v,' / '))
assert(#u==1 and u[1]=='U|abc123|4|t','your own Discord answer goes out as your own')
-- The events window shows the small mark.
local names,_,discord=BackstageForeverEventNames(store.abc123,'h') assert(names=='Bob (D)' and discord)
-- The realm board came with it, for this realm and side.
local rows,given=BackstageForeverLfgDeskRows() assert(given and #rows==1 and rows[1].who=='Cy')
said={} BackstageForeverLfgCommand('lfg board') assert(said[1]:find('Realm board, as of your last /reload: 1',1,true) and said[2]:find('Scarlet Monastery: Cy (34), plays damage (10 min)',1,true),said[2])
-- A second reload with the same file brings nothing and says nothing.
sent={} said={} BackstageForeverLiveReadDesk() runAfter() pumpAll() assert(#sent==0 and not heard('From the desktop app'))
-- An answer about you passed on by a guild mate: taken when newer, and you are told who passed it on.
said={} clock=clock+10 from('Bob','V|abc123|Me:h:5:d')
assert(store.abc123.signups.Me.s=='h' and store.abc123.signups.Me.v==5 and last():find('Your answer to Molten Core is now: healer',1,true) and last():find('Discord, passed on by Bob',1,true),last())
clock=clock+10 from('Bob','V|abc123|Me:n:5:d') assert(store.abc123.signups.Me.s=='h','not the same version again')
-- With guild events off nothing is merged; the player is told once what waits.
BackstageForeverEventsDB={on=false} said={} sent={}
BackstageForeverLiveReadDesk() runAfter() assert(next(BackstageForeverEventsDB.events or {})==nil and heard('The desktop app has guild events for you') and #sent==0)
-- A hand-off for another guild is left alone.
BackstageForeverEventsDB={on=true} BackstageForeverDesktopData.guild.n='Other Guild' said={}
BackstageForeverLiveReadDesk() runAfter() assert(next(BackstageForeverEventsDB.events or {})==nil and not heard('From the desktop app'))
`));

test("party: roles and the plan reach everybody at once, your state follows changes, and the desktop app hears the party state", () => lua(STUBS + ALL + String.raw`
useFakeLink()
BackstageForeverDesktopData={schema=1,characters={},plan={p='sm',n='Meet at the stone',t=NOW-60,f='Me-Thunder Hold',m={{'Me','h','Skeleton Key'},{'Ann','t',''},{'Bob','-',''}}}}
fire('PLAYER_LOGIN') runAfter()
assert(heard('Your role: Healer. Bring: Skeleton Key.'),'the plan from the desktop app is said at login')
assert(BackstageForeverLiveGuildDB.plan.place=='sm' and BackstageForeverLiveGuildDB.plan.by=='Me')
-- Joining a party: your state and the plan go out without anybody asking.
grouped=true sent={} clock=clock+10
fire('GROUP_ROSTER_UPDATE') runAfter()
assert(texts('B|','PARTY')[1]=='B|3|34|h|0','class, level, role from the plan, not ready')
local t=texts('T|','PARTY') assert(#t==1 and t[1]=='T|'..(NOW-60)..'|sm|3|Meet at the stone' and #texts('t|','PARTY')==3)
BackstageForeverLivePartyTick() flushAll()
local p=signalled('P1|') assert(#p==1 and p[1]=='P1|Me-Thunder Hold|Me|sm|'..(NOW-60)..'|Me:3:h:34:1:0;Ann:5:t:36:1:0;Bob:5:-:36:1:0|3',p[1])
-- A member says who they are and that they are ready: told once, and the app hears the new state.
said={} from('Bob','B|1|35|d|1','PARTY') assert(last()=='Backstage Forever: Bob says: ready.')
from('Bob','B|1|35|d|1','PARTY') assert(#said==1)
from('Bob','B|1|35|x|1','PARTY') from('Bob','B|99','PARTY')
BackstageForeverLivePartyTick() flushAll() assert(signalled('P1|')[2]:find('Bob:5:d:36:1:1',1,true),'the role and ready flag a member told: '..signalled('P1|')[2])
-- The leader sets a role in game: the party hears at once and the desktop app gets party.state.
sent={} clock=clock+10
BackstageForeverPlanCommand('plan role bob tank')
assert(last():find('Bob plays Tank',1,true) and #texts('T|','PARTY')==1 and texts('t|','PARTY')[3]:match('|3|Bob|t|%-$'),table.concat(texts('t|'),' / '))
BackstageForeverLivePartyTick() flushAll() assert(signalled('P1|')[3]:find('Bob:5:t:36:1:1',1,true))
BackstageForeverPlanCommand('plan role Zed tank') assert(last():find('Zed is not in your group',1,true))
BackstageForeverPlanCommand('plan role Bob bard') assert(last():find('Use /bf plan role NAME',1,true))
-- Ready.
sent={} clock=clock+10 BackstageForeverPlanCommand('plan ready') assert(texts('B|','PARTY')[1]=='B|3|34|h|1' and last():find('you are ready',1,true))
assert(#chat==0,'no chat line unless the player switched announcements on')
-- /bf plan prints it.
said={} BackstageForeverPlanCommand('plan')
assert(said[1]=='Backstage Forever: Group plan: Scarlet Monastery (from Me).' and said[3]=='Backstage Forever: Your role: Healer. Bring: Skeleton Key.' and said[5]:find('Bob: Tank, ready',1,true),table.concat(said,' / '))
-- As a member: the leader's plan arrives in pieces and you read your line; a member cannot replace it.
leader='party1' BackstageForeverLiveGuildDB.plan=nil said={} clock=clock+10
from('Ann','T|'..NOW..'|sm|2|-','PARTY') from('Ann','t|'..NOW..'|1|Me|d|Fire protection potion','PARTY') assert(BackstageForeverLiveGuildDB.plan==nil)
from('Ann','t|'..NOW..'|2|Bob|t|-','PARTY')
assert(BackstageForeverLiveGuildDB.plan.by=='Ann' and BackstageForeverLiveGuildDB.plan.leader==true and heard('Group plan from Ann: Scarlet Monastery') and heard('Your role: Damage. Bring: Fire protection potion.'))
from('Bob','T|'..(NOW+50)..'|mc|0|-','PARTY') assert(BackstageForeverLiveGuildDB.plan.place=='sm','a member never replaces the leader\'s plan')
from('Ann','T|'..(NOW+5000)..'|mc|0|-','PARTY') assert(BackstageForeverLiveGuildDB.plan.place=='sm','nor does a plan from the future')
BackstageForeverPlanCommand('plan role Bob healer') assert(last():find('Only the party leader sets roles',1,true))
BackstageForeverPlanCommand('plan me tank') assert(last():find('already gives you a role',1,true))
sent={} BackstageForeverPlanCommand('plan share') assert(#texts('T|')==0 and last():find('Only the party leader',1,true))
-- Party sync off: nothing is sent.
BackstageForeverPartyCommand('party off') sent={} BackstageForeverPlanCommand('plan ready') assert(#sent==0 and last():find('Party sync is off',1,true))
BackstageForeverPartyCommand('party on')
-- Leaving the party: the plan somebody else made goes, and the app hears that the party is gone.
grouped=false fire('GROUP_ROSTER_UPDATE') assert(BackstageForeverLiveGuildDB.plan==nil)
BackstageForeverLivePartyTick() flushAll() assert(signalled('P1|')[#signalled('P1|')]=='P1|Me-Thunder Hold|-|-|0|-|0')
-- A plan for another character in the hand-off is not yours.
BackstageForeverDesktopData.plan.f='Zed-Thunder Hold' BackstageForeverLiveReadPlan() assert(BackstageForeverLiveGuildDB.plan==nil)
`));

test("live readiness: an answer follows what changes by itself for half an hour, at a pace, never in combat, and not at all with the switch off", () => lua(STUBS + ALL + String.raw`
useFakeLink()
local quests={}
C_QuestLog={IsQuestFlaggedCompleted=function() return false end,IsOnQuest=function(id) return quests[id]~=nil end,IsComplete=function(id) return quests[id]=='ready' end,GetNumQuestLogEntries=function() return 0 end}
local free=10 C_Container={GetContainerNumFreeSlots=function(bag) return bag==0 and free or 0 end}
GetInventoryItemDurability=function(slot) if slot==1 then return 50,100 end end
grouped=true leader='party1'
fire('PLAYER_LOGIN') runAfter()
-- Ann asks; this addon answers once.
sent={} clock=clock+20 from('Ann','C|-','PARTY')
local a=texts('A|','PARTY') assert(#a==1,'the answer')
-- Nothing changed: nothing is sent again.
assert(BackstageForeverCheckLiveChanged()==true and #texts('A|','PARTY')==1)
-- Bags fill up: the new answer goes out by itself.
free=3 clock=clock+10 fire('BAG_UPDATE_DELAYED') BackstageForeverLivePartyTick()
a=texts('A|','PARTY') assert(#a==2 and a[2]~=a[1],'a changed answer is sent without anybody asking')
-- Again within eight seconds: it waits, and goes at the next tick after the pace allows.
free=1 clock=clock+2 fire('BAG_UPDATE_DELAYED') BackstageForeverLivePartyTick() assert(#texts('A|','PARTY')==2)
clock=clock+7 BackstageForeverLivePartyTick() assert(#texts('A|','PARTY')==3)
-- Never in combat.
free=0 combat=true clock=clock+20 fire('BAG_UPDATE_DELAYED') BackstageForeverLivePartyTick() assert(#texts('A|','PARTY')==3)
combat=false BackstageForeverLivePartyTick() assert(#texts('A|','PARTY')==4)
-- The switch off: only when asked.
BackstageForeverPartyCommand('party live off') assert(BackstageForeverPartySettings.live==false)
free=7 clock=clock+20 fire('BAG_UPDATE_DELAYED') BackstageForeverLivePartyTick() assert(#texts('A|','PARTY')==4)
BackstageForeverPartyCommand('party live on')
-- After half an hour the check is over.
clock=clock+20 from('Ann','C|-','PARTY') local n=#texts('A|','PARTY')
free=2 clock=clock+1801 fire('BAG_UPDATE_DELAYED') BackstageForeverLivePartyTick() assert(#texts('A|','PARTY')==n)
-- The asker's side: an answer that changes later is taken (the list stays open), and one quiet line says so.
leader='player' clock=clock+20 said={}
BackstageForeverCheckCommand('check') runAfter()
from('Ann','A|-|-|-|80|12|0','PARTY')
BackstageForeverCheckCommand('check show') local shown=#said
clock=clock+120 from('Ann','A|-|-|-|80|2|0','PARTY')
assert(last():find('Readiness changed: Ann',1,true),last())
said={} BackstageForeverCheckCommand('check show') local found=false for _,m in ipairs(said) do if m:find('Ann',1,true) and m:find('2',1,true) then found=true end end assert(found,'the list shows the newer answer')
-- With the switch off the old thirty-second window holds.
BackstageForeverPartySettings.live=false clock=clock+20
BackstageForeverCheckCommand('check') runAfter() from('Ann','A|-|-|-|80|12|0','PARTY') BackstageForeverCheckCommand('check show')
said={} clock=clock+31 from('Ann','A|-|-|-|80|1|0','PARTY') assert(#said==0)
-- A new member asks for the soft-reserve list by itself, once.
BackstageForeverPartySettings.live=true grouped=false fire('GROUP_ROSTER_UPDATE') grouped=true leader='party1' sent={} clock=clock+60
fire('GROUP_ROSTER_UPDATE') runAfter() assert(#texts('S?','PARTY')==1)
`));

test("announcements are off until the player switches one on, then go to party or guild chat only, at a pace and never in combat", () => lua(STUBS + ALL + String.raw`
useFakeLink()
local log={{id=101,title='Raptor Thieves',done=false,text='Raptor Head: 7/8'}}
C_QuestLog={GetNumQuestLogEntries=function() return #log end,GetInfo=function(i) return log[i] and {questID=log[i].id,title=log[i].title,isHeader=false} end,
  GetQuestObjectives=function(id) for _,q in ipairs(log) do if q.id==id then return {{finished=q.done,text=q.text}} end end end,GetTitleForQuestID=function(id) return id==101 and 'Raptor Thieves' or nil end}
grouped=true
fire('PLAYER_LOGIN') runAfter()
-- Off at first: a finished quest, a finished objective and "ready" say nothing in chat.
fire('QUEST_LOG_UPDATE') BackstageForeverLivePartyTick()
log[1].done=true log[1].text='Raptor Head: 8/8' fire('QUEST_LOG_UPDATE') BackstageForeverLivePartyTick()
fire('QUEST_TURNED_IN',101) BackstageForeverPlanCommand('plan ready')
assert(#chat==0,'nothing is said unless switched on')
said={} BackstageForeverAnnounceCommand('announce') assert(said[1]:find('Finished quests: not said',1,true) and said[2]:find('Finished objectives: not said',1,true) and said[3]:find('"Ready": not said',1,true))
-- Switched on for the party.
BackstageForeverAnnounceCommand('announce quest party') assert(BackstageForeverPartySettings.say.quest=='party' and last():find('most six lines in five minutes',1,true))
BackstageForeverAnnounceCommand('announce objective on') assert(BackstageForeverPartySettings.say.objective=='party')
BackstageForeverAnnounceCommand('announce ready guild') assert(BackstageForeverPartySettings.say.ready=='guild')
BackstageForeverAnnounceCommand('announce quest say') assert(last():find('Say where',1,true) and BackstageForeverPartySettings.say.quest=='party','public chat is not offered')
BackstageForeverAnnounceCommand('announce quest channel') assert(BackstageForeverPartySettings.say.quest=='party')
clock=clock+20 fire('QUEST_TURNED_IN',101)
assert(#chat==1 and chat[1][1]=='Quest done: Raptor Thieves.' and chat[1][2]=='PARTY')
-- An objective that becomes finished.
log[1].done=false log[1].text='Raptor Head: 7/8' fire('QUEST_LOG_UPDATE') BackstageForeverLivePartyTick()
log[1].done=true log[1].text='Raptor Head: 8/8' clock=clock+20 fire('QUEST_LOG_UPDATE') BackstageForeverLivePartyTick()
assert(#chat==2 and chat[2][1]=='Objective done: Raptor Head: 8/8.' and chat[2][2]=='PARTY',chat[#chat][1])
fire('QUEST_LOG_UPDATE') BackstageForeverLivePartyTick() assert(#chat==2,'said once')
-- Ready goes to guild chat because the player chose that.
clock=clock+20 BackstageForeverPlanCommand('plan ready') assert(#chat==3 and chat[3][1]=='Ready.' and chat[3][2]=='GUILD')
-- Never in combat; never to a raid; the pace holds.
combat=true clock=clock+20 fire('QUEST_TURNED_IN',101) assert(#chat==3) combat=false
raid=true clock=clock+20 fire('QUEST_TURNED_IN',101) assert(#chat==3,'a party line never goes to a raid') raid=false
clock=clock+20 fire('QUEST_TURNED_IN',101) assert(#chat==4) clock=clock+2 fire('QUEST_TURNED_IN',101) assert(#chat==4,'eight seconds between two of a kind')
for i=1,6 do clock=clock+9 fire('QUEST_TURNED_IN',101) end assert(#chat==6,'six lines in five minutes: '..#chat)
for _,line in ipairs(chat) do assert(line[2]=='PARTY' or line[2]=='GUILD') assert(not line[1]:find('|',1,true)) end
-- Not in a party: a party line has nowhere to go.
grouped=false clock=clock+400 fire('QUEST_TURNED_IN',101) assert(#chat==6)
-- Off again.
BackstageForeverAnnounceCommand('announce quest off') assert(BackstageForeverPartySettings.say.quest==nil and last():find('not said in chat any more',1,true))
grouped=true clock=clock+400 fire('QUEST_TURNED_IN',101) assert(#chat==6)
`));

test("the realm board listing: /bf lfg list posts or removes it, says plainly that the desktop app must run, and the old list still works", () => lua(STUBS + ALL + String.raw`
useFakeLink()
fire('PLAYER_LOGIN') runAfter() said={} signals={}
-- The bare word is the chat board as before.
BackstageForeverLfgCommand('lfg list') assert(said[1]:find('No looking-for-group line seen yet',1,true))
BackstageForeverLfgCommand('lfg board') assert(last():find('No realm board from the desktop app yet',1,true))
-- Post.
BackstageForeverLfgCommand('lfg list SM healer : Have the Key')
assert(last():find('Board listing: Scarlet Monastery, plays healer',1,true) and last():find('The desktop app posts it',1,true) and last():find('it must be running',1,true),last())
-- Changing it too fast is refused; later it keeps its id.
BackstageForeverLfgCommand('lfg list sm tank') assert(last():find('a moment ago',1,true))
flushAll() local f=signalled('F1|') assert(#f==1 and f[1]:match('^F1|Me%-Thunder Hold|[%l%d]+|g|34|3|h|sm|%-|Have the Key$'),f[1])
local id=BackstageForeverLiveGuildDB.listing.id assert(#id==16)
said={} BackstageForeverLfgCommand('lfg list') assert(said[1]:find('Your board listing: Scarlet Monastery, plays healer',1,true),'the bare word also says what you posted')
clock=clock+30 BackstageForeverLfgCommand('lfg list brd need 1 0 2') assert(BackstageForeverLiveGuildDB.listing.id==id and BackstageForeverLiveGuildDB.listing.kind=='m' and last():find('needs 1 tank, 2 damage',1,true))
flushAll() assert(signalled('F1|')[2]:match('|m|34|3|%-|brd|1%.0%.2|%-$'),signalled('F1|')[2])
-- Mistakes are explained.
clock=clock+30 BackstageForeverLfgCommand('lfg list nowhere') assert(last():find('Name a dungeon the board knows',1,true))
BackstageForeverLfgCommand('lfg list sm need 1') assert(last():find('three numbers',1,true))
combat=true BackstageForeverLfgCommand('lfg list sm') assert(last():find('outside combat',1,true)) combat=false
-- The saved file carries it too.
local block=BackstageForeverLiveGuildSnapshot() assert(block.listing==signalled('F1|')[2])
-- Take it down.
BackstageForeverLfgCommand('lfg list off') assert(BackstageForeverLiveGuildDB.listing==nil and last():find('taken down',1,true) and last():find('it must be running',1,true))
flushAll() assert(signalled('F1|')[3]=='F1|Me-Thunder Hold|'..id..'|x')
BackstageForeverLfgCommand('lfg list off') assert(last():find('You have no listing',1,true))
-- With the switch off a listing cannot reach the board, and the player is told.
BackstageForeverGuildCommand('guild desk off') clock=clock+30 BackstageForeverLfgCommand('lfg list sm') assert(last():find('/bf guild desk on',1,true) and BackstageForeverLiveGuildDB.listing==nil)
-- The window still opens and paints with a board handed over.
BackstageForeverDesktopData={schema=1,characters={},lfg={rows={{'abcdefgh12345678','g','Cy','Thunder Hold',34,3,'d','sm','',-1,-1,-1,NOW-600}}}}
BackstageForeverLiveReadDesk()
assert(BackstageForeverLfgCommand('lfg')==true)
local frame=frames.BackstageForeverLfgFrame assert(frame.boardHead.shown==true and frame.boardHead.text:find('as of your last /reload',1,true) and frame.boardLines[1].shown==true and frame.boardLines[1].who.text=='Cy (34)' and frame.boardLines[1].age.text=='10 min' and frame.boardLines[2].shown==false)
`));

test("the options window has a plain sentence for each new switch, and each runs one command", () => lua(STUBS + String.raw`
local ran={}
SlashCmdList={BACKSTAGEFOREVER=function(m) ran[#ran+1]=m end}
dofile('addon/BackstageForever/BackstageForeverHelpers.lua')
dofile('addon/BackstageForever/BackstageForeverOptions.lua')
local function row(label) for _,p in ipairs(BackstageForeverOptionsPages) do for _,r in ipairs(p.rows) do if r.label==label then return r,p.title end end end end
local want={['Live party updates']={'party live',true},['Guild and party to the app']={'guild desk',true},['Say finished quests']={'announce quest',false},['Say finished objectives']={'announce objective',false},['Say when you are ready']={'announce ready',false}}
for label,spec in pairs(want) do
  local r,page=row(label) assert(r and page=='Sharing',label)
  assert(r.get()==spec[2],label..' starts '..tostring(spec[2]))
  r.set(true) assert(ran[#ran]==spec[1]..' on') r.set(false) assert(ran[#ran]==spec[1]..' off')
end
BackstageForeverPartySettings={live=false,say={quest='party',ready='guild'}} BackstageForeverLiveGuildDB={desk=false}
assert(row('Live party updates').get()==false and row('Guild and party to the app').get()==false and row('Say finished quests').get()==true and row('Say finished objectives').get()==false and row('Say when you are ready').get()==true)
`));

test("texts: every new sentence has German, French and Spanish, and both files keep to the rules of the client", () => {
  const guildSource = read("addon/BackstageForever/BackstageForeverLiveGuild.lua"), partySource = read("addon/BackstageForever/BackstageForeverLiveParty.lua");
  for (const source of [guildSource, partySource]) {
    assert.doesNotMatch(source, /COMBAT_LOG|RunScript|loadstring|SendChatMessage\([^)]*'(?:SAY|YELL|CHANNEL|WHISPER)'/);
    assert.match(source, /issecretvalue/);
  }
  assert.match(partySource, /field\(plain\(C_ChatInfo\),'SendChatMessage'\) or plain\(SendChatMessage\)/);
  assert.equal((partySource.match(/SendChatMessage/g) || []).length, 2, "one place sends chat, through the channel rule");
  for (const lang of ["de", "fr", "es"]) {
    const dict = JSON.parse(read(`data/i18n/${lang}.json`)).addon;
    for (const text of ["Your guild uses Backstage Forever events. Open the desktop app to join.", "(D) signed up in Discord", "You have no role in the plan yet.", "Ready.", "Live party updates", "Guild and party to the app", "Say finished quests",
      "Realm board, from the desktop app, as of your last /reload", "No listing on the realm board at your last /reload.", "Step 1. Each member who wants events types /bf event on. /bf event opens the window; /bf event add proposes an event."]) assert.ok(dict.plain[text], `${lang}: ${text}`);
    for (const text of ["Your role: %s.", "Bring: %s.", "Quest done: %s.", "Objective done: %s.", "Ready for %s.", "Group plan: %s (from %s).", "%s says: ready.", "From the desktop app: %d new or changed guild events and answers. /bf events lists them.",
      "Readiness changed: %s. /bf check show prints the list again."]) assert.ok(dict.templates[text], `${lang}: ${text}`);
  }
});
