const { navigate } = require("./player-navigation.cjs");
const { _electron: electron } = require("playwright");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { testWindow } = require("./test-window.cjs");
const { assertSelectContrast } = require("./select-contrast.cjs");

function shortPath(target) {
  const script = `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public static class BfSmokeShortPath { [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern uint GetShortPathName(string path, StringBuilder result, uint length); }'; $buffer = New-Object System.Text.StringBuilder 4096; $length = [BfSmokeShortPath]::GetShortPathName($env:BF_SMOKE_ALIAS_PATH,$buffer,4096); if ($length -eq 0 -or $length -ge 4096) { throw 'Short path unavailable' }; $buffer.ToString()`;
  const alias = require("node:child_process").execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, BF_SMOKE_ALIAS_PATH: target }, encoding: "utf8", timeout: 15000 }).trim();
  assert.notEqual(alias.toLowerCase(), target.toLowerCase());
  assert.match(alias, /~\d/);
  assert.equal(require("node:fs").statSync(alias).ino, require("node:fs").statSync(target).ino);
  return alias;
}

(async () => {
  const normalData = await mkdtemp(path.join(tmpdir(), "backstage-smoke-"));
  let data = normalData;
  let app;
  const launch = async () => {
    app = await electron.launch({
      args: [path.join(__dirname, "..")],
      env: { ...process.env, BF_USER_DATA: data },
    });
    const page = await testWindow(app);
    page.on("pageerror", (error) =>
      console.error("Renderer error:", error.message),
    );
    await page.waitForLoadState("domcontentloaded");
    return page;
  };
  try {
    if (process.argv.includes("--short-path")) data = shortPath(normalData);
    let page = await launch();
    await page
      .getByRole("button", { name: "Use a manual character", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Every adventure starts somewhere." })
      .waitFor();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("backstage:listModels");
      ipcMain.handle("backstage:listModels", async () => ({
        models: [
          { id: "fixture-model-one", label: "Fixture model one" },
          { id: "fixture-model-two", label: "Fixture model two" },
        ],
        source: "Synthetic UI fixture",
        checkedAt: new Date().toISOString(),
        message: "Catalog fixture; no entitlement claim.",
      }));
    });
    await page.getByLabel("Character name").fill("Smoke Ranger");
    await assertSelectContrast(page, "onboarding class/faction");
    const characterClass = page.locator("select[name=className]");
    await characterClass.focus();
    await characterClass.press("Home");
    const firstClass = await characterClass.inputValue();
    await characterClass.press("ArrowDown");
    assert.notEqual(await characterClass.inputValue(), firstClass, "Native select must support keyboard selection");
    assert.ok(await page.evaluate(() => {
      const matches = document.querySelectorAll('#onboard select[name="className"]');
      if (matches.length !== 1 || !matches[0].isConnected) throw Error("Expected one current onboarding class control");
      const node = matches[0];
      const style = getComputedStyle(node);
      return node.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
    }), "Keyboard selection must retain a visible focus ring");
    await characterClass.selectOption("Hunter");
    await page.getByLabel("Realm").fill("Test Realm");
    await page.locator("select[name=faction]").selectOption("Alliance");
    await page.getByRole("button", { name: "Begin my adventure" }).click();
    await page
      .getByRole("heading", { name: "Smoke Ranger", exact: true })
      .waitFor();
    await navigate(page, "adventure");
    assert.equal(
      await page.locator("body").getAttribute("data-faction"),
      "alliance",
    );
    assert.equal(
      await page.locator("body").getAttribute("data-class"),
      "hunter",
    );
    await assertSelectContrast(page, "adventure character/session/focus");
    // Cover grouped/disabled native menu rows without adding fake product UI.
    await page.locator("#active-character").evaluate(select => {
      const group = document.createElement("optgroup");
      group.label = "Synthetic group";
      group.innerHTML = '<option value="contrast-only">Synthetic character</option><option value="contrast-disabled" disabled>Unavailable synthetic character</option>';
      group.dataset.contrastFixture = "";
      select.append(group);
      const disabledGroup = group.cloneNode(true);
      disabledGroup.label = "Synthetic disabled group";
      disabledGroup.disabled = true;
      select.append(disabledGroup);
    });
    await assertSelectContrast(page, "grouped disabled menu rows");
    await page.locator("[data-contrast-fixture]").evaluateAll(nodes => nodes.forEach(node => node.remove()));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    await page.waitForFunction(() => innerWidth <= 1000);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Select styling must not introduce horizontal scrolling");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
    await page.getByLabel("New goal").fill("Prepare for a dungeon");
    await page.getByRole("button", { name: "Add goal" }).click();
    await page.getByRole("checkbox", { name: "Prepare for a dungeon" }).check();
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Prepare for a dungeon" })
        .isChecked(),
      true,
    );
    await page.getByLabel("New goal").fill("   ");
    await page.getByRole("button", { name: "Add goal" }).click();
    await page.getByLabel("New goal").fill("A second valid goal");
    await page.getByRole("button", { name: "Add goal" }).click();
    await page.getByRole("checkbox", { name: "A second valid goal" }).waitFor();
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    await page
      .getByLabel("Private notes")
      .fill("<img src=x onerror=alert(1)> My private journal");
    await page.getByRole("button", { name: "Save character" }).click();
    await navigate(page, "assistant");
    assert.equal(
      await page.getByLabel("Use my active character").isChecked(),
      true,
    );
    await page.getByLabel("Use my active character").uncheck();
    await navigate(page, "game");
    await page
      .getByRole("heading", { name: "Bring your adventure home." })
      .waitFor();
    await page
      .getByText(
        "Live guidance runs inside WoW. The desktop journal catches up after the game saves on logout.",
        { exact: true },
      )
      .waitFor();
    await page.getByText("Connection checks and tools", { exact: true }).click();
    await page
      .getByRole("button", { name: "Choose game folder", exact: true })
      .waitFor();
    await navigate(page, "connections");
    await page
      .getByRole("heading", { name: "Choose your intelligence." })
      .waitFor();
    await page.getByRole("button", { name: "OpenAI API", exact: true }).click();
    await page.getByLabel("Access method").selectOption("subscription");
    await page
      .getByRole("button", { name: "Continue with ChatGPT", exact: true })
      .waitFor();
    assert.equal(await page.getByLabel("API key", { exact: true }).count(), 0);
    await page.getByLabel("Access method").selectOption("api");
    await assertSelectContrast(page, "connection access/model");
    await page.getByLabel("API key", { exact: true }).waitFor();
    await page.getByLabel("Available models").waitFor();
    await page
      .getByRole("button", { name: "Refresh models", exact: true })
      .waitFor();
    await page
      .getByRole("option", { name: "Fixture model one", exact: true })
      .waitFor({ state: "attached" });
    assert.equal(await page.getByLabel("Available models").inputValue(), "");
    await page.getByLabel("Available models").selectOption("fixture-model-two");
    await page
      .getByRole("button", { name: "Refresh models", exact: true })
      .click();
    await page
      .getByText("Catalog fixture; no entitlement claim.", { exact: false })
      .waitFor();
    assert.equal(
      await page.getByLabel("Available models").inputValue(),
      "fixture-model-two",
    );
    await assertSelectContrast(page, "chosen model");
    await page
      .getByRole("button", { name: "Ollama Cloud", exact: true })
      .click();
    assert.equal(await page.getByLabel("Access method").count(), 0);
    await page.getByLabel("API key", { exact: true }).waitFor();
    await page.getByRole("button", { name: "OpenAI API", exact: true }).click();
    await page
      .getByText("A ChatGPT subscription is not an API key.", { exact: false })
      .waitFor();
    await navigate(page, "guide");
    await page
      .getByRole("heading", { name: "A little guidance. A longer adventure." })
      .waitFor();
    await navigate(page, "updates");
    await page
      .getByRole("heading", { name: "Keep your companion ready." })
      .waitFor();
    await page
      .getByRole("checkbox", {
        name: "Automatically check and download updates",
      })
      .uncheck();
    await page
      .getByText("Automatic update checks are off.", { exact: false })
      .waitFor();
    await app.close();
    app = null;
    page = await launch();
    await page
      .getByRole("heading", { name: "Smoke Ranger", exact: true })
      .waitFor();
    await navigate(page, "updates");
    assert.equal(
      await page
        .getByRole("checkbox", {
          name: "Automatically check and download updates",
        })
        .isChecked(),
      false,
    );
    await navigate(page, "assistant");
    assert.equal(
      await page.getByLabel("Use my active character").isChecked(),
      false,
    );
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Prepare for a dungeon" })
        .isChecked(),
      true,
    );
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    assert.match(
      await page.getByLabel("Private notes").inputValue(),
      /<img src=x/,
    );
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    await page
      .getByLabel("Private notes")
      .fill("Unsaved draft must survive a snapshot refresh");
    // Capture the existing main-owned Store for synthetic observation injection.
    // Renderer saveState deliberately cannot manufacture addon evidence.
    await app.evaluate(({ app }) => {
      const load = process.getBuiltinModule("node:module").createRequire(
        process.getBuiltinModule("node:path").join(app.getAppPath(), "package.json"),
      );
      const { Store } = load("./src/core/store.cjs");
      const original = Store.prototype.saveState;
      globalThis.smokeRestoreStore = () => { Store.prototype.saveState = original; };
      Store.prototype.saveState = function (next) {
        globalThis.smokeStore = this;
        Store.prototype.saveState = original;
        return original.call(this, next);
      };
    });
    try {
      await page.evaluate(async () => {
        const { state } = await window.backstage.bootstrap();
        await window.backstage.saveState(state, state);
      });
    } finally {
      await app.evaluate(() => { smokeRestoreStore(); delete globalThis.smokeRestoreStore; });
    }
    await app.evaluate(() => {
      const state = structuredClone(smokeStore.state);
      const character = state.profiles.find(
        (p) => p.id === state.activeProfileId,
      );
      Object.assign(character, {
        className: "Mage",
        level: 22,
        faction: "Horde",
        race: "Synthetic race",
        location: { zone: "Synthetic Highlands", subZone: "Fixture Camp" },
        source: {
          kind: "wow-addon",
          id: "synthetic-ui-fixture",
          updatedAt: new Date().toISOString(),
        },
      });
      state.profiles.push({
        ...structuredClone(character),
        id: "fixture-alt",
        name: "Snapshot Alt",
        notes: "Alt journal must stay separate",
        goals: [],
        source: { ...character.source, id: "synthetic-ui-alt" },
      });
      state.activeProfileId = "fixture-alt";
      smokeStore.saveState(state);
      delete globalThis.smokeStore;
    });
    await page.waitForTimeout(5300);
    assert.equal(
      await page.getByLabel("Private notes").inputValue(),
      "Unsaved draft must survive a snapshot refresh",
    );
    assert.equal(
      await page.getByLabel("Character name").inputValue(),
      "Smoke Ranger",
    );
    await page
      .getByRole("button", { name: "Save character", exact: true })
      .click();
    const merged = await page.evaluate(
      async () => (await window.backstage.bootstrap()).state,
    );
    assert.equal(
      merged.profiles.find((p) => p.name === "Smoke Ranger").notes,
      "Unsaved draft must survive a snapshot refresh",
    );
    assert.equal(
      merged.profiles.find((p) => p.name === "Snapshot Alt").notes,
      "Alt journal must stay separate",
    );
    assert.equal(
      merged.profiles.find((p) => p.name === "Smoke Ranger").level,
      22,
    );
    assert.equal(merged.activeProfileId, "fixture-alt");
    assert.equal(merged.followGameCharacter, undefined);
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    assert.equal(await page.locator("body").getAttribute("data-class"), "mage");
    assert.equal(
      await page.locator("body").getAttribute("data-faction"),
      "horde",
    );
    await page.getByRole("button", { name: /Synthetic Highlands/ }).waitFor();
    await navigate(page, "assistant");
    await page
      .getByText("Public character context:", { exact: false })
      .waitFor();
    assert.match(
      await page.locator(".context-preview").innerText(),
      /Synthetic Highlands/,
    );
    assert.doesNotMatch(
      await page.locator(".context-preview").innerText(),
      /private journal|Unsaved draft/,
    );
    await page.getByRole("button", { name: "Characters", exact: true }).click();
    assert.equal(
      await page.getByLabel("Character name").getAttribute("readonly"),
      "",
    );
    assert.equal(await page.locator("select[name=className]").isDisabled(), true);
    assert.equal(await page.locator("select[name=faction]").isDisabled(), true);
    await assertSelectContrast(page, "imported disabled character fields");
    await page.getByRole("button", { name: "Adventure", exact: true }).click();
    await page.screenshot({
      path: path.join(__dirname, "..", "work", "desktop-preview.png"),
    });
    console.log(
      "PASS: onboarding, profile, goal, private notes, character context default/opt-out, catalog choice preservation, faction/class theming, snapshot draft preservation, read-only imported fields, provider navigation, guide, restart persistence, safe text rendering; native select/option/group contrast under light/dark preference, selected/disabled rows, keyboard/focus and compact layout.",
    );
  } catch (error) {
    if (app) {
      const page = await app.firstWindow();
      console.error(await page.locator("body").innerText());
      await page.screenshot({
        path: path.join(__dirname, "..", "work", "smoke-failure.png"),
      });
    }
    throw error;
  } finally {
    if (app) await app.close();
    await rm(normalData, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
