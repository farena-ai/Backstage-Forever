"use strict";
window.ObjectiveView = (() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const date = value => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  let getState = () => null;
  const MAX_QUEST_SAVE_AGE = 24 * 60 * 60 * 1000;
  function saveAge(elapsed) {
    if (!Number.isFinite(elapsed) || elapsed < 0) return "Last character save: time unknown";
    const minutes = Math.floor(elapsed / 60000);
    const age = minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} hr ago` : `${Math.floor(minutes / 1440)} days ago`;
    return `Last character save: ${age} · not live`;
  }
  const character = () => { const s = getState(); return s?.profiles.find(p => p.id === s.activeProfileId); };
  const pinned = p => getState()?.objectives?.find(o => o.profileId === p?.id);
  const matches = (o, p) => o.sourceId === p?.source?.id && o.build === p.clientBuild;
  const standings = ["", "Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
  const label = o => o.kind === "quest" ? o.title : `${o.title} · ${o.kind === "reputation" ? standings[o.targetStanding] : `Rank ${o.targetRank}`}`;
  const action = (p, o, target) => esc(JSON.stringify({ profileId: p.id, expectedId: o?.id ?? null, target, ...(target ? { sourceId: p.source.id, build: p.clientBuild ?? null } : {}) }));

  function pin(target, profileId) {
    const p = character();
    if (!p?.source || p.id !== profileId) return "";
    const o = pinned(p), quest = target.kind === "quest";
    const active = quest && p.quests?.some(q => q.id === target.questId);
    const previouslyCompleted = quest && (p.history?.completedIdsKnown && p.history.completedIds.includes(target.questId) || p.history?.recent.some(e => e.id === target.questId && e.completedAt * 1000 <= Date.parse(p.source.updatedAt)));
    const rep = target.kind === "reputation";
    if (rep && !p.ledger?.reputations?.factions.some(f => f.id === target.factionId && f.standing + 1 === target.targetStanding)) return "";
    const same = o?.kind === target.kind && matches(o, p) && (quest ? o.questId === target.questId : rep ? o.factionId === target.factionId && o.targetStanding === target.targetStanding : o.skillLineId === target.skillLineId && o.targetRank === target.targetRank);
    if (same && !(o.completion && active && previouslyCompleted)) return '<button type="button" data-nav="now">View pinned objective</button>';
    if (previouslyCompleted && !active) return "";
    const intent = action(p, o, target);
    if (!o) return `<button type="button" data-objective-change="${intent}">${quest ? "Pin quest objective" : rep ? "Pin reputation target" : "Pin rank objective"}</button>`;
    return `<span class="objective-confirm"><button type="button" data-objective-confirm aria-expanded="false">Replace pinned objective</button><span data-objective-confirmation hidden><small>Replace ${esc(label(o))}?</small> <button type="button" data-objective-change="${intent}">Confirm replacement</button> <button type="button" data-objective-cancel>Keep current objective</button></span></span>`;
  }

  function card({ suggested = false, dismiss = "", profileId } = {}) {
    const p = character(), o = pinned(p);
    if (!p || (profileId !== undefined && p.id !== profileId)) return "";
    const heading = `<h2 tabindex="-1" data-objective-heading${suggested ? " data-now-next-heading" : ""}>${suggested ? "Do this next" : "Your objective"}</h2>`;
    if (!o) return `<article class="now-card now-objective" data-now-objective>${heading}<p>No objective pinned for ${esc(p.name)}. ${p.source ? "Pin a quest, profession rank, or reputation target to resume it here." : "Save this character from WoW before pinning an objective."}</p>${p.source ? '<div class="now-actions"><button type="button" data-nav="quest-guide">Find a quest</button><button type="button" data-nav="preparation">Professions</button><button type="button" data-nav="ledger-reputation">Reputation</button></div>' : ""}</article>`;
    const same = matches(o, p), quest = o.kind === "quest", rep = o.kind === "reputation";
    const savedAt = Date.parse(p.source?.updatedAt), elapsed = new Date().getTime() - savedAt;
    let step, evidence, blocked;
    if (!same) {
      step = "This objective belongs to a different game identity or build. Clear it or pin a new objective from this character’s current save.";
      blocked = true;
    } else if (o.completion) {
      step = quest ? "Completed from saved quest history." : rep ? "Completed from a saved faction standing." : "Completed from a saved profession rank.";
      evidence = `Evidence saved ${date(o.completion.at)}`;
    } else if (quest) {
      const q = p.quests?.find(row => row.id === o.questId);
      const next = q?.objectives?.find(row => !row.done && row.text);
      const reason = !o.build ? "Completion remains unverified without a known client build."
        : !Number.isFinite(elapsed) || elapsed < 0 ? "The save time is unknown."
        : elapsed >= MAX_QUEST_SAVE_AGE ? "The last save is too old to recommend a step."
        : !q ? (Array.isArray(p.quests) ? "This quest is not in the last saved quest log." : "No quest log was observed in the last save.")
        : !q.complete && !next ? "No unfinished objective was observed for this quest." : "";
      blocked = Boolean(reason);
      step = reason || (q.complete ? "Required: hand in this quest. Ready to turn in is not a completed turn-in." : next.text);
      if (Number.isFinite(elapsed) && elapsed >= 0) evidence = `Character snapshot · ${date(savedAt)}`;
    } else if (rep) {
      const f = p.ledger?.reputations?.factions.find(row => row.id === o.factionId);
      step = f ? `Last saved at ${standings[f.standing]}. ${f.standing >= o.targetStanding ? "Save a fresh observation to verify completion." : "Check Ledger for quests and turn-ins."}` : "No saved standing for this faction. Expand its group in WoW and save again.";
      if (f) evidence = f.observedAt ? `Faction observation · ${date(f.observedAt * 1000)}` : "Saved Ledger standing · observation time unknown";
    } else {
      const saved = p.readiness?.workshop?.professions;
      const skill = saved?.items.find(row => row.skillLineId === o.skillLineId);
      step = skill ? `Last seen at rank ${skill.rank}. Open Professions to check the next craft and materials.` : "Open this profession in WoW and save again. No matching rank observation is available.";
      if (skill) evidence = `Profession snapshot · ${date(saved.observedAt)}`;
    }
    if (same && !quest && !o.build && !o.completion) step += " Completion remains unverified without a known client build.";
    const resumeLabel = quest ? (blocked ? "Review pinned quest" : "Resume quest") : rep ? "Resume reputation" : "Resume profession";
    const progress = blocked ? `<p><strong>Plan B:</strong> No supported next step. ${esc(step)}</p>` : `<p>${esc(step)}</p>`;
    return `<article class="now-card now-objective${suggested ? " now-next" : ""}" data-now-objective>${heading}<p class="now-saved-at">Returning briefing</p><p class="objective-title"><strong>${esc(label(o))}</strong></p>${progress}${suggested ? '<p class="now-reason"><strong>Why this?</strong> You pinned this objective.</p>' : ""}<small>Desktop-only plan · ${evidence ? esc(evidence) : "No matching evidence"}. Not sent to WoW.</small><p class="now-saved-at">${esc(saveAge(elapsed))}</p><div class="now-actions">${same && !o.completion ? `<button type="button"${suggested ? ' class="primary"' : ""} data-objective-resume="${esc(o.id)}">${resumeLabel}</button>` : ""}${dismiss}<button type="button" data-objective-change="${action(p, o, null)}">Clear objective</button></div></article>`;
  }
  function recommendation(profileId) {
    const p = character(), o = pinned(p);
    return p?.id === profileId && o ? resume(o.id) : null;
  }
  function resume(id) {
    const p = character(), o = pinned(p);
    return o?.id === id && matches(o, p) && !o.completion ? o : null;
  }
  return { init: read => { getState = read; }, card, recommendation, pin, resume, standingName: n => standings[n] };
})();
