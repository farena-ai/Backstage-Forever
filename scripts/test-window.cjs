async function testWindow(app) {
  const page = await app.firstWindow();
  // CI workers may occlude native windows; keep the test renderer actively painting.
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setBackgroundThrottling(false);
      window.show();
    }
  });
  page.setDefaultTimeout(45000);
  await page.waitForLoadState("domcontentloaded");
  return page;
}
module.exports = { testWindow };
