"use strict";
// Free AI card on Companion: one click turns on the built-in AI (downloads stubbed: tests never
// fetch the real engine or model), progress shows, the chat then uses it; or a free cloud key.
const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { testWindow, launch: launchElectron } = require("./test-window.cjs");
const { defaultState } = require("../src/core/validation.cjs");
(async () => {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "forever-free-ai-"));
  const capture = path.join(__dirname, "..", ".superpowers", "sdd", "free-ai-captures");
  await fs.mkdir(capture, { recursive: true });
  let app;
  const watchdog = setTimeout(() => { console.error("Free AI fixture exceeded 120 seconds"); app?.process().kill(); process.exitCode = 1; }, 120000);
  try {
    const profile = { id: "Alpha", name: "Alpha", className: "Hunter", realm: "Synthetic", level: 15, race: "Tauren", faction: "Horde", goals: [], notes: "", quests: [] };
    await fs.writeFile(path.join(dir, "state.json"), JSON.stringify({ ...defaultState(), onboarded: true, activeProfileId: "Alpha", profiles: [profile] }));
    const repo = path.resolve(__dirname, "..");
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "bf-free-ai-fixture", version: "0.27.0", main: "m.cjs" }));
    await fs.writeFile(path.join(dir, "m.cjs"), `
      const load=require('node:module').createRequire(${JSON.stringify(path.join(repo, "package.json"))});
      load('./src/core/game-runtime.cjs').GameRuntime.prototype.probe=async()=>({state:'not-running',launchAvailable:false});
      const L=load('./src/core/live-bridge.cjs'); L.LiveBridge.prototype.readPreference=function(){return false;};L.LiveBridge.prototype.start=function(){};
      // Never download or run anything real: a fake engine that "installs" in a few progress steps.
      const A=load('./src/core/local-ai.cjs');
      let installed=false,running=false;
      A.LocalAi.prototype.status=function(){return {supported:true,installed,running,starting:false,tier:installed?'light':null,model:installed?{name:'Qwen2.5 1.5B Instruct',license:'Apache-2.0',sizeGB:1}:null,engine:installed?'llama.cpp test (processor)':null,busy:Boolean(this.task),progress:this.progress||null,error:null,recommended:'light',ramGB:16,choices:{standard:{name:'Qwen3 4B Instruct',sizeGB:2.3,minRamGB:8},light:{name:'Qwen2.5 1.5B Instruct',sizeGB:1,minRamGB:4}},endpoint:'http://127.0.0.1:41234'};};
      A.LocalAi.prototype.install=function(){if(this.task)return this.task;this.task=(async()=>{for(const r of [0.2,0.6,1]){this.progress={label:'the Qwen2.5 1.5B Instruct model',received:r*1e9,total:1e9};this.emit();await new Promise(s=>setTimeout(s,400));}installed=true;running=true;this.progress=null;this.task=null;this.emit();return this.status();})();this.emit();return this.task;};
      A.LocalAi.prototype.start=async function(){running=true;return 'http://127.0.0.1:41234';};
      A.LocalAi.prototype.remove=async function(){installed=false;running=false;this.emit();return this.status();};
      globalThis.freeAiAsks=[];
      const P=load('./src/core/providers.cjs');const ask=P.ask;P.ask=async(o)=>{globalThis.freeAiAsks.push({provider:o.provider,endpoint:o.endpoint,model:o.model});return 'Free local answer.';};
      const M=load('./src/core/model-catalog.cjs');M.listModels=async(o)=>M.result(o.provider==='groq'?[{id:'llama-3.3-70b-versatile',label:'x'},{id:'whisper-large',label:'w'}]:[],'provider-api','ok');
      load('./src/main.cjs');`);
    app = await launchElectron(electron, { args: [dir], env: { ...process.env, BF_USER_DATA: dir }, timeout: 20000 });
    const page = await testWindow(app);
    page.setDefaultTimeout(15000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
    await page.evaluate(() => { localStorage.setItem("bf-setup-v4", "complete"); });
    await page.reload();
    await page.locator('[data-nav="assistant"]').first().click();
    await page.locator("[data-free-ai] [data-free-act='install']").waitFor();
    assert.match(await page.locator("[data-free-ai]").innerText(), /One click downloads a small AI model/);
    await page.locator("[data-free-ai] [data-free-act='install']").click();
    await page.locator(".free-ai-bar").waitFor();
    await page.screenshot({ path: path.join(capture, "free-ai-progress.png") });
    await page.locator(".free-ai-on").waitFor({ timeout: 20000 });
    assert.match(await page.locator(".free-ai-on").innerText(), /runs on this PC/);
    await page.screenshot({ path: path.join(capture, "free-ai-on.png") });
    // The chat now uses the built-in engine, with no key.
    await page.locator("#chat-form textarea, #chat-form input[type=text]").first().fill("Tell me a story about the Barrens");
    await page.locator("#chat-form button[type=submit]").first().click();
    await page.locator("#chatlog .message.assistant").getByText("Free local answer.").waitFor();
    const asks = await app.evaluate(() => globalThis.freeAiAsks);
    assert.equal(asks.at(-1).provider, "local"); assert.equal(asks.at(-1).endpoint, "http://127.0.0.1:41234");
    // Free cloud key: get, paste, save; the best model is chosen from the provider's own list.
    await page.locator(".free-ai-cloud summary").click();
    await page.locator("[data-free-act='paste-key'][data-provider='groq']").click();
    await page.locator("[data-free-key]").fill("gsk_test_key_for_fixture");
    await page.locator("[data-free-act='save-key']").click();
    await page.locator(".free-ai-note").getByText(/Ready: Groq \(llama-3\.3-70b-versatile\)/).waitFor();
    const provider = await page.evaluate(async () => (await window.backstage.bootstrap()).state.provider);
    assert.equal(provider.id, "groq"); assert.equal(provider.model, "llama-3.3-70b-versatile");
    console.log("Free AI smoke passed");
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { clearTimeout(watchdog); await app?.close().catch(() => {}); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
})();
