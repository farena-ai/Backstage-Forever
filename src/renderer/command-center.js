"use strict";
// Only small display preferences persist here. Quest evidence stays in memory.
window.CommandCenter = (() => {
  const prefix = "bf-guidance-v1:";
  function options(id) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(prefix + id)); } catch {}
    return {
      minutes: [15, 30, 60].includes(saved?.minutes) ? saved.minutes : 30,
      focus: ["balanced", "nearby", "turn-ins"].includes(saved?.focus) ? saved.focus : "balanced",
    };
  }
  function save(id, value) {
    try { localStorage.setItem(prefix + id, JSON.stringify(value)); } catch {}
  }
  function remove(id) {
    try {
      if (id) localStorage.removeItem(prefix + id);
      else Object.keys(localStorage).filter(key => key.startsWith(prefix)).forEach(key => localStorage.removeItem(key));
    } catch {}
  }
  function savedTime(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? date.toLocaleString() : "Time unavailable";
  }
  function age(p) {
    if (p?.source?.kind !== "wow-addon") return "Manual journal";
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(p.source.updatedAt)) / 60000));
    return "Saved · " + (!Number.isFinite(minutes) ? "time unknown" : minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`);
  }
  function draft(plan, selection) {
    const clip = (value, limit) => String(value || "").slice(0, limit);
    const evidence = (plan?.steps || []).slice(0, 8).map(step => ({
      title: clip(step.title, 200),
      action: step.kind === "turn-in" ? "Ready to turn in" : "Continue observed objectives",
      reason: clip(step.reason, 300),
      objectives: (step.objectives || []).slice(0, 10).map(o => ({ text: clip(o.text, 200), done: Boolean(o.done) })),
      ...(step.destination ? { destination: {
        ...(typeof step.destination.text === "string" ? { text: clip(step.destination.text, 200) } : {}),
        map: step.destination.mapId, x: step.destination.x, y: step.destination.y,
      } } : {}),
      ...(step.referenceDestination ? { approximateReference: step.referenceDestination } : {}),
      ...(step.knowledge?.record ? { reference: {
        questId: step.knowledge.questId,
        status: step.knowledge.status,
        chain: step.knowledge.chain?.slice(0,6),
        rewards: step.knowledge.rewards,
        source: step.knowledge.provenance,
      } } : {}),
      savedAt: step.source?.observedAt,
    }));
    return ("Explain this local quest plan in plain language. Use only the saved observations and labelled public reference facts below; do not invent quests, NPCs, prerequisites or an optimal route. Chain array order does not imply progression: only nextQuestId is a reported directed link, including targets outside this view. referenceStatus describes reference agreement separately from progress status; current game titles win, and referenceTitle is a qualified English alias. Conflicting references cannot establish current facts or eligibility. Ask me about missing details. This is a saved quest-log slice, not a complete quest database.\n" +
      JSON.stringify({ sessionMinutes: selection.minutes, focus: selection.focus, evidence }, null, 2)).slice(0, 11500);
  }
  function reference(step, esc) {
    const d = step.knowledge;
    const p = step.destination || step.referenceDestination;
    const at = p ? `${esc(p.name || p.text || "Quest area")} · ${esc((p.x*100).toFixed(1))}, ${esc((p.y*100).toFixed(1))}` : "";
    return `<div class="guidance-reference">${p ? `<strong>${step.destination ? "Game destination" : "Community location"}</strong><p>${at}</p>${!step.destination ? '<p class="bf-note">Community data · may differ in game</p>' : ""}` : '<p>Open your quest log in game (L) for where to go.</p>'}${d?.status === "conflict" ? '<p>The game names this quest differently from our reference; the game wins.</p>' : ""}<button class="subtle" data-quest-open="${step.questId}">Quest details · chain & rewards →</button></div>`;
  }
  function controls(selected, esc) {
    return `<div class="plan-controls"><label>Session length<select aria-label="Session length" data-plan-option="minutes">${[15,30,60].map(n => `<option value="${n}" ${selected.minutes === n ? "selected" : ""}>${n} minutes</option>`).join("")}</select></label><label>Quest focus<select aria-label="Quest focus" data-plan-option="focus">${[["balanced","Balanced"],["nearby","Nearby"],["turn-ins","Turn-ins"]].map(([v,label]) => `<option value="${esc(v)}" ${selected.focus === v ? "selected" : ""}>${label}</option>`).join("")}</select></label><span class="autosaved">◈ Autosaves for this character</span></div>`;
  }
  function steps(plan, selected, esc) {
    const headline = plan?.status === "ready" ? `${plan.steps.length} quest step${plan.steps.length === 1 ? "" : "s"} for this session` : plan?.headline || "Reading your saved quest log";
    const context = plan?.freshness?.status === "stale" ? "Saved more than 15 minutes ago. Log out or type /reload in game to bring it up to date." : plan?.freshness?.updatedAt ? `From your save · ${savedTime(plan.freshness.updatedAt)}` : "Your quests appear here after your first save.";
    const crest = (kind) => `<img class="step-crest" src="art/steps/${kind === "turn-in" ? "hand-in" : "quest"}.png" alt="" width="44" height="44">`;
    return `<section class="command-plan bf-card" role="region" aria-label="Your next steps"><header class="plan-heading"><h2>Quest plan <small>${esc(headline)}</small></h2></header><p class="plan-context">${esc(context)}</p><div class="guidance-list" aria-live="polite">${plan ? plan.steps.map((step) => `<article class="guidance-step bf-row ${step.kind === "turn-in" ? "ready-step" : ""}">${crest(step.kind)}<div class="step-body"><div class="step-kind">${step.kind === "turn-in" ? "Ready to hand in" : "In progress"}</div><h3>${esc(step.title)}</h3>${step.reason ? `<p>${esc(step.reason)}</p>` : ""}${step.objectives?.length ? `<ul class="quest-objectives">${step.objectives.map(o => `<li class="${o.done ? "done" : ""}">${o.done ? "✓" : "○"} ${esc(o.text)}</li>`).join("")}</ul>` : ""}${reference(step, esc)}<details class="step-evidence"><summary>Where this comes from</summary><p>Source: game snapshot · ${esc(savedTime(step.source?.observedAt))}</p>${step.knowledge?.provenance ? `<p>Quest reference: build ${esc(step.knowledge.provenance.build)} · ${esc(step.knowledge.provenance.attribution)}</p>` : ""}</details></div></article>`).join("") : '<p class="plan-empty">Reading your saved quest log…</p>'}${plan && !plan.steps.length ? `<div class="plan-empty"><h3>${plan.status === "unavailable" ? "No saved quest log yet" : "Nothing to do with this focus"}</h3><p>${plan.status === "unavailable" ? "Connect the game, play this character and log out (or type /reload): their quests show up here." : "Try another quest focus, or pick up quests in game: look for the yellow ! over people's heads."}</p>${plan.status === "unavailable" ? '<button data-nav="game">Open Game connection</button>' : ""}</div>` : ""}</div>${plan?.followUps?.length ? `<section class="plan-followups"><h3>Unlocked after the hand-in</h3>${plan.followUps.map(q => `<button data-quest-open="${q.questId}">${esc(q.title)} →</button>`).join("")}${'<p class="bf-note">Community data · may differ in game</p>'}</section>` : ""}<footer class="plan-footer"><p>${esc(plan ? `${plan.counts.shown ?? 0} shown of ${plan.counts.observed ?? "?"} quests in your log · ${plan.counts.ready ?? 0} ready` : "Waiting for your save")}</p><button class="primary" data-command="explain-plan" ${plan?.steps?.length ? "" : "disabled"}>Explain my plan</button></footer></section>`;
  }
  function readiness(brief, esc) {
    const ready = brief?.readiness;
    const free = ready?.bags?.free;
    return `<section class="preparation bf-card"><h2>Before you set out</h2>${ready?.known ? `<div class="preparation-facts"><span class="${Number.isFinite(free) && free < 4 ? "low" : ""}"><img src="art/pins/vendor.png" alt="" width="36" height="36"><strong>${ready.bags ? `${ready.bags.free} / ${ready.bags.total}` : "?"}</strong> bag slots free</span><span><img src="art/steps/repair.png" alt="" width="36" height="36"><strong>${ready.equipment ? ready.equipment.length : "?"}</strong> items equipped</span></div>${Number.isFinite(free) && free < 4 ? `<p>Bags nearly full: sell grey items at any vendor (the addon adds a <strong>Sell junk</strong> button) before you head out.</p>` : ""}${ready.equipment?.length ? `<details><summary>What you're wearing</summary><ul>${ready.equipment.map(item => `<li>${esc(item.name || "Unnamed item")}${item.itemLevel !== undefined ? ` · item level ${esc(item.itemLevel)}` : ""}</li>`).join("")}</ul></details>` : ""}` : `<p>${esc(ready?.message || "Bag space and gear appear after your first save.")}</p>`}</section>`;
  }
  return { options, save, remove, age, steps, readiness, draft, controls, savedTime };
})();
