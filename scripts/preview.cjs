const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "backstage-art-"));
  let app;
  try {
    app = await electron.launch({
      args: [path.join(__dirname, "..")],
      env: { ...process.env, BF_USER_DATA: data },
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page
      .getByRole("heading", { name: "Every adventure starts somewhere." })
      .waitFor();
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "onboarding-preview.png"),
    });
    const initial = await page.evaluate(() => window.backstage.bootstrap());
    const demo = {
      ...initial.state,
      onboarded: true,
      activeProfileId: "demo",
      profiles: [
        {
          id: "demo",
          name: "Aeralyn",
          realm: "Demo realm · manual profile",
          className: "Hunter",
          level: 18,
          notes:
            "Sample journal for a product screenshot. No real player data.",
          goals: [
            {
              id: "one",
              text: "Pack supplies for the next dungeon",
              done: true,
            },
            {
              id: "two",
              text: "Spend an evening exploring with friends",
              done: false,
            },
            { id: "three", text: "Choose a profession to learn", done: false },
          ],
        },
      ],
    };
    await page.evaluate((state) => window.backstage.saveState(state), demo);
    await page.reload();
    await page.getByRole("heading", { name: "Aeralyn", exact: true }).waitFor();
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "desktop-preview.png"),
    });
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await page.getByRole("button", { name: "OpenAI API", exact: true }).click();
    await page.getByLabel("Access method").selectOption("subscription");
    await page.screenshot({
      path: path.join(__dirname, "..", "assets", "connections-preview.png"),
    });
    console.log(
      "Captured original interface previews using a clearly labeled synthetic demo profile.",
    );
  } finally {
    if (app) await app.close();
    await fs.rm(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
