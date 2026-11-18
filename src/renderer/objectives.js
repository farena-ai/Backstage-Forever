"use strict";
window.ObjectiveView = (() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const date = value => new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  let getState = () => null;
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

  function card() {
    const p = character(), o = pinned(p);
    if (!p) return "";
    const heading = '<h2 tabindex="-1" data-objective-heading>Your objective</h2>';
    if (!o) return `<article class="now-card now-objective" data-now-objective>${heading}<p>No objective pinned for ${esc(p.name)}. ${p.source ? "Pin a quest, profession rank, or reputation target to resume it here." : "Save this character from WoW before pinning an objective."}</p>${p.source ? '<div class="now-actions"><button type="button" data-nav="quest-guide">Find a quest</button><button type="button" data-nav="preparation">Professions</button><button type="button" data-nav="ledger-reputation">Reputation</button></div>' : ""}</article>`;
    const same = matches(o, p), quest = o.kind === "quest", rep = o.kind === "reputation";
    let step, evidence;
    if (!same) {
      step = "This objective belongs to a different game identity or build. Clear it or pin a new objective from this character’s current save.";
    } else if (o.completion) {
      step = quest ? "Completed from saved quest history." : rep ? "Completed from a saved faction standing." : "Completed from a saved profession rank.";
      evidence = `Evidence saved ${date(o.completion.at)}`;
    } else if (quest) {
      const q = p.quests?.find(row => row.id === o.questId);
      const next = q?.objectives.find(row => !row.done);
      step = q?.complete ? "Hand in this quest. Ready to turn in is not a completed turn-in." : next?.text || (q ? "Continue the quest in your in-game log." : "Check the quest guide and your in-game log. No matching saved log entry; completion is unverified.");
      evidence = `Character snapshot · ${date(p.source.updatedAt)}`;
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
    if (same && !o.build && !o.completion) step += " Completion remains unverified without a known client build.";
    return `<article class="now-card now-objective" data-now-objective>${heading}<p class="objective-title"><strong>${esc(label(o))}</strong></p><p>${esc(step)}</p><small>Desktop-only plan · ${evidence ? esc(evidence) : "No matching evidence"}. Not sent to WoW.</small><div class="now-actions">${same && !o.completion ? `<button type="button" class="primary" data-objective-resume="${esc(o.id)}">${quest ? "Resume quest" : rep ? "Resume reputation" : "Resume profession"}</button>` : ""}<button type="button" data-objective-change="${action(p, o, null)}">Clear objective</button></div></article>`;
  }
  function resume(id) {
    const p = character(), o = pinned(p);
    return o?.id === id && matches(o, p) && !o.completion ? o : null;
  }
  return { init: read => { getState = read; }, card, pin, resume, standingName: n => standings[n] };
})();
