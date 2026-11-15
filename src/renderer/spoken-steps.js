"use strict";
// Spoken next steps (0.45, roadmap 3.5): when switched on, the app reads your next step aloud
// with the local Windows voice whenever it changes ("Hand in Call of Water to Islen Waterseer,
// south-east."). Off by default; the choice and voice are remembered on this computer only.
window.SpokenSteps = (() => {
  const api = window.backstage;
  const KEY = "bf-spoken-steps-v1", POLL = 4000, GAP = 8000;
  let timer = null, lastKey = null, lastAt = 0, busy = false, voices = null, status = "";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return { on: v.on === true, voiceId: typeof v.voiceId === "string" ? v.voiceId : null }; } catch { return { on: false, voiceId: null }; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} }
  /** Pure: a step's identity; the same step is never read twice in a row. */
  const stepKey = (s) => (s ? `${s.kind}|${s.questId ?? ""}|${s.title}|${s.progress ?? ""}` : null);
  /** Pure: the voice to use: the saved one if still installed, else English, else the first. */
  function pickVoice(list, saved) {
    if (!Array.isArray(list) || !list.length) return null;
    return list.find((v) => v.id === saved) || list.find((v) => /^en(-|$)/i.test(v.culture || "")) || list[0];
  }
  async function voiceList() {
    if (voices) return voices;
    try { const c = await api.voiceCapabilities(); voices = c?.synthesis?.available ? c.synthesis.voices : []; } catch { voices = []; }
    return voices;
  }
  async function say(text, profileId) {
    const pref = load(), voice = pickVoice(await voiceList(), pref.voiceId);
    if (!voice) { status = "No Windows voice is installed, so steps can't be read aloud."; paint(); return false; }
    try { await api.voiceSpeak({ profileId, text, voiceId: voice.id }); status = ""; return true; }
    catch { status = "Reading aloud is unavailable right now."; paint(); return false; }
  }
  async function tick(force) {
    if (busy || !load().on) return;
    busy = true;
    try {
      const r = await api.nextStep(), step = r?.step || null;
      const key = stepKey(step);
      if (step?.spoken && (force || (key !== lastKey && Date.now() - lastAt >= GAP))) {
        lastKey = key; lastAt = Date.now();
        await say(step.spoken, r.profileId ?? null);
      } else if (!step) lastKey = null;
    } catch {} finally { busy = false; }
  }
  function start() { stop(); if (load().on) { timer = setInterval(() => void tick(false), POLL); void tick(false); } }
  function stop() { clearInterval(timer); timer = null; }
  function control() {
    const on = load().on;
    return `<span class="spoken-steps" data-spoken-steps><button type="button" class="subtle${on ? " on" : ""}" data-spoken-act="toggle" aria-pressed="${on}" title="Read your next step aloud whenever it changes, with the local Windows voice">${on ? "🔊 Speaking steps" : "🔈 Speak steps"}</button>${on ? ' <button type="button" class="subtle" data-spoken-act="again" title="Read the current step again">Say again</button>' : ""}${status ? ` <small class="spoken-status">${esc(status)}</small>` : ""}</span>`;
  }
  function paint() { for (const el of document.querySelectorAll("[data-spoken-steps]")) el.outerHTML = control(); }
  document.addEventListener("click", (e) => {
    const act = e.target.closest?.("[data-spoken-act]")?.dataset.spokenAct;
    if (!act) return;
    if (act === "toggle") { const v = load(); v.on = !v.on; save(v); lastKey = null; status = ""; paint(); if (v.on) { start(); void tick(true); } else stop(); }
    if (act === "again") void tick(true);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  return { control, start, stop, _pure: { stepKey, pickVoice } };
})();
