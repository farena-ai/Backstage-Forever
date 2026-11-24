"use strict";
// G10 (0.49): a short painted splash and a three-card tour on first launch, for new players only
// (no saved characters yet; never during automated tests). Help → Field guide replays it.
// All art is our own (made locally with ComfyUI): art/splash/*.webp and art/factions/*.webp.
window.Onboarding = (() => {
  const api = window.backstage;
  const KEY = "bf-tour-v1";
  const CARDS = [
    { art: "art/splash/splash.webp", eyebrow: "Welcome", title: "Your companion for WoW Forever", text: "Backstage Forever reads your own game, quietly, and tells you what to do next: the quest to hand in, the objective nearby, the zone to level in. Mini Now keeps that step beside your game." },
    { art: "art/splash/journal.webp", eyebrow: "Your field journal", title: "Everything about your characters, in one place", text: "Gear and a gear plan, talents, gold, bags, professions with a recipe book, dungeon runs and the story so far, for every character. It all stays on this computer, and the companion can plan your night from it." },
    { crests: true, eyebrow: "Horde and Alliance alike", title: "Set up in one click", text: "On the next screen, Set it all up finds WoW Forever, installs the addon and turns on the live link. Then log in and play: the app follows along." },
  ];
  let el = null, index = 0, splash = true;
  const seen = () => { try { return localStorage.getItem(KEY) === "done"; } catch { return true; } };
  const done = () => { try { localStorage.setItem(KEY, "done"); } catch {} };
  function view() {
    if (splash) return `<div class="ob-splash" role="dialog" aria-modal="true" aria-label="Welcome to Backstage Forever"><img class="ob-splash-art" src="art/splash/splash.webp" alt=""><div class="ob-splash-words"><img src="../../assets/crest.svg" alt="" width="72" height="72"><h1>Backstage Forever</h1><p>Your companion for World of Warcraft: Forever</p><button type="button" class="ob-primary" data-ob="begin">Begin</button><button type="button" class="ob-skip" data-ob="skip">Skip the tour</button></div></div>`;
    const c = CARDS[index];
    const art = c.crests ? `<div class="ob-crests"><img src="art/factions/horde.webp" alt="Horde crest"><img src="art/factions/alliance.webp" alt="Alliance crest"></div>` : `<img class="ob-card-art" src="${c.art}" alt="">`;
    return `<div class="ob-tour" role="dialog" aria-modal="true" aria-labelledby="ob-title"><article class="ob-card">${art}<div class="ob-card-words"><span class="ob-eyebrow">${c.eyebrow}</span><h2 id="ob-title">${c.title}</h2><p>${c.text}</p>
      <div class="ob-nav"><span class="ob-dots" aria-label="Card ${index + 1} of ${CARDS.length}">${CARDS.map((_, i) => `<i${i === index ? ' class="on"' : ""}></i>`).join("")}</span>
      ${index ? '<button type="button" class="ob-ghost" data-ob="back">Back</button>' : '<button type="button" class="ob-ghost" data-ob="skip">Skip</button>'}
      <button type="button" class="ob-primary" data-ob="${index === CARDS.length - 1 ? "finish" : "next"}">${index === CARDS.length - 1 ? "Let's go" : "Next"}</button></div></div></article></div>`;
  }
  function paint() { if (!el) return; el.innerHTML = view(); el.querySelector(".ob-primary")?.focus(); }
  function close() { done(); el?.classList.add("out"); const old = el; el = null; setTimeout(() => old?.remove(), 350); }
  function open() {
    if (el) return;
    index = 0; splash = true;
    el = document.createElement("div"); el.className = "bf-onboarding"; document.body.append(el); paint();
    el.addEventListener("click", (e) => {
      const act = e.target.closest?.("[data-ob]")?.dataset.ob;
      if (act === "begin") { splash = false; paint(); }
      if (act === "next") { index = Math.min(CARDS.length - 1, index + 1); paint(); }
      if (act === "back") { index = Math.max(0, index - 1); paint(); }
      if (act === "skip" || act === "finish") close();
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }
  async function decide() {
    if (seen()) return;
    let allowed = null;
    try { allowed = await api.onboarding(); } catch {}
    if (allowed?.show) open(); else if (allowed && !allowed.show) done();
  }
  let decision;
  const start = () => decision ??= decide();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else void start();
  document.addEventListener("click", (e) => { if (e.target.closest?.("[data-ob-replay]")) open(); });
  return { open, start, CARDS };
})();
