"use strict";
const { navigate, ensureCompanionTools } = require("./player-navigation.cjs");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { _electron: electron } = require("playwright");
const { testWindow } = require("./test-window.cjs");
const {selectCurrentText,currentControlState}=require("./selection-fixture.cjs");
function currentQuestPaint({ id, previous }) {
  const detail = document.querySelector(`[data-quest-control="detail:${id}"]`);
  const row = document.querySelector(`.quest-ledger-row[data-quest-id="${id}"]`);
  const selectedProfile = document.querySelector("#active-character")?.value;
  let rowIntent, copyIntent;
  try {
    rowIntent = JSON.parse(row?.dataset.questIntent || "null");
    copyIntent = JSON.parse(detail?.querySelector("[data-quest-copy]")?.dataset.questIntent || "null");
  } catch { return false; }
  return Boolean(detail && detail !== previous && row?.getAttribute("aria-pressed") === "true" &&
    rowIntent?.id === id && copyIntent?.id === id &&
    rowIntent.profileId === selectedProfile && copyIntent.profileId === selectedProfile &&
    rowIntent.generation === copyIntent.generation);
}
async function prepareCurrentSourceSpace(page,id){
 return page.evaluate(id=>{
  const matches=document.querySelectorAll('.quest-source summary');
  if(matches.length!==1)throw Error('Expected one current quest source disclosure');
  const node=matches[0],key=node.dataset.interactionKey;
  const [profileId,questId,kind]=JSON.parse(key||'null');
  if(!node.isConnected||node.dataset.questControl!==`source:${id}`||questId!==id||kind!=='quest-source'||profileId!==document.querySelector('#active-character')?.value)throw Error('Source disclosure is not owned by the current quest and character');
  node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});node.focus({preventScroll:true});
  const rect=node.getBoundingClientRect();
  if(document.activeElement!==node||!rect.width||!rect.height||rect.bottom<=0||rect.top>=innerHeight)throw Error('Current source disclosure must be visible and own focus before Space');
  window.atlasSourcePreparedSummary=node;window.atlasHeldSummary=null;window.atlasToggles=0;window.atlasSourceKeydown=null;
  // Idle paints may replace preparation nodes. The physical keydown owns the
  // original node for every held-input/toggle assertion after the press begins.
  document.addEventListener('keydown',event=>{
   const target=event.target;window.atlasHeldSummary=target;
   window.atlasSourceKeydown={code:event.code,trusted:event.isTrusted,connected:target.isConnected,focused:target===document.activeElement,summary:target.matches('.quest-source summary'),control:target.dataset.questControl,key:target.dataset.interactionKey};
   target.parentElement.addEventListener('toggle',()=>window.atlasToggles++);
  },{once:true,capture:true});
  return {control:node.dataset.questControl,key};
 },id);
}
function shortPath(target){
  const script=`Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class AtlasShortPath { [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path,StringBuilder result,uint length); }'; $buffer=New-Object System.Text.StringBuilder 4096; $length=[AtlasShortPath]::GetShortPathName($env:BF_ATLAS_FIXTURE_PATH,$buffer,4096); if($length -eq 0 -or $length -ge 4096){throw 'Short path unavailable'}; $buffer.ToString()`;
  const alias=require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,BF_ATLAS_FIXTURE_PATH:target},encoding:'utf8',timeout:15000}).trim();
  assert.notEqual(alias.toLowerCase(),target.toLowerCase());assert.match(alias,/~\d/);assert.equal(require('node:fs').statSync(alias).ino,require('node:fs').statSync(target).ino);return alias;
}
(async () => {
  const normalData = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-knowledge-"));
  const data=process.argv.includes("--short-path")?shortPath(normalData):normalData;
  const repo = path.join(__dirname, "..");
  let app, page;
  const watchdog=setTimeout(()=>{console.error("Quest atlas fixture exceeded 120 seconds");process.exitCode=1;app?.process().kill();},120000);
  try {
    await fs.mkdir(path.join(data, "knowledge-v1"));
    await fs.writeFile(
      path.join(data, "knowledge-v1/preferences.json"),
      JSON.stringify({ automatic: false, checked: {} }),
    );
    const game = path.join(data, "fictional-client"),
      file = path.join(
        game,
        "WTF/Account/Fictional/SavedVariables/BackstageForever.lua",
      );
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(path.join(game, ".flavor.info"), "wowf");
    const base = {
      realm: "Fictional Realm",
      level: 24,
      updatedAt: Date.now() / 1000,
      clientBuild: "1.60.1.70862",
      captureVersion: "0.6.0",
      locale: "enUS",
      location: {
        zone: "Fictional Camp",
        subZone: "Camp",
        mapId: 1413,
        x: 0.4,
        y: 0.5,
      },
      history: {
        completedIdsKnown: true,
        completedIds: [1060],
        completedCount: 1,
        recent: [],
      },
    };
    const characters = [
      {
        ...base,
        id: "Fixture-Alliance",
        name: "Aeralyn",
        faction: "Alliance",
        race: "Human",
        className: "Hunter",
        quests: [
          {
            id: 1061,
            title: "The Spirits of Stonetalon",
            complete: true,
            objectives: [],
            destination: {
              mapId: 999,
              x: 0.123456,
              y: 0.654321,
              text: "Quest area reported by the game; not an exact NPC or spawn location",
            },
          },
          {
            id: 5729,
            title: "Current game hotfix title",
            complete: false,
            objectives: [{ text: "Speak with Neeru Fireblade", done: false }],
          },
          {
            id: 98024,
            title: "A New Beginning",
            complete: false,
            objectives: [],
          },
          {
            id: 854,
            title: "A New Beginning",
            complete: false,
            objectives: [],
          },
          {
            id: 2000001,
            title: "<img src=x onerror=alert(1)> Missing public record",
            complete: false,
            objectives: [],
            destination: {
              mapId: 888,
              x: 0.25,
              y: 0.75,
              text: "Saved point without a public record",
            },
          },
        ],
      },
      {
        ...base,
        id: "Fixture-Horde",
        name: "Vaelric",
        faction: "Horde",
        race: "Orc",
        className: "Mage",
        quests: [
          {id:1061,title:"The Spirits of Stonetalon",complete:false,objectives:[]},
          {id:5729,title:"Current game hotfix title",complete:false,objectives:[]},
          {
            id: 5730,
            title: "Hidden Enemies",
            complete: false,
            objectives: [{ text: "Speak with Thrall", done: false }],
          },
          {id:98024,title:"Journey to the Crossroads",complete:false,objectives:[]},
        ],
      },
    ];
    const write = async () =>
      fs.writeFile(
        file,
        "BackstageForeverExport = " +
          JSON.stringify(
            JSON.stringify({
              schema: 1,
              activeId: characters[0].id,
              observedAt: Date.now() / 1000,
              characters,
            }),
          ),
      );
    await write();
    app = await electron.launch({
      args: [repo],
      env: { ...process.env, BF_USER_DATA: data },
    });
    page = await testWindow(app);
    const waitQuestPaint = (id, previous) => page.waitForFunction(currentQuestPaint, { id, previous });
    await app.evaluate(({ ipcMain, clipboard }, root) => {
      globalThis.knowledgeInference = 0;
      globalThis.knowledgeCopies = [];
      clipboard.writeText = (text) => globalThis.knowledgeCopies.push(text);
      ipcMain.removeHandler("backstage:ask");
      ipcMain.handle("backstage:ask", () => {
        globalThis.knowledgeInference++;
        throw Error("Fixture blocks inference");
      });
      const { KnowledgeService } = process.mainModule.require(
        root + "/src/core/knowledge-cache.cjs",
      );
      KnowledgeService.prototype.readResponse = async function (url, signal) {
        globalThis.knowledgePublicRequest = url;
        if (globalThis.knowledgeBlockTransfer)
          await new Promise((resolve, reject) =>
            signal.addEventListener("abort", () => reject(Error("Cancelled")), {
              once: true,
            }),
          );
        throw Error("Fixture offline");
      };
      process.mainModule.require(root+'/src/core/voice.cjs').VoiceService.prototype.readCapabilities=async()=>({status:'unavailable',recognition:{available:false,cultures:[]},synthesis:{available:false,voices:[]},message:'Synthetic voice unavailable.'});
    }, repo);
    await page.evaluate(() => localStorage.setItem("bf-setup-v4", "complete"));
    const prepared = await page.evaluate(
      (root) => window.backstage.prepareGame(root),
      game,
    );
    assert.ok(
      prepared.state.profiles.some((p) => p.name === "Aeralyn"),
      JSON.stringify(prepared.gameStatus),
    );
    await page.reload();
    await page.getByRole("heading", { name: "Aeralyn", exact: true }).waitFor();
    const plans = page.getByRole("region", {
      name: "Your next steps",
      exact: true,
    });
    await plans
      .getByRole("button", { name: /Quest details/ })
      .first()
      .waitFor();
    assert.match(
      await plans.innerText(),
      /Saved game destination|Game destination/i,
    );
    await plans
      .getByRole("button", { name: /Quest details/ })
      .first()
      .click();
    await page
      .locator(".quest-detail")
      .getByRole("heading", { name: "The Spirits of Stonetalon", exact: true })
      .waitFor();
    const search = page.getByLabel("Find a quest", { exact: true });
    await page.locator(".quest-ledger-row").first().waitFor();
    assert.equal(
      await page.locator('.quest-ledger-row[data-quest-id="2000001"]').count(),
      1,
      "Every active quest remains visible without a reference row",
    );
    assert.equal(
      await page.locator(".quest-ledger-row img").count(),
      0,
      "Publisher and game titles stay literal text",
    );
    await page.locator('.quest-ledger-row[data-quest-id="2000001"]').click();
    await page
      .getByRole("button", { name: "Copy game waypoint", exact: true })
      .click();
    assert.equal(
      (await app.evaluate(() => globalThis.knowledgeCopies)).at(-1),
      "/bf guide 2000001 o 888 0.2500 0.7500 1.60.1.70862",
    );
    await page.locator('.quest-ledger-row[data-quest-id="1061"]').click();
    await page
      .locator(".quest-detail")
      .getByRole("heading", { name: "The Spirits of Stonetalon", exact: true })
      .waitFor();
    assert.match(
      await page.locator(".quest-detail").innerText(),
      /1062|Reported chain/,
    );
    assert.match(
      await page.locator(".quest-waypoint").innerText(),
      /999.*12\.35.*65\.43/s,
    );
    await page
      .getByRole("button", { name: "Copy game waypoint", exact: true })
      .click();
    assert.equal(
      (await app.evaluate(() => globalThis.knowledgeCopies)).at(-1),
      "/bf guide 1061 t 999 0.1235 0.6543 1.60.1.70862",
    );
    assert.equal(await page.locator('.quest-atlas-art').count(),1,"Quest atlas must be image-led with original class art");
    assert.match(await page.locator('.quest-waypoint').innerText(),/Quest area reported by the game; not an exact NPC or spawn location/);
    assert.match(await page.locator('.quest-waypoint').innerText(),/Saved game snapshot · saved/);
    assert.ok(await page.locator('[data-quest-copy]').getAttribute('data-quest-intent'));
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
    await page.waitForFunction(()=>innerWidth<=1000);await page.evaluate(()=>scrollTo(0,0));
    assert.ok(await page.getByRole('button',{name:'Copy game waypoint',exact:true}).evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight),'Game area copy action must fit the compact first viewport with the full qualification visible');
    await fs.mkdir(path.join(repo,'work/v012-quest-ui-evidence'),{recursive:true});await page.evaluate(()=>{document.querySelector('.breadcrumb').textContent='Fictional preview · invented player state';document.getElementById('toast').className='';scrollTo(0,0);});await page.screenshot({path:path.join(repo,'work/v012-quest-ui-evidence',`${process.argv.includes('--short-path')?'short-':''}quest-guide-game-area.png`)});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));
    assert.ok(await page.locator(".rail nav").evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth)),"Navigation must never gain a horizontal scroll axis");
    await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('backstage:copyQuestWaypoint');ipcMain.removeHandler('backstage:copyQuestWaypoint');globalThis.atlasCopyCalls=0;ipcMain.handle('backstage:copyQuestWaypoint',async(...args)=>{atlasCopyCalls++;const fail=globalThis.atlasCopyFail;const result=await original(...args);if(globalThis.atlasCopyHold)await new Promise(r=>globalThis.atlasCopyRelease=r);if(fail)throw Error("Synthetic late copy acknowledgement failure");return result;});globalThis.atlasCopyHold=true;});
    const copying=page.getByRole('button',{name:'Copy game waypoint',exact:true});await copying.click();
    await app.evaluate(async()=>{const end=Date.now()+5000;while(!globalThis.atlasCopyRelease){if(Date.now()>end)throw Error('copy ack not held');await new Promise(r=>setTimeout(r,10));}});
    assert.equal(await copying.isDisabled(),true,'Explicit waypoint action cannot duplicate while its acknowledgement is held');
    await page.evaluate(()=>render());await app.evaluate(()=>{globalThis.atlasCopyHold=false;globalThis.atlasCopyRelease();});await copying.waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('[data-quest-copy]').disabled);
    assert.equal(await app.evaluate(()=>atlasCopyCalls),1);
    await app.evaluate(()=>{globalThis.atlasCopyHold=true;globalThis.atlasCopyFail=true;globalThis.atlasCopyRelease=null;});await copying.click();
    await app.evaluate(async()=>{const end=Date.now()+5000;while(!globalThis.atlasCopyRelease){if(Date.now()>end)throw Error('copy ack not held');await new Promise(r=>setTimeout(r,10));}});
    await page.locator('.quest-ledger-row[data-quest-id="5729"]').click();await page.locator('[data-quest-control="detail:5729"]').waitFor();
    await app.evaluate(()=>{globalThis.atlasCopyHold=false;globalThis.atlasCopyFail=false;globalThis.atlasCopyRelease();});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await page.locator('[data-quest-control="detail:5729"]').count(),1,'Failed copy reply cannot reopen the old selected quest');assert.doesNotMatch(await page.locator('.quest-detail').innerText(),/saved quest changed/i);
    await page.locator('.quest-ledger-row[data-quest-id="1061"]').click();await page.locator('[data-quest-control="detail:1061"]').waitFor();
    const beforeRefusal = (await app.evaluate(() => globalThis.knowledgeCopies))
      .length;
    // Advance owned saved evidence while retaining the visible stale descriptor.
    characters[0].quests.find((q) => q.id === 1061).complete = false;
    characters[0].updatedAt = Math.max(Date.now() / 1000, characters[0].updatedAt + 0.01);
    await write();
    await page.evaluate(() => window.backstage.refreshGame());
    await page
      .getByRole("button", { name: "Copy game waypoint", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "saved quest changed" })
      .waitFor();
    assert.equal(
      (await app.evaluate(() => globalThis.knowledgeCopies)).length,
      beforeRefusal,
      "Main revalidates phase after the visible descriptor was fetched",
    );
    characters[0].quests.find((q) => q.id === 1061).complete = true;
    characters[0].updatedAt = Math.max(Date.now() / 1000, characters[0].updatedAt + 0.01);
    await write();
    await page.evaluate(() => window.backstage.refreshGame());
    await search.fill("A New Beginning");
    await page.waitForFunction(
      () => document.querySelectorAll(".quest-ledger-row").length === 2,
    );
    assert.deepEqual(
      (
        await page
          .locator(".quest-ledger-row")
          .evaluateAll((rows) => rows.map((row) => Number(row.dataset.questId)))
      ).sort((a, b) => a - b),
      [854, 98024],
    );
    await search.fill("5728");
    const reported = await page.evaluate(async () => {
      const id = (await window.backstage.bootstrap()).state.activeProfileId;
      return (await window.backstage.questDetails(id,5728)).chain;
    });
    // Hold the real main-owned result so the old empty-detail heading cannot
    // accidentally stand in for completion of this selected quest.
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("backstage:questDetails");
      ipcMain.removeHandler("backstage:questDetails");
      globalThis.atlasCompletionHold = true;
      globalThis.atlasCompletionReleases = [];
      ipcMain.handle("backstage:questDetails", async (...args) => {
        const result = await original(...args);
        if (args[2] === globalThis.atlasCompletionQuest && globalThis.atlasCompletionHold) {
          await new Promise(resolve => globalThis.atlasCompletionReleases.push(resolve));
        }
        return result;
      });
    });
    const openQuestAndWait = async (id) => {
      const row = page.locator(`.quest-ledger-row[data-quest-id="${id}"]`);
      await row.waitFor();
      const previous = await page.$(".quest-detail");
      await app.evaluate((_, id) => {
        globalThis.atlasCompletionQuest = id;
        globalThis.atlasCompletionHold = true;
      }, id);
      await row.focus();
      await page.keyboard.down("Space");
      await row.click();
      await app.evaluate(async () => {
        const end = Date.now() + 5000;
        while (!globalThis.atlasCompletionReleases.length) {
          if (Date.now() > end) throw Error("Quest completion response was not held");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      });
      assert.equal(await page.evaluate(currentQuestPaint, { id, previous }), false,
        "A retained detail cannot complete the held current selection");
      // This deliberately witnesses the old predicate while a genuine reply is
      // held. The readiness condition contains no chain, title or waypoint facts.
      assert.equal(await page.locator(".quest-detail h2").count(), 1,
        "The old generic heading predicate is satisfied before completion");
      await app.evaluate(() => {
        globalThis.atlasCompletionHold = false;
        globalThis.atlasCompletionReleases.splice(0).forEach(release => release());
      });
      await page.keyboard.up("Space");
      await waitQuestPaint(id, previous);
      await previous?.dispose();
      console.log(`PASS: held actual questDetails #${id}: old heading is present before current selection paint; current profile/generation and replacement detail complete after release.`);
    };
    await openQuestAndWait(5728);
    const shownEdges = await page.locator('[data-chain-from]').evaluateAll(nodes => nodes.map(n=>[Number(n.dataset.chainFrom),Number(n.dataset.chainTo)]));
    assert.deepEqual(shownEdges.sort((a,b)=>a[0]-b[0]), reported.filter(n=>n.nextQuestId).map(n=>[n.id,n.nextQuestId]).sort((a,b)=>a[0]-b[0]), "Every visible arrow must describe an actual reported edge, never array adjacency");
    const neighbor = page.locator('[data-chain-node="5729"]');
    assert.match(await neighbor.innerText(), /Current game hotfix title/);
    assert.match(await neighbor.innerText(), /Reference conflict.*Hidden Enemies/s);
    if (process.argv.includes("--detail-completion-only")) {
      console.log("PASS: current selected quest completion uses the genuine main/preload/renderer path and preserves exact chain/title/conflict assertions.");
      return;
    }
    await fs.mkdir(path.join(repo,"work/v012-quest-ui-evidence"),{recursive:true});
    await page.evaluate(()=>{ document.getElementById("toast").className = ""; });
    await page.locator('.quest-chain').screenshot({path:path.join(repo,"work/v012-quest-ui-evidence/quest-chain-directed.png")});
    await search.fill("5730");
    await openQuestAndWait(5730);
    await page
      .getByRole("heading", { name: "Hidden Enemies", exact: true })
      .waitFor();
    assert.match(
      await page.locator(".quest-detail").innerText(),
      /Reward|Choose one/,
    );
    assert.match(
      await page.locator(".quest-waypoint").innerText(),
      /Neeru|3216/,
    );
    await page
      .getByRole("button", { name: "Copy reference marker", exact: true })
      .click();
    assert.match(
      (await app.evaluate(() => globalThis.knowledgeCopies)).at(-1),
      /^\/bf guide 5730 r /,
    );
    await page.locator(".quest-source summary").click();
    assert.match(
      await page.locator(".quest-source").innerText(),
      /Efficient Games|CC BY/,
    );
    assert.match(
      await page.locator(".quest-source").innerText(),
      /contributor|Contributor/,
    );
    const collectionDate = await page.evaluate(async () => {
      const id = (await window.backstage.bootstrap()).state.activeProfileId;
      const d = await window.backstage.questDetails(id, 5730);
      return new Date(d.provenance.observedThrough).toLocaleDateString(
        undefined,
        { timeZone: "UTC" },
      );
    });
    assert.ok(
      (await page.locator(".quest-source").innerText()).includes(
        collectionDate,
      ),
      "Date-only collection dates keep the published calendar day",
    );
    await search.focus();
    await search.press("Escape");
    assert.equal(
      await page.evaluate(() => document.querySelector("#quest-search") === document.activeElement),
      true,
      "Escape returns focus to quest search",
    );
    assert.equal(await page.locator('[aria-label="Quest details"]').count(), 0);
    await search.fill("5730");
    await page.locator('.quest-ledger-row[data-quest-id="5730"]').click();
    const ids = await page
      .getByLabel("Active character", { exact: true })
      .locator("option")
      .evaluateAll((rows) =>
        rows.map((row) => ({ id: row.value, text: row.textContent })),
      );
    const alliance = ids.find((row) => row.text.includes("Aeralyn")).id,
      horde = ids.find((row) => row.text.includes("Vaelric")).id;
    const screens = path.join(repo, "work/v012-quest-ui-evidence");
    await fs.mkdir(screens, { recursive: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const capture = async (name) => {
      await page.evaluate(() => {
        document.querySelector(".breadcrumb").textContent =
          "Fictional preview · invented player state";
        scrollTo(0, 0);
        document.getElementById("toast").className = "";
      });
      await page.screenshot({ path: path.join(screens, (process.argv.includes("--short-path")?"short-":"")+name) });
    };
    await capture("quest-guide-alliance.png");
    await page
      .getByLabel("Active character", { exact: true })
      .selectOption(horde);
    await openQuestAndWait(5730);
    assert.match(
      await page.locator(".quest-waypoint").innerText(),
      /Named in a quest objective/,
    );
    assert.doesNotMatch(
      await page.locator(".quest-waypoint").innerText(),
      /finisher not confirmed/,
    );
    await page
      .locator(".quest-detail")
      .getByRole("heading", { name: "Turn-in observations", exact: true })
      .waitFor();
    assert.match(await page.locator('.quest-waypoint').innerText(),/NPC clue.*destination unconfirmed/i);
    assert.equal(await page.getByRole('button',{name:'Copy NPC clue marker',exact:true}).count(),1);
    await capture("quest-guide-horde.png");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 700),
    );
    await page.waitForFunction(() => innerWidth <= 1000);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.ok(
      await search.evaluate(
        (node) => node.getBoundingClientRect().bottom < innerHeight,
      ),
    );
    await capture("quest-guide-compact.png");
    assert.ok(
      await page
        .getByRole("button", { name: "Copy NPC clue marker", exact: true })
        .evaluate((node) => node.getBoundingClientRect().bottom <= innerHeight),
      "The first waypoint action fits the compact first screen",
    );
    assert.ok(await page.locator('.rail nav').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth)),"Navigation must never gain a horizontal scroll axis");
    // Real native disclosure, menu and search selection survive root and region paints.
    const sourceSummary=page.locator('.quest-source summary'),idleSource=await sourceSummary.elementHandle();
    await page.evaluate(()=>render());
    assert.equal(await idleSource.evaluate(n=>n.isConnected),false,'Accepted idle root paint retires the resolved preparation node before scrolling');
    await assert.rejects(idleSource.scrollIntoViewIfNeeded(),/not attached to the DOM/);await idleSource.dispose();
    const sourceTarget=await prepareCurrentSourceSpace(page,5730);
    // A second accepted idle paint after preparation must retain semantic focus;
    // the following physical keydown must capture its actual replacement node.
    await page.evaluate(()=>render());
    assert.equal(await page.evaluate(()=>atlasSourcePreparedSummary.isConnected),false,'The idle preparation node is replaced before the physical press');
    assert.equal((await currentControlState(page,'.quest-source summary')).focused,true,'Current source disclosure retains semantic keyboard focus after idle paint');
    await page.keyboard.down('Space');
    try{
      assert.deepEqual(await page.evaluate(()=>atlasSourceKeydown),{code:'Space',trusted:true,connected:true,focused:true,summary:true,...sourceTarget},'The true physical keydown owns the exact current source disclosure');
      assert.equal(await page.evaluate(()=>atlasHeldSummary===atlasSourcePreparedSummary),false,'Keydown captures the current replacement, never an obsolete idle node');
      await page.evaluate(()=>render());assert.ok(await sourceSummary.evaluate(n=>n===window.atlasHeldSummary));
    }finally{await page.keyboard.up('Space');}
    await page.waitForFunction(()=>window.atlasToggles===1);assert.equal((await currentControlState(page,".quest-source summary")).focused,true);
    const disclosureOpen=(await currentControlState(page,".quest-source summary",{disclosure:true})).open;await page.evaluate(()=>render());assert.equal((await currentControlState(page,".quest-source summary",{disclosure:true})).open,disclosureOpen);
    console.log('PASS: accepted idle root paints retire stale pre-scroll/pre-key nodes; atomic current preparation and true native Space keydown preserve exact held node, one toggle, semantic focus and disclosure choice.');
    const activeMenu=page.getByLabel('Active character',{exact:true});await activeMenu.click();await activeMenu.evaluate(n=>window.atlasHeldMenu=n);await page.evaluate(()=>render());assert.ok(await activeMenu.evaluate(n=>n===window.atlasHeldMenu));await page.keyboard.press('Escape');await search.focus();
    const atlasNav=page.getByRole('button',{name:'Quests',exact:true});await page.evaluate(()=>{const nodes=document.querySelectorAll('[data-shell-control="nav:quest-guide"]');if(nodes.length!==1)throw Error('Expected one current Quests navigation control');nodes[0].focus();if(document.activeElement!==nodes[0])throw Error('Current Quests navigation control must own focus');});await page.evaluate(()=>render());
    // A locator may resolve a node just before an accepted root replacement.
    // Keep this semantic focus check atomic; held native target checks above
    // deliberately retain their original-node assertions.
    await app.evaluate(({ipcMain})=>{
      const original=ipcMain._invokeHandlers.get('backstage:saveState');ipcMain.removeHandler('backstage:saveState');
      ipcMain.handle('backstage:saveState',async(...args)=>{const result=await original(...args);if(globalThis.atlasFocusSaveHold)await new Promise(resolve=>globalThis.atlasFocusSaveRelease=resolve);return result;});
      globalThis.atlasFocusSaveHold=true;
    });
    await page.evaluate(()=>{autosaveQueue=autosaveQueue.then(async()=>{await persist(state);render();});});
    await app.evaluate(async()=>{const end=Date.now()+5000;while(!globalThis.atlasFocusSaveRelease){if(Date.now()>end)throw Error('Navigation focus save acknowledgement was not held');await new Promise(resolve=>setTimeout(resolve,10));}});
    const previousNav=await atlasNav.elementHandle();
    await app.evaluate(()=>{globalThis.atlasFocusSaveHold=false;globalThis.atlasFocusSaveRelease();});await page.evaluate(()=>autosaveQueue);
    await page.waitForFunction(previous=>document.querySelector('[data-shell-control="nav:quest-guide"]')!==previous,previousNav);
    assert.equal(await previousNav.evaluate(node=>node.isConnected),false,'The probe witnesses an actual accepted root replacement');
    assert.equal(await previousNav.evaluate(node=>node===document.activeElement),false,'An obsolete resolved node cannot describe current semantic focus');
    assert.equal(await page.evaluate(()=>document.querySelector('[data-shell-control="nav:quest-guide"]')===document.activeElement),true,'Navigation focus keeps semantic ownership through source/root paints');
    await previousNav.dispose();
    console.log('PASS: held real save acknowledgement replaces the obsolete navigation node; current semantic navigation focus remains exact.');
    await search.fill('Hidden');await selectCurrentText(page,{selector:'#quest-search',value:'Hidden',start:2,end:4});await page.evaluate(()=>render());assert.equal(await search.inputValue(),'Hidden');assert.deepEqual(await page.evaluate(()=>{const n=document.querySelector('#quest-search');return [n.value,n===document.activeElement,n.selectionStart,n.selectionEnd];}),['Hidden',true,2,4]);assert.equal(await page.evaluate(()=>document.querySelector('#quest-search')===document.activeElement),true);
    await search.fill('');await openQuestAndWait(5730);
    // A real ready phase uses the compatible turn-in observation, not an objective clue.
    characters[1].quests.find(q=>q.id===5730).complete=true;characters[1].updatedAt+=2;await write();await page.evaluate(()=>window.backstage.refreshGame());
    await page.evaluate(async()=>{const r=await backstage.bootstrap();state=r.state;render();});await openQuestAndWait(5730);
    const readyFacts=await page.evaluate(async()=>backstage.questDetails(state.activeProfileId,5730));
    assert.equal(readyFacts.waypoint.source,'reference');assert.notEqual(readyFacts.waypoint.destination?.evidence,'mentioned-in-objective');assert.ok(readyFacts.waypoint.destination);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,1000));await capture('quest-guide-horde-ready.png');
    characters[1].quests.find(q=>q.id===5730).complete=false;characters[1].updatedAt+=2;await write();await page.evaluate(()=>window.backstage.refreshGame());
    await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('backstage:questDetails');ipcMain.removeHandler('backstage:questDetails');ipcMain.handle('backstage:questDetails',async(...args)=>{if(globalThis.atlasFailDetails)throw Error('Synthetic evidence unavailable');return original(...args);});globalThis.atlasFailDetails=true;});
    await page.locator('.quest-ledger-row[data-quest-id="5730"]').click();await page.getByRole('button',{name:'Retry quest evidence',exact:true}).waitFor();await capture('quest-guide-detail-error.png');
    await app.evaluate(()=>globalThis.atlasFailDetails=false);await page.getByRole('button',{name:'Retry quest evidence',exact:true}).click();await page.locator('.quest-detail h2').waitFor();
    await search.fill('99999999');await page.getByText('No matching quests.',{exact:true}).waitFor();await capture('quest-guide-empty.png');await search.fill('');

    await navigate(page, "assistant");
    await page.getByLabel("Your question", {exact:true}).fill("Where is Thork?");
    await page.waitForFunction(()=>document.querySelector('.context-preview pre')?.textContent.includes('Thork'));
    const npcPreview = JSON.parse(await page.locator('.context-preview pre').textContent());
    assert.equal(npcPreview.knowledge[0].questId,98024,"Name-only preview retrieves Thork after three other active quests");
    await page.getByRole('button',{name:'Adventure',exact:true}).click();
    await page.getByRole('button',{name:'Explain my plan',exact:true}).click();
    const chainDraft = await page.getByLabel('Your question',{exact:true}).inputValue();
    assert.match(chainDraft,/"nextQuestId": 5730/);
    assert.match(chainDraft,/"referenceStatus": "conflict"/);
    assert.match(chainDraft,/Current game hotfix title/);
    const deferredQuestion = "Where is Neeru for quest 5730?";
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("backstage:contextPreview");
      ipcMain.removeHandler("backstage:contextPreview");
      globalThis.knowledgeDeferredPreviewCalls = 0;
      ipcMain.handle("backstage:contextPreview", async (...args) => {
        const result = await original(...args);
        if (
          args[3] === "Where is Neeru for quest 5730?" &&
          !globalThis.knowledgeDeferredPreviewReleased
        ) {
          globalThis.knowledgeDeferredPreviewCalls++;
          await new Promise((resolve) => {
            globalThis.knowledgeDeferredPreviewRelease = resolve;
          });
        }
        return result;
      });
    });
    await page
      .getByLabel("Your question", { exact: true })
      .fill("Explain quest 1061 with its public source facts.");
    await page.waitForFunction(() =>
      document
        .querySelector(".context-preview pre")
        ?.textContent.includes("1061"),
    );
    const previousPreview = await page
      .locator(".context-preview pre")
      .textContent();
    await page.evaluate((prompt) => {
      document.querySelector('#chat-form [name="prompt"]').value = prompt;
      window.QuestGuide.updateContext();
      window.QuestGuide.mounted();
      window.QuestGuide.updateContext();
    }, deferredQuestion);
    await app.evaluate(async () => {
      const end = Date.now() + 5000;
      while (!globalThis.knowledgeDeferredPreviewRelease) {
        if (Date.now() > end)
          throw Error("Deferred preview fixture did not start");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    assert.equal(
      await page.locator(".context-preview pre").count(),
      0,
      "Duplicate calls while the new preview is pending must not repaint previous quest JSON",
    );
    assert.match(
      await page.locator("[data-context-body]").innerText(),
      /Opening the public context preview/,
    );
    assert.equal(
      await app.evaluate(() => globalThis.knowledgeDeferredPreviewCalls),
      1,
      "Same pending key must not start duplicate IPC requests",
    );
    await app.evaluate(() => {
      globalThis.knowledgeDeferredPreviewReleased = true;
      globalThis.knowledgeDeferredPreviewRelease();
    });
    await page.waitForFunction((old) => {
      const next = document.querySelector(".context-preview pre")?.textContent;
      return next && next !== old && next.includes("5730");
    }, previousPreview);
    await page
      .getByLabel("Your question", { exact: true })
      .fill("Where is Neeru for quest 5730?");
    await page.waitForFunction(() =>
      document
        .querySelector(".context-preview pre")
        ?.textContent.includes("5730"),
    );
    const preview = JSON.parse(
      await page.locator(".context-preview pre").textContent(),
    );
    assert.deepEqual(
      preview,
      await page.evaluate(
        (id) =>
          window.backstage.contextPreview(
            id,
            true,
            "Where is Neeru for quest 5730?",
          ),
        horde,
      ),
    );
    for (const secret of ["completedIds", "Fixture-Horde", game, file])
      assert.ok(!JSON.stringify(preview).includes(secret));
    await page.getByLabel("Use my active character", { exact: true }).uncheck();
    await page.waitForFunction(() =>
      document
        .querySelector(".context-preview")
        ?.textContent.includes("No character context"),
    );
    assert.equal(await page.locator(".context-preview pre").count(), 0);
    await navigate(page, "quest-guide");await ensureCompanionTools(page,"quest-details");
    await page
      .getByRole("button", { name: "Refresh reference", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".knowledge-status")
        ?.textContent.includes("unavailable"),
    );
    await page
      .getByLabel("Automatic reference updates", { exact: true })
      .check();
    await page.waitForFunction(
      async () => (await window.backstage.knowledgeStatus()).automatic === true,
    );
    await page
      .getByLabel("Automatic reference updates", { exact: true })
      .uncheck();
    await page.waitForFunction(
      async () =>
        (await window.backstage.knowledgeStatus()).automatic === false,
    );
    await app.evaluate(() => {
      globalThis.knowledgeBlockTransfer = true;
    });
    await page
      .getByRole("button", { name: "Refresh reference", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Cancel refresh", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Cancel refresh", exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector('[data-knowledge-action="cancel"]'),
    );
    assert.equal(
      await page
        .getByLabel("Automatic reference updates", { exact: true })
        .isChecked(),
      false,
    );
    await page
      .getByLabel("Active character", { exact: true })
      .selectOption(alliance);
    characters[0].captureVersion = "0.5.0";
    characters[0].updatedAt = Date.now() / 1000 + 1;
    await write();
    await page.evaluate(() => window.backstage.refreshGame());
    await page.locator('.quest-ledger-row[data-quest-id="1061"]').click();
    await page.waitForFunction(() =>
      document.querySelector(".quest-waypoint")?.textContent.includes("reload"),
    );
    assert.doesNotMatch(await page.locator(".quest-waypoint").innerText(), /second \/reload|then \/reload to load it/i, "Old saved capture must not demand repeated reloads or claim the current Compass is broken");
    assert.match(await page.locator(".quest-waypoint").innerText(), /snapshot was saved/i);
    assert.match(await page.locator(".quest-waypoint").innerText(), /current Compass may already work/i);
    assert.equal(
      await page
        .getByRole("button", { name: "Copy game waypoint", exact: true })
        .isDisabled(),
      true,
    );
    characters[0].clientBuild = "1.60.1.99999";
    characters[0].captureVersion = "0.6.0";
    characters[0].updatedAt++;
    await write();
    await page.evaluate(() => window.backstage.refreshGame());
    await search.fill("");
    await page.locator('.quest-ledger-row[data-quest-id="1061"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector(".quest-detail")
        ?.textContent.includes("No matching reference"),
    );
    assert.equal(
      await page.locator(".quest-ledger-row").count(),
      characters[0].quests.length,
    );
    await capture("quest-guide-build-mismatch.png");
    characters[0].clientBuild = "1.60.1.70862";
    characters[0].quests[0].title = "Current hotfix title";
    characters[0].updatedAt++;
    await write();
    await page.evaluate(() => window.backstage.refreshGame());
    await page.reload();
    await navigate(page, "quest-guide");await ensureCompanionTools(page,"quest-details");
    await search.fill("The Spirits of Stonetalon");
    await page.locator('.quest-ledger-row[data-quest-id="1061"]').waitFor();
    assert.match(
      await page.locator('.quest-ledger-row[data-quest-id="1061"]').innerText(),
      /Current hotfix title.*Current title differs/s,
      "Reference aliases keep the current game title and conflict status",
    );
    const waitHeld = (name) =>
      app.evaluate(async (_, key) => {
        const end = Date.now() + 5000;
        while (!globalThis[key]) {
          if (Date.now() > end)
            throw Error("Fixture request was not held: " + key);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }, name);
    await app.evaluate(({ ipcMain }) => {
      const search = ipcMain._invokeHandlers.get("backstage:searchQuests");
      ipcMain.removeHandler("backstage:searchQuests");
      ipcMain.handle("backstage:searchQuests", async (...args) => {
        const result = await search(...args);
        if (args[1] === "Hidden Enemies" && !globalThis.knowledgeSearchHeld) {
          await new Promise((resolve) => {
            globalThis.knowledgeSearchHeld = resolve;
          });
          for (const row of result) row.title = "STALE SEARCH MUST NOT APPEAR";
        }
        return result;
      });
    });
    await search.fill("Hidden Enemies");
    await waitHeld("knowledgeSearchHeld");
    await page
      .getByLabel("Active character", { exact: true })
      .selectOption(horde);
    await page.locator('.quest-ledger-row[data-quest-id="5730"]').waitFor();
    await app.evaluate(() => globalThis.knowledgeSearchHeld());
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.ok(
      !(await page.locator(".quest-results").innerText()).includes(
        "STALE SEARCH",
      ),
      "Late search cannot cross a character switch",
    );
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("backstage:contextPreview");
      ipcMain.removeHandler("backstage:contextPreview");
      ipcMain.handle("backstage:contextPreview", async (...args) => {
        const result = await original(...args);
        if (args[3] === "SLOW CONTEXT") {
          await new Promise((resolve) => {
            globalThis.knowledgeContextHeld = resolve;
          });
          result.name = "STALE CONTEXT MUST NOT APPEAR";
        }
        return result;
      });
    });
    await navigate(page, "assistant");
    await page.getByLabel("Use my active character", { exact: true }).check();
    await page
      .getByLabel("Your question", { exact: true })
      .fill("SLOW CONTEXT");
    await waitHeld("knowledgeContextHeld");
    await page.getByLabel("Use my active character", { exact: true }).uncheck();
    await app.evaluate(() => globalThis.knowledgeContextHeld());
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await page.locator(".context-preview pre").count(),
      0,
      "Late context cannot undo the persistent opt-out",
    );
    const restored = (await page.evaluate(() => window.backstage.bootstrap()))
      .state;
    const old = restored.profiles.find((p) => p.id === horde);
    old.quests = [
      {
        id: 2000002,
        title: "Restored current quest",
        complete: false,
        objectives: [],
      },
    ];
    const backup = path.join(data, "fixture-restore.json");
    await fs.writeFile(backup, JSON.stringify(restored));
    await app.evaluate(({ ipcMain, dialog }, backupPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [backupPath],
      });
      dialog.showMessageBox = async () => ({ response: 1 });
      const details = ipcMain._invokeHandlers.get("backstage:questDetails");
      ipcMain.removeHandler("backstage:questDetails");
      ipcMain.handle("backstage:questDetails", async (...args) => {
        const result = await details(...args);
        if (args[2] === 5730 && !globalThis.knowledgeDetailsHeld) {
          await new Promise((resolve) => {
            globalThis.knowledgeDetailsHeld = resolve;
          });
          result.rewards = {
            items: [
              { itemId: 1, count: 1, name: "STALE DETAILS MUST NOT APPEAR" },
            ],
            choices: [],
          };
        }
        return result;
      });
    }, backup);
    await navigate(page, "quest-guide");await ensureCompanionTools(page,"quest-details");
    await page.locator('.quest-ledger-row[data-quest-id="5730"]').click();
    await waitHeld("knowledgeDetailsHeld");
    await navigate(page, "guide");
    await page
      .getByRole("button", { name: "Import backup", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Backup imported." })
      .waitFor();
    await navigate(page, "quest-guide");await ensureCompanionTools(page,"quest-details");
    await page.locator('.quest-ledger-row[data-quest-id="2000002"]').click();
    await page
      .getByRole("heading", { name: "Restored current quest", exact: true })
      .waitFor();
    await app.evaluate(() => globalThis.knowledgeDetailsHeld());
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.ok(
      !(await page.locator(".quest-detail").innerText()).includes(
        "STALE DETAILS",
      ),
      "A restored profile with the same ID rejects old details",
    );
    assert.equal(
      await page.getByLabel("Active character", { exact: true }).inputValue(),
      horde,
    );
    await app.evaluate(({ ipcMain }) => {
      globalThis.knowledgeBlockTransfer = false;
      const refresh = ipcMain._invokeHandlers.get("backstage:refreshKnowledge");
      ipcMain.removeHandler("backstage:refreshKnowledge");
      ipcMain.handle("backstage:refreshKnowledge", async (...args) => {
        const result = await refresh(...args);
        await new Promise((resolve) => {
          globalThis.knowledgeStatusHeld = resolve;
        });
        result.message = "STALE STATUS MUST NOT APPEAR";
        return result;
      });
    });
    await page
      .getByRole("button", { name: "Refresh reference", exact: true })
      .click();
    await waitHeld("knowledgeStatusHeld");
    await page
      .getByLabel("Active character", { exact: true })
      .selectOption(alliance);
    await page.locator('.quest-ledger-row[data-quest-id="1061"]').waitFor();
    await app.evaluate(() => globalThis.knowledgeStatusHeld());
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.ok(
      !(await page.locator(".knowledge-status").innerText()).includes(
        "STALE STATUS",
      ),
      "Late status does not cross a character switch",
    );
    // The root navigation read owns its page/profile, independently of module replies.
    await navigate(page, "guide");
    await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('backstage:knowledgeStatus');ipcMain.removeHandler('backstage:knowledgeStatus');ipcMain.handle('backstage:knowledgeStatus',async(...args)=>{const result=await original(...args);if(globalThis.atlasHoldNavStatus){await new Promise(r=>globalThis.atlasNavStatusRelease=r);result.message='STALE NAV STATUS MUST NOT APPEAR';}return result;});globalThis.atlasHoldNavStatus=true;});
    await navigate(page, "quest-guide");await ensureCompanionTools(page,"quest-details");await waitHeld('atlasNavStatusRelease');await navigate(page, "guide");
    await app.evaluate(()=>{globalThis.atlasHoldNavStatus=false;globalThis.atlasNavStatusRelease();});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await page.evaluate(()=>page), 'guide');assert.doesNotMatch(await page.evaluate(()=>JSON.stringify(knowledgeStatus)),/STALE NAV STATUS/);
    // Two physical Guide clicks behind one real accepted save acknowledgement retain one latest navigation owner.
    await app.evaluate(({ipcMain})=>{
      const save=ipcMain._invokeHandlers.get('backstage:saveState');ipcMain.removeHandler('backstage:saveState');ipcMain.handle('backstage:saveState',async(...args)=>{const result=await save(...args);if(globalThis.atlasRepeatSaveHold)await new Promise(r=>globalThis.atlasRepeatSaveRelease=r);return result;});
      const status=ipcMain._invokeHandlers.get('backstage:knowledgeStatus');ipcMain.removeHandler('backstage:knowledgeStatus');ipcMain.handle('backstage:knowledgeStatus',async(...args)=>{const result=await status(...args);if(globalThis.atlasRepeatStatusHold){if(globalThis.atlasRepeatSkipStatus>0)globalThis.atlasRepeatSkipStatus--;else await new Promise(r=>globalThis.atlasRepeatStatusReleases.push(message=>{result.message=message;r();}));}return result;});
      globalThis.atlasRepeatSaveHold=true;globalThis.atlasRepeatStatusHold=true;globalThis.atlasRepeatSkipStatus=1;globalThis.atlasRepeatStatusReleases=[];
    });
    await page.evaluate(()=>{autosaveQueue=autosaveQueue.then(()=>persist(state));});await waitHeld('atlasRepeatSaveRelease');
    await page.getByRole("navigation",{name:"Main navigation",exact:true}).getByRole("button",{name:"Quests",exact:true}).click();await page.getByRole("navigation",{name:"Main navigation",exact:true}).getByRole("button",{name:"Quests",exact:true}).click();assert.equal(await app.evaluate(()=>atlasRepeatStatusReleases.length),0);
    await app.evaluate(()=>{globalThis.atlasRepeatSaveHold=false;globalThis.atlasRepeatSaveRelease();});await page.evaluate(()=>autosaveQueue);
    const waitRepeat=target=>app.evaluate(async(_e,target)=>{const end=Date.now()+5000;while(globalThis.atlasRepeatStatusReleases.length<target){if(Date.now()>end)throw Error('Repeated status fixture did not start');await new Promise(r=>setTimeout(r,10));}},target);
    await waitRepeat(1);assert.equal(await app.evaluate(()=>atlasRepeatStatusReleases.length),1,'Only the latest queued Guide click may dispatch status');
    await app.evaluate(()=>atlasRepeatStatusReleases[0]('NEWER QUEUED NAV STATUS'));await page.waitForFunction(()=>knowledgeStatus.message==='NEWER QUEUED NAV STATUS');
    // Dispatched reads also have distinct owners; resolve the second before the first.
    await app.evaluate(()=>globalThis.atlasRepeatStatusReleases=[]);await navigate(page, "quest-guide");await ensureCompanionTools(page,"quest-details");await waitRepeat(1);await navigate(page, "quest-guide");await ensureCompanionTools(page,"quest-details");await waitRepeat(2);
    await app.evaluate(()=>atlasRepeatStatusReleases[1]('NEWER DISPATCHED NAV STATUS'));await page.waitForFunction(()=>knowledgeStatus.message==='NEWER DISPATCHED NAV STATUS');await app.evaluate(()=>atlasRepeatStatusReleases[0]('OLDER DISPATCHED NAV STATUS'));
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await page.evaluate(()=>knowledgeStatus.message),'NEWER DISPATCHED NAV STATUS');await app.evaluate(()=>globalThis.atlasRepeatStatusHold=false);
    console.log('PASS: two physical Guide clicks behind one held save dispatch only latest; separate read replies NEWER-before-OLDER keep NEWER.');
    const manual=await page.evaluate(async()=>{const s=(await backstage.bootstrap()).state;const p={id:'Fictional-manual-journal',name:'Elowen',className:'Druid',level:12,faction:'',realm:'Fictional Realm',notes:'',goals:[]};s.profiles.push(p);s.activeProfileId=p.id;s.followGameCharacter=false;state=await backstage.saveState(s);knowledgeStatus=await backstage.knowledgeStatus();render();return p.id;});
    await navigate(page, "quest-guide");await ensureCompanionTools(page,"quest-details");await page.locator('.quest-detail-empty').waitFor();await capture('quest-guide-neutral-manual.png');
    assert.equal(await app.evaluate(() => globalThis.knowledgeInference), 0);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await navigate(page, "guide");
    await page
      .getByRole("button", { name: "Delete all local data", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "A companion for the road ahead.", exact: true })
      .waitFor();
    assert.equal(await page.locator(".quest-detail").count(), 0);
    assert.equal(
      await page.evaluate(
        () =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith("bf-knowledge"),
          ).length,
      ),
      0,
    );
    console.log(
      "PASS: local exact-ID Quest Guide, source-aware actual/reference waypoints, shared public preview, missing/build/capture recovery, offline/cancel/opt-out/reset and compact faction fixtures; no inference or system clipboard access.",
    );
  } catch (error) {
    console.error("Knowledge fixture failed:", error.message);
    if (page)
      await page
        .screenshot({ path: path.join(repo, "work/knowledge-failure.png") })
        .catch(() => {});
    throw error;
  } finally {
    if (app)
      await app
        .evaluate(() => {
          globalThis.atlasRepeatSaveRelease?.();
          globalThis.atlasFocusSaveRelease?.();
          globalThis.atlasCompletionReleases?.splice(0).forEach(release => release());
          globalThis.atlasRepeatStatusReleases?.forEach(release=>release("Fixture cleanup"));
          globalThis.atlasNavStatusRelease?.();
          globalThis.atlasCopyRelease?.();
          globalThis.knowledgeSearchHeld?.();
          globalThis.knowledgeContextHeld?.();
          globalThis.knowledgeDetailsHeld?.();
          globalThis.knowledgeStatusHeld?.();
          globalThis.knowledgeDeferredPreviewRelease?.();
        })
        .catch(() => {});
    clearTimeout(watchdog);
    if (app) await app.close();
    const target = await fs.realpath(normalData);
    assert.equal(path.dirname(target), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("bf-knowledge-"));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
