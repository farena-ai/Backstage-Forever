"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
test("owned voice runtime repairs changed assets, preserves trusted exact bytes and rejects links", async () => {
  let prepareVoiceRuntime; try { ({ prepareVoiceRuntime } = require("../src/core/voice-runtime.cjs")); } catch {}
  assert.equal(typeof prepareVoiceRuntime, "function", "runtime preparation must exist");
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-voice-runtime-"));
  try {
    const helper = await prepareVoiceRuntime(dir), source = path.join(__dirname, "../src/native/voice-helper.ps1"); assert.deepEqual(await fs.readFile(helper), await fs.readFile(source));
    await fs.writeFile(helper, "changed"); assert.equal(await prepareVoiceRuntime(dir), helper); assert.deepEqual(await fs.readFile(helper), await fs.readFile(source));
    await fs.rm(path.join(dir, "runtime/voice"), { recursive: true }); await fs.mkdir(path.join(dir, "redirect")); await fs.symlink(path.join(dir, "redirect"), path.join(dir, "runtime/voice"), "junction"); await assert.rejects(() => prepareVoiceRuntime(dir));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test("runtime rejects hard-linked helper files and redirected ancestors without touching the destination", async () => {
  const { prepareVoiceRuntime } = require("../src/core/voice-runtime.cjs");
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "bf-voice-runtime-links-"));
  try {
    const helper = await prepareVoiceRuntime(dir), outside = path.join(dir, "unrelated.txt"); await fs.writeFile(outside, "preserve this"); await fs.rm(helper); await fs.link(outside, helper);
    await assert.rejects(() => prepareVoiceRuntime(dir)); assert.equal(await fs.readFile(outside, "utf8"), "preserve this"); await fs.rm(helper);
    await fs.mkdir(helper); await assert.rejects(() => prepareVoiceRuntime(dir)); await fs.rm(helper, { recursive: true });
    await fs.rm(path.join(dir, "runtime"), { recursive: true }); await fs.mkdir(path.join(dir, "elsewhere")); await fs.symlink(path.join(dir, "elsewhere"), path.join(dir, "runtime"), "junction"); await assert.rejects(() => prepareVoiceRuntime(dir)); assert.deepEqual(await fs.readdir(path.join(dir, "elsewhere")), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
