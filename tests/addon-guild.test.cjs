"use strict";
// 1.25 (roadmap S2): guild sharing over the guild addon channel. Off until switched on; bounded,
// rate-limited, and every incoming message checked field by field.
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
local handlers={}
CreateFrame=function() return {RegisterEvent=function() end,SetScript=function(_,k,fn) if k=='OnEvent' then handlers[#handlers+1]=fn end end} end
local function fire(...) for _,h in ipairs(handlers) do h(nil,...) end end
local sent={}
C_ChatInfo={RegisterAddonMessagePrefix=function() end,SendAddonMessage=function(p,t,ch) sent[#sent+1]={p,t,ch} end}
local clock=1000 GetTime=function() return clock end
local guilded=true IsInGuild=function() return guilded end
IsInGroup=function() return false end IsInRaid=function() return false end
UnitName=function(u) if u=='player' then return 'Me' end end
local level,zone=42,'Stranglethorn Vale'
UnitLevel=function() return level end GetRealZoneText=function() return zone end
Ambiguate=function(n) return (n:gsub('%-.*$','')) end
local function from(who,text,channel) fire('CHAT_MSG_ADDON','BFParty',text,channel or 'GUILD',who) end
local function last() return said[#said] end
`;

test("guild messages: four bounded fields out, strict checks in", () => lua(GUILD + String.raw`
local E,D=BackstageForeverGuildEncode,BackstageForeverGuildDecode
assert(E({level=42,zone='Stranglethorn Vale',profs={{name='Mining',rank=210},{name='Herbalism',rank=180}},lfd='brd'})=='G|42|Stranglethorn Vale|Mining:210,Herbalism:180|brd')
assert(E({level=1})=='G|1|-|-|-' and E({})==nil and E({level=0})==nil and E({level=101})==nil and E(nil)==nil)
assert(E({level=60.7,zone='A|B:C,D',profs={{name='First: Aid',rank=300.9},{name='',rank=1},{name='Bad',rank=-1},{name='Bad',rank=1000},'junk'},lfd='Not An Id'})=='G|60|A B C D|First Aid:300|-')
local seven={} for i=1,7 do seven[i]={name='P'..i,rank=i} end
assert(E({level=5,profs=seven})=='G|5|-|P1:1,P2:2,P3:3,P4:4|-','four professions at most')
assert(#E({level=60,zone=string.rep('z',200),profs={{name=string.rep('n',200),rank=300},{name=string.rep('m',200),rank=300},{name=string.rep('o',200),rank=300},{name=string.rep('p',200),rank=300}},lfd='scholo'})<=255)
local m=D('G|42|Stranglethorn Vale|Mining:210,Herbalism:180|brd')
assert(m.level==42 and m.zone=='Stranglethorn Vale' and #m.profs==2 and m.profs[2].name=='Herbalism' and m.profs[2].rank==180 and m.lfd=='brd')
m=D('G|1|-|-|-') assert(m.level==1 and m.zone==nil and #m.profs==0 and m.lfd==nil)
assert(D('G|off').off==true)
for _,bad in ipairs({'G|0|-|-|-','G|101|-|-|-','G|1000|-|-|-','G|x|-|-|-','G|42|-|-','G|42|-|-|-|-','G|42||-|-','G|42|-|Mining|-','G|42|-|Mining:x|-','G|42|-|Mining:1000|-',
  'G|42|-|:5|-','G|42|-|a:1,b:2,c:3,d:4,e:5|-','G|42|-|-|BRD','G|42|-|-|not a dungeon','G|42|'..string.rep('z',41)..'|-|-','G|42| Zone|-|-','G|42|Zo  ne|-|-',
  'G|42|Zone|'..string.rep('n',25)..':1|-','G|42|Z\1one|-|-','G|42|-|-|-'..string.rep('x',300),'G|OFF','Gjunk','',5,nil}) do assert(D(bad)==nil,tostring(bad)) end
`));

test("the roster: bounded, entries expire, and sends are rare", () => lua(GUILD + String.raw`
local r={}
local S=BackstageForeverGuildStore
assert(S(r,'Ann','G|42|Stranglethorn Vale|Mining:210|brd',100) and r.Ann.level==42 and r.Ann.at==100)
assert(S(r,'Bob','G|20|-|-|-',200) and not S(r,'Cy','G|999|-|-|-',200) and not S(r,'C1','G|20|-|-|-',200) and not S(r,'Cy','hello',200) and not S(r,'Cy','G|20|-|-|-',nil))
assert(S(r,'Ann','G|43|Tanaris|-|-',300) and r.Ann.level==43 and r.Ann.lfd==nil,'a newer message replaces the older one')
assert(S(r,'Bob','G|off',310) and r.Bob==nil and not S(r,'Bob','G|off',311))
assert(BackstageForeverGuildPrune(r,300+30*60-1)==0 and BackstageForeverGuildPrune(r,300+30*60)==1 and next(r)==nil,'gone after thirty minutes')
for i=1,130 do S(r,'M'..string.char(97+math.floor(i/26))..string.char(97+i%26),'G|10|-|-|-',1000+i) end
local n,oldest=0,math.huge for _,row in pairs(r) do n=n+1 if row.at<oldest then oldest=row.at end end
assert(n==100 and oldest==1031,'a hundred members at most: '..n..' '..oldest)
-- When to send.
local Due=BackstageForeverGuildDue
assert(Due(nil,'a',0,false),'the first one, after login')
local last={at=1000,body='a'}
assert(not Due(last,'b',1100,true),'never within three minutes, whatever changed')
assert(not Due(last,'b',1179,false) and Due(last,'b',1180,false),'a change waits for the three minutes')
assert(not Due(last,'a',1180,false) and Due(last,'a',1180,true),'nothing changed: only when someone asked')
assert(not Due(last,'a',1599,false) and Due(last,'a',1600,false),'otherwise every ten minutes')
assert(Due(last,'a',5,false),'a clock that went backwards does not lock it') assert(not Due(last,nil,2000,false) and not Due(last,'a','x',false))
-- The lines.
r={}
S(r,'Zed','G|60|Burning Steppes|Mining:300,Engineering:285|-',50) S(r,'Ann','G|52|-|-|brd',50) S(r,'Bob','G|20|Westfall|-|-',50)
local lines=BackstageForeverGuildLines(r)
assert(#lines==4 and lines[1]=='Guild members sharing: 3.')
assert(lines[2]=='  Ann, level 52. Looking for brd.' and lines[3]=='  Bob, level 20, Westfall.' and lines[4]=='  Zed, level 60, Burning Steppes. Mining 300, Engineering 285.',lines[2]..lines[4])
assert(#BackstageForeverGuildLines(r,2)==4 and BackstageForeverGuildLines(r,2)[4]=='  and 1 more.')
assert(BackstageForeverGuildLines({})[1]:find('No guild member is sharing',1,true))
`));

test("in game: off until switched on, the guild channel only, at most every three minutes, nothing read while off", () => lua(STUBS + FILES + String.raw`
fire('PLAYER_LOGIN')
BackstageForeverGuildUpdate({readiness={workshop={professions={items={{name='Mining',rank=210},{name='Herbalism',rank=180}}}}}})
-- Off by default: nothing is sent, nothing is kept, nothing answers.
assert(BackstageForeverGuildSharing()==false)
BackstageForeverGuildTick() fire('ZONE_CHANGED_NEW_AREA') fire('PLAYER_LEVEL_UP')
from('Ann','G|42|Tanaris|-|brd') from('Ann','G?')
assert(#sent==0 and next(BackstageForeverGuildRoster)==nil)
BackstageForeverGuildCommand('guild') assert(#sent==0 and last():find('Guild sharing is off',1,true))
BackstageForeverGuildCommand('guild lfd brd') assert(#sent==0 and BackstageForeverGuildSettings.lfd=='brd' and last():find('nobody sees the flag',1,true))
-- On: one message on the guild channel.
BackstageForeverGuildCommand('guild on')
assert(#sent==1 and sent[1][1]=='BFParty' and sent[1][3]=='GUILD' and sent[1][2]=='G|42|Stranglethorn Vale|Mining:210,Herbalism:180|brd',sent[1] and sent[1][2])
assert(last():find('Guild sharing: on',1,true))
-- Changes wait for three minutes; then one message carries the latest state.
level=43 fire('PLAYER_LEVEL_UP') zone='Tanaris' fire('ZONE_CHANGED_NEW_AREA') BackstageForeverGuildCommand('guild lfd off')
clock=1100 BackstageForeverGuildTick() assert(#sent==1)
clock=1180 BackstageForeverGuildTick() assert(#sent==2 and sent[2][2]=='G|43|Tanaris|Mining:210,Herbalism:180|-',sent[2] and sent[2][2])
clock=1400 BackstageForeverGuildTick() assert(#sent==2,'nothing changed, nothing sent')
from('Bob','G?') BackstageForeverGuildTick() assert(#sent==3,'someone asked who shares')
from('Bob','G?') clock=1450 BackstageForeverGuildTick() assert(#sent==3,'but never twice in three minutes')
clock=2000 BackstageForeverGuildTick() assert(#sent==4,'and a sign of life every ten minutes')
-- Reading: guild channel only, clean messages only, never your own.
from('Ann','G|42|Tanaris|Alchemy:150|brd') from('Me','G|60|-|-|-') from('Bob-Realm','G|20|-|-|-')
from('Cy','G|42|Tanaris|-|brd','PARTY') from('Dee','G|42|Tanaris|-|brd','WHISPER') from('Eve','G|42|<script>|x|y')
fire('CHAT_MSG_ADDON','Other','G|42|Tanaris|-|brd','GUILD','Fay')
local n=0 for _ in pairs(BackstageForeverGuildRoster) do n=n+1 end
assert(n==2 and BackstageForeverGuildRoster.Ann.lfd=='brd' and BackstageForeverGuildRoster.Bob.level==20,'kept: '..n)
BackstageForeverGuildCommand('guild')
assert(said[#said-2]=='Backstage Forever: Guild members sharing: 2.' and said[#said-1]=='Backstage Forever:   Ann, level 42, Tanaris. Alchemy 150. Looking for Blackrock Depths.' and last()=='Backstage Forever:   Bob, level 20.',said[#said-1])
from('Ann','G|off') assert(BackstageForeverGuildRoster.Ann==nil)
-- Not in a guild: silent.
guilded=false clock=3000 BackstageForeverGuildTick() assert(#sent==4)
BackstageForeverGuildCommand('guild') assert(last()=='Backstage Forever: You are not in a guild.') guilded=true
-- Off: one goodbye, the roster is forgotten, and flipping the switch does not flood the channel.
BackstageForeverGuildCommand('guild off')
assert(sent[#sent][2]=='G|off' and next(BackstageForeverGuildRoster)==nil and BackstageForeverGuildSettings.share==false)
local count=#sent
for i=1,5 do BackstageForeverGuildCommand('guild on') BackstageForeverGuildCommand('guild off') end
assert(#sent<=count+1,'flipping the switch sent '..(#sent-count))
from('Ann','G|42|Tanaris|-|brd') assert(next(BackstageForeverGuildRoster)==nil)
`));

test("party sync stays what it was: its own letters cannot be taken over, and the guild channel reaches guild handlers only", () => lua(STUBS + String.raw`
dofile('addon/BackstageForever/BackstageForeverParty.lua')
fire('PLAYER_LOGIN')
local got={}
for _,kind in ipairs({'Q','R','W','QQ','',5}) do assert(BackstageForeverPartyHandle(kind,function() end)==false,tostring(kind)) end
assert(BackstageForeverPartyHandle('X',function(sender,message) got[#got+1]='party:'..sender..':'..message end)==true)
assert(BackstageForeverPartyHandle('X',function(sender,message) got[#got+1]='guild:'..sender..':'..message end,'GUILD')==true)
assert(BackstageForeverPartyHandle('X',function() end,'RAID')==false and BackstageForeverPartyHandle('Y','not a function')==false)
from('Ann','Xhello','PARTY') from('Ann','Xhello','GUILD') from('Ann','Xhello','RAID') from('Ann','Xhello','WHISPER') from('Me','Xhello','GUILD')
from('Ann','X'..string.rep('x',300),'GUILD') from('Ann','','GUILD') from('Ann','Zunknown','GUILD')
assert(table.concat(got,' ')=='party:Ann:Xhello guild:Ann:Xhello',table.concat(got,' '))
-- Sending: PARTY needs a party and party sync on; GUILD needs a guild; nothing else is possible; 255 bytes at most.
assert(BackstageForeverPartySend('Xhi')==false,'not in a party')
assert(BackstageForeverPartySend('Xhi','GUILD')==true and sent[1][3]=='GUILD')
assert(BackstageForeverPartySend('Xhi','RAID')==false and BackstageForeverPartySend('Xhi','WHISPER')==false,'any other word means PARTY, and there is no party')
assert(BackstageForeverPartySend(string.rep('x',256),'GUILD')==false and BackstageForeverPartySend('','GUILD')==false and BackstageForeverPartySend(nil,'GUILD')==false)
guilded=false assert(BackstageForeverPartySend('Xhi','GUILD')==false) guilded=true
IsInGroup=function() return true end
assert(BackstageForeverPartySend('Xhi')==true and sent[#sent][3]=='PARTY')
IsInRaid=function() return true end assert(BackstageForeverPartySend('Xhi')==false,'never to a raid') IsInRaid=function() return false end
BackstageForeverPartyCommand('party off')
local n=#sent assert(BackstageForeverPartySend('Xhi')==false and #sent==n,'party sync off: the helpers on top are silent too')
got={} from('Ann','Xhello','PARTY') assert(#got==0)
`));

test("wiring: file listed, command routed and catalogued, the switch is off by default in the options", () => {
  const source = read("addon/BackstageForever/BackstageForeverGuild.lua");
  for (const never of ["loadstring", "RunScript", "SendChatMessage", "SendAddonMessage", "'WHISPER'", "'RAID'", "'PARTY'"]) assert.ok(!source.includes(never), never);
  assert.ok(require("../src/core/game-sync.cjs").ADDON_FILES.includes("BackstageForeverGuild.lua"));
  assert.match(read("addon/BackstageForever/BackstageForever.toc"), /BackstageForeverGuildSettings/);
  assert.ok(read("addon/BackstageForever/BackstageForeverHUD.lua").includes("if word=='guild' then\n                if type(BackstageForeverGuildCommand)=='function' then pcall(BackstageForeverGuildCommand,message)end"));
  assert.ok(require("../src/renderer/commands.js").CATALOG.some((c) => c.word === "guild"));
  assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), /'\/bf guild - /);
  assert.ok(read("addon/BackstageForever/BackstageForeverOptions.lua").includes("off('BackstageForeverGuildSettings','share'),'guild'"));
  assert.match(read("addon/BackstageForever/BackstageForever.lua"), /pcall\(BackstageForeverGuildUpdate,character\)/);
});
