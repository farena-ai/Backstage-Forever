"use strict";
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { _electron: electron } = require("playwright");
const { testWindow } = require("./test-window.cjs");
(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "bf-knowledge-"));
  const repo = path.join(__dirname, "..");
  let app, page;
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
              text: "Saved game destination",
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
      /Saved game destination|Game destination/,
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
    await page.locator('.quest-ledger-row[data-quest-id="5728"]').click();
    await page.locator('.quest-detail h2').waitFor();
    const reported = await page.evaluate(async () => {
      const id = (await window.backstage.bootstrap()).state.activeProfileId;
      return (await window.backstage.questDetails(id,5728)).chain;
    });
    const shownEdges = await page.locator('[data-chain-from]').evaluateAll(nodes => nodes.map(n=>[Number(n.dataset.chainFrom),Number(n.dataset.chainTo)]));
    assert.deepEqual(shownEdges.sort((a,b)=>a[0]-b[0]), reported.filter(n=>n.nextQuestId).map(n=>[n.id,n.nextQuestId]).sort((a,b)=>a[0]-b[0]), "Every visible arrow must describe an actual reported edge, never array adjacency");
    const neighbor = page.locator('[data-chain-node="5729"]');
    assert.match(await neighbor.innerText(), /Current game hotfix title/);
    assert.match(await neighbor.innerText(), /Reference conflict.*Hidden Enemies/s);
    await fs.mkdir(path.join(repo,"work/v06-ui-evidence"),{recursive:true});
    await page.evaluate(()=>{ document.getElementById("toast").className = ""; });
    await page.locator('.quest-chain').screenshot({path:path.join(repo,"work/v06-ui-evidence/quest-chain-directed.png")});
    await search.fill("5730");
    await page.locator('.quest-ledger-row[data-quest-id="5730"]').click();
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
      await search.evaluate((node) => node === document.activeElement),
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
    const screens = path.join(repo, "work/v06-ui-evidence");
    await fs.mkdir(screens, { recursive: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const capture = async (name) => {
      await page.evaluate(() => {
        document.querySelector(".breadcrumb").textContent =
          "Fictional preview · invented player state";
        scrollTo(0, 0);
        document.getElementById("toast").className = "";
      });
      await page.screenshot({ path: path.join(screens, name) });
    };
    await capture("quest-guide-alliance.png");
    await page
      .getByLabel("Active character", { exact: true })
      .selectOption(horde);
    await page.locator('.quest-ledger-row[data-quest-id="5730"]').click();
    await page.locator(".quest-detail h2").waitFor();
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
        .getByRole("button", { name: "Copy game waypoint", exact: true })
        .evaluate((node) => node.getBoundingClientRect().bottom <= innerHeight),
      "The first waypoint action fits the compact first screen",
    );
    await page
      .getByRole("button", { name: "AI Companion", exact: true })
      .click();
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
    await page
      .getByRole("button", { name: "Quest Guide", exact: true })
      .click();
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
    characters[0].clientBuild = "1.60.1.70862";
    characters[0].quests[0].title = "Current hotfix title";
    characters[0].updatedAt++;
    await write();
    await page.evaluate(() => window.backstage.refreshGame());
    await page.reload();
    await page
      .getByRole("button", { name: "Quest Guide", exact: true })
      .click();
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
    await page
      .getByRole("button", { name: "AI Companion", exact: true })
      .click();
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
    await page
      .getByRole("button", { name: "Quest Guide", exact: true })
      .click();
    await page.locator('.quest-ledger-row[data-quest-id="5730"]').click();
    await waitHeld("knowledgeDetailsHeld");
    await page
      .getByRole("button", { name: "Field Guide", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Import backup", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Backup imported." })
      .waitFor();
    await page
      .getByRole("button", { name: "Quest Guide", exact: true })
      .click();
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
    assert.equal(await app.evaluate(() => globalThis.knowledgeInference), 0);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await page
      .getByRole("button", { name: "Field Guide", exact: true })
      .click();
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
          globalThis.knowledgeSearchHeld?.();
          globalThis.knowledgeContextHeld?.();
          globalThis.knowledgeDetailsHeld?.();
          globalThis.knowledgeStatusHeld?.();
          globalThis.knowledgeDeferredPreviewRelease?.();
        })
        .catch(() => {});
    if (app) await app.close();
    const target = path.resolve(data);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("bf-knowledge-"));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
