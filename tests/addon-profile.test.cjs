"use strict";
// Profiles: every setting of a character as one text code. The code is read by a small reader that
// never runs anything; these tests feed it damaged, hostile and random text and check that only
// known settings with the right kind of value ever reach a saved table.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const LOAD = String.raw`dofile('addon/BackstageForever/BackstageForeverProfile.lua')
local function world(tables) return {get=function(n) return tables[n] end,set=function(n,v) tables[n]=v end} end
local function code(payload) return 'BF1:'..BackstageForeverProfileSum(payload)..':'..payload end
`;

test("every per-character saved table is either in the list of settings, your data, or named as never copied", () => {
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  const saved = /^## SavedVariablesPerCharacter: (.*)$/m.exec(toc)[1].split(",").map((s) => s.trim());
  assert.ok(saved.length >= 38 && saved.includes("BackstageForeverProfileDB"));
  const out = lua(LOAD + String.raw`
local names={}
for _,e in pairs(BackstageForeverProfileSettings) do names[e.global]='settings' end
for _,e in pairs(BackstageForeverProfileData) do names[e.global]=names[e.global] or 'data' end
for _,n in ipairs(BackstageForeverProfileNotCopied) do names[n]=names[n] or 'never' end
local list={} for n,k in pairs(names) do list[#list+1]=n..'='..k end table.sort(list) print(table.concat(list,','))`);
  const known = new Map(out.split(",").map((p) => p.split("=")));
  for (const name of saved) assert.ok(known.has(name), `${name} is not accounted for in BackstageForeverProfile.lua`);
  for (const name of known.keys()) assert.ok(saved.includes(name), `${name} is not a saved table`);
  // Every table called ...Settings is copied, except the soft-reserve list of one run.
  for (const name of saved.filter((n) => n.endsWith("Settings") && n !== "BackstageForeverCrewSettings")) assert.equal(known.get(name), "settings", name);
  for (const name of ["BackstageForeverJournalDB", "BackstageForeverSheetDB", "BackstageForeverQuestItemSourcesDB"]) assert.equal(known.get(name), "never", name);
  // Every switch in the settings window is a setting the profile carries, apart from the three that change the game itself.
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  const pairs = [...options.matchAll(/(?:on|off|saved)\('(BackstageForever\w+)','(\w+)'\)/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.ok(pairs.length >= 40);
  const carried = new Set(lua(LOAD + String.raw`local o={} for _,e in pairs(BackstageForeverProfileSettings) do for k in pairs(e.keys) do o[#o+1]=e.global..'.'..k end end print(table.concat(o,','))`).split(","));
  const notCopied = ["BackstageForeverQoLSettings.questtext", "BackstageForeverChatSettings.stamps", "BackstageForeverChatSettings.names"];
  assert.deepEqual([...new Set(pairs)].filter((p) => !carried.has(p)).sort(), notCopied.sort());
  const helpers = read("addon/BackstageForever/BackstageForeverHelpers.lua");
  for (const m of options.matchAll(/helper\('(\w+)'/g)) { assert.ok(carried.has(`BackstageForeverHelperSettings.${m[1]}`), m[1]); assert.ok(helpers.includes(m[1])); }
});

test("a code goes out and comes back the same: versioned, with a checksum, the same text for the same settings", () => lua(LOAD + String.raw`
local tables={
  BackstageForeverHUDSettings={visible=true,collapsed=false,mode='questing',focus='turn-ins',minutes=15,point='TOPLEFT',relativePoint='TOPLEFT',x=12.5,y=-340.25,schemaVersion=1,profession={crafts=5}},
  BackstageForeverPanelSettings={tracker=true,wish=false,pos={tracker={x=10,y=700.125},run={x=0,y=1}},visit={map=36,startedAt=5}},
  BackstageForeverAssistSettings={toasts=false,danger=true,welcomed=true,repairers={[5]={m=1}},flightNames={[2]='x'}},
  BackstageForeverMapSettings={enabled=true,details=true,layers={quest=true,herbs=false,ore=true,supplies=true,finds=true,olderReferences=false}},
  BackstageForeverLedgerDB={pricesOn=false,prices={{1,2}},money=5},
  BackstageForeverScoutDB={on=true,records={{k='v'}}},
  BackstageForeverLfgSettings={sort='age'},
}
local doc=BackstageForeverProfileCollect(world(tables),false,{name='Tester',realm='Some Realm',class='MAGE',at=1700000000})
local text=BackstageForeverProfileEncode(doc)
assert(text:match('^BF1:%x%x%x%x%x%x%x%x:{') and not text:find('[^%w_%.%-%%;{}:]'),'one line of plain characters: '..text)
assert(#text<1200)
-- State, caches and one character's own records are not in it.
for _,word in ipairs({'welcomed','repairers','flightNames','visit','schemaVersion','profession','money','records','hist'}) do assert(not text:find(word,1,true),word) end
assert(BackstageForeverProfileEncode(BackstageForeverProfileCollect(world(tables),false,{name='Tester',realm='Some Realm',class='MAGE',at=1700000000}))==text,'the same settings give the same code')
local back=assert(BackstageForeverProfileDecode(text))
assert(back.m.n=='Tester' and back.m.r=='Some Realm' and back.m.c=='MAGE' and back.m.t==1700000000)
assert(back.s.HUD.mode=='questing' and back.s.HUD.minutes==15 and back.s.HUD.x==12.5 and back.s.HUD.y==-340.25 and back.s.HUD.visible==true and back.s.HUD.collapsed==false)
assert(back.s.Panel.pos.tracker.y==700.125 and back.s.Panel.wish==false and back.s.Map.layers.herbs==false and back.s.Ledger.pricesOn==false and back.s.Scout.on==true and back.s.Lfg.sort=='age')
local settings,rows=BackstageForeverProfileCount(back) assert(settings==28 and rows==0,settings)
assert(BackstageForeverProfileEncode(back)==text,'reading and writing again changes nothing')
-- Spaces and line ends around a pasted code do not matter.
assert(BackstageForeverProfileDecode('  \n'..text..'\r\n '))
-- Numbers keep their exact value.
for _,v in ipairs({0,1,-1,0.1,1/3,123456.789,1e-7,9999.9999,360,0.4523}) do
  local c=BackstageForeverProfileEncode({v=1,s={Ask={angle=v}},m={}})
  local d=BackstageForeverProfileDecode(c)
  if v>=0 and v<=360 then assert(d.s.Ask.angle==v,tostring(v)) else assert(d==nil) end
end
-- The checksum is plain Adler-32.
assert(BackstageForeverProfileSum('')=='00000001' and BackstageForeverProfileSum('Wikipedia')=='11e60398' and BackstageForeverProfileSum(string.rep('a',70000)):match('^%x%x%x%x%x%x%x%x$'))
`));

test("strict reading: damaged, cut, foreign and oversized codes are refused with a plain reason", () => lua(LOAD + String.raw`
local good=BackstageForeverProfileEncode({v=1,m={n='A'},s={Gear={enabled=false},QoL={coords=true}}})
local function why(text,limit) local doc,reason=BackstageForeverProfileDecode(text,limit) assert(doc==nil,'accepted: '..tostring(text):sub(1,60)) return reason end
assert(why(nil)=='form' and why(5)=='form' and why('')=='form' and why('hello')=='form' and why('BF1:zzzzzzzz:{}')=='form' and why('BF1:{}')=='form')
assert(why((good:gsub('^BF1','BF2')))=='version' and why((good:gsub('^BF1','XX9')))=='version')
-- One changed, missing or added character anywhere is noticed.
assert(why(good:sub(1,-2))=='sum' and why(good..'}')=='sum' and why((good:gsub('coords','coordz')))=='sum' and why((good:gsub(';t',';f',1)))=='sum')
for i=14,#good do local c=good:sub(1,i-1)..(good:sub(i,i)=='t' and 'f' or 't')..good:sub(i+1) assert(BackstageForeverProfileDecode(c)==nil,'a changed character at '..i) end
-- A right checksum over a wrong body is still refused.
for _,payload in ipairs({'','{','}','{}','{sv;n1;','{sv;n1;}}','{sv;n1;sv;n1;}','{t}','{sv;}','{n1.5;t}','{n0;t}','{sv;n1e9999;}','{sv;nNaN;}','{sv;n--1;}','{sv;n1.;}','{sv;n0x10;}',
  '{sv;n1;ss;{sGear;{senabled;x}}}','{sv;n1;ss;{sGear;{senabled;t}}}trailing','{sv;n1;ss;{sa%2;t}}','{sv;n1;ss;{sa%zz;t}}','{sv;n1;ss;{sa%;t}}','{{}t}','{sv;n'..string.rep('9',30)..';}','sv;','t','n5;',
  '{sv;n2;ss;{sGear;{senabled;t}}}','{sv;n1;}','{sv;n1;ss;t}','{sv;n1;ss;{}}','{sv;n1;ss;{sNothing;{sx;t}}}'}) do
  assert(BackstageForeverProfileDecode(code(payload))==nil,'accepted: '..payload)
end
assert(why(code('{sv;n1;ss;{sNothing;{sx;t}}}'))=='empty' and why(code('{sv;n2;ss;{sGear;{senabled;t}}}'))=='version' and why(code('{sv;n1;sv;n1;}'))=='read')
-- Characters outside the code's own alphabet never reach the reader.
for _,ch in ipairs({' ','|','"',"'",'\\','(',')','=','\n','\0','<','$','#'}) do assert(why('BF1:00000001:{sv;n1;'..ch..'}')=='form',ch) end
-- Bounds: length, depth, number of values, length of one text.
assert(why(code('{sv;n1;sx;s'..string.rep('a',240000)..';}'))=='big')
assert(why(good,20)=='big')
assert(why(code(string.rep('{sa;',9)..'t'..string.rep('}',9)))=='read','nine deep')
local many={} for i=1,31000 do many[i]='n'..i..';t' end
assert(why(code('{sv;n1;sx;{'..table.concat(many)..'}}'))=='read','too many values')
assert(why(code('{sv;n1;ss;{sGear;{senabled;t}}sx;s'..string.rep('a',401)..';}'))=='read','one text too long')
assert(BackstageForeverProfileDecode(code('{sv;n1;ss;{sGear;{senabled;t}}sx;s'..string.rep('a',400)..';}')),'an unknown key with a legal value is simply dropped')
assert(BackstageForeverProfileEncode({v=1,s={x=string.rep('a',300)}},100)==nil)
for _,reason in ipairs({'big','form','version','sum','read','empty','anything'}) do local s=BackstageForeverProfileWhy(reason) assert(type(s)=='string' and s:sub(-1)=='.' and not s:find('checksum',1,true)) end
`));

test("unknown tables and keys are dropped and every value is checked for kind, range and allowed word", () => lua(LOAD + String.raw`
local raw={v=1,m={n='Mage|cffff0000',r=string.rep('x',61),c='mage',t=-5,extra='x'},s={
  HUD={mode='zzz',focus='nearby',minutes=45,visible='yes',collapsed=true,point='TOPLEFT',x=5,y=5,unknown=true,profession={crafts=5}},
  Route={mode='guide',shown=1,arrow=true,skipped={a=true}},
  Live={enabled=true,pos='topleft',safe=true,momentSeq=9,announce=true},
  Ask={angle=361,hidden=true,recent={{text='x'}}},
  Panel={tracker=true,pos={tracker={x=-1,y=5},run={x=3,y=4,z=9},other={x=1,y=1}},visit={map=1}},
  Map={layers={quest=false,nope=true,herbs='x'}},
  Bag={sort='price',enabled=true,seen={[5]=1}},
  Chat={links=true,filter=false,stamps=true,names=true,filtered=99,stampsBefore='none'},
  QoL={coords=true,questtext=true,questtextBefore='1'},
  Crew={sr={{'A','B'}}}, Journal={levels={1}}, Evil={x=true}, [5]={x=true},
  Helper={questTracker=false,madeUp=false},
  Lfg={sort='age',pos={x=1e8,y=5}},
},d={Notes='x'},junk={1,2,3}}
local doc=assert(BackstageForeverProfileClean(raw))
assert(doc.m.n==nil and doc.m.r==nil and doc.m.c==nil and doc.m.t==nil and doc.m.extra==nil,'a name with a colour code, an overlong realm, a wrong class and a wrong time are all left out')
local function keys(t) local o={} for k in pairs(t or {}) do o[#o+1]=tostring(k) end table.sort(o) return table.concat(o,',') end
assert(keys(doc.s)=='Ask,Bag,Chat,HUD,Helper,Lfg,Live,Map,Panel,QoL,Route',keys(doc.s))
-- The Compass position needs all four of its values; with one missing none is kept.
assert(keys(doc.s.HUD)=='collapsed,focus',keys(doc.s.HUD))
assert(keys(doc.s.Route)=='arrow,mode' and keys(doc.s.Live)=='enabled,safe' and keys(doc.s.Ask)=='hidden')
assert(keys(doc.s.Panel)=='pos,tracker' and keys(doc.s.Panel.pos)=='run' and keys(doc.s.Panel.pos.run)=='x,y','half a position is no position')
assert(keys(doc.s.Map)=='layers' and keys(doc.s.Map.layers)=='quest' and keys(doc.s.Bag)=='enabled' and keys(doc.s.Chat)=='filter,links' and keys(doc.s.QoL)=='coords')
assert(keys(doc.s.Helper)=='questTracker' and keys(doc.s.Lfg)=='sort' and doc.d==nil)
assert(BackstageForeverProfileClean(nil)==nil and BackstageForeverProfileClean({v=1})==nil and BackstageForeverProfileClean({v=1,s={Evil={x=1}}})==nil and BackstageForeverProfileClean({v='1',s={Gear={enabled=true}}})==nil)
-- Not-a-number and infinity never pass as numbers.
local nan,inf=0/0,1/0
assert(BackstageForeverProfileClean({v=1,s={Ask={angle=nan}}})==nil and BackstageForeverProfileClean({v=1,s={Ask={angle=inf}}})==nil and BackstageForeverProfileClean({v=1,s={HUD={minutes=15.5}}})==nil)
`));

test("hostile and random text: the reader never errors, never runs anything, and only ever yields known settings", () => lua(LOAD + String.raw`
-- If any of this text were ever run, these would change.
HACKED=nil
local attacks={
  'BF1:00000001:HACKED=true','HACKED=true','return (function() HACKED=true end)()','BF1:00000001:{sv;n1;ss;{sGear;{senabled;loadstring("HACKED=true")()}}}',
  ']] HACKED=true --[[','BF1:00000001:\\"..(HACKED=true)..\\"','|cffff0000|Hitem:1|h[x]|h|r','%s%s%s%n%n','\\0\\0\\0',string.rep('{',5000),string.rep('}',5000),string.rep('BF1:',500),
  code('{sv;n1;ss;{sGear;{senabled;sloadstring%28%22HACKED%3Dtrue%22%29%28%29;}}}'),
  code('{sv;n1;ss;{sHUD;{smode;s__index;}}}'),code('{sv;n1;ss;{s__index;{sx;t}}}'),code('{sv;n1;ss;{sGear;{s__newindex;t;senabled;t}}}'),
  code('{sv;n1;sm;{sn;s%00%00;}}'),code('{sv;n1;ss;{sGear;{senabled;t};sGear;{senabled;f}}}'),
}
for _,text in ipairs(attacks) do local ok,doc=pcall(BackstageForeverProfileDecode,text) assert(ok,'the reader threw on: '..text:sub(1,40)) end
assert(HACKED==nil)
-- A text value where a switch belongs is dropped; the switch is not set from it.
local doc=BackstageForeverProfileDecode(code('{sv;n1;ss;{sGear;{senabled;sloadstring%28%22HACKED%3Dtrue%22%29%28%29;}sQoL;{scoords;t}}}'))
assert(doc and doc.s.Gear==nil and doc.s.QoL.coords==true)
assert(BackstageForeverProfileDecode(code('{sv;n1;ss;{sGear;{senabled;t}sGear;{senabled;f}}}'))==nil,'a key given twice is refused')
-- Whatever comes out holds only tables, keys and kinds of value this file knows.
local known=BackstageForeverProfileSettings
local function audit(doc)
  for short,t in pairs(doc.s) do
    local entry=assert(known[short],'unknown table '..tostring(short))
    for key,value in pairs(t) do
      local spec=assert(entry.keys[key],'unknown key '..short..'.'..tostring(key))
      if spec[1]=='b' then assert(type(value)=='boolean') elseif spec[1]=='n' then assert(type(value)=='number' and value>=spec[2] and value<=spec[3])
      elseif spec[1]=='e' then assert(spec[2][value]) else assert(type(value)=='table') end
    end
  end
end
-- A deterministic stream of numbers, so a failure can be repeated.
local seed=20261124
local function rnd(n) seed=(seed*1103515245+12345)%2147483648 return seed%n+1 end
local alphabet='tfns{};%-._0123456789abcdefABCDEF:|"\\ \n'..string.char(0,1,127,128,255)
local valid=BackstageForeverProfileEncode(BackstageForeverProfileCollect(world({
  BackstageForeverHUDSettings={visible=true,mode='adventure',focus='balanced',minutes=30,point='CENTER',relativePoint='CENTER',x=1,y=2},
  BackstageForeverHelperSettings={questTracker=false,questDetours=true},BackstageForeverPanelSettings={pos={tracker={x=1,y=2}},tracker=true},
  BackstageForeverSocialSettings={marks=true},BackstageForeverLfgSettings={sort='age',pos={x=4,y=5}}}),false,{name='A',realm='B'}))
local payload=valid:match('^BF1:%x+:(.*)$')
local accepted,refused=0,0
for round=1,6000 do
  local text
  local kind=rnd(4)
  if kind==1 then                       -- pure noise
    local parts={} for i=1,rnd(60) do local at=rnd(#alphabet) parts[i]=alphabet:sub(at,at) end text=table.concat(parts)
  elseif kind==2 then                   -- noise in the code's own alphabet, with a right checksum
    local parts={} for i=1,rnd(80) do local at=rnd(15) parts[i]=('tfns{};%-._059aE'):sub(at,at) end text=code(table.concat(parts))
  elseif kind==3 then                   -- a real code with one piece changed, checksum left wrong
    local at=rnd(#valid) local c=rnd(#alphabet) text=valid:sub(1,at-1)..alphabet:sub(c,c)..valid:sub(at+1)
  else                                  -- a real body with a piece cut out, swapped or doubled, checksum made right
    local a,b=rnd(#payload),rnd(#payload) if a>b then a,b=b,a end
    local how=rnd(3)
    local body=how==1 and (payload:sub(1,a)..payload:sub(b)) or how==2 and (payload:sub(1,a)..payload:sub(a,b)..payload:sub(a)) or (payload:sub(b)..payload:sub(1,a))
    text=code(body)
  end
  local ok,doc,why=pcall(BackstageForeverProfileDecode,text)
  assert(ok,'the reader threw: '..tostring(doc)..' on '..text:sub(1,80))
  if doc then accepted=accepted+1;audit(doc);assert(BackstageForeverProfileDecode(BackstageForeverProfileEncode(doc)))
  else refused=refused+1;assert(type(why)=='string') end
end
assert(refused>5000 and HACKED==nil,'refused '..refused..', accepted '..accepted)
-- Applying whatever was accepted never errors either, and never makes a table the addon does not own.
local tables={}
local applied=BackstageForeverProfileApply(BackstageForeverProfileDecode(valid),world(tables),true)
for name in pairs(tables) do assert(name:match('^BackstageForever%a+Settings$') or name:match('^BackstageForever%a+DB$'),name) end
assert(applied.settings>0 and next(applied.skipped)==nil)
`));

test("applying a profile: tables are written in place, a missing setting goes back to its default unless its owner fills it in", () => lua(LOAD + String.raw`
local hud={visible=false,mode='adventure',point='CENTER',relativePoint='CENTER',x=1,y=1,schemaVersion=1,profession={crafts=5}}
local social={marks=true,text=true}
local live={enabled=true,safe=true,hairlineOnce=true}
local panel={tracker=false,bags=true,pos={tracker={x=1,y=2}},visit={map=36,startedAt=5}}
local layers={quest=true,herbs=true}
local tables={BackstageForeverHUDSettings=hud,BackstageForeverSocialSettings=social,BackstageForeverLiveSettings=live,BackstageForeverPanelSettings=panel,
  BackstageForeverMapSettings={enabled=true,layers=layers},BackstageForeverAssistSettings={toasts=true,repairers={[1]={m=2}}}}
local positions=panel.pos.tracker
local doc=BackstageForeverProfileClean({v=1,s={HUD={visible=true,mode='questing'},Social={large=true},Live={pos='topright'},Panel={tracker=true,pos={tracker={x=50,y=60},run={x=7,y=8}}},
  Map={layers={herbs=false}},Gear={enabled=false},Assist={toasts=false}}})
local result=BackstageForeverProfileApply(doc,world(tables),false)
-- The same table objects, changed in place: files that hold on to their table keep working.
assert(tables.BackstageForeverHUDSettings==hud and tables.BackstageForeverSocialSettings==social and tables.BackstageForeverPanelSettings==panel and panel.pos.tracker==positions and tables.BackstageForeverMapSettings.layers==layers)
assert(hud.visible==true and hud.mode=='questing')
-- The Compass file fills in its own settings: what the code lacks is left, never emptied. State is never touched.
assert(hud.point=='CENTER' and hud.x==1 and hud.schemaVersion==1 and hud.profession.crafts==5)
-- Files that read "nothing saved" as the default: a setting the code lacks goes back to that default.
assert(social.large==true and social.marks==nil and social.text==nil)
assert(panel.tracker==true and panel.bags==nil and positions.x==50 and positions.y==60 and panel.pos.run.y==8 and panel.visit.map==36)
-- The live link reads a missing switch as off, so it is never cleared.
assert(live.enabled==true and live.pos=='topright' and live.safe==nil and live.hairlineOnce==true)
assert(layers.herbs==false and layers.quest==true)
assert(tables.BackstageForeverGearSettings.enabled==false and tables.BackstageForeverAssistSettings.toasts==false and tables.BackstageForeverAssistSettings.repairers[1].m==2)
assert(result.settings==16 and result.rows==0,result.settings)
-- A table the code does not mention is not touched at all; applying the same code twice changes nothing more.
assert(tables.BackstageForeverQoLSettings==nil)
assert(BackstageForeverProfileApply(doc,world(tables),false).settings==0)
assert(BackstageForeverProfileApply(nil,world(tables)).settings==0 and BackstageForeverProfileApply({},world(tables)).settings==0)
`));

test("\"include my data\": notes, flight times and gathering spots are added, never put in place of what is there", () => lua(LOAD + String.raw`
local function spot(n) return {id='wowf:herb:'..n,method='herb',entityId=n,itemIds={765},mapId=1413,x=0.4523,y=0.6181,observedAt=1700000000,clientBuild='1.60.1.71037',name='Peacebloom',
  evidence='observed-gathering-loot',precision='recorded-standing-point',approximate=true} end
local source={
  BackstageForeverNotesDB={v=1,notes={{name='Thrall',text='good tank',at=1700000000,zone='Durotar'},{name='Bad|Name',text='x'},{name='Jaina',text=string.rep('y',121)},{name='Vol-Realm',text='healer'}}},
  BackstageForeverFlightTimesDB={v=1,trips={{from='Orgrimmar',to='Crossroads',seconds=112,count=3,at=1700000001},{from='A',to='B',seconds=-1},{from='A',to='B',seconds=40000}}},
  BackstageForeverGatheringDB={schemaVersion=1,recording=false,records={spot(1),spot(2),{id='x'}}},
  BackstageForeverJournalDB={levels={{1,2}}},BackstageForeverGearSettings={enabled=false},
}
assert(BackstageForeverProfileCollect(world(source),false,{}).d==nil,'data stays out unless asked for')
local doc=BackstageForeverProfileCollect(world(source),true,{name='A'})
assert(#doc.d.Notes==2 and #doc.d.Flights==1 and #doc.d.Spots==2 and doc.s.Gathering.recording==false)
local text=assert(BackstageForeverProfileEncode(doc))
assert(not text:find('levels',1,true),'the Journal is never part of a code')
local back=assert(BackstageForeverProfileDecode(text))
assert(back.d.Notes[1].name=='Thrall' and back.d.Notes[1].zone=='Durotar' and back.d.Flights[1].seconds==112 and back.d.Spots[1].x==0.4523 and back.d.Spots[1].itemIds[1]==765)
local _,rows=BackstageForeverProfileCount(back) assert(rows==5)
-- The other character already has a note on Thrall and one flight: those stay as they are.
local mine={v=1,notes={{name='thrall',text='my own words',at=5}}}
local target={BackstageForeverNotesDB=mine,BackstageForeverFlightTimesDB={v=1,trips={{from='Orgrimmar',to='Crossroads',seconds=100,count=1}}},BackstageForeverGatheringDB={schemaVersion=1,recording=true,records={spot(2)}}}
-- Without the tick, data in the code is ignored.
assert(BackstageForeverProfileApply(back,world(target),false).rows==0 and #mine.notes==1)
-- The gathering file's own checker decides about spots. Without it they are not added, and it says so.
local result=BackstageForeverProfileApply(back,world(target),true)
assert(result.rows==1 and #mine.notes==2 and mine.notes[1].text=='my own words' and mine.notes[2].name=='Vol-Realm' and target.BackstageForeverNotesDB==mine)
assert(#target.BackstageForeverFlightTimesDB.trips==1 and target.BackstageForeverFlightTimesDB.trips[1].seconds==100)
assert(#target.BackstageForeverGatheringDB.records==1 and result.skipped[1]=='Spots')
local judged
BackstageForeverGatheringValidateSnapshot=function(snapshot,at) judged=#snapshot.records return snapshot end
result=BackstageForeverProfileApply(back,world(target),true)
assert(judged==2 and result.rows==1 and #target.BackstageForeverGatheringDB.records==2 and #result.skipped==0)
-- The checker says no: nothing is added, what was there stays.
BackstageForeverGatheringValidateSnapshot=function() return nil end
target.BackstageForeverGatheringDB.records={spot(2)}
result=BackstageForeverProfileApply(back,world(target),true) assert(#target.BackstageForeverGatheringDB.records==1 and result.skipped[1]=='Spots')
-- A character with no stores yet gets fresh ones.
local empty={} BackstageForeverGatheringValidateSnapshot=function(s) return s end
result=BackstageForeverProfileApply(back,world(empty),true) assert(result.rows==5 and empty.BackstageForeverNotesDB.v==1 and #empty.BackstageForeverFlightTimesDB.trips==1 and empty.BackstageForeverGatheringDB.schemaVersion==1)
-- Hostile rows are dropped one by one: wrong kinds, a name with a link code, numbers out of range.
local hostile=BackstageForeverProfileClean({v=1,s={Gear={enabled=true}},d={Notes={{name='A|Hx|h',text='t'},{name=5,text='t'},'x',{name='Okay',text='fine',at='soon',zone=7}},
  Flights={{from='A',to='B',seconds=1.5},{from='A',to='B',seconds=5,count=-2}},Spots={{id='i',method='HERB'},spot(3),{id='wowf',method='herb',entityId=1,itemIds={'x'},mapId=1,x=2,y=0}},Journal={{1}}}})
assert(#hostile.d.Notes==1 and hostile.d.Notes[1].at==nil and hostile.d.Notes[1].zone==nil and #hostile.d.Flights==1 and hostile.d.Flights[1].count==1 and #hostile.d.Spots==1 and hostile.d.Journal==nil)
`));

const STUBS = String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
local function last() return said[#said] end
local combat=false InCombatLockdown=function() return combat end
local function widget(kind)
  local w={kind=kind,scripts={},shown=true}
  local methods={
    SetScript=function(self,k,fn) self.scripts[k]=fn end,
    SetText=function(self,t) self.text=t end, GetText=function(self) return self.text or '' end,
    SetChecked=function(self,v) self.checked=v and true or false end, GetChecked=function(self) return self.checked end,
    Show=function(self) self.shown=true end, Hide=function(self) self.shown=false end, IsShown=function(self) return self.shown end,
    CreateFontString=function() return widget('FontString') end, CreateTexture=function() return widget('Texture') end,
  }
  return setmetatable(w,{__index=function(_,k) return methods[k] or function() end end})
end
local events,buttons={},{}
CreateFrame=function(kind,name) local w=widget(kind);if name then _G[name]=w end
  if kind=='Button' then buttons[#buttons+1]=w end
  w.RegisterEvent=function(self,e) events[e]=events[e] or {};table.insert(events[e],self) end
  return w end
local function fire(e,...) for _,f in ipairs(events[e] or {}) do if f.scripts.OnEvent then f.scripts.OnEvent(f,e,...) end end end
local function press(label) for _,b in ipairs(buttons) do if b.text==label then b.scripts.OnClick(b) return true end end error('no button '..label) end
UIParent={} UISpecialFrames={}
time=function() return 1700000000 end
UnitName=function() return 'Tester' end GetRealmName=function() return 'Realm' end UnitClass=function() return 'Mage','MAGE' end
local captures=0 BackstageForeverRequestCapture=function() captures=captures+1 end
BackstageForeverSocialSettings={marks=true} BackstageForeverQoLSettings={coords=true,loot=false,dismount=false} BackstageForeverGearSettings={enabled=false}
dofile('addon/BackstageForever/BackstageForeverProfile.lua')
`;

test("in game: keep a profile under a name, put it back, undo an import, and the window exports and imports", () => lua(STUBS + String.raw`
BackstageForeverProfileCommand('profile list') assert(last():find('No profile is kept on this character yet',1,true))
BackstageForeverProfileCommand('profile save Raiding') assert(last()=='Backstage Forever: Profile "raiding" kept: this character\'s settings as they are now.' and captures==1)
assert(BackstageForeverProfileDB.profiles.raiding.code:match('^BF1:') and BackstageForeverProfileDB.profiles.raiding.at==1700000000)
for _,bad in ipairs({'','two words','x'..string.rep('y',20),'bad!name','-lead','undo'}) do
  BackstageForeverProfileCommand('profile save '..bad) assert(BackstageForeverProfileDB.profiles[bad]==nil,bad)
end
-- Settings change, then the kept profile is put back.
BackstageForeverSocialSettings.marks=false BackstageForeverQoLSettings.coords=false BackstageForeverGearSettings.enabled=true
local social=BackstageForeverSocialSettings
BackstageForeverProfileCommand('profile load raiding')
assert(BackstageForeverSocialSettings==social and social.marks==true and BackstageForeverQoLSettings.coords==true and BackstageForeverGearSettings.enabled==false)
assert(last():find('Profile applied from Tester: 3 settings changed.',1,true) and last():find('Type /reload',1,true) and last():find('/bf profile load undo',1,true),last())
-- What was there before the import is kept as "undo".
BackstageForeverProfileCommand('profile load undo') assert(social.marks==false and BackstageForeverGearSettings.enabled==true)
BackstageForeverProfileCommand('profile list') assert(said[#said-2]=='Backstage Forever: Profiles kept on this character: 2.' and said[#said-1]=='  raiding - /bf profile load raiding' and last()=='  undo - /bf profile load undo')
BackstageForeverProfileCommand('profile load nothere') assert(last():find('No profile named "nothere"',1,true))
-- Eight names at most.
for i=1,7 do BackstageForeverProfileCommand('profile save p'..i) end
BackstageForeverProfileCommand('profile save p8') assert(BackstageForeverProfileDB.profiles.p8==nil and last():find('Eight profiles are kept',1,true))
BackstageForeverProfileCommand('profile save p3') assert(not last():find('Eight',1,true),'an existing name is written over')
BackstageForeverProfileCommand('profile delete p7') assert(BackstageForeverProfileDB.profiles.p7==nil and last()=='Backstage Forever: Profile "p7" deleted.')
-- Nothing changes in combat.
combat=true BackstageForeverProfileCommand('profile load raiding') assert(last():find('outside combat',1,true) and social.marks==false)
BackstageForeverProfileCommand('profile') assert(BackstageForeverProfileFrame==nil and last():find('outside combat',1,true)) combat=false
-- The window: Export writes the code into the box; Import reads the box.
BackstageForeverProfileCommand('profile')
local f=BackstageForeverProfileFrame assert(f.shown and f.status.text=='')
press('Export') local text=f.edit.text
assert(text:match('^BF1:%x+:{') and f.status.text:find('settings, 0 data rows',1,true) and f.status.text:find('Ctrl+C',1,true),f.status.text)
BackstageForeverGearSettings.enabled=false
press('Import') assert(BackstageForeverGearSettings.enabled==true and f.status.text=='Applied: 1 settings changed. Type /reload.',f.status.text)
f.edit.text=text:sub(1,-3) press('Import') assert(f.status.text=='This code is damaged: a piece is missing or changed. Copy it again, all of it.')
f.edit.text='hello' press('Import') assert(f.status.text=='This is not a Backstage Forever profile code.')
f.edit.text='HACKED=true' HACKED=nil press('Import') assert(HACKED==nil)
press('Clear') assert(f.edit.text=='' and f.status.text=='')
fire('PLAYER_REGEN_DISABLED') assert(f.shown==false)
BackstageForeverProfileCommand('profile nonsense') assert(last():find('Use /bf profile for the window',1,true))
`));

test("the desktop app: kept profiles are shared only with the switch on, and a sent profile is offered, never applied by itself", () => lua(STUBS + String.raw`
BackstageForeverProfileCommand('profile save main')
assert(BackstageForeverProfileSnapshot()==nil and BackstageForeverProfileShared()==false,'off at first: nothing goes into the capture')
BackstageForeverProfileCommand('profile share on') assert(BackstageForeverProfileDB.share==true and last():find('Nothing leaves this computer',1,true))
local block=BackstageForeverProfileSnapshot()
assert(block.v==1 and #block.profiles==1 and block.profiles[1].n=='main' and block.profiles[1].c==BackstageForeverProfileDB.profiles.main.code and block.profiles[1].t==1700000000 and block.done==nil)
BackstageForeverProfileCommand('profile share off') assert(BackstageForeverProfileSnapshot()==nil)
-- A kept profile that is too long, or badly named, is never passed on.
assert(#BackstageForeverProfileList({profiles={ok={code='BF1:x'},['Bad Name']={code='x'},big={code=string.rep('x',16001)},odd='x'}})==1)
-- The hand-off file carries a profile for this character.
local sentCode=BackstageForeverProfileEncode({v=1,m={n='Otherchar'},s={Gear={enabled=true},Social={marks=false,large=true}}})
local data={schema=1,characters={['Tester-Realm']={wish={},prof={n='raiding',f='Otherchar-Realm',c=sentCode}},['Else-Realm']={prof={n='x',f='y',c=sentCode}}}}
local sent=BackstageForeverProfileSent(data,'Tester','Realm')
assert(sent.name=='raiding' and sent.from=='Otherchar-Realm' and sent.code==sentCode and sent.sum==BackstageForeverProfileSum(sentCode))
assert(BackstageForeverProfileSent(data,'Nobody','Realm')==nil and BackstageForeverProfileSent(nil,'Tester','Realm')==nil and BackstageForeverProfileSent({schema=2,characters=data.characters},'Tester','Realm')==nil)
for _,bad in ipairs({{n='Bad Name!',f='x',c=sentCode},{n='ok',f='x',c=string.rep('x',16001)},{n='ok',f='x',c=5},'x'}) do
  assert(BackstageForeverProfileSent({schema=1,characters={['Tester-Realm']={prof=bad}}},'Tester','Realm')==nil)
end
assert(BackstageForeverProfileSent({schema=1,characters={['Tester-Realm']={prof={n='ok',f='a|cffff0000b',c=sentCode}}}},'Tester','Realm').from=='?','a sender name with a colour code is not shown')
-- At login it is only offered.
BackstageForeverDesktopData=data
BackstageForeverProfileCommand('profile accept') -- first use reads the hand-off
`));

test("accepting a sent profile applies it once; dismissing leaves the settings alone; the desktop is told either way", () => lua(STUBS + String.raw`
local sentCode=BackstageForeverProfileEncode({v=1,m={n='Otherchar'},s={Gear={enabled=true},Social={large=true}}})
BackstageForeverDesktopData={schema=1,characters={['Tester-Realm']={prof={n='raiding',f='Otherchar-Realm',c=sentCode}}}}
local later={} C_Timer={After=function(s,fn) later[#later+1]=fn end}
fire('PLAYER_LOGIN') assert(#said==0 and #later==1,'said a little after login, not in the middle of it')
later[1]()
assert(last()=='Backstage Forever: The desktop app sent the profile "raiding" from Otherchar-Realm. /bf profile accept uses it; /bf profile dismiss leaves your settings alone.',last())
assert(BackstageForeverGearSettings.enabled==false and BackstageForeverSocialSettings.marks==true,'nothing is applied by the offer')
combat=true BackstageForeverProfileCommand('profile accept') assert(BackstageForeverGearSettings.enabled==false) combat=false
BackstageForeverProfileCommand('profile accept')
assert(BackstageForeverGearSettings.enabled==true and BackstageForeverSocialSettings.large==true and BackstageForeverSocialSettings.marks==nil and last():find('Profile applied from Otherchar: 3 settings changed.',1,true),last())
assert(BackstageForeverProfileDB.done==BackstageForeverProfileSum(sentCode) and BackstageForeverProfileDB.profiles.undo~=nil)
-- The same profile is not offered again, at this login or the next.
BackstageForeverProfileCommand('profile accept') assert(last()=='Backstage Forever: The desktop app has sent no new profile to this character.')
said={} later={} fire('PLAYER_LOGIN') later[1]() assert(#said==0)
-- With sharing on, the capture tells the desktop app which sent profile was dealt with.
BackstageForeverProfileDB.share=true
assert(BackstageForeverProfileSnapshot().done==BackstageForeverProfileSum(sentCode))
-- Dismiss: the settings stay and the offer is gone.
BackstageForeverProfileDB.done=nil BackstageForeverGearSettings.enabled=false
BackstageForeverProfileCommand('profile dismiss') assert(BackstageForeverGearSettings.enabled==false and BackstageForeverProfileDB.done==BackstageForeverProfileSum(sentCode) and last():find('left alone',1,true))
-- A damaged profile from the hand-off is refused in plain words.
`));

test("a code is data: the file has no way to run text, and its frames have fixed sizes and no wrapping", () => {
  const source = read("addon/BackstageForever/BackstageForeverProfile.lua");
  for (const name of ["loadstring", "load(", "RunScript", "setfenv", "getfenv", "dofile", "require", "assert(load", "SendChatMessage", "SendAddonMessage", "hooksecurefunc", "HookScript", "SetAttribute", "string.dump", "debug."])
    assert.equal(source.split(name).length - 1, 0, `the profile file never uses ${name}`);
  assert.match(source, /if #code>\(type\(limit\)=='number' and limit or MAX_CODE\) then return nil,'big' end/, "the length is checked before anything is read");
  assert.match(source, /local MAX_DEPTH,MAX_NODES,MAX_STRING,MAX_NUMBER=8,30000,400,24/);
  const strings = (source.match(/CreateFontString\(/g) || []).length, noWrap = (source.match(/SetWordWrap\(false\)/g) || []).length;
  assert.ok(strings >= 4 && noWrap >= strings - 1, "every text but the two-line explanation is set not to wrap");
  assert.match(source, /about:SetPoint\('TOPLEFT',INSET,-38\);about:SetSize\(WIDTH-INSET\*2,26\)/, "the explanation has a fixed box of two lines");
  // The capture carries the block only through the snapshot function, and it is the first optional block to go.
  const main = read("addon/BackstageForever/BackstageForever.lua");
  assert.match(main, /BackstageForeverProfileSnapshot\)\n\s+if ok and type\(block\)=='table' and type\(block\.profiles\)=='table' then array\(block\.profiles\);character\.settingsProfiles=block end/);
  assert.ok(main.indexOf("discard(chars[i],'settingsProfiles')") > 0 && main.indexOf("discard(chars[i],'settingsProfiles')") < main.indexOf("discard(chars[i],'scout')"));
  assert.ok(!/captureVersion\s*=\s*[^0-9]*\d+[^\n]*settingsProfiles/.test(main));
});

test("wiring: the toc, the dispatcher, help, the sharing switch and the three languages", () => {
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverProfileDB\b/m, "per character, never account-wide");
  assert.match(toc, /^## SavedVariables: BackstageForeverExport\r?$/m);
  assert.equal(toc.split(/\r?\n/).filter((l) => l.endsWith(".lua")).pop(), "BackstageForeverProfile.lua", "after every file whose settings it reads");
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /word=='profile' then\s+if type\(BackstageForeverProfileCommand\)=='function' then pcall\(BackstageForeverProfileCommand,message\)end/);
  assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), /'\/bf profile - all settings of this character as one code/);
  assert.match(read("addon/BackstageForever/BackstageForeverOptions.lua"), /switch\('Profiles to the desktop app','[^']+',off\('BackstageForeverProfileDB','share'\),'profile share'\)/);
  for (const lang of ["de", "es", "fr"]) {
    const d = JSON.parse(read(`data/i18n/${lang}.json`)).addon;
    for (const text of ["Profiles", "Export", "Import", "Clear", "Include my data: player notes, flight times, gathering spots", "This is not a Backstage Forever profile code.",
      "This code is damaged: a piece is missing or changed. Copy it again, all of it.", "Profiles to the desktop app", "Profile applied%s: %d settings changed.", "Applied: %d settings changed. Type /reload."]) assert.ok(d.plain[text], `${lang}: ${text}`);
    assert.ok(d.templates["The desktop app sent the profile \"%s\" from %s. /bf profile accept uses it; /bf profile dismiss leaves your settings alone."], `${lang}: the offer`);
  }
});
