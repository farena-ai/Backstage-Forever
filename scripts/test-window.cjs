async function testWindow(app) {
  const page = await app.firstWindow();
  // CI workers may occlude native windows; keep the test renderer actively painting.
  // On a multi-monitor desktop, test windows open on a non-primary display so they never cover
  // a game running on the main screen (BF_TEST_PRIMARY=1 keeps them on the primary display).
  await app.evaluate(({ BrowserWindow, screen, app: electronApp }, keepPrimary) => {
    const primary = screen.getPrimaryDisplay();
    const other = keepPrimary ? null : screen.getAllDisplays().find((d) => d.id !== primary.id);
    const place = (w) => {
      if (!other || !w || w.isDestroyed()) return;
      const a = other.workArea, [ww, wh] = w.getSize();
      w.setPosition(a.x + Math.max(0, Math.floor((a.width - Math.min(ww, a.width)) / 2)), a.y + Math.max(0, Math.floor((a.height - Math.min(wh, a.height)) / 2)));
    };
    for (const window of BrowserWindow.getAllWindows()) {
      place(window);
      window.webContents.setBackgroundThrottling(false);
      // Never steal keyboard focus from the player (keys typed in the game must not land here); checks drive input directly.
      window.showInactive();
    }
    if (other && !globalThis.__bfTestPlacement) {
      globalThis.__bfTestPlacement = true;
      electronApp.on("browser-window-created", (_event, w) => { place(w); w.once("ready-to-show", () => place(w)); w.on("resize", () => { const b = w.getBounds(), a = other.bounds; if (b.x < a.x || b.y < a.y || b.x > a.x + a.width || b.y > a.y + a.height) place(w); }); });
      for (const window of BrowserWindow.getAllWindows()) window.on("resize", () => { const b = window.getBounds(), a = other.bounds; if (b.x < a.x || b.y < a.y || b.x > a.x + a.width || b.y > a.y + a.height) place(window); });
    }
  }, process.env.BF_TEST_PRIMARY === "1");
  page.setDefaultTimeout(45000);
  await page.waitForLoadState("domcontentloaded");
  return page;
}
// Electron occasionally fails to start on a busy Windows desktop ("Process failed to launch!").
// One retry after a short pause; any other failure, or a second failure, is reported as is.
async function launch(electron, options) {
  try { return await electron.launch(options); }
  catch (error) {
    if (!/Process failed to launch/i.test(String(error?.message))) throw error;
    console.warn("Electron failed to launch; retrying once.");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return electron.launch(options);
  }
}
module.exports = { testWindow, launch };
