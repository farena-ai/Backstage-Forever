"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { GameSync, parseSavedVariables } = require("../src/core/game-sync.cjs");
const snapshot = () => ({
  schema: 1,
  characters: [
    {
      id: "Player-synthetic-1",
      name: "Example",
      realm: "Example Realm",
      className: "Mage",
      level: 12,
      race: "Human",
      faction: "Alliance",
      location: { zone: "Test Zone", subZone: "", mapId: 1, x: 0.4, y: 0.5 },
      updatedAt: 1700000000,
    },
  ],
  activeId: "Player-synthetic-1",
  observedAt: 1700000000,
});
const saved = (s = snapshot()) =>
  "BackstageForeverExport = " + JSON.stringify(JSON.stringify(s));
test("parses bounded JSON-only quoted/long-string exports and conceals raw local ids", () => {
  const a = parseSavedVariables(saved());
  assert.equal(a.characters[0].name, "Example");
  assert.match(a.activeId, /^[a-f0-9]{64}$/);
  assert.equal(a.activeId, a.characters[0].id);
  assert.equal(a.observedAt, "2023-11-14T22:13:20.000Z");
  assert.equal(
    parseSavedVariables(
      "BackstageForeverExport = [=[" + JSON.stringify(snapshot()) + "]=]",
    ).characters.length,
    1,
  );
});
test("rejects executable Lua, partial exports, invalid schema, controls and oversized data", () => {
  for (const s of [
    "BackstageForeverExport = {}",
    saved() + '; os.execute("bad")',
    'Other = "x"',
    saved().slice(0, -4),
    "x".repeat(1024 * 1024 + 1),
  ])
    assert.throws(() => parseSavedVariables(s));
  const bad = snapshot();
  bad.characters[0].level = 0;
  assert.throws(() => parseSavedVariables(saved(bad)));
});
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "forever-sync-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "client");
  await fs.mkdir(
    path.join(root, "WTF", "Account", "SyntheticAccount", "SavedVariables"),
    { recursive: true },
  );
  await fs.writeFile(path.join(root, ".flavor.info"), "wowf");
  await fs.writeFile(
    path.join(root, ".build.info"),
    "Version!STRING:0\n1.60.1.70862",
  );
  return {
    dir,
    root,
    file: path.join(
      root,
      "WTF",
      "Account",
      "SyntheticAccount",
      "SavedVariables",
      "BackstageForever.lua",
    ),
  };
}
test("connect, refresh, partial-write recovery, install ownership and disconnect cancellation", async (t) => {
  const f = await fixture(t),
    events = [];
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: path.join(__dirname, "../addon/BackstageForever"),
    onSnapshot: (s) => events.push(s),
  });
  t.after(() => sync.close());
  assert.equal((await sync.connect(f.root)).connected, true);
  await fs.writeFile(f.file, saved());
  await sync.refresh();
  assert.equal(events.length, 1);
  await fs.writeFile(f.file, 'BackstageForeverExport = "partial');
  await sync.refresh();
  assert.equal(sync.status().characterCount, 1);
  await sync.installAddon();
  const folder = path.join(f.root, "Interface", "AddOns", "BackstageForever");
  await fs.writeFile(path.join(folder, "user.txt"), "keep");
  await sync.installAddon();
  assert.equal(
    await fs.readFile(path.join(folder, "user.txt"), "utf8"),
    "keep",
  );
  assert.ok(!JSON.stringify(sync.status()).includes(f.root));
  const pending = sync.refresh();
  await sync.disconnect();
  await pending;
  assert.equal(sync.status().connected, false);
  assert.equal(events.length, 1);
});
test("refuses a symlink connection and symlink saved exports", async (t) => {
  const f = await fixture(t);
  const link = path.join(f.dir, "link");
  try {
    await fs.symlink(f.root, link, "junction");
  } catch (e) {
    t.skip("symlink permission unavailable");
    return;
  }
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: "unused",
    onSnapshot: () => assert.fail("unexpected snapshot"),
  });
  t.after(() => sync.close());
  assert.equal((await sync.connect(link)).connected, false);
  await sync.connect(f.root);
  await fs.writeFile(path.join(f.dir, "outside.lua"), saved());
  await fs.symlink(path.join(f.dir, "outside.lua"), f.file);
  await sync.refresh();
  assert.equal(sync.status().characterCount, 0);
});
test("closing before restore resolves prevents saved connection resurrection", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.dir, "data"));
  await fs.writeFile(
    path.join(f.dir, "data", "game-connection.private.json"),
    JSON.stringify({ root: f.root }),
  );
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: "unused",
  });
  sync.close();
  await sync.ready;
  assert.equal(sync.status().connected, false);
});
test("parser accepts WoW decimal byte escapes without running Lua", () => {
  const json = JSON.stringify(snapshot());
  const lua =
    'BackstageForeverExport = "' +
    [...json]
      .map((c) => "\\" + String(c.charCodeAt(0)).padStart(3, "0"))
      .join("") +
    '"';
  assert.equal(parseSavedVariables(lua).characters[0].name, "Example");
});
test("addon installer refuses symlink owned destination without changing its target", async (t) => {
  const f = await fixture(t);
  const folder = path.join(f.root, "Interface", "AddOns", "BackstageForever");
  await fs.mkdir(folder, { recursive: true });
  const outside = path.join(f.dir, "outside.txt");
  await fs.writeFile(outside, "untouched");
  try {
    await fs.symlink(outside, path.join(folder, "BackstageForever.lua"));
  } catch {
    t.skip("symlink unavailable");
    return;
  }
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: path.join(__dirname, "../addon/BackstageForever"),
  });
  t.after(() => sync.close());
  await sync.connect(f.root);
  assert.equal((await sync.installAddon()).addonInstalled, false);
  assert.equal(await fs.readFile(outside, "utf8"), "untouched");
});
test("disconnect during addon checks cannot rewrite the private connection or restore status", async (t) => {
  const f = await fixture(t);
  const folder = path.join(f.root, "Interface", "AddOns", "BackstageForever");
  await fs.mkdir(folder, { recursive: true });
  for (const file of ["BackstageForever.toc", "BackstageForever.lua"])
    await fs.writeFile(path.join(folder, file), "fixture");
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: "unused",
  });
  t.after(() => sync.close());
  await sync.ready;
  const original = fs.lstat;
  let release,
    reached,
    paused = false;
  const blocked = new Promise((r) => {
    reached = r;
  });
  fs.lstat = async function (file, ...args) {
    if (!paused && String(file) === path.join(folder, "BackstageForever.toc")) {
      paused = true;
      reached();
      await new Promise((r) => {
        release = r;
      });
    }
    return original.call(this, file, ...args);
  };
  try {
    const pending = sync.connect(f.root);
    await blocked;
    await sync.disconnect();
    release();
    await pending;
    assert.equal(sync.status().connected, false);
    assert.equal(sync.status().addonInstalled, false);
    await assert.rejects(
      fs.stat(path.join(f.dir, "data", "game-connection.private.json")),
      { code: "ENOENT" },
    );
  } finally {
    fs.lstat = original;
    release?.();
  }
});
test("failed snapshot consumer is retried instead of acknowledged", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const sync = new GameSync({
    dataDir: path.join(f.dir, "data"),
    addonDir: "unused",
    onSnapshot: () => {
      if (++calls === 1) throw Error("disk full");
    },
  });
  t.after(() => sync.close());
  await sync.connect(f.root);
  await fs.writeFile(f.file, saved());
  await sync.refresh();
  await sync.refresh();
  assert.equal(calls, 2);
});
