"use strict";
// 1.25 (roadmap G7): the group finder board. The parser and the board are pure; the frame is thin.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const FILE = "dofile('addon/BackstageForever/BackstageForeverLfg.lua')\n";
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local combat=false InCombatLockdown=function() return combat end
local clock=1000 GetTime=function() return clock end
local made,handler={},nil
local function widget(kind)
  local w={kind=kind,scripts={},shown=true}
  local methods={
    SetScript=function(self,k,fn) self.scripts[k]=fn if k=='OnEvent' and not handler then handler=fn end end,
    SetText=function(self,t) self.text=t end, SetHeight=function(self,h) self.height=h end,
    SetWidth=function(self,v) self.width=v end, SetSize=function(self,a,b) self.width=a self.height=b end,
    SetWordWrap=function(self,v) self.wrap=v end, SetAlpha=function(self,a) self.alpha=a end,
    Show=function(self) self.shown=true end, Hide=function(self) self.shown=false end,
    IsShown=function(self) return self.shown end,
    CreateFontString=function(self) local f=widget('FontString') made[#made+1]=f return f end,
    CreateTexture=function() return widget('Texture') end,
  }
  return setmetatable(w,{__index=function(_,k) return methods[k] or function() end end})
end
CreateFrame=function(kind,name) local w=widget(kind);made[#made+1]=w;if name then _G[name]=w end;return w end
UIParent={} UISpecialFrames={}
UnitName=function() return 'Me' end UnitLevel=function() return 34 end UnitClass=function() return 'Warrior','WARRIOR' end
Ambiguate=function(n) return (n:gsub('%-.*$','')) end
local box,sent=nil,0
ChatFrame_OpenChat=function(text) box=text end
SendChatMessage=function() sent=sent+1 end JoinChannelByName=function() sent=sent+1 end
`;

test("the parser: whole words only, the common short names, roles, and no false hits", () => lua(FILE + String.raw`
local P=BackstageForeverLfgParse
local function is(text,dungeon,kind,roles,either)
  local r=P(text)
  assert(r,'not read: '..text)
  assert(r.dungeon==dungeon and r.kind==kind,text..' -> '..tostring(r.dungeon)..' '..tostring(r.kind))
  assert(table.concat(r.roles,',')==(roles or ''),text..' roles '..table.concat(r.roles,','))
  assert(r.either==either,text..' either '..tostring(r.either))
end
is('LFM RFC need tank and healer','rfc','want','tank,healer')
is('lfg wc','wc','seek')
is('Healer LFG SFK','sfk','seek','healer')
is('LF1M BFD dps','bfd','want','dps')
is('LF2M Stocks, need heals','stocks','want','healer')
is('lfm gnomer tank then g2g','gnomer','want','tank')
is('LFM RFK','rfk','want') is('lfg SM cath','sm','seek') is('LF tank for SM Lib','sm','want','tank')
is('LFM RFD last spot dps','rfd','want','dps') is('lfg ulda','ulda','seek') is('LFM ZF mallet run','zf','want')
is('lfm mara princess run need dd','mara','want','dps') is('LFG ST','st','seek') is('LF3M BRD lava run','brd','want')
is('LFM LBRS need healer','lbrs','want','healer') is('lfm UBRS have key, need tanks','ubrs','want','tank')
is('LFG Scholo','scholo','seek') is('lfm strat live need heal','strat','want','healer')
is('Looking for group Scarlet Monastery','sm','seek') is('looking for more for Zul\'Farrak','zf','want')
is('LFM Dire Maul North tribute','dme','want') is('lfm DM East need healer','dme','want','healer') is('lfg dmw','dme','seek')
is('LFM DM West','dme','want') is('lfm DM N','dme','want') is('LFG Deadmines','dm','seek') is('LFM VC need tank','dm','want','tank')
is('LFM DM need tank','dm','want','tank','dme')
is('LFM |cff71d5ff|Hquest:214:20|h[Red Silk Bandanas]|h|r DM','dm','want',nil,'dme')
is('LFG SM/ZF','sm','seek') is('(LFM) [BRD] {skull}','brd','want')
is('Suche Gruppe Kloster','sm','seek') is('Suchen Heiler f\195\188r BRT','brd','want','healer') is('LFM Todesminen','dm','want')
is('LFM D\195\188sterbruch','dme','want') is('need healer UBRS','ubrs','want','healer')
for _,text in ipairs({
  'dm me for an invite','pls dm','LFG, dm me','LFM anything, just dm me','hello SM','WTS [Krol Blade] dm me','WTB runs LFM BRD','wtb ubrs run lfg',
  'LF guild','lf enchanter for crusader','looking for a guild that runs MC','anyone for wc?','lfm','LFG','I love Stratholme',
  'lfg stratus','lfm smx','lfg wcx','the first lfg','lfg 1st time','lfg rfcc','',string.rep('lfm brd ',40)}) do
  assert(P(text)==nil,'false hit: '..text)
end
assert(P(nil)==nil and P(5)==nil and P({})==nil)
assert(BackstageForeverLfgDungeon('sm')=='sm' and BackstageForeverLfgDungeon('Scarlet Monastery')=='sm' and BackstageForeverLfgDungeon('dm east')=='dme')
assert(BackstageForeverLfgDungeon('dm')=='dm' and BackstageForeverLfgDungeon('nowhere')==nil and BackstageForeverLfgDungeon(string.rep('x',80))==nil)
assert(BackstageForeverLfgName('brd')=='Blackrock Depths' and BackstageForeverLfgName('dm','dme')=='Deadmines / Dire Maul' and BackstageForeverLfgName('nope')==nil)
-- Every Instance Atlas row has a board name, and the other way round.
dofile('addon/BackstageForever/BackstageForeverAtlasData.lua')
local atlas={} for _,row in ipairs(BackstageForeverAtlasData) do atlas[row[1]]=row[2] end
local n=0
for _,row in ipairs(BackstageForeverLfgDungeons) do n=n+1 assert(atlas[row[1]],'not in the Atlas: '..row[1]) assert(BackstageForeverLfgDungeon(atlas[row[1]])==row[1],'the Atlas name is not read: '..atlas[row[1]]) end
local total=0 for _ in pairs(atlas) do total=total+1 end
assert(n==total,'board '..n..' atlas '..total)
`));

test("the board: one row per player, 60 rows at most, gone after 15 minutes, sorted by dungeon or age", () => lua(FILE + String.raw`
local b={}
assert(BackstageForeverLfgAdd(b,'Ann','LFM BRD need tank',100,4).channel==4)
assert(BackstageForeverLfgAdd(b,'Bob','lfg rfc',160)) assert(BackstageForeverLfgAdd(b,'Cy','LFM SM need healer dps',130,2))
assert(#b==3)
assert(BackstageForeverLfgAdd(b,'ann','LFG ZF',200) and #b==3,'a new line from the same player replaces the old one')
for _,bad in ipairs({'A','Ann1','An n','Ann|r','|cffff0000Ann|r',string.rep('a',49),'Ann;x'}) do assert(BackstageForeverLfgAdd(b,bad,'LFM BRD',200)==nil,bad) end
assert(BackstageForeverLfgAdd(b,'Ann-Realm','LFM BRD',201) and #b==4)
assert(BackstageForeverLfgAdd(b,'Dee','hello there',201)==nil and BackstageForeverLfgAdd(b,nil,'LFM BRD',201)==nil and BackstageForeverLfgAdd(b,'Dee','LFM BRD',nil)==nil)
assert(BackstageForeverLfgAdd(b,'Eve','LFM BRD',202,'x').channel==nil and BackstageForeverLfgAdd(b,'Eve','LFM BRD',202,99).channel==nil)
local names=function(list) local t={} for i,r in ipairs(list) do t[i]=r.who end return table.concat(t,',') end
assert(names(BackstageForeverLfgSorted(b,'dungeon'))=='Bob,Cy,ann,Eve,Ann-Realm',names(BackstageForeverLfgSorted(b,'dungeon')))
assert(names(BackstageForeverLfgSorted(b,'age'))=='Eve,Ann-Realm,ann,Bob,Cy',names(BackstageForeverLfgSorted(b,'age')))
local rows,more=BackstageForeverLfgRows(b,'dungeon',260,3)
assert(#rows==3 and more==2)
assert(rows[1].dungeon=='Ragefire Chasm' and rows[1].wanted=='wants a group' and rows[1].who=='Bob' and rows[1].age=='1 min')
assert(rows[2].dungeon=='Scarlet Monastery' and rows[2].wanted=='needs healer, damage' and rows[2].age=='2 min')
assert(rows[3].wanted=='wants a group' and rows[3].age=='1 min')
assert(BackstageForeverLfgWanted({kind='want',roles={}})=='players' and BackstageForeverLfgWanted({kind='seek',roles={'tank'}})=='plays tank')
assert(BackstageForeverLfgAge(0)=='now' and BackstageForeverLfgAge(59)=='now' and BackstageForeverLfgAge(899)=='14 min' and BackstageForeverLfgAge('x')=='')
-- Fifteen minutes: Cy (130) and Bob (160) go at 1060.
assert(BackstageForeverLfgPrune(b,1029)==0 and BackstageForeverLfgPrune(b,1060)==2 and #b==3)
assert(BackstageForeverLfgPrune(b,50)==3 and #b==0,'rows from the future are dropped after a clock change')
for i=1,70 do BackstageForeverLfgAdd(b,'P'..string.char(96+math.floor((i-1)/26)+1)..string.char(97+(i-1)%26),'LFM BRD',1000+i) end
assert(#b==60,'bounded: '..#b)
local oldest=math.huge for _,r in ipairs(b) do if r.at<oldest then oldest=r.at end end
assert(oldest==1011,'the oldest rows made room')
assert(BackstageForeverLfgPost('sm',34,'Warrior')=='LFG Scarlet Monastery, level 34 Warrior' and BackstageForeverLfgPost('sm',34,'Warrior',4)=='/4 LFG Scarlet Monastery, level 34 Warrior')
assert(BackstageForeverLfgPost('sm')=='LFG Scarlet Monastery' and BackstageForeverLfgPost('sm',34,'War|rior')=='LFG Scarlet Monastery' and BackstageForeverLfgPost('nope',34,'Warrior')==nil)
assert(BackstageForeverLfgWhisper({who='Ann'})=='/w Ann ' and BackstageForeverLfgWhisper({who='Ann /camp'})==nil and BackstageForeverLfgWhisper(nil)==nil)
`));

test("in game: channel lines are only read; a row click starts a whisper, post fills the chat box, nothing is sent", () => lua(STUBS + FILE + String.raw`
handler(nil,'PLAYER_LOGIN')
local function heard(text,who,index) handler(nil,'CHAT_MSG_CHANNEL',text,who,'','4. LookingForGroup','',nil,0,index,'LookingForGroup') end
heard('LFM BRD need tank and healer','Ann-Realm',4)
heard('lfg wc','Me',4) heard('selling stuff','Bob',2) heard('LFG RFC','Bob',2)
assert(#BackstageForeverLfgBoard==2,'your own line and chatter are not kept: '..#BackstageForeverLfgBoard)
for _,row in ipairs(BackstageForeverLfgBoard) do assert(row.text==nil,'the words other players wrote are not kept') end
-- A hidden value (the game hides some chat in places) is skipped without an error.
issecretvalue=function(v) return v=='SECRET' end
heard('SECRET','Cy',4) heard('LFM SM','SECRET',4)
assert(#BackstageForeverLfgBoard==2)
issecretvalue=nil
assert(BackstageForeverLfgCommand('lfg')==true and BackstageForeverLfgFrame.shown)
local f=BackstageForeverLfgFrame
assert(f.lines[1].dungeon.text=='Ragefire Chasm' and f.lines[1].who.text=='Bob' and f.lines[1].wanted.text=='wants a group' and f.lines[1].age.text=='now')
assert(f.lines[2].dungeon.text=='Blackrock Depths' and f.lines[2].who.text=='Ann' and f.lines[2].wanted.text=='needs tank, healer' and not f.lines[3].shown)
-- Columns do not overlap and stay inside the frame; no text wraps.
local cols=BackstageForeverLfgColumns
for i=2,#cols do assert(cols[i-1][2]+cols[i-1][3]<=cols[i][2]-4,'columns touch at '..i) end
assert(cols[#cols][2]+cols[#cols][3]<=f.width-32,'the last column ends inside the frame')
for _,key in ipairs({'dungeon','wanted','who','age'}) do assert(f.lines[1][key].wrap==false and f.lines[1][key].width==cols[({dungeon=1,wanted=2,who=3,age=4})[key]][3]) end
-- Post before any row is chosen asks for one; then a click chooses.
BackstageForeverLfgCommand('lfg post')
assert(box==nil and said[#said]:find('Click a row first',1,true))
f.lines[2].scripts.OnClick(f.lines[2])
assert(box=='/w Ann ','the whisper start, never sent: '..tostring(box))
BackstageForeverLfgCommand('lfg post')
assert(box=='/4 LFG Blackrock Depths, level 34 Warrior',box)
BackstageForeverLfgCommand('lfg post dm east')
assert(box=='LFG Dire Maul, level 34 Warrior',box)
BackstageForeverLfgCommand('lfg post nowhere') assert(said[#said]:find('Name a dungeon',1,true))
assert(sent==0,'nothing is ever sent or joined')
-- Sorting by age from the header.
f.heads=f.heads
clock=1100 heard('LFM ZF','Dee',4)
BackstageForeverLfgSettings.sort='age' BackstageForeverLfgCommand('lfg') BackstageForeverLfgCommand('lfg')
assert(f.lines[1].who.text=='Dee' and f.lines[2].age.text=='1 min')
BackstageForeverLfgCommand('lfg list')
assert(said[#said-3]=='Backstage Forever: Group finder board: 3 lines in the last 15 minutes.' and said[#said-2]=='Backstage Forever:   Zul\'Farrak: Dee, players (now)',said[#said-2])
-- Combat: the board hides and does not open; fifteen minutes later the rows are gone.
handler(nil,'PLAYER_REGEN_DISABLED') assert(not f.shown)
combat=true BackstageForeverLfgCommand('lfg') assert(not f.shown and said[#said]:find('outside combat',1,true)) combat=false
clock=2100 BackstageForeverLfgCommand('lfg')
assert(f.shown and not f.lines[1].shown and f.note.text:find('No looking-for-group line',1,true))
-- Off: nothing is read and the board is emptied.
BackstageForeverLfgCommand('lfg off')
assert(BackstageForeverLfgSettings.enabled==false and BackstageForeverLfgEnabled()==false)
heard('LFM BRD','Ann',4) assert(#BackstageForeverLfgBoard==0)
BackstageForeverLfgCommand('lfg on') heard('LFM BRD','Ann',4) assert(#BackstageForeverLfgBoard==1)
`));

test("wiring: file listed, command routed, catalogued, switch in the options, and it never sends chat", () => {
  const source = read("addon/BackstageForever/BackstageForeverLfg.lua");
  for (const never of ["SendChatMessage", "JoinChannel", "JoinPermanentChannel", "SendAddonMessage", "RunScript", "loadstring"]) assert.ok(!source.includes(never), never);
  const order = read("addon/BackstageForever/BackstageForever.toc").split(/\r?\n/).filter((l) => l.endsWith(".lua"));
  assert.ok(order.indexOf("BackstageForeverWish.lua") < order.indexOf("BackstageForeverLfg.lua"));
  assert.ok(require("../src/core/game-sync.cjs").ADDON_FILES.includes("BackstageForeverLfg.lua"));
  assert.match(read("addon/BackstageForever/BackstageForever.toc"), /BackstageForeverLfgSettings/);
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  assert.ok(hud.includes("if word=='lfg' then\n                if type(BackstageForeverLfgCommand)=='function' then pcall(BackstageForeverLfgCommand,message)end"));
  const { CATALOG } = require("../src/renderer/commands.js");
  assert.ok(CATALOG.some((c) => c.word === "lfg"));
  assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), /'\/bf lfg - /);
  assert.ok(read("addon/BackstageForever/BackstageForeverOptions.lua").includes("on('BackstageForeverLfgSettings','enabled'),'lfg'"));
});
