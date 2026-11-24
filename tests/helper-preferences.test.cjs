"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const keys = ["questTracker", "objectiveHints", "questDetours", "beforeLeaving", "rewardReasons", "questBlockers", "gatheringMarks", "sharedObjectives", "keepQuestItems", "questItemCue", "spellRankReminder"];
function replay(body, settings = "nil", locale = "enUS", setup = "") {
  const folder = "addon/BackstageForever";
  const loads = fs.readFileSync(path.join(root, folder, "BackstageForever.toc"), "utf8").split(/\r?\n/).filter(line => line.endsWith(".lua")).map(line => `dofile('${folder}/${line}')`).join("\n");
  const proc = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, encoding: "utf8", timeout: 15000, input: `
    GetLocale=function()return '${locale}'end
    SlashCmdList={}
    local last
    DEFAULT_CHAT_FRAME={AddMessage=function(_,msg)last=msg end}
    BackstageForeverHelperSettings=${settings}
    ${setup}
    ${loads}
    local cmd=SlashCmdList.BACKSTAGEFOREVER
    ${body}
  ` });
  assert.equal(proc.status, 0, proc.stderr || String(proc.error));
  assert.equal(proc.stderr, "");
  return proc.stdout.trim();
}
test("standalone slash preferences are default-on, independent and survive a fresh per-character load", () => {
  const all = `{${keys.map(key => `'${key}'`).join(",")}}`;
  const seed = replay(`
    for _,key in ipairs(${all})do assert(BackstageForeverHelperEnabled(key)==true,key)end
    assert(BackstageForeverHelperEnabled('unknown')==false)
    for _,key in ipairs(${all})do
      cmd('helpers '..key..' off')
      assert(BackstageForeverHelperEnabled(key)==false,key)
      assert(last:find(key,1,true) and last:find('Off',1,true))
      cmd('helpers '..key..' on');assert(BackstageForeverHelperEnabled(key)==true,key)
    end
    cmd('helpers questTracker off')
    print('{ questTracker='..tostring(BackstageForeverHelperSettings.questTracker)..' }')
  `);
  replay(`
    cmd('helpers questTracker');assert(last:find('Off',1,true))
    assert(not BackstageForeverHelperEnabled('questTracker'))
    assert(BackstageForeverHelperEnabled('questDetours'))
    for _,input in ipairs({'helpers questTracker', 'helpers questTracker on extra', 'helpers dps off', 'helpers questTracker toggle', 'helpers live on', 'helpers questTracker 1'})do cmd(input)end
    assert(not BackstageForeverHelperEnabled('questTracker'))
    assert(next(BackstageForeverHelperSettings)=='questTracker')
    assert(BackstageForeverLiveSettings==nil)
  `, seed);
  replay(`assert(BackstageForeverHelperEnabled('questTracker'))`);
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.toc"), "utf8"), /^## SavedVariablesPerCharacter:.*\bBackstageForeverHelperSettings\b/m);
});

test("the batch handoff validates through the real slash dispatcher before writing any preference", () => {
  const seed = replay(`
    for _,bad in ipairs({
      'questTracker=on spellRankReminder=off',
      'questTracker=on dps=off commit',
      'questTracker=on questTracker=off commit',
      'questTracker=on objectiveHints=toggle commit',
      'questTracker=on commit extra',
      'questTracker=on\\nobjectiveHints=off commit',
      'questTracker=on'..string.rep(' ',240)..'commit',
      'commit',
    }) do
      cmd('helpers apply '..bad)
      assert(BackstageForeverHelperSettings.questTracker==false and BackstageForeverHelperSettings.spellRankReminder==nil,bad)
    end
    fighting=true
    cmd('helpers apply questTracker=on commit');assert(BackstageForeverHelperSettings.questTracker==false)
    fighting=false;guid=nil
    cmd('helpers apply questTracker=on commit');assert(BackstageForeverHelperSettings.questTracker==false)
    guid='Player-Synthetic'
    local redraws=0
    BackstageForeverHUDHelpersChanged=function()
      assert(not BackstageForeverHelperEnabled('questDetours'))
      redraws=redraws+1
    end
    cmd('helpers apply objectiveHints=on questDetours=off spellRankReminder=off commit')
    local s=BackstageForeverHelperSettings
    assert(s.questTracker==false and s.questDetours==false and s.spellRankReminder==false and s.objectiveHints==true)
    assert(s.keepQuestItems==nil and BackstageForeverLiveSettings==nil and redraws==1)
    assert(last:find('questDetours',1,true) and last:find('Aus',1,true) and not last:find(guid,1,true))
    print('{questTracker='..tostring(s.questTracker)..',questDetours='..tostring(s.questDetours)..'}')
  `, '{questTracker=false}', 'deDE', `
    local guid,fighting='Player-Synthetic',false
    UnitGUID=function()return guid end
    InCombatLockdown=function()return fighting end
  `);
  replay(`assert(not BackstageForeverHelperEnabled('questTracker') and not BackstageForeverHelperEnabled('questDetours'))`, seed);
  replay(`assert(BackstageForeverHelperEnabled('questTracker') and BackstageForeverHelperEnabled('questDetours'))`);
});

test("the standalone list and acknowledgement use localized text with literal keys and commands", () => {
  replay(`
    cmd('helpers');assert(last:find('spellRankReminder',1,true) and last:find('An',1,true))
    assert(BackstageForeverHelperSettings==nil)
    cmd('helpers questTracker off');assert(last:find('questTracker',1,true) and last:find('Aus',1,true))
    cmd('helpers invalid');assert(last:find('Mit /bf helpers <key>',1,true))
  `, "nil", "deDE");
});

test("native checkboxes save per-character choices and retire clicks on an owner round trip", () => {
  const setup = `
    local widgets,frames={},{}
    local owner,fighting='Player-A',false
    UnitGUID=function()return owner end
    InCombatLockdown=function()return fighting end
    UIParent={};UISpecialFrames={}
    local function widget(kind,name)
      local f={kind=kind,scripts={},events={}}
      function f:SetScript(k,fn) self.scripts[k]=fn end
      function f:RegisterEvent(k) self.events[k]=true end
      function f:SetChecked(v) self.checked=v end
      function f:GetChecked() return self.checked end
      function f:IsShown() return self.shown end
      function f:Show() self.shown=true end
      function f:Hide() self.shown=false end
      function f:SetText(v) self.text=v end
      function f:CreateTexture() return widget('Texture') end
      function f:CreateFontString() local label=widget('FontString');self.label=rawget(self,'label') or label;return label end
      if name then widgets[name]=f end
      frames[#frames+1]=f
      return setmetatable(f,{__index=function()return function()end end})
    end
    CreateFrame=widget
    local function fire(event)
      for _,f in ipairs(frames) do if f.events[event] then f.scripts.OnEvent(f,event) end end
    end
  `;
  const seed = replay(`
    cmd('helpers panel')
    local panel=widgets.BackstageForeverHelperPanel
    assert(panel and panel:IsShown(),'native helper panel opens')
    local tracker=widgets.BackstageForeverHelper_questTracker
    local detours=widgets.BackstageForeverHelper_questDetours
    assert(tracker.kind=='CheckButton' and tracker:GetChecked()==true and detours:GetChecked()==true)
    local count=0
    for name,w in pairs(widgets) do if name:match('^BackstageForeverHelper_') and w.kind=='CheckButton' then count=count+1 end end
    assert(count==11 and BackstageForeverHelperSettings==nil)
    tracker.checked=false;tracker.scripts.OnClick(tracker)
    assert(BackstageForeverHelperSettings.questTracker==false and detours:GetChecked()==true)
    cmd('helpers questDetours off');assert(detours:GetChecked()==false)
    local old=tracker.scripts.OnClick
    owner='Player-B';fire('PLAYER_ENTERING_WORLD');assert(not panel:IsShown())
    owner='Player-A';fire('PLAYER_ENTERING_WORLD');cmd('helpers panel')
    tracker.checked=true;old(tracker);assert(BackstageForeverHelperSettings.questTracker==false)
    fighting=true;fire('PLAYER_REGEN_DISABLED');assert(not panel:IsShown())
    assert(BackstageForeverLiveSettings==nil)
    print('{questTracker='..tostring(BackstageForeverHelperSettings.questTracker)..'}')
  `, "nil", "enUS", setup);
  replay(`cmd('helpers panel');assert(widgets.BackstageForeverHelper_questTracker:GetChecked()==false)
    assert(widgets.BackstageForeverHelper_questDetours:GetChecked()==true)
    assert(widgets.BackstageForeverHelperPanel.label.text=='Helfer im Spiel')`, seed, "deDE", setup);
  replay(`cmd('helpers panel');assert(widgets.BackstageForeverHelper_questTracker:GetChecked()==true)`, "nil", "enUS", setup);
});

test("desktop renders only reviewed explicit commands and never implies an applied preference", () => {
  const app = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src/renderer/helper-preferences.js"), "utf8");
  const vm = require("node:vm");
  const window = {};
  vm.runInNewContext(renderer, { window });
  const markup = window.HelperPreferences.markup(String);
  assert.match(app, /MomentsView\.settingsMarkup\(\).*?HelperPreferences\.markup\(esc,.*?CommunityView\.markup\(\)/);
  assert.match(markup, /Not sent/);
  assert.match(markup, /Desktop cannot verify/);
  assert.match(markup, /<code>\/bf helpers panel<\/code>/);
  assert.deepEqual([...markup.matchAll(/\/bf helpers (\w+) (on|off)<\/code>/g)].map(m => m[1]+" "+m[2]), keys.flatMap(key => [key+" on", key+" off"]));
  assert.doesNotMatch(markup, /<input|\bdps\b/i);
});

test("the longest desktop preview is a bounded identity-free command accepted by the shipped slash dispatcher", () => {
  const window = {};
  require("node:vm").runInNewContext(fs.readFileSync(path.join(root, "src/renderer/helper-preferences.js"), "utf8"), { window });
  const character = { id: "PRIVATE_ID", name: "PRIVATE_NAME", realm: "PRIVATE_REALM", source: { id: "PRIVATE_SOURCE", kind: "wow-addon" } };
  const owner = JSON.stringify([character.id, character.name, character.realm, character.source.kind, character.source.id, null]);
  const previous = {
    dataset: { helperOwner: owner },
    querySelectorAll: () => [...keys, "dps"].reverse().map(helperChoice => ({ dataset: { helperChoice }, value: "off" })),
  };
  const markup = window.HelperPreferences.markup(String, character, previous);
  const preview = markup.match(/<textarea[^>]*>([^<]*)<\/textarea>/)[1];
  assert.equal(preview, `/bf helpers apply ${keys.map(key => `${key}=off`).join(" ")} commit`);
  assert.ok(Buffer.byteLength(preview) <= 255);
  assert.match(window.HelperPreferences.markup(String, { ...character, source: { ...character.source, id: "REPLACED" } }, previous), /data-helper-preview hidden/);
  replay(`
    cmd(${JSON.stringify(preview.slice(4))})
    for _,key in ipairs({${keys.map(key => `'${key}'`).join(",")}}) do
      assert(BackstageForeverHelperSettings[key]==false,key)
    end
    cmd('help');assert(not sawBatchHelp,'the bare command prints the short index')
    cmd('help settings');assert(sawBatchHelp)
  `, "nil", "deDE", `
    local sawBatchHelp=false
    local original=DEFAULT_CHAT_FRAME.AddMessage
    DEFAULT_CHAT_FRAME.AddMessage=function(self,text)
      original(self,text)
      if text:find('/bf helpers apply key=on|off',1,true) and text:find('vorbereitete',1,true) then sawBatchHelp=true end
    end
    UnitGUID=function()return 'Player-Synthetic' end
    InCombatLockdown=function()return false end
  `);
});
