"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const keys = ["questTracker", "objectiveHints", "questDetours", "beforeLeaving", "rewardReasons", "questBlockers", "gatheringMarks", "sharedObjectives", "keepQuestItems", "questItemCue", "spellRankReminder"];
function replay(body, settings = "nil", locale = "enUS") {
  const folder = "addon/BackstageForever";
  const loads = fs.readFileSync(path.join(root, folder, "BackstageForever.toc"), "utf8").split(/\r?\n/).filter(line => line.endsWith(".lua")).map(line => `dofile('${folder}/${line}')`).join("\n");
  const proc = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, encoding: "utf8", timeout: 15000, input: `
    GetLocale=function()return '${locale}'end
    SlashCmdList={}
    local last
    DEFAULT_CHAT_FRAME={AddMessage=function(_,msg)last=msg end}
    BackstageForeverHelperSettings=${settings}
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

test("the standalone list and acknowledgement use localized text with literal keys and commands", () => {
  replay(`
    cmd('helpers');assert(last:find('spellRankReminder',1,true) and last:find('An',1,true))
    assert(BackstageForeverHelperSettings==nil)
    cmd('helpers questTracker off');assert(last:find('questTracker',1,true) and last:find('Aus',1,true))
    cmd('helpers invalid');assert(last:find('Mit /bf helpers <key>',1,true))
  `, "nil", "deDE");
});

test("desktop renders only reviewed explicit commands and never implies an applied preference", () => {
  const app = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
  const renderer = fs.readFileSync(path.join(root, "src/renderer/helper-preferences.js"), "utf8");
  const vm = require("node:vm");
  const window = {};
  vm.runInNewContext(renderer, { window });
  const markup = window.HelperPreferences.markup(String);
  assert.match(app, /MomentsView\.settingsMarkup\(\).*?HelperPreferences\.markup\(esc\).*?CommunityView\.markup\(\)/);
  assert.match(markup, /Not sent/);
  assert.match(markup, /Desktop cannot verify/);
  assert.deepEqual([...markup.matchAll(/\/bf helpers (\w+) (on|off)<\/code>/g)].map(m => m[1]+" "+m[2]), keys.flatMap(key => [key+" on", key+" off"]));
  assert.doesNotMatch(markup, /<input|\bdps\b/i);
});
