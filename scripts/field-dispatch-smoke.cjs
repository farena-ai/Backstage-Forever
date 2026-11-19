"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron } = require("playwright");
const { launch, testWindow } = require("./test-window.cjs");

const change = (id, title, summary, extra = {}) => ({ id, title, summary, ...extra });
const model = {
  status: "updated", fromVersion: "1.9.0", toVersion: "1.11.0",
  rangeVersions: ["1.10.0", "1.11.0"], historyIncomplete: true,
  releases: [
    { version: "1.11.0", sections: [
      { kind: "compatibility", entries: [change("prep", "Private preparation stays on desktop", "The in-game overlay does not use private preparation.", { platforms: ["desktop", "addon"], highlight: true, actionId: "preparation" })] },
      { kind: "fixed", entries: [change("correction", "Corrected map note", "A later correction remains a separate change.", { actionId: "https://invalid.example/" })] },
    ] },
    { version: "1.10.0", sections: [{ kind: "new", entries: [change("map", "Map note", "A note about a map.")] }] },
    { version: "1.9.0", sections: [{ kind: "improved", entries: [change("older", "Older notes", "<img src=x onerror=alert(1)> **literal text**", { platforms: ["macos"] })] }] },
  ],
};

async function main() {
  const scratch = process.env.BF_DISPATCH_SCRATCH || process.env.TMPDIR || os.tmpdir();
  const profile = fs.mkdtempSync(path.join(scratch, "bf-dispatch-"));
  let app;
  try {
    const mainFile = path.join(profile, "main.cjs");
    fs.writeFileSync(mainFile, `const {app, BrowserWindow} = require('electron');
      app.setPath('userData', ${JSON.stringify(profile)});
      app.whenReady().then(() => {
        const win = new BrowserWindow({ width: 1240, height: 860, minWidth: 1000, minHeight: 700, show: false, webPreferences: { sandbox: true } });
        win.loadFile(${JSON.stringify(path.join(__dirname, "fixtures", "field-dispatch.html"))});
      });`);
    app = await launch(_electron, { args: [mainFile] });
    const page = await testWindow(app);
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const screenshotDir = process.env.BF_DISPATCH_SCREENSHOTS;
    const capture = async (name) => {
      if (!screenshotDir) return;
      fs.mkdirSync(screenshotDir, { recursive: true });
      const session = await page.context().newCDPSession(page);
      try {
        const { data } = await session.send("Page.captureScreenshot", { captureBeyondViewport: false });
        fs.writeFileSync(path.join(screenshotDir, `${name}.png`), Buffer.from(data, "base64"));
      } finally { await session.detach(); }
    };
    assert.equal(await page.evaluate(() => typeof window.FieldDispatch?.create), "function", `Field Dispatch renderer is available at ${page.url()}`);
    const dialog = page.getByRole("dialog");
    const opener = page.getByRole("button", { name: "What’s New" });
    await page.evaluate((model) => {
      window.calls = [];
      window.dispatchView = FieldDispatch.create({
        host: document.querySelector("main"),
        actions: { preparation: { label: "Open Preparation", run: () => calls.push("preparation") } },
        onDismiss: (reason) => calls.push(reason),
      });
      window.openRecap = (locale, data = model) => dispatchView.openRecap(data, document.activeElement, locale);
      document.querySelector("button").onclick = (event) => dispatchView.openHistory(model, event.currentTarget);
    }, model);
    await opener.focus();
    await page.evaluate(() => window.openRecap());
    await dialog.getByRole("heading", { name: "Updated from 1.9.0 to 1.11.0" }).waitFor();
    assert.equal(await page.locator(":focus").textContent(), "Updated from 1.9.0 to 1.11.0");
    assert.equal(await dialog.getByText("Older notes", { exact: true }).count(), 0);
    assert.equal(await dialog.getByText("Corrected map note", { exact: true }).count(), 1);
    assert.equal(await dialog.getByRole("link").count(), 0);
    assert.equal(await dialog.getByRole("button").count(), 4);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.locator(":focus").textContent(), "Got it");
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").textContent(), "Open Preparation");
    await capture("dispatch-recap");
    await dialog.getByRole("button", { name: "Open Preparation" }).click();
    assert.deepEqual(await page.evaluate(() => calls), ["preparation"]);
    assert.equal(await opener.evaluate((node) => node === document.activeElement), true);
    assert.equal(await dialog.count(), 0);

    await page.evaluate(() => window.openRecap());
    await page.keyboard.press("Escape");
    assert.equal(await opener.evaluate((node) => node === document.activeElement), true);
    assert.deepEqual(await page.evaluate(() => calls), ["preparation", "later"]);
    await page.evaluate(() => window.openRecap());
    await dialog.getByRole("button", { name: "View all changes" }).click();
    await dialog.getByRole("heading", { name: "Dispatch history" }).waitFor();
    const search = dialog.getByRole("searchbox", { name: "Search changes" });
    await search.fill("macOS");
    assert.equal(await dialog.getByText("Older notes", { exact: true }).count(), 1);
    assert.equal(await dialog.getByText("Map note", { exact: true }).count(), 0);
    assert.equal(await dialog.locator('.field-dispatch__entry img').count(), 0);
    assert.equal(await dialog.getByText("<img src=x onerror=alert(1)> **literal text**", { exact: true }).count(), 1);
    await search.fill("no matching term");
    await dialog.getByRole("status").getByText("No matching changes.").waitFor();
    await dialog.getByRole("button", { name: "Back to recap" }).click();
    await dialog.getByRole("button", { name: "Got it" }).click();
    assert.deepEqual(await page.evaluate(() => calls), ["preparation", "later", "acknowledged"]);

    await opener.press("Enter");
    await dialog.getByRole("heading", { name: "Dispatch history" }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Got it" }).count(), 0);
    await dialog.getByRole("button", { name: "Close" }).click();
    assert.deepEqual(await page.evaluate(() => calls), ["preparation", "later", "acknowledged"]);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(1000, 700);
      win.webContents.setZoomFactor(2);
    });
    await page.waitForFunction(() => innerWidth <= 500 && devicePixelRatio >= 2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    await page.evaluate(() => window.openRecap("de"));
    await dialog.getByRole("heading", { name: "Von 1.9.0 auf 1.11.0 aktualisiert" }).waitFor();
    const compact = await dialog.evaluate((node) => {
      const scroller = node.querySelector(".field-dispatch__scroll");
      const footerButtons = [...node.querySelectorAll("footer button")];
      return {
        width: innerWidth, height: innerHeight,
        inside: footerButtons.every((button) => {
          const r = button.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
        }),
        noOverflow: scroller.scrollWidth === scroller.clientWidth,
        scrolls: scroller.scrollHeight > scroller.clientHeight,
        motion: footerButtons.map((button) => getComputedStyle(button).transitionProperty),
      };
    });
    assert.ok(compact.inside && compact.noOverflow && compact.scrolls && compact.motion.every((value) => value === "none"), JSON.stringify(compact));
    await capture("dispatch-recap-compact-de");
    await dialog.getByRole("button", { name: "Alle Änderungen anzeigen" }).press("Enter");
    await dialog.getByRole("heading", { name: "Änderungsverlauf" }).waitFor();
    await dialog.getByRole("searchbox", { name: "Änderungen suchen" }).fill("1.11.0 Datenschutz");
    assert.equal(await dialog.getByText("Private preparation stays on desktop", { exact: true }).count(), 1);
    assert.equal(await dialog.getByText("Corrected map note", { exact: true }).count(), 0);
    await capture("dispatch-history-compact-de");
    await page.keyboard.press("Escape");
    await page.evaluate((data) => window.openRecap("en", data), { ...model, status: "unknown-predecessor", fromVersion: null });
    await dialog.getByRole("heading", { name: "What’s new in 1.11.0" }).waitFor();
    assert.equal(await dialog.getByText("Map note", { exact: true }).count(), 0);
    assert.equal(await dialog.getByRole("button", { name: "Got it" }).count(), 0);
    await dialog.getByRole("button", { name: "Close" }).click();
    assert.deepEqual(await page.evaluate(() => calls), ["preparation", "later", "acknowledged", "later"]);
    await page.evaluate((data) => window.openRecap("en", data), {
      ...model,
      rangeVersions: [...model.rangeVersions, "1.8.0", "1.7.0"],
      releases: [...model.releases, ...["1.8.0", "1.7.0"].map((version) => ({ ...model.releases[2], version }))],
    });
    const olderVersion = dialog.getByText("Version 1.7.0", { exact: true });
    assert.equal(await olderVersion.evaluate((heading) => heading.closest("details")?.open), false);
    await dialog.locator("summary").filter({ hasText: "Version 1.7.0" }).press("Enter");
    assert.equal(await olderVersion.evaluate((heading) => heading.closest("details")?.open), true);
    await dialog.getByRole("searchbox", { name: "Search changes" }).fill("1.8.0");
    assert.equal(await dialog.getByText("Version 1.8.0", { exact: true }).evaluate((heading) => heading.closest("details")?.open), true);
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    console.log(`Field Dispatch renderer smoke passed (compact viewport ${compact.width}×${compact.height} at 200%)`);
  } finally {
    try { await app?.close(); }
    finally { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
