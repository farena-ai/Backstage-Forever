const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  candidateRoots,
  discoverGame,
} = require("../src/core/game-discovery.cjs");
test("bounded discovery includes common custom-drive install and deduplicates normalized roots", async () => {
  const candidates = candidateRoots({ env: {}, platform: "win32" });
  assert.ok(
    candidates.includes("F:\\WorldofWarcraft\\World of Warcraft\\_forever_"),
  );
  assert.ok(candidates.length < 300);
  const root = candidates[0];
  const found = await discoverGame({
    candidates: [root, root],
    validateRoot: async (p) => p,
  });
  assert.equal(found.length, 1);
});
test("an unavailable drive cannot hold up discovery of a usable installation", async () => {
  const start = Date.now();
  const found = await discoverGame({
    candidates: ["unavailable", "valid"],
    candidateTimeoutMs: 20,
    maxDurationMs: 100,
    validateRoot: (p) =>
      p === "unavailable" ? new Promise(() => {}) : Promise.resolve(p),
  });
  assert.deepEqual(
    found.map((x) => x.path),
    ["valid"],
  );
  assert.ok(Date.now() - start < 1000);
});

test("canonical validation folds short-path and case aliases into one choice",async()=>{
  const roots={"C:\\GAME~1\\_forever_":"C:\\Game Folder\\_forever_","c:\\game folder\\_forever_":"C:\\Game Folder\\_forever_"};
  const found=await discoverGame({candidates:Object.keys(roots),validateRoot:async p=>roots[p]});
  assert.equal(found.length,1);assert.equal(found[0].path,"C:\\Game Folder\\_forever_");
});
