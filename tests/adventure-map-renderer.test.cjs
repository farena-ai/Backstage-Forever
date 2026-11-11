const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
function fixture() {
  const events = {},
    storage = {},
    root = {
      addEventListener: (k, f) => (events[k] ??= []).push(f),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
  const c = {
    window: {},
    document: { activeElement: null, addEventListener() {} },
    localStorage: {
      getItem: (k) => storage[k] ?? null,
      setItem: (k, v) => (storage[k] = v),
      removeItem: (k) => delete storage[k],
    },
    setTimeout,
    console,
    Preparation: { options: () => ({ crafts: 2 }) },
  };
  vm.createContext(c);
  for (const [file, key] of [
    ["interaction", "InteractionGuard"],
    ["adventure-map", "AdventureMap"],
  ]) {
    const p = require("node:path").join(
      __dirname,
      "../src/renderer/" + file + ".js",
    );
    assert.ok(fs.existsSync(p), "Map renderer missing");
    vm.runInContext(fs.readFileSync(p, "utf8"), c);
    c[key] = c.window[key];
  }
  let id = "p",
    source = "one",
    active = true;
  const requests = [];
  const host = {
    root,
    esc: (v) =>
      String(v ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;"),
    portrait: () => "../../assets/class-hunter.png",
    profileId: () => id,
    sourceSignature: () => source,
    active: () => active,
    epoch: () => 0,
    api: {
      adventureMap: (...args) =>
        new Promise((resolve) => requests.push({ args, resolve })),
    },
  };
  c.AdventureMap.init(host);
  return {
    c,
    requests,
    events,
    storage,
    setId: (v) => (id = v),
    setSource: (v) => (source = v),
    setActive: (v) => (active = v),
  };
}
const model = () => ({
  character: {
    id: "p",
    name: "<script>",
    className: "Hunter",
    faction: "Alliance",
  },
  view: {
    mapId: 1411,
    label: "Saved coast",
    kind: "saved",
    maps: [{ mapId: 1411, label: "Saved coast" }],
  },
  source: {
    kind: "saved-addon",
    savedAt: "2026-11-11T12:00:00.000Z",
    build: "1.60.1.70862",
  },
  playerPosition: null,
  points: [
    {
      id: "point1",
      kind: "find",
      layer: "finds",
      title: "<img src=x>",
      mapId: 1411,
      x: 0.5027,
      y: 0.4874,
      detail: "Standing interaction",
      qualification: "own-recorded",
      precision: "recorded-standing-point",
      sources: [],
      itemIds: [],
    },
  ],
  counts: { total: 1 },
  layers: {
    quest: true,
    ore: true,
    herbs: false,
    supplies: true,
    finds: true,
    olderReferences: false,
  },
  limitations: [],
  references: {},
  gathering: { status: "available", shown: 1 },
  goal: { crafts: 2 },
});
test("actual renderer escapes source text, uses numeric SVG and visible honest legend", () => {
  const f = fixture(),
    html = f.c.AdventureMap.page(model());
  assert.match(html, /Last-saved location view/);
  assert.match(html, /full live map in WoW/i);
  assert.match(html, /502.7/);
  assert.match(html, /487.4/);
  assert.match(html, /&lt;script>/);
  assert.doesNotMatch(html, /<img src=x>|style=|[/]bf |https?:/);
  assert.match(html, /data-map-point/);
});
test("async profile and source ownership retire late geometry; goal getter is reused", async () => {
  const f = fixture();
  f.c.AdventureMap.refresh();
  assert.equal(f.requests[0].args[1].goal.crafts, 2);
  f.setSource("two");
  f.c.AdventureMap.refresh();
  f.requests[0].resolve(model());
  await new Promise((r) => setImmediate(r));
  assert.doesNotMatch(f.c.AdventureMap.page(), /data-map-point=/);
  f.requests[1].resolve(model());
  await new Promise((r) => setImmediate(r));
  assert.match(f.c.AdventureMap.page(), /data-map-point=/);
  f.setId("q");
  f.c.AdventureMap.invalidate();
  assert.doesNotMatch(f.c.AdventureMap.page(), /data-map-point=/);
});
test("bounded per-character map choices never store observations", () => {
  const f = fixture();
  f.c.AdventureMap.save("p", {
    mapId: 1411,
    layers: { ore: false, quest: 1 },
    points: [{ x: 1 }],
  });
  const options = JSON.parse(JSON.stringify(f.c.AdventureMap.options("p")));
  assert.deepEqual(options, { mapId: 1411, layers: { ore: false } });
  assert.deepEqual(JSON.parse(JSON.stringify(f.c.AdventureMap.options("q"))), {
    layers: {},
  });
  assert.doesNotMatch(JSON.stringify(f.storage), /points|quest/);
});

test("changed owner cannot briefly republish old geometry during a whole root render before refresh", async () => {
  const f = fixture();
  f.c.AdventureMap.refresh();
  f.requests[0].resolve(model());
  await new Promise((r) => setImmediate(r));
  assert.match(f.c.AdventureMap.page(), /data-map-point=/);
  f.setSource("replacement-source");
  assert.doesNotMatch(f.c.AdventureMap.page(), /data-map-point=/);
});

test("actual setup wording separates prepared files and connected format receipt", () => {
  const c = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../src/renderer/living-setup.js"), "utf8"),
    c,
  );
  const status = {
      connected: true,
      addonCurrent: true,
      loadedCaptureVersion: "0.12.3",
    },
    esc = (v) => String(v);
  assert.match(
    c.window.LivingSetup.activation(status, esc),
    /Waiting for a new-format game save/,
  );
  assert.match(
    c.window.LivingSetup.activation(
      { ...status, loadedGatheringSchema: 1 },
      esc,
    ),
    /New-format game save received/,
  );
  assert.match(
    c.window.LivingSetup.activation(
      { ...status, loadedGatheringSchema: 1 },
      esc,
    ),
    /not live map or gathering capability/,
  );
});

async function mounted(t) {
  const path = require("node:path"),
    os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-map-dom-"));
  const html = path.join(dir, "map.html");
  fs.writeFileSync(
    html,
    '<!doctype html><div id="root"><section data-adventure-map></section></div>',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await require("playwright")._electron.launch({
    args: [path.join(__dirname, "fixtures/adventure-map-dom.cjs"), dir, html],
    env,
  });
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const page = await app.firstWindow();
  await page.waitForSelector("#root", { state: "attached" });
  for (const name of ["interaction", "adventure-map"])
    await page.addScriptTag({
      path: path.join(__dirname, "../src/renderer", name + ".js"),
    });
  await page.evaluate(() => {
    window.mapClock = Date.parse("2026-11-11T12:00:00.000Z");
    Date.now = () => mapClock;
    window.Preparation = { options: () => ({ crafts: 2 }) };
    window.requests = [];
    window.source = "initial";
    window.opened = [];
    AdventureMap.init({
      root: document.querySelector("#root"),
      active: () => true,
      profileId: () => "p",
      sourceSignature: () => source,
      epoch: () => 0,
      esc: (value) =>
        String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll('"', "&quot;"),
      portrait: () => "",
      open: (route) => opened.push(route),
      api: {
        adventureMap: (...args) =>
          new Promise((resolve, reject) =>
            requests.push({ args, resolve, reject }),
          ),
      },
    });
    AdventureMap.mounted();
  });
  return {
    page,
    resolve: async (index, value) =>
      page.evaluate(
        ([i, result]) => requests[i].resolve(result),
        [index, value],
      ),
    refresh: async (source) =>
      page.evaluate((s) => {
        if (s) window.source = s;
        void AdventureMap.refresh();
      }, source),
    count: async () => page.evaluate(() => requests.length),
  };
}
const coreMap = (state, now) =>
  require("../src/core/adventure-map.cjs").buildAdventureMap(
    state,
    "p",
    {},
    { now },
  );

test(
  "mounted DOM retires source, cleared and malformed history while replacement IPC waits",
  { timeout: 45000 },
  async (t) => {
    const f = await mounted(t),
      state = require("./adventure-map-fixture.cjs").seed();
    await f.resolve(
      0,
      coreMap(state, Date.parse(state.profiles[0].source.updatedAt)),
    );
    await f.page
      .locator(".map-point-list button")
      .first()
      .dispatchEvent("click");
    assert.equal(await f.page.locator(".map-dossier-copy").count(), 1);
    await f.refresh("changed-source");
    assert.equal(
      await f.page.locator(".map-mark,.map-player,.map-dossier-copy").count(),
      0,
    );
    assert.match(
      await f.page.locator(".map-no-points").textContent(),
      /Opening your saved map/,
    );
    assert.doesNotMatch(
      await f.page.locator(".map-freshness").textContent(),
      /fresh/,
    );
    state.profiles[0].quests[0].destination.x = 0.82;
    await f.resolve(
      1,
      coreMap(state, Date.parse(state.profiles[0].source.updatedAt)),
    );
    assert.equal(
      await f.page.locator(".map-mark.quest circle").getAttribute("cx"),
      "820",
    );
    for (const [label, gathering] of [
      ["cleared", undefined],
      ["malformed", { schemaVersion: 1, records: "broken" }],
    ]) {
      await f.refresh(label);
      assert.equal(
        await f.page.locator(".map-mark,.map-dossier-copy").count(),
        0,
      );
      assert.match(
        await f.page.locator(".map-no-points").textContent(),
        /Opening/,
      );
      state.profiles[0].gathering = gathering;
      await f.resolve(
        (await f.count()) - 1,
        coreMap(state, Date.parse(state.profiles[0].source.updatedAt)),
      );
      assert.equal(await f.page.locator(".map-mark.find").count(), 0);
      assert.equal(await f.page.locator(".map-mark.quest").count(), 1);
    }
  },
);

test(
  "mounted pending paint waits for held native ownership and rejects the retired action",
  { timeout: 45000 },
  async (t) => {
    const f = await mounted(t);
    await f.resolve(0, model());
    await f.page
      .locator(".map-point-list button")
      .first()
      .dispatchEvent("click");
    await f.page.evaluate(() => {
      window.oldOpen = document.querySelector("[data-map-open]");
      window.held = document.querySelector("[data-map-area]");
      held.focus();
      held.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    await f.refresh("different-source");
    assert.equal(
      await f.page.evaluate(
        () => held === document.querySelector("[data-map-area]"),
      ),
      true,
    );
    await f.page.evaluate(() => oldOpen.click());
    assert.deepEqual(await f.page.evaluate(() => opened), []);
    await f.page.evaluate(() =>
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })),
    );
    await f.page.waitForTimeout(10);
    assert.equal(
      await f.page.evaluate(() => held.isConnected),
      true,
      "native menu retains ownership after pointer-up",
    );
    await f.page.evaluate(() =>
      held.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await f.page.waitForFunction(() => !window.held.isConnected);
    assert.equal(
      await f.page.locator(".map-mark,.map-dossier-copy").count(),
      0,
    );
    assert.match(
      await f.page.locator(".map-no-points").textContent(),
      /Opening/,
    );
    const replacement = model();
    replacement.points[0].x = 0.75;
    await f.resolve(1, replacement);
    assert.equal(
      await f.page.locator(".map-mark circle").getAttribute("cx"),
      "750",
    );
  },
);

test(
  "mounted freshness crosses actual core boundary with one caption-only read and retains selection and controls",
  { timeout: 45000 },
  async (t) => {
    const f = await mounted(t),
      state = require("./adventure-map-fixture.cjs").seed(),
      saved = Date.parse(state.profiles[0].source.updatedAt);
    await f.resolve(0, coreMap(state, saved));
    await f.page
      .locator(".map-point-list button")
      .first()
      .dispatchEvent("click");
    await f.page.evaluate(() => {
      window.held = document.querySelector("[data-map-area]");
      window.chosen = document.querySelector(".map-mark.chosen");
      window.dossier = document.querySelector(".map-dossier-copy");
      held.focus();
      held.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      window.mapClock += 16 * 60000 - 1;
      for (let i = 0; i < 30; i++) void AdventureMap.refresh();
    });
    assert.equal(await f.count(), 1);
    assert.equal(
      coreMap(state, saved + 16 * 60000 - 1).source.freshness,
      "fresh",
    );
    await f.page.evaluate(() => {
      window.mapClock++;
      for (let i = 0; i < 30; i++) void AdventureMap.refresh();
    });
    assert.equal(coreMap(state, saved + 16 * 60000).source.freshness, "stale");
    assert.equal(
      await f.count(),
      2,
      "one boundary read despite unrelated refreshes",
    );
    assert.match(
      await f.page.locator(".map-freshness").textContent(),
      /Checking saved age/,
    );
    assert.equal(
      await f.page.evaluate(
        () => held.isConnected && chosen.isConnected && dossier.isConnected,
      ),
      true,
    );
    await f.resolve(1, coreMap(state, saved + 16 * 60000));
    assert.match(await f.page.locator(".map-freshness").textContent(), /stale/);
    assert.equal(
      await f.page.evaluate(
        () =>
          held === document.querySelector("[data-map-area]") &&
          chosen === document.querySelector(".map-mark.chosen") &&
          dossier === document.querySelector(".map-dossier-copy"),
      ),
      true,
    );
    await f.page.evaluate(() => {
      window.mapClock += 12 * 3600000;
      for (let i = 0; i < 50; i++) void AdventureMap.refresh();
    });
    assert.equal(
      await f.count(),
      2,
      "stale source does not need repeated map reads",
    );
  },
);

test(
  "age failures retry at most once a minute and late age replies cannot cross a source replacement",
  { timeout: 45000 },
  async (t) => {
    const f = await mounted(t),
      state = require("./adventure-map-fixture.cjs").seed(),
      saved = Date.parse(state.profiles[0].source.updatedAt);
    await f.resolve(0, coreMap(state, saved));
    await f.page.evaluate(() => {
      window.mapClock += 16 * 60000;
      void AdventureMap.refresh();
    });
    await f.page.evaluate(() =>
      requests[1].reject(new Error("Synthetic unavailable read")),
    );
    assert.match(
      await f.page.locator(".map-freshness").textContent(),
      /Saved age unavailable/,
    );
    await f.page.evaluate(() => {
      for (let i = 0; i < 50; i++) void AdventureMap.refresh();
    });
    assert.equal(await f.count(), 2);
    await f.page.evaluate(() => {
      window.mapClock += 60000;
      for (let i = 0; i < 50; i++) void AdventureMap.refresh();
    });
    assert.equal(await f.count(), 3);
    await f.refresh("new-save-before-age-reply");
    assert.equal(
      await f.page.locator(".map-mark,.map-dossier-copy").count(),
      0,
    );
    await f.resolve(2, coreMap(state, saved + 17 * 60000));
    assert.equal(await f.page.locator(".map-mark").count(), 0);
    assert.doesNotMatch(
      await f.page.locator(".map-freshness").textContent(),
      /stale|Checking saved age/,
    );
    state.profiles[0].source.updatedAt = new Date(
      saved + 17 * 60000,
    ).toISOString();
    state.profiles[0].quests[0].destination.x = 0.63;
    await f.resolve(3, coreMap(state, saved + 17 * 60000));
    assert.match(await f.page.locator(".map-freshness").textContent(), /fresh/);
    assert.equal(
      await f.page.locator(".map-mark.quest circle").getAttribute("cx"),
      "630",
    );
    await f.refresh();
    assert.equal(await f.count(), 4);
  },
);
