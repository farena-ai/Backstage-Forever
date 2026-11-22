"use strict";
// 1.23: group quest lines for the chat box, notes on players, mail expiry, and two accessibility
// settings. Pure functions first, then the thin game-facing parts with stubs.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const FILE = "dofile('addon/BackstageForever/BackstageForeverSocial.lua')\n";
const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local handler
CreateFrame=function()
  local f={RegisterEvent=function() end}
  f.SetScript=function(_,k,fn) if k=='OnEvent' then handler=fn end end
  return f
end
local combat=false InCombatLockdown=function() return combat end
local function last() return said[#said] end
`;
// Noon UTC, so the day is the same in every time zone the tests run in.
const NOV12 = Date.UTC(2026, 10, 12, 12) / 1000, MAR3 = Date.UTC(2026, 2, 3, 12) / 1000;

test("group quests: picked by the game's tag or suggested group, lowest level first", () => lua(FILE + String.raw`
local list=BackstageForeverGroupQuests({
  {title='Plain Quest',level=20,group=0},
  {title='The Missing Diplomat',level=28,group=3,tagId=1,tagName='Elite'},
  {title='Blackfathom Villainy',level=27,group=5,tagId=81,tagName='Dungeon'},
  {title='Attunement to the Core',level=60,tagId=62},
  {title='A Warsong Token',level=25,tagId=41,tagName='PvP'},
  {title='Old Client Elite',level=24,tagName='Elite'},
  {title='Bring Friends',level=22,group=2},
  {title='',level=30,tagId=1},{level=30,tagId=1},'junk'})
local names={} for i,q in ipairs(list) do names[i]=q.title end
assert(table.concat(names,'|')=='Bring Friends|Old Client Elite|Blackfathom Villainy|The Missing Diplomat|Attunement to the Core',table.concat(names,'|'))
assert(list[1].kind=='group' and list[1].word=='Group' and list[1].group==2)
assert(list[2].kind=='tagged' and list[2].word=='Elite' and list[2].group==nil)
assert(list[3].kind=='dungeon' and list[3].word=='Dungeon' and list[4].word=='Elite' and list[5].kind=='raid' and list[5].word=='Raid')
assert(#BackstageForeverGroupQuests(nil)==0 and #BackstageForeverGroupQuests({})==0)
assert(BackstageForeverLfgText(list[4])=='LFG for [The Missing Diplomat] (Elite, level 28)')
assert(BackstageForeverLfgText({title='No Level',word='Group'})=='LFG for [No Level] (Group)' and BackstageForeverLfgText(nil)==nil)
assert(BackstageForeverGroupQuests({{title='Level Unknown',level=-1,tagId=1}})[1].level==nil)
local lines=BackstageForeverGroupLines(list,true)
assert(#lines==6 and lines[1]=='Group quests in your log: 5. Click a line, or type /bf group 1, to put it in your chat box. Nothing is sent until you press Enter.',lines[1])
assert(lines[2]=='  1. |cff71d5ff|Haddon:BackstageForever:lfg:1|h[LFG for [Bring Friends] (Group, level 22)]|h|r  suggested group of 2',lines[2])
assert(lines[3]=='  2. |cff71d5ff|Haddon:BackstageForever:lfg:2|h[LFG for [Old Client Elite] (Elite, level 24)]|h|r',lines[3])
lines=BackstageForeverGroupLines(list,false)
assert(lines[1]:find('Type /bf group 1 to put the first line',1,true) and lines[3]=='  2. LFG for [Old Client Elite] (Elite, level 24)','no link where a click could not be heard')
assert(BackstageForeverGroupLines({},true)[1]=='No elite, group, dungeon or raid quest is in your log.')
assert(BackstageForeverGroupLines(nil,true)[1]=='The quest log is not readable in this game client.')
local many={} for i=1,14 do many[i]={title='Quest '..i,level=i,tagId=1} end
assert(#BackstageForeverGroupLines(BackstageForeverGroupQuests(many),true)==11,'ten lines and a heading')
assert(BackstageForeverGroupLinkIndex('addon:BackstageForever:lfg:3')==3)
for _,bad in ipairs({'addon:BackstageForever:lfg:0','addon:BackstageForever:lfg:11','addon:Other:lfg:1','item:1234','addon:BackstageForever:lfg:1:x',5}) do assert(BackstageForeverGroupLinkIndex(bad)==nil,tostring(bad)) end
`));

test("group quests in game: the line goes to the chat box on a click or a typed number, and is never sent", () => lua(STUBS + String.raw`
local quests={{isHeader=true,title='Ashenvale'},{title='The Missing Diplomat',level=28,suggestedGroup=3,questID=1265},{title='Plain',level=20,suggestedGroup=0,questID=5},{title='Blackfathom Villainy',level=27,suggestedGroup=5,questID=6561}}
C_QuestLog={GetNumQuestLogEntries=function() return #quests end,GetInfo=function(i) return quests[i] end,
  GetQuestTagInfo=function(id) if id==1265 then return {tagID=1,tagName='Elite'} end if id==6561 then return {tagID=81,tagName='Dungeon'} end end}
local box ChatFrame_OpenChat=function(text) box=text end
local sent=0 SendChatMessage=function() sent=sent+1 end
local heard EventRegistry={RegisterCallback=function(self,event,fn,owner) assert(event=='SetItemRef') heard=function(link) fn(owner,link,'text','LeftButton') end end}
`+ FILE + String.raw`
handler(nil,'PLAYER_LOGIN') assert(type(heard)=='function')
BackstageForeverGroupCommand('group')
assert(#said==3 and said[1]:find('Group quests in your log: 2.',1,true),said[1])
assert(said[2]=='Backstage Forever:   1. |cff71d5ff|Haddon:BackstageForever:lfg:1|h[LFG for [Blackfathom Villainy] (Dungeon, level 27)]|h|r  suggested group of 5',said[2])
assert(box==nil,'listing puts nothing in the chat box')
heard('item:1234') assert(box==nil,'other links are left alone')
heard('addon:BackstageForever:lfg:2') assert(box=='LFG for [The Missing Diplomat] (Elite, level 28)',box)
box=nil BackstageForeverGroupCommand('group 1') assert(box=='LFG for [Blackfathom Villainy] (Dungeon, level 27)' and #said==3,'a typed number does the same')
BackstageForeverGroupCommand('group 7') assert(last():find('no line with that number',1,true))
heard('addon:BackstageForever:lfg:9') assert(last():find('That line is gone',1,true))
assert(sent==0,'nothing is ever sent')
combat=true local n=#said BackstageForeverGroupCommand('group') assert(#said==n+1 and last():find('outside combat',1,true)) combat=false
-- No way to open the chat box: the line is shown instead.
ChatFrame_OpenChat=nil BackstageForeverGroupCommand('group 2') assert(said[#said-1]:find('cannot be opened',1,true) and last()=='Backstage Forever:   LFG for [The Missing Diplomat] (Elite, level 28)')
ChatFrameUtil={OpenChat=function(text) box='util:'..text end} BackstageForeverGroupCommand('group 2') assert(box=='util:LFG for [The Missing Diplomat] (Elite, level 28)')
-- Older clients: the third value is the tag text, or the suggested group.
C_QuestLog=nil EventRegistry=nil PVP='PvP'
local old={{'Ashenvale',0,nil,true},{'Old Elite',24,'Elite',false,nil,nil,nil,11},{'Battleground Quest',30,'PvP',false,nil,nil,nil,12},{'Bring Two',22,2,false,nil,nil,nil,13},{'Solo',20,0,false,nil,nil,nil,14}}
GetNumQuestLogEntries=function() return #old end
GetQuestLogTitle=function(i) return (unpack or table.unpack)(old[i],1,8) end
`+ FILE + String.raw`
said={} handler(nil,'PLAYER_LOGIN') BackstageForeverGroupCommand('group')
assert(#said==3 and said[1]:find('Type /bf group 1',1,true) and said[2]=='Backstage Forever:   1. LFG for [Bring Two] (Group, level 22)  suggested group of 2' and said[3]=='Backstage Forever:   2. LFG for [Old Elite] (Elite, level 24)',said[2])
GetNumQuestLogEntries=nil said={} BackstageForeverGroupCommand('group') assert(said[1]:find('not readable',1,true))
`));

test("notes: one per player, bounded, with the day and zone, and a plain way to show and delete", () => lua(FILE + String.raw`
local db={v=1,notes={}}
local row=BackstageForeverNoteSet(db,'Thrall','good tank',${NOV12},'Westfall')
assert(row.name=='Thrall' and #db.notes==1)
assert(BackstageForeverNoteLine(row)=='Thrall: you noted on 12 Nov in Westfall: good tank',BackstageForeverNoteLine(row))
assert(BackstageForeverNoteGet(db,'thrall')==row and BackstageForeverNoteGet(db,'Jaina')==nil,'names match in any letter case')
BackstageForeverNoteSet(db,'thrall','left mid-run',${MAR3},nil)
assert(#db.notes==1 and BackstageForeverNoteLine(db.notes[1])=='thrall: you noted on 3 Mar: left mid-run','a new note replaces the old one')
assert(BackstageForeverNoteLine({name='Jaina',text='kind healer',at=0})=='Jaina: you noted: kind healer')
assert(BackstageForeverNoteLine(nil)==nil and BackstageForeverNoteLine({name='x'})==nil)
for _,bad in ipairs({{'T','x'},{'Thrall',''},{'Thrall',string.rep('x',121)},{'Thr4ll','x'},{'Thrall!','x'},{nil,'x'},{'Thrall',5},{string.rep('a',49),'x'}}) do
  assert(BackstageForeverNoteSet(db,bad[1],bad[2],1,'Zone')==nil,tostring(bad[1]))
end
assert(BackstageForeverNoteSet(nil,'Thrall','x',1)==nil and BackstageForeverNoteSet({},'Thrall','x',1)==nil)
assert(BackstageForeverNoteSet(db,'Jaina-Kul Tiras','from another realm',5,'Dustwallow Marsh') and BackstageForeverNoteName('J\195\164ger') and not BackstageForeverNoteName('a b-'))
local gone=BackstageForeverNoteDelete(db,'THRALL') assert(gone and gone.text=='left mid-run' and #db.notes==1 and BackstageForeverNoteDelete(db,'Thrall')==nil)
local big={notes={}}
for i=1,205 do BackstageForeverNoteSet(big,'Player'..string.char(97+i%26)..string.char(97+math.floor(i/26)),'note '..i,i) end
assert(#big.notes==200 and big.notes[1].text=='note 6' and big.notes[200].text=='note 205','200 notes at most; the oldest go first')
-- What "/bf note ..." means.
local function parse(rest,target) local a,b,c=BackstageForeverNoteParse(rest,target,db) return tostring(a)..'|'..tostring(b)..'|'..tostring(c) end
db={notes={}} BackstageForeverNoteSet(db,'Thrall','good tank',1)
assert(parse('great healer','Jaina')=='set|Jaina|great healer','with a player targeted, every word is the note')
assert(parse('  Rexxar pulls too much ',nil)=='set|Rexxar|pulls too much','without a target the first word is the name')
assert(parse('Thrall',nil)=='delete|Thrall|nil' and parse('thrall','Jaina')=='delete|Thrall|nil','a noted name alone shows and deletes')
assert(parse('Thrall even better tank','Jaina')=='set|Thrall|even better tank','a noted name first updates that note')
assert(parse('Thrall is here','Thrall')=='set|Thrall|Thrall is here')
assert(parse('friendly','Jaina')=='set|Jaina|friendly' and parse('Rexxar',nil)=='missing|Rexxar|nil')
assert(parse('',nil)=='usage|nil|nil' and parse('','Jaina')=='show|Jaina|nil' and parse(nil,nil)=='usage|nil|nil' and parse('12345 x',nil)=='usage|nil|nil')
local lines=BackstageForeverNotesLines({notes={{name='Old',text='first',at=${MAR3},zone='Durotar'},{name='New',text='second',at=${NOV12}}}})
assert(lines[1]=='Your notes on players: 2. /bf note Name shows one and deletes it.' and lines[2]=='  New: you noted on 12 Nov: second' and lines[3]=='  Old: you noted on 3 Mar in Durotar: first',lines[2])
assert(BackstageForeverNotesLines({notes={}})[1]:find('No notes yet',1,true) and BackstageForeverNotesLines(nil)[1]:find('No notes yet',1,true))
lines=BackstageForeverNotesLines(big,3) assert(#lines==5 and lines[5]=='  and 197 more.',lines[5])
`));

test("notes in game: written on your target, repeated once when you meet again, never in combat", () => lua(STUBS + String.raw`
local units={} UnitExists=function(u) return units[u]~=nil end UnitIsPlayer=function(u) return units[u] and units[u].player end
UnitIsUnit=function(a,b) return units[a] and units[a].me==true end
UnitName=function(u) local x=units[u] if x then return x.name,x.realm end end
GetServerTime=function() return ${NOV12} end GetRealZoneText=function() return 'Westfall' end
local raid=false IsInRaid=function() return raid end
`+ FILE + String.raw`
handler(nil,'PLAYER_LOGIN') assert(type(BackstageForeverNotesDB.notes)=='table')
BackstageForeverNoteCommand('note') assert(last():find('Target a player',1,true))
units.target={name='Thrall',player=true}
BackstageForeverNoteCommand('note good tank') assert(last()=='Backstage Forever: Note on Thrall saved. It stays on this computer.',last())
local saved=BackstageForeverNotesDB.notes[1] assert(saved.name=='Thrall' and saved.text=='good tank' and saved.zone=='Westfall' and saved.at==${NOV12})
BackstageForeverNoteCommand('note') assert(last()=='Backstage Forever: Thrall: you noted on 12 Nov in Westfall: good tank',last())
units.target={name='Mankrik',player=false} BackstageForeverNoteCommand('note') assert(last():find('Target a player',1,true),'no notes on characters of the game')
units.target={name='Me',player=true,me=true} BackstageForeverNoteCommand('note') assert(last():find('Target a player',1,true),'no notes on yourself')
units.target=nil
BackstageForeverNoteCommand('note Jaina kind |cffff0000healer|r') assert(BackstageForeverNoteGet(BackstageForeverNotesDB,'Jaina').text=='kind cffff0000healerr','colour codes cannot be stored')
BackstageForeverNoteCommand('note Rexxar') assert(last():find('You have no note on Rexxar',1,true))
BackstageForeverNoteCommand('note Jaina '..string.rep('x',130)) assert(last():find('under 120 characters',1,true))
BackstageForeverNoteCommand('note Jaina') assert(said[#said-1]:find('Jaina: you noted on 12 Nov in Westfall: kind',1,true) and last()=='Backstage Forever: Note on Jaina deleted.' and BackstageForeverNoteGet(BackstageForeverNotesDB,'Jaina')==nil)
-- Meeting again.
local n=#said
units.target={name='Thrall',player=true} combat=true handler(nil,'PLAYER_TARGET_CHANGED') assert(#said==n,'never in combat')
combat=false handler(nil,'PLAYER_REGEN_ENABLED') assert(#said==n+1 and last()=='Backstage Forever: Thrall: you noted on 12 Nov in Westfall: good tank',last())
handler(nil,'PLAYER_TARGET_CHANGED') handler(nil,'GROUP_ROSTER_UPDATE') assert(#said==n+1,'once per session per player')
units.target={name='Stranger',player=true} handler(nil,'PLAYER_TARGET_CHANGED') assert(#said==n+1)
BackstageForeverNoteSet(BackstageForeverNotesDB,'Garrosh-Nagrand','ninja looter',${MAR3},'Deadmines')
units.target=nil units.party2={name='Garrosh',realm='Nagrand',player=true} handler(nil,'GROUP_ROSTER_UPDATE')
assert(#said==n+2 and last()=='Backstage Forever: Garrosh-Nagrand: you noted on 3 Mar in Deadmines: ninja looter',last())
BackstageForeverNoteSet(BackstageForeverNotesDB,'Sylvanas','quiet',1) units.raid17={name='Sylvanas',player=true}
handler(nil,'GROUP_ROSTER_UPDATE') assert(#said==n+2,'raid units are only looked at in a raid')
raid=true BackstageForeverNotesCommand('notes off') assert(BackstageForeverSocialSettings.notes==false)
local m=#said handler(nil,'GROUP_ROSTER_UPDATE') assert(#said==m,'switched off')
BackstageForeverNotesCommand('notes on') handler(nil,'GROUP_ROSTER_UPDATE') assert(#said==m+2 and last():find('Sylvanas: you noted',1,true))
m=#said BackstageForeverNotesCommand('notes') assert(#said==m+4 and said[m+1]:find('Your notes on players: 3.',1,true))
combat=true BackstageForeverNoteCommand('note Thrall x') assert(last():find('outside combat',1,true) and BackstageForeverNoteGet(BackstageForeverNotesDB,'Thrall').text=='good tank')
combat=false BackstageForeverNotesDB='broken' BackstageForeverNotesCommand('notes') assert(last():find('No notes yet',1,true),'a damaged saved table starts over')
`));

test("mail expiry: letters under 3 days are counted and the soonest is named", () => lua(FILE + String.raw`
local s=BackstageForeverMailExpiry({29.5,2.4,0.3,3,1.2,'x',-1,0/0,400})
assert(s.count==3 and s.soonest==0.3 and s.total==5)
assert(BackstageForeverMailExpiryLine(s)=='3 letters expire within 3 days. The soonest has less than a day left.')
assert(BackstageForeverMailExpiryLine(BackstageForeverMailExpiry({1.5,30}))=='One letter expires within 3 days: it has about a day left.')
assert(BackstageForeverMailExpiryLine(BackstageForeverMailExpiry({2.9,2.2}))=='2 letters expire within 3 days. The soonest has about 2 days left.')
s=BackstageForeverMailExpiry({3,12,30}) assert(s.count==0 and s.soonest==nil and s.total==3 and BackstageForeverMailExpiryLine(s)==nil,'3 days is not within 3 days')
assert(BackstageForeverMailExpiry(nil).count==0 and BackstageForeverMailExpiryLine(nil)==nil and BackstageForeverMailExpiryLine({count=2})==nil)
`));

test("mail in game: one line per mailbox visit, mail is only looked at", () => lua(STUBS + String.raw`
local mail={{30},{2.5},{0.4}}
GetInboxNumItems=function() return #mail end
GetInboxHeaderInfo=function(i) return 'icon','stationery','Sender','Subject',0,0,mail[i][1],1 end
`+ FILE + String.raw`
BackstageForeverMailCommand('mail') assert(last():find('Open a mailbox first',1,true))
handler(nil,'MAIL_SHOW') assert(#said==2 and last()=='Backstage Forever: 2 letters expire within 3 days. The soonest has less than a day left.',last())
handler(nil,'MAIL_INBOX_UPDATE') handler(nil,'MAIL_INBOX_UPDATE') assert(#said==2,'once per visit')
table.remove(mail,3) handler(nil,'MAIL_INBOX_UPDATE') assert(#said==3 and last():find('One letter expires within 3 days: it has about 2 days left.',1,true),'said again when it changes')
handler(nil,'MAIL_CLOSED') handler(nil,'MAIL_SHOW') assert(#said==4,'and at the next visit')
handler(nil,'MAIL_CLOSED') combat=true handler(nil,'MAIL_SHOW') assert(#said==4) combat=false
BackstageForeverMailCommand('mail off') assert(BackstageForeverSocialSettings.mail==false)
local n=#said handler(nil,'MAIL_CLOSED') handler(nil,'MAIL_SHOW') assert(#said==n,'switched off')
BackstageForeverMailCommand('mail') assert(#said==n+1 and last():find('One letter expires',1,true),'the command still answers')
mail={{30}} handler(nil,'MAIL_INBOX_UPDATE') BackstageForeverMailCommand('mail') assert(last()=='Backstage Forever: No letter in your mailbox expires within 3 days.')
mail={} handler(nil,'MAIL_INBOX_UPDATE') BackstageForeverMailCommand('mail') assert(last()=='Backstage Forever: Your mailbox was empty when you last opened it.')
BackstageForeverMailCommand('mail on') mail={{1}} GetInboxHeaderInfo=function() error('blocked') end
n=#said handler(nil,'MAIL_CLOSED') handler(nil,'MAIL_SHOW') assert(#said==n,'unreadable days are not guessed')
`));

test("accessibility: marks only when switched on, and one scale for the addon's windows", () => lua(STUBS + FILE + String.raw`
assert(BackstageForeverMark('good')=='' and BackstageForeverMark('bad')=='' and BackstageForeverTextScale()==1,'both are off until switched on')
assert(BackstageForeverSocialEnabled('notes') and BackstageForeverSocialEnabled('mail') and not BackstageForeverSocialEnabled('marks') and not BackstageForeverSocialEnabled('text') and not BackstageForeverSocialEnabled('nonsense'))
local scales={}
local function window(name) _G[name]={SetScale=function(_,s) scales[name]=s end} end
window('BackstageForeverCompass') window('BackstageForeverOptions')
assert(BackstageForeverAccessCommand('access marks on')==true and last()=='Backstage Forever: Marks without colour — On')
assert(BackstageForeverMark('good')=='[+] ' and BackstageForeverMark('bad')=='[x] ' and BackstageForeverMark('same')=='[=] ' and BackstageForeverMark('warn')=='[!] ' and BackstageForeverMark('danger')=='[!!] ' and BackstageForeverMark('other')=='')
assert(next(scales)==nil,'marks do not touch the windows')
assert(BackstageForeverAccessCommand('access text on')==true and scales.BackstageForeverCompass==1.15 and scales.BackstageForeverOptions==1.15)
local late={SetScale=function(self,s) self.scale=s end} assert(BackstageForeverApplyTextSize(late)==true and late.scale==1.15,'a window built later gets the same size')
assert(BackstageForeverApplyTextSize(nil)==false and BackstageForeverApplyTextSize({})==false)
assert(BackstageForeverAccessCommand('access text')==false and scales.BackstageForeverCompass==1 and BackstageForeverTextScale()==1,'no word toggles')
combat=true BackstageForeverAccessCommand('access text on') assert(last():find('outside combat',1,true) and scales.BackstageForeverCompass==1) combat=false
local n=#said BackstageForeverAccessCommand('access')
assert(#said==n+3 and said[n+2]=='Backstage Forever:   Marks without colour — On (/bf access marks off)' and said[n+3]=='Backstage Forever:   Larger window text — Off (/bf access text on)',said[n+2])
BackstageForeverAccessCommand('access nonsense on') assert(BackstageForeverSocialSettings.nonsense==nil)
`));

test("marks reach the gear tooltip line and the target warning, and the windows ask for their size", () => {
  const gear = read("addon/BackstageForever/BackstageForeverGear.lua");
  assert.match(gear, /return mark\('bad'\)\.\.'Not for you: '/); assert.match(gear, /return mark\('good'\)\.\.'Upgrade for you'/); assert.match(gear, /return mark\('same'\)\.\.'Not an upgrade'/);
  const assist = read("addon/BackstageForever/BackstageForeverAssist.lua");
  assert.match(assist, /d\.tone=='red' and BackstageForeverMark\('danger'\) or d\.tone=='orange' and BackstageForeverMark\('warn'\)/);
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /panel=CreateFrame\('Frame','BackstageForeverCompass',UIParent,'BackdropTemplate'\)\r?\n[^\n]*\r?\n    if type\(BackstageForeverApplyTextSize\)=='function' then pcall\(BackstageForeverApplyTextSize,panel\) end/);
  assert.equal((read("addon/BackstageForever/BackstageForeverOptions.lua").match(/pcall\(BackstageForeverApplyTextSize,f\)/g) || []).length, 2, "the settings window and the welcome card");
  // The gear line itself, with the mark switched on and off.
  lua(String.raw`
local line dofile('addon/BackstageForever/BackstageForeverSocial.lua')
local function mark(kind) local f=BackstageForeverMark;if type(f)~='function' then return '' end;local ok,m=pcall(f,kind);return ok and type(m)=='string' and m or '' end
assert(mark('good')..'Upgrade for you'=='Upgrade for you')
BackstageForeverSocialSettings={marks=true}
assert(mark('good')..'Upgrade for you'=='[+] Upgrade for you' and mark('bad')..'Not for you: level 40'=='[x] Not for you: level 40')
`);
});

test("the social helpers are wired in, saved per character, switchable, and never act for the player", () => {
  const src = read("addon/BackstageForever/BackstageForeverSocial.lua");
  for (const banned of ["SendChatMessage", "SendAddonMessage", "TakeInboxItem", "TakeInboxMoney", "AutoLootMailItem", "DeleteInboxItem", "ReturnInboxItem", "GetInboxText", "OpenMail", "InviteUnit", "AddFriend", "AddIgnore", "CreateFontString", "CreateTexture", ":Insert("]) assert.ok(!src.includes(banned), banned);
  assert.equal((src.match(/OpenChat/g) || []).length, 2, "the chat box is opened in one place only");
  assert.match(src, /local function offer\(index\)/);
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  // The desktop reads the account-wide saved file and accepts exactly one variable in it, so notes
  // and switches are per character: those go to another file the desktop never parses.
  assert.match(toc, /^## SavedVariables: BackstageForeverExport\r?$/m);
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverSocialSettings\b.*\bBackstageForeverNotesDB\b/m);
  assert.match(toc, /^BackstageForeverSocial\.lua\r?$/m);
  const { parseSavedVariables } = require("../src/core/game-sync.cjs");
  assert.throws(() => parseSavedVariables('BackstageForeverNotesDB = {\n}\nBackstageForeverExport = "{}"\n'), "a second account-wide variable would stop the desktop reading the capture");
  const hud = read("addon/BackstageForever/BackstageForeverHUD.lua");
  for (const word of ["group", "note", "notes", "mail", "access"]) assert.ok(hud.includes(`word=='${word}'`), word);
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  for (const [key, command] of [["mail", "mail"], ["notes", "notes"]]) assert.ok(options.includes(`on('BackstageForeverSocialSettings','${key}'),'${command}'`), key);
  for (const [key, command] of [["marks", "access marks"], ["text", "access text"]]) assert.ok(options.includes(`off('BackstageForeverSocialSettings','${key}'),'${command}'`), key);
  const { CATALOG } = require("../src/renderer/commands.js");
  for (const word of ["group", "note", "notes", "mail", "access"]) assert.ok(CATALOG.some((c) => c.word === word), word);
  const help = read("addon/BackstageForever/BackstageForeverAssist.lua");
  for (const word of ["group", "note", "mail", "access"]) assert.ok(help.includes(`'/bf ${word} `), `/bf help lists ${word}`);
});

test("German clients get the social lines in German", () => {
  const out = lua(String.raw`
GetLocale=function() return 'deDE' end
dofile('addon/BackstageForever/BackstageForeverLocale.lua')
` + FILE + String.raw`
local q=BackstageForeverGroupQuests({{title='Der vermisste Diplomat',level=28,group=3,tagId=1,tagName='Elite'},{title='Bringt Freunde',level=22,group=2}})
print(BackstageForeverLfgText(q[2])) print(BackstageForeverLfgText(q[1]))
local lines=BackstageForeverGroupLines(q,false) print(lines[1]) print(lines[2])
print(BackstageForeverGroupLines({},true)[1])
print(BackstageForeverNoteLine({name='Thrall',text='guter Tank',at=${MAR3},zone='Westfall'}))
print(BackstageForeverNoteLine({name='Thrall',text='guter Tank',at=${NOV12}}))
print(BackstageForeverNotesLines({notes={}})[1])
print(BackstageForeverMailExpiryLine(BackstageForeverMailExpiry({0.2,2,2})))
print(BackstageForeverMailExpiryLine(BackstageForeverMailExpiry({2.5})))
print(BackstageForeverTr('Marks without colour')) print(BackstageForeverTr('Larger window text'))
`).split("\n");
  assert.equal(out[0], "Suche Gruppe für [Der vermisste Diplomat] (Elite, Stufe 28)");
  assert.equal(out[1], "Suche Gruppe für [Bringt Freunde] (Gruppe, Stufe 22)");
  assert.equal(out[2], "Gruppenquests in deinem Log: 2. Tippe /bf group 1, um die erste Zeile in dein Chatfeld zu setzen. Nichts wird gesendet, bis du Enter drückst.");
  assert.equal(out[3], "  1. Suche Gruppe für [Bringt Freunde] (Gruppe, Stufe 22)  empfohlene Gruppe: 2");
  assert.equal(out[4], "In deinem Log ist keine Elite-, Gruppen-, Dungeon- oder Schlachtzugsquest.");
  assert.equal(out[5], "Thrall: deine Notiz vom 3. Mär in Westfall: guter Tank");
  assert.equal(out[6], "Thrall: deine Notiz vom 12. Nov: guter Tank");
  assert.equal(out[7], "Noch keine Notizen. Wähle einen Spieler als Ziel und tippe /bf note guter Tank, oder /bf note Name guter Tank.");
  assert.equal(out[8], "3 Briefe verfallen innerhalb von 3 Tagen. Der nächste hat noch weniger als einen Tag.");
  assert.equal(out[9], "Ein Brief verfällt innerhalb von 3 Tagen: er hat noch etwa 2 Tage.");
  assert.equal(out[10], "Zeichen statt Farbe");
  assert.equal(out[11], "Größere Fensterschrift");
});
