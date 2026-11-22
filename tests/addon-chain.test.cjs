"use strict";
// 1.19: /bf chain says where each quest in the log sits in its chain.
const test = require("node:test"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
function lua(source) {
  const r = spawnSync(process.execPath, [require.resolve("./lua-stdin.cjs")], { cwd: root, input: source, encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stderr, ""); return r.stdout.trim();
}

test("a chain is walked both ways from any step, and loops or missing rows end it", () => lua(String.raw`
local said={} DEFAULT_CHAT_FRAME={AddMessage=function(_,m) said[#said+1]=m end}
dofile('addon/BackstageForever/BackstageForeverChain.lua')
local q={[10]={title='One',next=20},[20]={title='Two',next=30},[30]={title='Three'},[40]={title='Alone'},
  [50]={title='Loop A',next=60},[60]={title='Loop B',next=50},[70]={title='Dangling',next=999}}
local ids,pos=BackstageForeverQuestChain(q,20)
assert(#ids==3 and ids[1]==10 and ids[2]==20 and ids[3]==30 and pos==2)
ids,pos=BackstageForeverQuestChain(q,10);assert(#ids==3 and pos==1)
ids,pos=BackstageForeverQuestChain(q,30);assert(#ids==3 and pos==3)
ids=BackstageForeverQuestChain(q,50);assert(#ids==2,'a loop stops after one lap')
ids=BackstageForeverQuestChain(q,70);assert(#ids==1,'a link to an unknown quest is ignored')
assert(BackstageForeverQuestChain(q,12345)==nil and BackstageForeverQuestChain(nil,10)==nil)
assert(BackstageForeverChainLine(q,20)=='Two: step 2 of 3. Next: Three.')
assert(BackstageForeverChainLine(q,30,'Three (yours)')=='Three (yours): step 3 of 3. This is the last step.')
assert(BackstageForeverChainLine(q,40)==nil)
BackstageForeverReference={quests=q}
C_QuestLog={GetNumQuestLogEntries=function() return 3 end,GetInfo=function(i) return ({{isHeader=true,title='Zone'},{isHeader=false,questID=20,title='Two'},{isHeader=false,questID=40,title='Alone'}})[i] end}
BackstageForeverChainCommand()
assert(#said==1 and said[1]=='Backstage Forever: Two: step 2 of 3. Next: Three.',said[1])
C_QuestLog.GetNumQuestLogEntries=function() return 0 end;BackstageForeverChainCommand()
assert(said[2]:find('None of the quests in your log',1,true))
`));

test("the bundled reference carries follow-up links and the command is wired in", () => {
  const ref = fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverReference.lua"), "utf8");
  assert.ok((ref.match(/\["next"\]=\d+/g) || []).length > 1000);
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForeverHUD.lua"), "utf8"), /word=='chain'/);
  assert.match(fs.readFileSync(path.join(root, "addon/BackstageForever/BackstageForever.toc"), "utf8"), /BackstageForeverChain\.lua/);
});
