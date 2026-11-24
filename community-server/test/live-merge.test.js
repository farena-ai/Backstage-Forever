"use strict";
// The guild-event merge rule: one pure function on the server, the same answers as the addon's
// BackstageForeverEventMerge on a shared table of cases, and the sign-up rule next to it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const G = require("../lib/guilds");

const TABLE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "event-merge-cases.json"), "utf8")).cases;
const shape = (e) => (e ? { version: e.version, creator: { name: e.creator }, editor: e.editor ? { name: e.editor } : null, relayed: !!e.relayed } : null);

test("merge rule: every case of the shared table, on the server", () => {
  assert.ok(TABLE.length >= 25);
  for (const c of TABLE) assert.equal(G.eventDecision(shape(c.old), shape(c.incoming), c.direct).accept, c.accept, c.name);
});

test("merge rule: the reason says why, and every tie case is decided", () => {
  const d = (old, incoming, direct = true) => G.eventDecision(shape(old), shape(incoming), direct);
  const anna = (version, editor = null, relayed = false) => ({ version, creator: "Anna", editor, relayed });
  assert.deepEqual(d(null, anna(1)), { accept: true, reason: "new" });
  assert.deepEqual(d(anna(1), anna(2)), { accept: true, reason: "newer" });
  assert.deepEqual(d(anna(2), anna(1)), { accept: false, reason: "older" });
  assert.deepEqual(d(anna(2, null, true), anna(1)), { accept: true, reason: "author" });
  assert.deepEqual(d(anna(2), anna(9), false), { accept: false, reason: "hearsay" });
  assert.deepEqual(d(anna(2, null, true), anna(3), false), { accept: true, reason: "newer" });
  assert.deepEqual(d(anna(2, null, true), anna(2), false), { accept: false, reason: "older" });
  assert.deepEqual(d(anna(2), { version: 9, creator: "Cara", editor: null }), { accept: false, reason: "creator" });
  // Ties, every way round: equal names, later, earlier, editor against creator, case folded first.
  assert.deepEqual(d(anna(3, "Bob"), anna(3, "Bob")), { accept: false, reason: "older" });
  assert.deepEqual(d(anna(3, "Bob"), anna(3, "Cy")), { accept: true, reason: "tie" });
  assert.deepEqual(d(anna(3, "Cy"), anna(3, "Bob")), { accept: false, reason: "older" });
  assert.deepEqual(d(anna(3), anna(3, "Bob")), { accept: true, reason: "tie" });
  assert.deepEqual(d(anna(3, "Bob"), anna(3)), { accept: false, reason: "older" });
  assert.deepEqual(d(anna(3, "bob"), anna(3, "BOB")), { accept: false, reason: "older" });
  assert.deepEqual(d(anna(3, "abe"), anna(3, "Zed")), { accept: true, reason: "tie" });
  // A tie is decided the same way whichever copy a replica saw first: exactly one of the two orders wins.
  for (const [a, b] of [["Bob", "Cy"], ["abe", "Zed"], ["Bob", "Bobby"], [null, "Bob"], ["Zed", String.fromCodePoint(0xc9) + "mile"]]) {
    const ab = d(anna(7, a), anna(7, b)).accept, ba = d(anna(7, b), anna(7, a)).accept;
    assert.notEqual(ab, ba, `${a} / ${b}`);
  }
});

test("merge rule: names compare like the addon compares them (ASCII case folded, then bytes)", () => {
  assert.equal(G.sameName("Anna", "ANNA"), true);
  assert.equal(G.sameName("Anna", "Anne"), false);
  // Only ASCII letters are folded, as string.lower does in the game: an accented capital stays different.
  assert.equal(G.sameName(String.fromCodePoint(0xc9) + "mile", String.fromCodePoint(0xe9) + "mile"), false);
  assert.ok(G.compareNames("Zed", "abe") > 0);
  assert.ok(G.compareNames("Bob", "Bobby") < 0);
  assert.equal(G.compareNames("bob", "BOB"), 0);
  assert.equal(G.eventAuthor({ creator: { name: "Anna" }, editor: { name: "anna" } }), "Anna");
  assert.equal(G.eventAuthor({ creator: { name: "Anna" }, editor: { name: "Bob" } }), "Bob");
});

test("sign-up rule: your own newer answer wins; a passed-on answer never replaces a newer or equal one", () => {
  const S = G.signupDecision;
  assert.equal(S(null, 1, true), true);
  assert.equal(S(null, 1, false), true);
  assert.equal(S({ version: 2, relayed: 0 }, 3, true), true);
  assert.equal(S({ version: 2, relayed: 0 }, 2, true), false);
  assert.equal(S({ version: 2, relayed: 0 }, 1, true), false);
  assert.equal(S({ version: 5, relayed: 1 }, 1, true), true, "what the member says replaces what was passed on");
  assert.equal(S({ version: 2, relayed: 0 }, 3, false), true);
  assert.equal(S({ version: 2, relayed: 1 }, 2, false), false);
  assert.equal(S({ version: 2, relayed: 0 }, 2, false), false);
  assert.equal(G.roleFor(0, 1), "leader");
  assert.equal(G.roleFor(1, 1), "officer");
  assert.equal(G.roleFor(2, 1), "member");
  assert.equal(G.roleFor(3, 3), "officer");
});

// The addon file is on the app side of the repository; it and the Lua runner (a dev dependency of the
// app) are there in a full checkout. BF_EVENTS_LUA can point at the file when it lives elsewhere.
function luaSetup() {
  const root = path.join(__dirname, "..", "..");
  const file = process.env.BF_EVENTS_LUA || path.join(root, "addon", "BackstageForever", "BackstageForeverEvents.lua");
  if (!fs.existsSync(file)) return { skip: "the addon file BackstageForeverEvents.lua is not in this checkout" };
  let cli;
  try { cli = require.resolve("fengari-node-cli/src/lua-cli.js", { paths: [root] }); } catch { return { skip: "the Lua runner (fengari-node-cli) is not installed" }; }
  return { file, cli };
}

test("merge rule: the addon's BackstageForeverEventMerge gives the same answer on every case of the shared table", (t) => {
  const setup = luaSetup();
  if (setup.skip) return t.skip(setup.skip);
  const q = (s) => `'${String(s).replace(/[\\']/g, "\\$&")}'`;
  const ev = (e, extra = "") => `{id='abc123',ver=${e.version},creator=${q(e.creator)},${e.editor ? `editor=${q(e.editor)},` : ""}at=NOW+86400,dungeon='mc',roles={t=2,h=8,d=30},title='Molten Core'${extra}}`;
  const lines = [`dofile(${q(setup.file.replace(/\\/g, "/"))})`, "local NOW=1795000000", "local out={}",
    "local function run(old,e,sender) local db={events={},policy={ver=1,edit=9}} if old then db.events[old.id]=old end",
    "  local r=BackstageForeverEventMerge(db,e,sender,{now=NOW,rank=function() return 0 end}) out[#out+1]=r and '1' or '0' end"];
  const used = TABLE;
  for (const c of used) {
    const author = c.incoming.editor && c.incoming.editor.toLowerCase() !== c.incoming.creator.toLowerCase() ? c.incoming.editor : c.incoming.creator;
    lines.push(`run(${c.old ? ev(c.old, `,signups={}${c.old.relayed ? ",relayed='Quin'" : ""}`) : "nil"},${ev(c.incoming)},${q(c.direct ? author : "Quin")})`);
  }
  lines.push("io.write(table.concat(out,''))");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-merge-lua-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const chunk = path.join(dir, "chunk.lua");
  fs.writeFileSync(chunk, lines.join("\n"));
  const r = spawnSync(process.execPath, [setup.cli, chunk], { encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const got = r.stdout.trim();
  assert.equal(got.length, used.length, r.stdout + r.stderr);
  used.forEach((c, i) => assert.equal(got[i] === "1", c.accept, `addon: ${c.name}`));
  // And the server agrees with the addon case by case (not only with the table).
  used.forEach((c, i) => assert.equal(G.eventDecision(shape(c.old), shape(c.incoming), c.direct).accept, got[i] === "1", `server against addon: ${c.name}`));
});
