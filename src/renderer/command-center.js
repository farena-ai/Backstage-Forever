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
    return `<div class="guidance-reference">${p ? `<strong>${step.destination ? "SAVED GAME DESTINATION" : "APPROXIMATE COMMUNITY LOCATION"}</strong><p>${esc(p.name || p.text || "Quest waypoint")} · Map ${esc(p.mapId)} · ${esc((p.x*100).toFixed(2))}%, ${esc((p.y*100).toFixed(2))}%</p>${!step.destination ? '<p>Player observation, not a guaranteed spawn or route.</p>' : ""}` : '<p>Check the game’s quest log for your destination.</p>'}${d?.status === "conflict" ? '<p>Current game title differs from the reference. Your saved game data wins.</p>' : ""}<button class="subtle" data-quest-open="${step.questId}">Quest details · chain & rewards →</button></div>`;
  }
  function controls(selected, esc) {
    return `<div class="plan-controls"><label>Session length<select aria-label="Session length" data-plan-option="minutes">${[15,30,60].map(n => `<option value="${n}" ${selected.minutes === n ? "selected" : ""}>${n} minutes</option>`).join("")}</select></label><label>Quest focus<select aria-label="Quest focus" data-plan-option="focus">${[["balanced","Balanced"],["nearby","Nearby"],["turn-ins","Turn-ins"]].map(([v,label]) => `<option value="${esc(v)}" ${selected.focus === v ? "selected" : ""}>${label}</option>`).join("")}</select></label><span class="autosaved">◈ Autosaves for this character</span></div>`;
  }
  function steps(plan, selected, esc) {
    const headline = plan?.status === "ready" ? `${plan.steps.length} steps for your adventure` : plan?.headline || "Gathering saved observations";
    const context = plan?.freshness?.status === "stale" ? "Desktop snapshot is older than 15 minutes. Live guidance in WoW keeps updating; desktop progress catches up after logout." : plan?.freshness?.updatedAt ? "From your last saved quest log. Live guidance runs inside WoW; the desktop catches up after logout." : "Quest actions appear after a saved game snapshot.";
    return `<section class="command-plan" role="region" aria-label="Your next steps"><header class="plan-heading"><div><div class="eyebrow">YOUR NEXT STEPS · LOCAL QUEST GUIDANCE</div><h2>${esc(headline)}</h2></div><span class="plan-seal" aria-hidden="true">◈</span></header>${controls(selected, esc)}<p class="plan-context">${esc(context)}</p><div class="guidance-list" aria-live="polite">${plan ? plan.steps.map((step,i) => `<article class="guidance-step ${step.kind === "turn-in" ? "ready-step" : ""}"><span class="step-number" aria-hidden="true">${String(i+1).padStart(2,"0")}</span><div class="step-body"><div class="step-kind">${step.kind === "turn-in" ? "◆ READY TO TURN IN" : "◇ CONTINUE OBJECTIVES"}</div><h3>${esc(step.title)}</h3><p>${esc(step.reason)}</p>${step.objectives?.length ? `<ul class="quest-objectives">${step.objectives.map(o => `<li>${o.done ? "✓" : "○"} ${esc(o.text)}</li>`).join("")}</ul>` : '<p class="muted">No objective text was reported.</p>'}${reference(step, esc)}<details class="step-evidence"><summary>Saved game evidence</summary><p>Source: game snapshot · ${esc(savedTime(step.source?.observedAt))}</p>${step.destination ? `<p>Observed destination: map ${esc(step.destination.mapId)} · ${esc(Math.round(step.destination.x*100))}%, ${esc(Math.round(step.destination.y*100))}%${step.destination.text ? " · " + esc(step.destination.text) : ""}</p>` : '<p>No game destination was reported. Community positions, when present, are separate approximate observations.</p>'}${step.knowledge?.provenance ? `<p>Public reference: build ${esc(step.knowledge.provenance.build)} · collected through ${esc(step.knowledge.provenance.observedThrough)} · ${esc(step.knowledge.provenance.attribution)}</p>` : ""}<p>This action uses the observed quest log. It does not verify a complete quest chain or an optimal route.</p></details></div><span class="step-ornament" aria-hidden="true">✧</span></article>`).join("") : '<p class="plan-empty">Building a plan from the selected character’s saved snapshot…</p>'}${plan && !plan.steps.length ? `<div class="plan-empty"><h3>${plan.status === "unavailable" ? "A saved quest log opens the way." : "A clear page for the next chapter."}</h3><p>${plan.status === "unavailable" ? "Manual journals work for your own goals. For observed quest actions, connect the game, play this character and log out to save their snapshot. Missing quest data is never guessed." : "Try another quest focus, or pick up a quest in game. This desktop plan catches up after the game saves on logout."}</p>${plan.status === "unavailable" ? '<button data-nav="game">Open Game Connection</button>' : ""}</div>` : ""}</div>${plan?.followUps?.length ? `<section class="plan-followups"><h3>After the turn-in · check availability</h3><p>Reported follow-ups; race, class, reputation and other requirements may still apply.</p>${plan.followUps.map(q => `<button data-quest-open="${q.questId}">${esc(q.title)} · Check availability →</button>`).join("")}</section>` : ""}<footer class="plan-footer"><p>${esc(plan ? `${plan.counts.shown ?? 0} shown · ${plan.counts.observed ?? "Unknown"} observed quests · ${plan.counts.ready ?? "Unknown"} ready` : "Waiting for saved evidence")}<br>Built here, without AI. Saved game observations with compatible public references; coverage is partial.</p><button class="primary" data-command="explain-plan" ${plan?.steps?.length ? "" : "disabled"}>Explain my plan</button></footer><details class="plan-limits"><summary>What this plan can tell you</summary>${(plan?.limitations || ["Guidance requires a saved game snapshot."]).map(line => `<p>${esc(line)}</p>`).join("")}<p>Session length limits the number of actions; it is not a completion-time estimate.</p><p>Explain my plan opens an editable question. Nothing is sent until you press Send question.</p></details></section>`;
  }
  function readiness(brief, esc) {
    const ready = brief?.readiness;
    return `<section class="preparation"><div class="panel-header"><h3>Before you set out</h3><span class="eyebrow">LOCAL PREPARATION</span></div><p>${esc(ready?.message || "Equipment and bag space have not been received in a saved snapshot.")}</p>${ready?.known ? `<div class="preparation-facts"><span><strong>${ready.bags ? `${ready.bags.free} / ${ready.bags.total}` : "Unknown"}</strong> bag slots free</span><span><strong>${ready.equipment ? ready.equipment.length : "Unknown"}</strong> observed equipped items</span></div>${ready.equipment?.length ? `<details><summary>View observed equipment</summary><ul>${ready.equipment.map(item => `<li>Slot ${esc(item.slot)} · ${esc(item.name || "Unnamed item")}${item.itemLevel !== undefined ? ` · item level ${esc(item.itemLevel)}` : ""}</li>`).join("")}</ul></details>` : ""}` : ""}<small>Saved observations, without gear scores or upgrade claims. Kept on this computer.</small></section>`;
  }
  return { options, save, remove, age, steps, readiness, draft };
})();
