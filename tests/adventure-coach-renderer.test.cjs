"use strict";
const test = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { buildAdventureCoach } = require("../src/core/adventure-coach.cjs"),
  fixture = require("./fixtures/adventure-coach-cap.cjs");

test("mounted Adventure primary and alternatives visibly qualify only their capped profession in every mode", { timeout: 45000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-coach-cap-dom-")),
    html = path.join(dir, "coach.html"), env = { ...process.env };
  fs.writeFileSync(html, '<!doctype html><div id="root"></div>');
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await require("playwright")._electron.launch({
    args: [path.join(__dirname, "fixtures/adventure-map-dom.cjs"), dir, html], env,
  });
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  await page.waitForSelector("#root", { state: "attached" });
  for (const name of ["interaction", "adventure-coach"])
    await page.addScriptTag({ path: path.join(__dirname, "../src/renderer", name + ".js") });
  await page.evaluate(() => {
    window.CommandCenter = { savedTime: value => value };
    window.coachRequests = [];
    AdventureCoach.init({
      root: document.querySelector("#root"), active: () => true,
      profile: () => window.coachProfile,
      esc: value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
      api: { adventureCoach: (id, options) => {
        coachRequests.push({ id, options });
        return Promise.resolve(window.coachModel);
      } },
    });
  });
  for (const mode of fixture.modes) {
    for (const options of [{}, { rank: 74 }, { mixed: true }]) {
      const profile = fixture.profile(options), model = buildAdventureCoach(profile, { mode });
      assert.deepEqual([model.recommendation, ...model.alternatives].map(row => row.kind), Array(3).fill("craft-ready"));
      await page.evaluate(({ profile, model, mode }) => {
        AdventureCoach.clear();
        window.coachProfile = profile;
        window.coachModel = model;
        localStorage.setItem("bf-coach-mode:" + profile.id, mode);
        document.querySelector("#root").innerHTML = AdventureCoach.render();
        AdventureCoach.sync();
      }, { profile, model, mode });
      await page.locator("[data-coach-primary]").waitFor();
      const cards = page.locator("[data-coach-primary], .coach-alternatives > div");
      assert.equal(await cards.count(), 3);
      for (let i = 0; i < 3; i++) {
        const card = cards.nth(i), reason = card.locator(i ? "p" : ".coach-reason");
        assert.ok(await card.isVisible());
        assert.ok(await reason.isVisible());
        const capped = options.rank !== 74 && !(options.mixed && i === 1);
        if (capped) assert.match(await reason.innerText(), /Check training before expecting rank progress\./, `${mode}: card ${i}`);
        else assert.doesNotMatch(await card.innerText(), /Check training before expecting rank progress/);
      }
      assert.match(await page.locator(".coach-detail").innerText(), /not guaranteed/);
      assert.deepEqual(await page.evaluate(() => coachRequests.at(-1)), { id: profile.id, options: { mode } });
    }
  }
});
