"use strict";
// Characters → Journey, two more views: challenge runs (C12) and the Discord status switch (S6).
// The main process works out how a run stands and what Discord would show; this file paints
// that model. JourneyExtras owns the view switch, the cache and the status line.
window.JourneyMore = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const day = (ms) => (window.I18n?.when ? window.I18n.when(ms, "date") : new Date(ms).toLocaleString());
  const wait = (text) => `<p class="jr-empty" role="status">${esc(text)}</p>`;
  const STATUS = { clear: "Nothing recorded against it", broken: "A record shows it broken", declared: "Self-declared" };
  const STANDING = { kept: "Reached by your rules", before: "Reached before this run", after: "Reached after a rule broke", unknown: "Reached; no date to compare", ahead: "Not reached yet" };
  let editing = false;

  // ---- Challenge run ----
  function ruleForm(d, busy) {
    const r = d.rules || {};
    const option = (id) => d.options.find((o) => o.id === id);
    const tick = (id, checked) => `<input type="checkbox" aria-label="${esc(option(id).name)}" id="jm-rule-${id}" name="${id}"${checked ? " checked" : ""}>`;
    const line = (id, checked, extra = "") => `<li>${tick(id, checked)}<label for="jm-rule-${id}"><strong>${esc(option(id).name)}</strong><span>${esc(option(id).what)}</span></label>${extra}</li>`;
    return `<form class="jx-panel jm-form" data-challenge-form><h3>${d.run ? "Start again with these rules" : "Choose your rules"}</h3>
      <ul class="jm-options">${line("oneLife", r.oneLife)}${line("noAuction", r.noAuction)}${line("selfFound", r.selfFound)}
        ${line("noDungeonsBelow", !!r.noDungeonsBelow, `<span class="jm-extra"><label for="jm-dungeon-level">Level</label><input id="jm-dungeon-level" name="dungeonLevel" type="number" min="2" max="${d.limits.dungeonLevel}" step="1" value="${r.noDungeonsBelow || 20}"></span>`)}
        ${line("custom", !!r.custom, `<span class="jm-extra jm-wide"><label for="jm-custom">Your rule</label><input id="jm-custom" name="customText" type="text" maxlength="${d.limits.custom}" value="${esc(r.custom || "")}" placeholder="No mounts before level 50" autocomplete="off" data-no-translate></span>`)}</ul>
      <p class="jx-foot">The run starts now, at your saved level. Nothing before this moment counts for or against it.</p>
      <div class="jx-row"><button type="submit"${busy ? " disabled" : ""}>${d.run ? "Start again from now" : "Start the run"}</button>${d.run ? `<button type="button" data-challenge-cancel>Cancel</button>` : ""}</div></form>`;
  }
  function challenge(d, { note, busy, share }) {
    if (!d) return wait("Choose a character in Characters.");
    const run = d.run;
    const head = `<div class="jx-head"><div><h2>Challenge run</h2><p class="jx-lead">Rules you set yourself for <span data-no-translate>${esc(d.name)}</span>. The app calls a rule broken only when it holds a record that shows it. A rule it cannot check is your word, and the page says so.</p></div>${run && d.card ? share("challenge", d.card, "Share picture") : ""}</div>`;
    if (!run) return `<section class="jr-card jm-challenge" data-journey-challenge>${head}${d.saved ? "" : `<p class="jx-foot">This character was not saved by the addon, so the app has no deaths, dungeon visits or auction pages to check. Every rule would be self-declared.</p>`}${ruleForm(d, busy)}<p class="jx-status" role="status">${esc(note)}</p></section>`;
    const rules = run.rules.map((r) => `<li class="jm-rule jm-${esc(r.status)}"><span class="jm-chip">${esc(STATUS[r.status])}</span><strong${r.id === "custom" ? " data-no-translate" : ""}>${esc(r.name)}</strong>
      ${r.evidence ? `<p class="jm-evidence">${esc(r.evidence)}</p>` : ""}<small>${esc(r.basis)}</small></li>`).join("");
    const track = run.milestones.map((m) => `<li class="jm-stone jm-${esc(m.standing)}"><img src="art/badges/level-${m.level}.png" alt="" width="64" height="64"><strong>Level <span data-no-translate>${m.level}</span></strong><span>${esc(STANDING[m.standing])}</span>${m.reached && m.at ? `<small data-no-translate>${esc(day(m.at))}</small>` : ""}</li>`).join("");
    return `<section class="jr-card jm-challenge" data-journey-challenge>${head}
      <p class="jm-verdict${run.broken ? " broken" : ""}" role="status">${esc(run.verdict)}</p>
      <dl class="jm-facts"><div><dt>Started</dt><dd data-no-translate>${esc(day(run.startedAt))}</dd></div><div><dt>Level at the start</dt><dd data-no-translate>${run.startLevel}</dd></div><div><dt>Level now</dt><dd data-no-translate>${run.level ?? "–"}</dd></div><div><dt>Days</dt><dd data-no-translate>${run.days}</dd></div>${run.endedAt ? `<div><dt>Ended</dt><dd data-no-translate>${esc(day(run.endedAt))}</dd></div>` : ""}</dl>
      <div class="jx-panel"><h3>Your rules</h3><ul class="jm-rules">${rules}</ul></div>
      <div class="jx-panel"><h3>Milestones by your rules</h3><ol class="jm-track">${track}</ol>
        <p class="jx-foot">A milestone counts when its level was reached during the run and before any record of a broken rule. ${run.declared ? "Self-declared rules are taken on your word." : ""}</p></div>
      ${editing ? ruleForm(d, busy) : `<div class="jx-panel jm-actions"><div class="jx-row">${run.endedAt ? "" : `<button type="button" data-challenge-end="end"${busy ? " disabled" : ""}>End the run</button>`}<button type="button" data-challenge-edit${busy ? " disabled" : ""}>Start again with new rules</button><button type="button" data-challenge-end="remove"${busy ? " disabled" : ""}>Remove the run</button></div></div>`}
      <p class="jx-status" role="status">${esc(note)}</p></section>`;
  }

  // ---- Discord status ----
  const STATE = {
    off: "Off. The app does not look for Discord.",
    "needs-id": "Needs a Discord application id. Nothing is opened until one is typed in below.",
    waiting: "On. Waiting for the live link: the status shows only while the game reports where you are.",
    connecting: "Looking for Discord on this computer…",
    on: "Connected to Discord on this computer.",
    "no-discord": "Discord was not found on this computer. The app tries again while this page or the game is open.",
    refused: "Discord refused the application id. Check the number.",
  };
  function discord(d, { note, busy }) {
    if (!d) return wait("Reading the Discord switch…");
    const tick = (key, label) => `<li><input type="checkbox" aria-label="${label}" id="jm-dc-${key}" data-discord-tick="${key}"${d[key] ? " checked" : ""}${busy ? " disabled" : ""}><label for="jm-dc-${key}">${label}</label></li>`;
    return `<section class="jr-card jm-discord" data-journey-discord><div class="jx-head"><div><h2>Discord status</h2><p class="jx-lead">Shows a line such as “Level 34 Hunter in Stranglethorn Vale” on your own Discord. Optional and off until you switch it on.</p></div>
        <button type="button" class="jx-switch" data-discord-toggle aria-pressed="${d.enabled}"${busy ? " disabled" : ""}>${d.enabled ? "Switch Discord status off" : "Switch Discord status on"}</button></div>
      <div class="jx-ov-grid"><div class="jx-panel">
        <h3>${d.enabled ? "The Discord status is on" : "The Discord status is off"}</h3>
        <p class="jm-state" data-discord-state>${esc(STATE[d.state] || STATE.off)}</p>
        <form class="jm-id" data-discord-id-form><label for="jm-dc-id">Discord application id</label><div class="jx-row"><input id="jm-dc-id" name="appId" type="text" inputmode="numeric" maxlength="20" value="${esc(d.appId)}" placeholder="17 to 20 digits" autocomplete="off" spellcheck="false" data-no-translate><button type="submit"${busy ? " disabled" : ""}>Save id</button></div>
          <small>Needs a Discord application id. This project does not ship one yet, so the status cannot show until you type one in. Without it the app never opens Discord's connection.</small></form>
        <p class="jx-status" role="status">${esc(note)}</p></div>
        <div class="jx-panel"><h3>What it shows</h3><ul class="jm-ticks">${tick("level", "Your level")}${tick("className", "Your class")}${tick("zone", "The zone you are in")}</ul>
          <div class="jm-preview" aria-label="What Discord would show now"><small>Playing</small><strong data-no-translate>${esc(d.preview || "—")}</strong></div>
          <ul class="jx-facts"><li>Your character's name is never sent.</li><li>It talks only to the Discord program on this computer. The app itself makes no internet call for this.</li><li>It shows only while the live link is on, so Discord never shows an old place.</li><li>Switching it off or closing the app removes the status.</li></ul></div></div></section>`;
  }

  /** Clicks and forms of both views. act(work, done) runs one change and repaints. */
  function mounted(root, view, { cache, act, rerender, setNote }) {
    if (view === "challenge") {
      root.querySelector("[data-challenge-form]")?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget.elements;
        const rules = { oneLife: f.oneLife.checked, noAuction: f.noAuction.checked, selfFound: f.selfFound.checked, noDungeonsBelow: f.noDungeonsBelow.checked ? Number(f.dungeonLevel.value) : 0, custom: f.custom.checked ? f.customText.value : "" };
        if (f.noDungeonsBelow.checked && !(Number.isInteger(rules.noDungeonsBelow) && rules.noDungeonsBelow >= 2 && rules.noDungeonsBelow <= 60)) { setNote("Choose a level from 2 to 60 for the dungeon rule."); return rerender(); }
        if (f.custom.checked && !f.customText.value.trim()) { setNote("Write your own rule, or untick it."); return rerender(); }
        void act(async () => { cache.challenge = await api.startChallengeRun(rules); editing = false; }, "The run has started. Good luck.");
      });
      root.addEventListener("click", (ev) => {
        const end = ev.target.closest("[data-challenge-end]")?.dataset.challengeEnd;
        if (end) void act(async () => { cache.challenge = await api.endChallengeRun(end); editing = false; }, end === "end" ? "The run is ended and kept as it stood." : "The run was removed.");
        else if (ev.target.closest("[data-challenge-edit]")) { editing = true; rerender(); }
        else if (ev.target.closest("[data-challenge-cancel]")) { editing = false; rerender(); }
      });
    }
    if (view === "discord") {
      const set = (patch, done) => act(async () => { cache.discord = await api.setDiscordPresence(patch); return cache.discord; }, done);
      root.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-discord-toggle]")) void set({ enabled: !cache.discord?.enabled }, (d) => (!d.enabled ? "The Discord status is off." : d.appIdValid ? "The Discord status is on." : "Switched on, but it needs a Discord application id first."));
      });
      root.addEventListener("change", (ev) => { const key = ev.target.closest?.("[data-discord-tick]")?.dataset.discordTick; if (key) void set({ [key]: ev.target.checked }, "Saved."); });
      root.querySelector("[data-discord-id-form]")?.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const id = ev.currentTarget.elements.appId.value.trim();
        if (id && !/^\d{17,20}$/.test(id)) { setNote("A Discord application id is 17 to 20 digits and nothing else."); return rerender(); }
        void set({ appId: id }, id ? "Id saved." : "Id removed. The status stays off without one.");
      });
    }
  }
  const reset = () => { editing = false; };
  return { challenge, discord, mounted, reset, loaders: { challenge: () => api.challengeRun(), discord: () => api.discordPresence() } };
})();
