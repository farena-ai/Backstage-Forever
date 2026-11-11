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
