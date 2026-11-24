"use strict";
// Chat tools: the game's own timestamps and class colours, a copy mark and links for web addresses
// and coordinates, and a conservative gold-seller filter. The text logic is pure and run here against
// tables of real-looking lines, including a table of lines that must never be hidden.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}
const LOAD = String.raw`dofile('addon/BackstageForever/BackstageForeverChat.lua')
local ITEM='|cff1eff00|Hitem:2589::::::::20:::::|h[Linen Cloth]|h|r'
`;

test("a chat line is cut into text and codes; a code that is not understood leaves the line alone", () => lua(LOAD + String.raw`
local p=BackstageForeverChatPieces('WTS '..ITEM..' 5s each')
assert(#p==5 and p[1].text=='WTS ' and not p[1].code and p[2].code and p[3].code and p[3].text:sub(1,6)=='|Hitem' and p[4].text=='|r' and p[5].text==' 5s each' and not p[5].tinted)
p=BackstageForeverChatPieces('|cffff0000red www.site.com|r plain') assert(p[2].tinted==true and p[4].text==' plain' and not p[4].tinted)
assert(#BackstageForeverChatPieces('')==0 and #BackstageForeverChatPieces('a||b')==3)
for _,bad in ipairs({'|','a|','|x','|cff00','|Hitem:1|h[cut','|Tpath','a |q b',string.rep('x',1001)}) do assert(BackstageForeverChatPieces(bad)==nil,bad) end
assert(BackstageForeverChatPieces(nil)==nil and BackstageForeverChatPieces(5)==nil)
-- For copying: no colours, a link as its words, no pictures, one line.
assert(BackstageForeverChatPlain('WTS '..ITEM..' 5s')=='WTS [Linen Cloth] 5s')
assert(BackstageForeverChatPlain('|TInterface\\Icons\\x:0|t hi|nthere a||b')==' hi there a|b')
assert(BackstageForeverChatLine('12:03','Thrall','lok |cffff0000tar|r')=='[12:03] Thrall: lok tar' and BackstageForeverChatLine('','','x')=='x')
`));

test("web addresses: found when they are one, left alone when they are not", () => lua(LOAD + String.raw`
local yes={
  {'see https://www.example.com/guide?id=5.','https://www.example.com/guide?id=5'},
  {'http://example.org','http://example.org'},{'go to www.wowhead.com now','www.wowhead.com'},
  {'join discord.gg/abcDEF!','discord.gg/abcDEF'},{'our site: guild-name.com/apply','guild-name.com/apply'},
  {'twitch.tv/somebody, live now','twitch.tv/somebody'},{'docs at sub.example.io','sub.example.io'},
}
for _,row in ipairs(yes) do
  local found=BackstageForeverChatUrls(row[1])
  assert(#found==1 and found[1].url==row[2],row[1]..' -> '..tostring(found[1] and found[1].url))
  assert(row[1]:sub(found[1].from,found[1].to)==row[2])
end
local no={'e.g. this','i.e. that','5.5k gold','v1.2.3 is out','Mr.Smith said hi','wait...what','no.way','lol.omg','end of line.Next one','45.2, 61.8','bob@example.com',
  'a.b','1.2.3.4','www.','http://','x.com','gut.es ist','10.com','..com','file.name.txt','ok.then,go'}
for _,text in ipairs(no) do assert(#BackstageForeverChatUrls(text)==0,text..' -> '..tostring((BackstageForeverChatUrls(text)[1] or {}).url)) end
assert(#BackstageForeverChatUrls(nil)==0 and BackstageForeverChatUrl(string.rep('a',300)..'.com')==nil)
`));

test("coordinates: \"45.2, 61.8\" and its usual spellings, with a table of numbers that are not places", () => lua(LOAD + String.raw`
local yes={
  {'meet at 45.2, 61.8 by the tree',45.2,61.8,'45.2, 61.8'},{'45.2,61.8',45.2,61.8,'45.2,61.8'},{'rare at (37.45, 12.5)!',37.45,12.5,'37.45, 12.5'},
  {'/way 51.5 30.9 Thork',51.5,30.9,'51.5 30.9'},{'loc 45.2/61.8',45.2,61.8,'45.2/61.8'},{'chest (45, 61) inside the cave',45,61,'45, 61'},
  {'at [8,99]',8,99,'8,99'},{'it is at 0.5, 100.0.',0.5,100,'0.5, 100.0'},
}
for _,row in ipairs(yes) do
  local found=BackstageForeverChatCoords(row[1])
  assert(#found==1,row[1]..': '..#found)
  assert(found[1].x==row[2] and found[1].y==row[3] and row[1]:sub(found[1].from,found[1].to)==row[4],row[1]..' -> '..row[1]:sub(found[1].from,found[1].to))
end
local no={
  'need 2, 3 more','lvl 45, 61 soon','45, 61','WTS 20g, 15g obo','1.5, 2.5g each','patch 1.15.2, 1.15.3','v1.2, 1.3','3.5k, 4.5k dps','got 12.5%, 13.5% crit',
  '101.5, 20.5','45.123, 61.5','10.5, 20.5, 30.5','1, 45.2, 61.8','$45.2, 61.8','x45.2, 61.8','45.2, 61.8x','at 12:30.5, 13.5','-45.2, 61.8','45.2, 61.8/70.1',
  '(145, 61)','(45; 61)','(45, 61','ratio 2.5/3.5/4.5','ip 10.0.0.1, 10.0.0.2','45.2 , ','',' ',
}
for _,text in ipairs(no) do local f=BackstageForeverChatCoords(text) assert(#f==0,text..' -> '..(f[1] and text:sub(f[1].from,f[1].to) or '')) end
local two=BackstageForeverChatCoords('a 10.5, 20.5 then b 30.5 40.5') assert(#two==2 and two[1].x==10.5 and two[2].y==40.5 and two[1].from<two[2].from)
assert(#BackstageForeverChatCoords(nil)==0)
`));

test("a decorated line: links for addresses and coordinates, a copy mark, and never inside a link or a colour", () => lua(LOAD + String.raw`
local new,targets=BackstageForeverChatDecorate('rare at 45.2, 61.8 see www.wowhead.com',7)
assert(new=='rare at |cff71d5ff|Haddon:BackstageForever:chat:7:1|h[45.2, 61.8]|h|r see |cff71d5ff|Haddon:BackstageForever:chat:7:2|h[www.wowhead.com]|h|r |cff808080|Haddon:BackstageForever:chat:7:0|h[+]|h|r',new)
assert(#targets==2 and targets[1].kind=='way' and targets[1].x==45.2 and targets[1].y==61.8 and targets[2].kind=='url' and targets[2].value=='www.wowhead.com')
-- A plain line only gets the copy mark; an item link is carried through byte for byte.
new,targets=BackstageForeverChatDecorate('hello there',1) assert(new=='hello there |cff808080|Haddon:BackstageForever:chat:1:0|h[+]|h|r' and #targets==0)
new=BackstageForeverChatDecorate('WTS '..ITEM..' at 10.5, 20.5',2)
assert(new:find(ITEM,1,true) and new:find('chat:2:1|h[10.5, 20.5]',1,true))
-- Text inside a link, or inside somebody's colour, is never touched.
local linked='|Hurl:x|h[www.inside.com 10.5, 20.5]|h and |cffff0000www.red.com|r'
new,targets=BackstageForeverChatDecorate(linked,3) assert(new==linked..' |cff808080|Haddon:BackstageForever:chat:3:0|h[+]|h|r' and #targets==0)
-- At most three links in a line; the rest stays plain text.
new,targets=BackstageForeverChatDecorate('aa.com/x bb.com/x cc.com/x dd.com/x',4) assert(#targets==3 and new:find(' dd.com/x ',1,true))
-- A code the reader does not know, or a bad number: the line is left alone.
assert(BackstageForeverChatDecorate('broken |q code',5)==nil and BackstageForeverChatDecorate('x',0)==nil and BackstageForeverChatDecorate('x','7')==nil and BackstageForeverChatDecorate(nil,1)==nil)
-- The click: only our own links, a small number, nothing else.
local id,n=BackstageForeverChatLinkTarget('addon:BackstageForever:chat:7:2') assert(id==7 and n==2)
id,n=BackstageForeverChatLinkTarget('addon:BackstageForever:chat:7:0') assert(id==7 and n==0)
for _,bad in ipairs({'addon:BackstageForever:chat:7:9','addon:BackstageForever:chat:0:1','addon:BackstageForever:lfg:1','addon:Other:chat:1:1','item:5','addon:BackstageForever:chat:7:1:extra','addon:BackstageForever:chat:7777777:1',''}) do
  assert(BackstageForeverChatLinkTarget(bad)==nil,bad)
end
assert(BackstageForeverChatLinkTarget(nil)==nil and BackstageForeverChatLinkTarget(string.rep('1',100))==nil)
-- Remembered lines: numbered, and only the last sixty are kept.
local ring={} local first=BackstageForeverChatRemember(ring,{plain='a'},3) assert(first==1)
for i=2,5 do BackstageForeverChatRemember(ring,{plain=tostring(i)},3) end
assert(ring.rows[1]==nil and ring.rows[2]==nil and ring.rows[5].plain=='5' and #ring.order==3)
`));

test("the gold-seller filter catches sellers and leaves a long table of ordinary lines alone", () => lua(LOAD + String.raw`
local spam={
  'Cheap gold! www.g0ldshop.com 24/7 fast delivery',
  '$5 = 1000g, safe and fast, instant delivery',
  '1000g=$4.99 >> w w w . bestgoldz . c o m <<',
  'WTS gold $3 per 100g paypal only',
  'Buy g0ld at goldking,c0m - cheapest, in stock',
  'selling gold, paypal accepted, whisper me',
  'G O L D for sale! 100g / 2.50 usd, 5 min delivery',
  'gold in stock www.fastgold.net discount code WOW5',
  'Power leveling 1-60 only $49 at www.lvlup.com',
  '>>> buy cheap gold <<< goldmart dot com, 10% off',
  'cheapest gold on the server: 500g for $3',
  '1k gold = 6 eur, face to face',
}
for _,text in ipairs(spam) do assert(BackstageForeverChatSpam(text)==true,'missed: '..text) end
local clean={
  -- trade and auction talk
  'WTS [Arcanite Bar] 45g, cheapest on the AH','WTS gold bars 2g each, pst','selling gold ore x20, best price','WTB Gold Power Core, paying well',
  'buy gold ore here, best price, cheapest!','WTS gold bars, pst. my stream is at www.twitch.tv/somebody','LF enchanter, 5g tip, discount for guildies',
  'WTS Thorium Bar 20g/stack in stock now','selling Golden Sansam cheap','WTB Goldthorn x40','Selling runs through SM for 5g, fast and safe',
  'anyone selling gold dust for the ZG quest?','cheapest flight is from Booty Bay','WTS 20g for 1 dollar jk','got 500g for my epic mount finally',
  -- sites and guides
  'LFM UBRS need tank, check www.wowhead.com for the guide','our guild site is www.guild.com, raids 24/7, best price on enchants','join our discord discord.gg/abc123',
  'the gold guide on www.wowhead.com is great','how do I get gold fast? any tips','watch my stream twitch.tv/somebody',
  -- money said in passing
  "I'd pay $20 for that mount lol",'that sub costs 13 eur a month','need 2g for my skill, anyone?','1000g is a lot for a mount','gold is hard at level 20',
  'this game is worth every dollar','lol he tried to sell gold in trade again','report the gold sellers',
  -- ordinary play
  'LF2M tank healer BRD arena run','rare at 45.2, 61.8','ty for the port','gz on 60!','anyone got a lockpick?','LFG Scholo, 58 mage',
  'Golddust? where is that','Goldshire inn is full again','the customer is always right haha','power leveling my alt in SM, anyone want to join','24/7 farming this spot, no drops',
  'en vente: barres d or 2po','Verkaufe Goldbarren 2g das Stück','vendo mineral de oro barato',
  '','short','?',
}
for _,text in ipairs(clean) do local hit,why=BackstageForeverChatSpam(text) assert(hit==false,'wrongly hidden: '..text) end
assert(BackstageForeverChatSpam(nil)==false and BackstageForeverChatSpam(42)==false)
-- A very long line is judged on its first six hundred characters and never errors.
assert(BackstageForeverChatSpam(string.rep('hello there ',400))==false)
assert(BackstageForeverChatSpam(string.rep('x',590)..' $5 = 1000g')==false and BackstageForeverChatSpam('$5 = 1000g '..string.rep('x',2000))==true)
-- Colour codes and links do not hide a seller.
assert(BackstageForeverChatSpam('|cffff0000Cheap gold|r at www.goldz.com')==true)
-- Who is never filtered: yourself, friends, guild, group, anyone you whispered. A whisper is only judged when the game can say who is a friend.
local T_=BackstageForeverChatTrusted
assert(T_('CHAT_MSG_CHANNEL',{self=true}) and T_('CHAT_MSG_SAY',{friend=true}) and T_('CHAT_MSG_YELL',{guild=true}) and T_('CHAT_MSG_CHANNEL',{group=true}) and T_('CHAT_MSG_WHISPER',{spoken=true,known=true}))
assert(T_('CHAT_MSG_WHISPER',{known=false})==true and T_('CHAT_MSG_WHISPER',{})==true and T_('CHAT_MSG_WHISPER',nil)==true)
assert(T_('CHAT_MSG_WHISPER',{known=true})==false and T_('CHAT_MSG_CHANNEL',{})==false and T_('CHAT_MSG_CHANNEL',{known=false})==false)
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
    Show=function(self) self.shown=true end, Hide=function(self) self.shown=false end, IsShown=function(self) return self.shown end,
    HighlightText=function(self) self.highlighted=true end, SetFocus=function(self) self.focused=true end,
    CreateFontString=function() return widget('FontString') end, CreateTexture=function() return widget('Texture') end,
  }
  return setmetatable(w,{__index=function(_,k) return methods[k] or function() end end})
end
local events={}
CreateFrame=function(kind,name) local w=widget(kind);if name then _G[name]=w end
  w.RegisterEvent=function(self,e) events[e]=events[e] or {};table.insert(events[e],self) end
  return w end
local function fire(e,...) for _,f in ipairs(events[e] or {}) do if f.scripts.OnEvent then f.scripts.OnEvent(f,e,...) end end end
UIParent={} UISpecialFrames={}
date=function() return '12:03' end
UnitName=function() return 'Tester' end
local filters={}
ChatFrame_AddMessageEventFilter=function(event,fn) filters[event]=fn end
ChatFrame_RemoveMessageEventFilter=function(event,fn) if filters[event]==fn then filters[event]=nil end end
local clicks={}
EventRegistry={RegisterCallback=function(self,name,fn) clicks[name]=fn end}
local ways={} BackstageForeverWay=function(m) ways[#ways+1]=m end
C_Map={GetBestMapForUnit=function() return 1413 end}
local friends={['Player-1-FRIEND']=true}
C_FriendList={IsFriend=function(guid) return friends[guid]==true end}
IsGuildMember=function(guid) return guid=='Player-1-GUILD' end
local cvars={showTimestamps='none'}
C_CVar={GetCVar=function(n) return cvars[n] end,SetCVar=function(n,v) cvars[n]=v end}
ChatTypeInfo={SAY={colorNameByClass=false},YELL={colorNameByClass=true},GUILD={colorNameByClass=false}}
local named={} SetChatColorNameByClass=function(kind,on) named[#named+1]=kind..'='..tostring(on);ChatTypeInfo[kind].colorNameByClass=on end
dofile('addon/BackstageForever/BackstageForeverChat.lua')
fire('PLAYER_LOGIN')
local function count(t) local n=0 for _ in pairs(t) do n=n+1 end return n end
-- The game hands a filter: frame, event, text, author, language, channel, target, flags, zone id, channel number, channel name, unused, line id, guid.
local function chat(event,text,author,lineId,guid) return filters[event]({},event,text,author,'','2. Trade','','',0,2,'Trade',0,lineId,guid) end
local SELLER='Cheap gold! www.g0ldshop.com 24/7 fast delivery'
`;

test("everything is off at first: no filter is registered and no game setting is touched", () => lua(STUBS + String.raw`
assert(count(filters)==0 and cvars.showTimestamps=='none' and #named==0)
for _,k in ipairs({'stamps','names','links','filter'}) do assert(BackstageForeverChatEnabled(k)==false,k) end
assert(BackstageForeverChatEnabled('nonsense')==false)
BackstageForeverChatCommand('chat')
assert(said[1]=='Backstage Forever: Chat tools, each off until you switch it on:' and #said==5 and said[2]=='  Chat timestamps - Off (/bf chat stamps on)' and said[5]=='  Gold seller filter - Off (/bf chat filter on)')
`));

test("the filter hides a seller once, counts it, lets friends, guild and unknown whisperers through, and shows what it hid", () => lua(STUBS + String.raw`
BackstageForeverChatCommand('chat filter on')
assert(BackstageForeverChatSettings.filter==true and count(filters)==14 and last():find('Gold seller filter: on',1,true))
assert(chat('CHAT_MSG_CHANNEL',SELLER,'Goldbot-Realm',101,'Player-1-BOT')==true)
-- The same line reaches a second chat window: hidden again, counted once.
assert(chat('CHAT_MSG_CHANNEL',SELLER,'Goldbot-Realm',101,'Player-1-BOT')==true and BackstageForeverChatSettings.filtered==1)
-- An ordinary line is not touched at all (links are off).
local r,new=chat('CHAT_MSG_CHANNEL','WTS gold bars 2g each','Smith',102,'Player-1-X') assert(r==false and new==nil)
-- Friends and guild members are never hidden, whatever the line says, in a channel or in a whisper.
assert(chat('CHAT_MSG_CHANNEL',SELLER,'Buddy',103,'Player-1-FRIEND')==false and chat('CHAT_MSG_WHISPER',SELLER,'Buddy',104,'Player-1-FRIEND')==false)
assert(chat('CHAT_MSG_SAY',SELLER,'Mate',105,'Player-1-GUILD')==false and chat('CHAT_MSG_CHANNEL',SELLER,'Tester',106,'Player-1-ME')==false)
-- A whisper from a stranger the game can identify is judged; one it cannot identify is let through.
assert(chat('CHAT_MSG_WHISPER',SELLER,'Stranger',107,'Player-1-S')==true)
assert(chat('CHAT_MSG_WHISPER',SELLER,'Ghost',108,nil)==false)
-- Somebody you whispered yourself is never hidden afterwards.
chat('CHAT_MSG_WHISPER_INFORM','hi','Trader',109,'Player-1-T') assert(chat('CHAT_MSG_WHISPER',SELLER,'Trader',110,'Player-1-T')==false)
-- Party, raid and guild chat are not judged at all.
assert(chat('CHAT_MSG_PARTY',SELLER,'Stranger',111,'Player-1-S')==false and chat('CHAT_MSG_GUILD',SELLER,'Stranger',112,'Player-1-S')==false)
-- In combat chat is left alone.
combat=true assert(chat('CHAT_MSG_CHANNEL',SELLER,'Goldbot2',113,'Player-1-B2')==false) combat=false
-- Values the game marks secret are never read.
issecretvalue=function(v) return v=='secret text' end
assert(chat('CHAT_MSG_CHANNEL','secret text','Goldbot3',114,'Player-1-B3')==false) issecretvalue=nil
assert(BackstageForeverChatSettings.filtered==2)
said={} BackstageForeverChatCommand('chat filtered')
assert(said[1]=='Backstage Forever: Hidden gold-seller lines since you logged in: 2 (2 in all). Newest first:',said[1])
assert(said[2]=='  12:03 Stranger: '..SELLER and said[3]=='  12:03 Goldbot: '..SELLER and said[4]:find('/bf chat filter off',1,true) and #said==4)
said={} BackstageForeverChatCommand('chat') assert(last()=='  Hidden gold-seller lines so far: 2. /bf chat filtered shows them.')
BackstageForeverChatCommand('chat filter off') assert(count(filters)==0 and BackstageForeverChatSettings.filter==false,'the filter is taken out again')
`));

test("copy and links: every argument is handed back, a click copies, and a waypoint is placed only by a click", () => lua(STUBS + String.raw`
BackstageForeverChatCommand('chat links on') assert(last():find('Click [+] after a line',1,true) and count(filters)==14)
local out={chat('CHAT_MSG_SAY','rare at 45.2, 61.8 see www.wowhead.com','Scout-Realm',201,'Player-1-S')}
assert(out[1]==false and out[2]:find('chat:1:1|h[45.2, 61.8]',1,true) and out[2]:find('chat:1:2|h[www.wowhead.com]',1,true) and out[2]:find('chat:1:0|h[+]|h|r',1,true),out[2])
assert(out[3]=='Scout-Realm' and out[5]=='2. Trade' and out[12]==201 and out[13]=='Player-1-S' and #out==13,'the other arguments pass through unchanged')
-- A second chat window gets the same text and the same number.
local again={chat('CHAT_MSG_SAY','rare at 45.2, 61.8 see www.wowhead.com','Scout-Realm',201,'Player-1-S')} assert(again[2]==out[2])
assert(#ways==0 and BackstageForeverChatCopy==nil,'reading a line places no waypoint and opens nothing')
-- [+] opens the copy box with the plain line selected.
clicks.SetItemRef(nil,'addon:BackstageForever:chat:1:0')
local box=BackstageForeverChatCopy
assert(box.shown and box.edit.text=='[12:03] Scout: rare at 45.2, 61.8 see www.wowhead.com' and box.edit.highlighted and box.edit.focused)
-- Typing over it puts the text back: it is there to be copied.
box.edit.text='changed' box.edit.scripts.OnTextChanged(box.edit,true) assert(box.edit.text=='[12:03] Scout: rare at 45.2, 61.8 see www.wowhead.com')
clicks.SetItemRef(nil,'addon:BackstageForever:chat:1:2') assert(box.edit.text=='www.wowhead.com')
-- The coordinates: a waypoint on the map you are on, from the click.
clicks.SetItemRef(nil,'addon:BackstageForever:chat:1:1') assert(#ways==1 and ways[1]=='way 1413 0.4520 0.6180 from chat',ways[1])
combat=true clicks.SetItemRef(nil,'addon:BackstageForever:chat:1:1') assert(#ways==1 and last():find('wait until you leave combat',1,true)) combat=false
-- Somebody else's link, or a number that was never given, does nothing.
clicks.SetItemRef(nil,'item:2589') clicks.SetItemRef(nil,'addon:BackstageForever:lfg:1') assert(#ways==1)
clicks.SetItemRef(nil,'addon:BackstageForever:chat:99:0') assert(last()=='Backstage Forever: That chat line is no longer remembered.')
-- A line with a code the reader does not know is passed on untouched, but can still be copied by command.
local raw={chat('CHAT_MSG_SAY','odd |q code','Odd',202,'Player-1-O')} assert(raw[1]==false and raw[2]==nil)
BackstageForeverChatCommand('chat copy') assert(box.edit.text=='[12:03] Odd: odd q code')
BackstageForeverChatCommand('chat copy 2') assert(box.edit.text:find('rare at',1,true))
-- With both switches on, a seller is hidden and gets no copy mark.
BackstageForeverChatCommand('chat filter on')
assert(chat('CHAT_MSG_CHANNEL',SELLER,'Goldbot',203,'Player-1-BOT')==true)
BackstageForeverChatCommand('chat links off') BackstageForeverChatCommand('chat copy') assert(last():find('Copy and links in chat is off',1,true))
`));

test("timestamps and class colours are the game's own settings, and switching off only undoes what the addon switched on", () => lua(STUBS + String.raw`
BackstageForeverChatCommand('chat stamps on')
assert(cvars.showTimestamps=='%H:%M ' and BackstageForeverChatSettings.stamps==true and BackstageForeverChatSettings.stampsBefore=='none' and last():find('Chat timestamps: on',1,true))
BackstageForeverChatCommand('chat stamps off') assert(cvars.showTimestamps=='none' and BackstageForeverChatSettings.stamps==false and BackstageForeverChatSettings.stampsBefore==nil)
-- The player already had timestamps in their own format: it is left exactly as it is, on and off.
cvars.showTimestamps='%I:%M:%S %p ' BackstageForeverChatCommand('chat stamps on') assert(cvars.showTimestamps=='%I:%M:%S %p ')
BackstageForeverChatCommand('chat stamps off') assert(cvars.showTimestamps=='%I:%M:%S %p ')
-- Class colours: only the chat kinds that were off are switched, and only those are switched back.
BackstageForeverChatCommand('chat names on')
assert(table.concat(named,',')=='SAY=true,GUILD=true' and BackstageForeverChatSettings.names==true and ChatTypeInfo.YELL.colorNameByClass==true)
named={} BackstageForeverChatCommand('chat names off')
table.sort(named) assert(table.concat(named,',')=='GUILD=false,SAY=false' and ChatTypeInfo.YELL.colorNameByClass==true and BackstageForeverChatSettings.namesBefore==nil)
-- A game client without these settings: the switch stays off and says why.
C_CVar=nil GetCVar=nil BackstageForeverChatCommand('chat stamps on') assert(BackstageForeverChatSettings.stamps==false and last():find('no chat timestamp setting',1,true))
SetChatColorNameByClass=nil BackstageForeverChatCommand('chat names on') assert(BackstageForeverChatSettings.names==false and last():find('no class colour setting',1,true))
ChatFrame_AddMessageEventFilter=nil BackstageForeverChatCommand('chat filter on') assert(BackstageForeverChatSettings.filter==false and last():find('no chat filter',1,true))
-- Nothing is changed in combat.
combat=true BackstageForeverChatCommand('chat links on') assert(BackstageForeverChatSettings.links~=true and last():find('outside combat',1,true))
`));

test("only the documented chat filter and the game's own settings: nothing replaced, nothing hooked, nothing sent", () => {
  const source = read("addon/BackstageForever/BackstageForeverChat.lua");
  for (const name of ["hooksecurefunc", "HookScript", "SendChatMessage", "SendAddonMessage", "RunScript", "loadstring", "SetAttribute", "ChatFrame_OnHyperlinkShow", "SetItemRef=", "ChatEdit_", "C_ChatInfo", "DoEmote",
    "GetChatWindowInfo", "FCF_", ".AddMessage=", "ChatFrame1"]) assert.equal(source.split(name).length - 1, 0, `the chat file never uses ${name}`);
  const code = source.split("\n").filter((l) => !l.startsWith("--")).join("\n").replace(/ChatFrame_(Add|Remove)MessageEventFilter/g, "");
  assert.equal((code.match(/AddMessage/g) || []).length, (code.match(/chat\.AddMessage/g) || []).length, "AddMessage only on the default chat frame, to print the addon's own lines");
  assert.match(source, /local function onChat\(_,event,text,author,\.\.\.\)\n    if combat\(\) then return false end/, "chat is left alone in combat");
  assert.match(source, /text,author=plain\(text\),plain\(author\)/, "secret values are never read");
  assert.match(source, /if row\.text then return false,row\.text,author,\.\.\. end/, "every argument is handed back");
  assert.equal((source.match(/BackstageForeverWay/g) || []).length, 2, "a waypoint is placed in one place only: the click handler");
  const strings = (source.match(/CreateFontString\(/g) || []).length, noWrap = (source.match(/SetWordWrap\(false\)/g) || []).length;
  assert.ok(strings >= 2 && noWrap >= strings);
  // Nothing about chat is saved except the switches, what was switched in the game, and a count.
  assert.deepEqual([...new Set([...source.matchAll(/\bs\.(\w+)=/g)].map((m) => m[1]))].sort(), ["filtered", "names", "namesBefore", "stamps", "stampsBefore"]);
});

test("wiring: the toc, the dispatcher, help, four settings switches and the three languages", () => {
  const toc = read("addon/BackstageForever/BackstageForever.toc");
  assert.match(toc, /^## SavedVariablesPerCharacter:.*\bBackstageForeverChatSettings\b/m);
  assert.match(read("addon/BackstageForever/BackstageForeverHUD.lua"), /word=='chat' then\s+if type\(BackstageForeverChatCommand\)=='function' then pcall\(BackstageForeverChatCommand,message\)end/);
  assert.match(read("addon/BackstageForever/BackstageForeverAssist.lua"), /'\/bf chat - chat tools, each off at first/);
  const options = read("addon/BackstageForever/BackstageForeverOptions.lua");
  for (const [label, key] of [["Chat timestamps", "stamps"], ["Class colours in chat", "names"], ["Copy and links in chat", "links"], ["Gold seller filter", "filter"]])
    assert.ok(options.includes(`switch('${label}',`) && options.includes(`off('BackstageForeverChatSettings','${key}'),'chat ${key}')`), label);
  for (const lang of ["de", "es", "fr"]) {
    const d = JSON.parse(read(`data/i18n/${lang}.json`)).addon;
    for (const text of ["Chat timestamps", "Class colours in chat", "Copy and links in chat", "Gold seller filter", "Copy from chat", "Press Ctrl+C to copy, then Escape to close.", "Gold seller filter: off.",
      "Hidden gold-seller lines since you logged in: %d (%d in all). Newest first:", "That chat line is no longer remembered."]) assert.ok(d.plain[text], `${lang}: ${text}`);
  }
});
