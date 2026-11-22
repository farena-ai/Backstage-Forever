"use strict";
// Gear planning pages (roadmap C3, C2, C10, G5, C11):
//  - GearPlanView: Characters → Sheet → "Gear plan": stat weights you can edit and, per slot, what
//    you wear, up to three upgrades you can reach, and one pinned target.
//  - RepPlannerView: Ledger → Reputation: what reaches a chosen standing, and Ledger → Bags & bank:
//    the collection the saved bags and bank prove.
//  - AttunementsView: Adventure → Dungeons & raids → "Keys & attunements".
// Everything shown comes from the main process (gear-planning-ipc.cjs); numbers are validated there
// and every text from saved data is escaped here. Item hover cards come from data-card-item.
(() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const quality = (q) => QUALITY[q] || "common";
  const active = () => document.getElementById("active-character")?.value || null;
  const icon = (it, size = 28) => (it?.iconFileId && window.GameIcons ? GameIcons.tag(it.iconFileId, size) : `<span class="gp-gem q-${quality(it?.quality)}" aria-hidden="true">◆</span>`);
  const pct = (chance) => (Number.isFinite(chance) ? `${chance >= 0.1 ? Math.round(chance * 100) : Math.round(chance * 1000) / 10}%` : "");
  const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  function coins(copper) {
    const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
    return [g ? `${g.toLocaleString()}g` : "", s ? `${s}s` : "", c || (!g && !s) ? `${c}c` : ""].filter(Boolean).join(" ");
  }
  function ago(at) {
    if (!Number.isFinite(at) || at <= 0) return "";
    const s = Math.max(0, Math.floor(Date.now() / 1000) - at);
    if (s < 120) return "just now";
    if (s < 7200) return `${Math.round(s / 60)} minutes ago`;
    if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
    return `${Math.round(s / 86400)} days ago`;
  }

  // ---------------------------------------------------------------------------------------------
  // Gear plan and stat weights (inside the Sheet page)
  // ---------------------------------------------------------------------------------------------
  window.GearPlanView = (() => {
    let view = "sheet", mountedFor = null, forProfile = null;
    let weights = null, plan = null, error = "", loading = false, loadedAt = 0, weightsOpen = false, status = "", request = 0;

    function switcher() {
      const tab = (id, label) => `<button type="button" role="tab" data-gear-view="${id}" aria-selected="${view === id}" tabindex="${view === id ? 0 : -1}">${label}</button>`;
      return `<div class="gp-switch" role="tablist" aria-label="Sheet views">${tab("sheet", "Sheet")}${tab("plan", "Gear plan")}</div>`;
    }
    /** Markup the Sheet page places under its hero: the view switch and the plan's own container. */
    const frame = () => `${switcher()}<div class="gp-plan" data-gear-plan>${view === "plan" ? body() : ""}</div>`;

    function sourceLine(s) {
      if (s.kind === "quest") {
        const from = s.giver ? ` · from ${esc(s.giver.name)}${s.giver.zone ? `, ${esc(s.giver.zone)}` : ""}` : "";
        const when = s.inLog ? " · in your quest log" : s.later && s.minLevel ? ` · from level ${s.minLevel}` : "";
        return `<span class="gp-kind">Quest</span> ${esc(s.title)}${s.choice ? " (one of the reward choices)" : ""}${from}${when}`;
      }
      if (s.kind === "vendor") return `<span class="gp-kind">Vendor</span> ${esc(s.name)}${s.zone ? `, ${esc(s.zone)}` : ""} · ${s.price ? `you saw it for ${esc(coins(s.price.copper))}${s.price.count > 1 ? ` per ${s.price.count}` : ""}` : "price not seen yet"}`;
      if (s.kind === "dungeon") return `<span class="gp-kind">Dungeon</span> ${esc(s.boss)}, ${esc(s.instance)} · ${esc(pct(s.chance))} chance (seen in ${plural(s.drops, "loot")})`;
      if (s.kind === "drop") return `<span class="gp-kind">Drop</span> ${esc(s.name)} · ${esc(pct(s.chance))} chance (seen in ${plural(s.drops, "loot")})`;
      if (s.kind === "craft") return `<span class="gp-kind">Craft</span> ${esc(s.name)} (${esc(s.profession)}, a recipe you know)${s.reagents?.length ? ` · ${s.reagents.map((r) => `${r.required} ${esc(r.name || `item #${r.itemId}`)}`).join(", ")}` : ""}`;
      return "";
    }
    function candidate(u, slot, isPin) {
      const gain = Number.isFinite(u.delta) ? `<em class="gp-gain${u.delta > 0 ? "" : " gp-loss"}">${u.delta > 0 ? "+" : ""}${u.delta}</em>` : "";
      const facts = [u.later && u.requiredLevel ? `Usable from level ${u.requiredLevel}` : "", u.twoHanded ? "Two-handed: replaces both hands" : "", u.owned ? `Already in your ${u.owned === "bank" ? "bank" : "bags"}` : "", u.worn ? "You wear it now" : "", ...(u.reasons || [])].filter(Boolean);
      const sources = (u.sources || []).map((s) => `<li>${sourceLine(s)}</li>`).join("");
      const more = u.moreSources ? `<li class="gp-more">and ${plural(u.moreSources, "more source")}</li>` : "";
      const none = !sources && !u.unknown ? `<li class="gp-more">No source in the data any more.</li>` : "";
      const pinned = isPin || u.pinned;
      return `<li class="gp-cand${pinned ? " gp-pinned" : ""}" data-gear-candidate="${u.itemId}">
        <span class="gp-icon" data-card-item="${u.itemId}">${icon(u)}</span>
        <div class="gp-what"><p class="gp-name"><strong class="q-${quality(u.quality)}" data-card-item="${u.itemId}">${esc(u.name)}</strong>${gain}${pinned ? '<span class="gp-flag">Your target</span>' : ""}</p>
          ${facts.length ? `<p class="gp-facts">${facts.map(esc).join(" · ")}</p>` : ""}
          <ul class="gp-sources">${sources}${more}${none}</ul></div>
        <button type="button" class="gp-pin" data-gear-pin="${pinned ? "" : u.itemId}" data-gear-slot="${slot}" aria-pressed="${pinned ? "true" : "false"}" aria-label="${pinned ? "Remove target" : "Pin as target"}: ${esc(u.name)}">${pinned ? "Unpin" : "Pin"}</button></li>`;
    }
    function slotRow(s) {
      const worn = s.worn
        ? `<p class="gp-worn" data-card-item="${s.worn.itemId}">${icon(s.worn, 32)}<span><strong class="q-${quality(s.worn.quality)}">${esc(s.worn.name)}</strong><small>${[Number.isFinite(s.worn.itemLevel) && s.worn.itemLevel > 0 ? `item level ${s.worn.itemLevel}` : "", s.worn.score !== null ? `score ${s.worn.score}` : "stats unknown"].filter(Boolean).join(" · ")}</small></span></p>`
        : `<p class="gp-worn gp-none"><span class="gp-gem" aria-hidden="true">◇</span><span><strong>Empty</strong><small>nothing worn</small></span></p>`;
      const pinOutside = s.pinned && !s.upgrades.some((u) => u.pinned) ? candidate(s.pinned, s.slot, true) : "";
      const list = `${pinOutside}${s.upgrades.map((u) => candidate(u, s.slot, false)).join("")}`;
      return `<article class="gp-slot" data-gear-slot-row="${s.slot}"><header><h3>${esc(s.label)}</h3>${worn}</header>
        <div class="gp-ups">${list ? `<ul>${list}</ul>` : ""}${s.note ? `<p class="gp-nothing">${esc(s.note)}</p>` : ""}</div></article>`;
    }
    function weightsCard() {
      if (!weights) return "";
      const w = weights;
      const summary = w.isDefault ? `${esc(w.presetLabel)} preset (default)` : `${esc(w.presetLabel)} preset${w.changed ? ` · ${plural(w.changed, "weight")} changed` : ""}`;
      const rows = w.stats.map((s) => `<li class="gp-stat${s.changed ? " gp-changed" : ""}"><label for="gp-w-${esc(s.key.replace(/\s+/g, "-"))}">${esc(s.label)}</label>
        <input type="range" min="0" max="${s.max}" step="${s.step}" value="${s.value}" data-gear-weight="${esc(s.key)}" aria-label="${esc(s.label)} weight (slider)">
        <input type="number" id="gp-w-${esc(s.key.replace(/\s+/g, "-"))}" min="0" max="${s.max}" step="${s.step}" value="${s.value}" data-gear-weight="${esc(s.key)}" inputmode="decimal" aria-label="${esc(s.label)} weight">
        <small>${s.changed ? `preset ${s.preset}` : ""}</small></li>`).join("");
      return `<details class="sht-card gp-weights" data-gear-weights${weightsOpen ? " open" : ""}><summary><span>Stat weights</span><small>${summary}</small></summary>
        <p class="sht-note">Points per point of each stat. Every gear verdict for this character uses them: this plan, dungeon loot, item cards, the sheet and the upgrade marks in game (after the next /reload).</p>
        ${w.classKnown ? "" : '<p class="sht-note">This character has no class saved, so general weights are shown.</p>'}
        <div class="gp-weights-bar"><label>Preset <select data-gear-preset aria-label="Stat weight preset">${w.presets.map((p) => `<option value="${esc(p.id)}"${p.id === w.preset ? " selected" : ""}>${esc(p.label)}${p.id === "leveling" ? " (default)" : ""}</option>`).join("")}</select></label>
          <button type="button" data-gear-weights-reset${w.isDefault ? " disabled" : ""}>Reset to default</button><span class="gp-status" role="status" data-gear-status>${esc(status)}</span></div>
        <ul class="gp-stats">${rows}</ul></details>`;
    }
    function body() {
      if (error) return `<p class="sht-empty">${esc(error)}</p>`;
      if (!plan) return `<p class="sht-empty">${loading || !loadedAt ? "Working out your gear plan…" : "Pick or create a character first."}</p>`;
      if (plan.status !== "available") return `${weightsCard()}<p class="sht-empty">${esc(plan.reason)}</p>`;
      const c = plan.counts;
      const counted = [c.quest ? plural(c.quest, "quest reward") : "", c.vendor ? plural(c.vendor, "vendor item") : "", c.dungeon ? plural(c.dungeon, "boss drop") : "", c.drop ? plural(c.drop, "creature drop") : "", c.craft ? plural(c.craft, "recipe you know", "recipes you know") : ""].filter(Boolean).join(" · ");
      const pins = plan.pinnedIds.length;
      return `${weightsCard()}<section class="sht-card gp-card"><div class="gp-head"><h2>Gear plan</h2><span class="gp-count">${pins ? `${plural(pins, "target")} pinned` : "No target pinned yet"}</span></div>
        <p class="sht-note">For each slot: what you wear and up to ${plan.perSlot} upgrades you can use now or within ${plan.levelsAhead} levels, best first by your stat weights${plan.customWeights ? " (your own)" : ""}. A suggestion from the data on this computer, not a best-in-slot list. Pin one target per slot; pinned targets are marked in the in-game atlas like your wish list after the next /reload.</p>
        <p class="sht-note">Checked: ${counted || "no source data"}.${plan.carried ? " Some data was checked on another build of the same patch." : ""}</p>
        <div class="gp-slots">${plan.slots.map(slotRow).join("")}</div>
        <div class="gp-foot"><h3>Where this comes from</h3><ul>
          <li>Quest rewards, vendor goods and drops: bundled community reference. A quest may need earlier quests first; check in game.</li>
          <li>Item stats: your own game files. Random bonuses, enchants and set bonuses are not counted.</li>
          <li>Vendor prices: only what you saw in a vendor window yourself.</li>
          ${plan.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul></div></section>`;
    }
    function paint(root) {
      const host = root?.querySelector("[data-gear-plan]");
      if (!host) return;
      const focus = host.contains(document.activeElement) ? document.activeElement : null;
      const key = focus?.dataset.gearWeight ? `[data-gear-weight="${CSS.escape(focus.dataset.gearWeight)}"][type="${focus.type}"]` : focus?.dataset.gearSlot ? `[data-gear-slot="${focus.dataset.gearSlot}"]` : focus?.matches("[data-gear-preset]") ? "[data-gear-preset]" : null;
      host.innerHTML = view === "plan" ? body() : "";
      if (key) host.querySelector(key)?.focus({ preventScroll: true });
    }
    const owns = (root, id) => mountedFor === root && root.isConnected && active() === id;
    async function load(root, id) {
      if (loading) return;
      loading = true;
      const mine = ++request;
      let w = null, p = null, message = "";
      try { [w, p] = await Promise.all([api.statWeights(id), api.gearPlan(id)]); } catch (e) { message = e.message || "Your gear plan is unavailable."; }
      loading = false;
      if (mine !== request || !owns(root, id)) return;
      weights = w; plan = p; error = message; loadedAt = Date.now(); forProfile = id;
      paint(root);
    }
    async function saveWeights(root, id, choice) {
      const mine = ++request;
      status = "Saving…";
      const note = root.querySelector("[data-gear-status]"); if (note) note.textContent = status;
      try {
        const w = await api.setStatWeights(id, choice);
        const p = await api.gearPlan(id);
        if (mine !== request || !owns(root, id)) return;
        weights = w; plan = p; error = "";
        status = choice === null ? "Back to the default weights." : "Saved. Every gear verdict now uses these weights.";
        window.SheetView?.invalidate();
      } catch (e) {
        if (mine !== request || !owns(root, id)) return;
        status = e.message || "The weights could not be saved.";
      }
      paint(root);
    }
    function choiceFromInputs(root, changedInput) {
      const custom = {};
      for (const s of weights.stats) {
        const input = changedInput?.dataset.gearWeight === s.key ? changedInput : root.querySelector(`input[type="number"][data-gear-weight="${CSS.escape(s.key)}"]`);
        const n = Number(input?.value);
        if (Number.isFinite(n) && n >= 0) custom[s.key] = Math.min(s.max, n);
      }
      return { preset: weights.preset, custom };
    }
    function mounted(root, profileId) {
      if (!root) { mountedFor = null; return; }
      if (mountedFor === root) return;
      mountedFor = root;
      if (forProfile !== profileId) { weights = null; plan = null; error = ""; loadedAt = 0; status = ""; }
      root.addEventListener("click", async (e) => {
        if (mountedFor !== root) return;
        const tab = e.target.closest("[data-gear-view]");
        if (tab) {
          view = tab.dataset.gearView === "plan" ? "plan" : "sheet";
          root.dataset.sheetView = view;
          for (const b of root.querySelectorAll("[data-gear-view]")) { const on = b.dataset.gearView === view; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
          paint(root);
          const id = active();
          if (view === "plan" && id && (forProfile !== id || !loadedAt || Date.now() - loadedAt > 3000)) void load(root, id);
          return;
        }
        const id = active();
        if (!id) return;
        if (e.target.closest("[data-gear-weights-reset]")) { void saveWeights(root, id, null); return; }
        const pin = e.target.closest("[data-gear-pin]");
        if (pin) {
          const slot = Number(pin.dataset.gearSlot), itemId = pin.dataset.gearPin ? Number(pin.dataset.gearPin) : null;
          pin.disabled = true;
          const mine = ++request;
          try { const p = await api.setGearPin(id, slot, itemId); if (mine === request && owns(root, id)) { plan = p; error = ""; } }
          catch (err) { if (mine === request && owns(root, id)) status = err.message || "That target could not be pinned."; }
          if (owns(root, id)) paint(root);
        }
      });
      root.addEventListener("input", (e) => {
        // Slider and number box of one stat move together while you drag or type.
        const input = e.target.closest?.("[data-gear-weight]");
        if (!input || mountedFor !== root) return;
        for (const twin of root.querySelectorAll(`[data-gear-weight="${CSS.escape(input.dataset.gearWeight)}"]`)) if (twin !== input) twin.value = input.value;
      });
      root.addEventListener("change", (e) => {
        if (mountedFor !== root || !weights) return;
        const id = active();
        if (!id) return;
        if (e.target.matches?.("[data-gear-preset]")) { void saveWeights(root, id, { preset: e.target.value, custom: {} }); return; }
        const input = e.target.closest?.("[data-gear-weight]");
        if (input) void saveWeights(root, id, choiceFromInputs(root, input));
      });
      root.addEventListener("toggle", (e) => { if (e.target.matches?.("[data-gear-weights]")) weightsOpen = e.target.open; }, true);
      document.getElementById("active-character")?.addEventListener("change", () => {
        if (mountedFor !== root) return;
        weights = null; plan = null; error = ""; loadedAt = 0; status = ""; forProfile = null; request++;
        paint(root);
        const id = active();
        if (view === "plan" && id) void load(root, id);
      });
      if (view === "plan" && profileId && (!loadedAt || Date.now() - loadedAt > 3000)) void load(root, profileId);
    }
    return { frame, mounted, view: () => view, show: (v) => { view = v === "plan" ? "plan" : "sheet"; }, invalidate: () => { loadedAt = 0; } };
  })();

  // ---------------------------------------------------------------------------------------------
  // Reputation planner and collections (inside the Ledger pages)
  // ---------------------------------------------------------------------------------------------
  window.RepPlannerView = (() => {
    const STANDINGS = ["", "Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
    const plans = new Map(), targets = new Map(), owned = new Map();
    let mountedFor = null;
    const key = (profileId, factionId) => `${profileId}|${factionId}|${targets.get(`${profileId}|${factionId}`) ?? ""}`;
    const amount = (x) => `${x.exact ? "" : "about "}${x.amount.toLocaleString()}`;
    const place = (p) => (p ? `${esc(p.name)}${p.zone ? `, ${esc(p.zone)}` : ""}` : "");
    const statusText = (x) => (x.status === "turn-in" ? "In your log, ready to hand in" : x.status === "in-log" ? "In your quest log" : x.later && x.minLevel ? `From level ${x.minLevel}` : "");

    function handIn(h, target) {
      const held = h.items.map((r) => `${esc(r.name)}: ${r.held.toLocaleString()} of ${r.required.toLocaleString()} per hand-in (${r.bags.toLocaleString()} in bags, ${r.bank.toLocaleString()} in bank)`).join("; ");
      const need = h.handInsNeeded === null ? "" : `<p><strong>${plural(h.handInsNeeded, "hand-in")}</strong> to reach ${esc(target)} if it repeats: ${h.itemsNeeded.map((r) => `${r.total.toLocaleString()} ${esc(r.name)}${r.missing ? ` (${r.missing.toLocaleString()} more than you hold)` : " (you hold enough)"}`).join(", ")}.</p>`;
      const where = h.turnIn ? `Hand in to ${place(h.turnIn)}` : h.giver ? `Starts with ${place(h.giver)}` : "";
      return `<li data-rep-hand-in="${h.id}"><div class="rp-row"><strong>${esc(h.title)}</strong><span class="rp-amount">${amount(h)} per hand-in</span></div>
        ${need}<p>You hold enough for <strong>${plural(h.heldHandIns, "hand-in")}</strong>. ${held}.</p>
        <small>${[where ? `${where} (reference)` : "", statusText(h), h.handedInBefore ? "You handed this in before; it only counts again if it repeats" : "", h.exact ? "Amount recorded in the quest data" : "Standard amount for this reward size"].filter(Boolean).join(" · ")}</small></li>`;
    }
    function questRow(q) {
      const where = q.status === "turn-in" && q.turnIn ? `Hand in to ${place(q.turnIn)}` : q.giver ? `Starts with ${place(q.giver)}` : "";
      return `<li data-rep-quest="${q.id}"><div class="rp-row"><strong>${esc(q.title)}</strong><span class="rp-amount">${amount(q)}</span></div>
        <small>${[statusText(q), where ? `${where} (reference)` : "", q.exact ? "Amount recorded in the quest data" : "Standard amount for this reward size"].filter(Boolean).join(" · ")}</small></li>`;
    }
    function planBody(p) {
      if (!p) return `<p class="ldg-note" role="status">Working out the plan…</p>`;
      if (p.error) return `<p class="ldg-empty">${esc(p.error)}</p>`;
      if (p.status !== "available") return `<p class="ldg-empty">${esc(p.reason)}</p>`;
      if (!p.target) return `<p class="ldg-empty">${esc(p.faction.name)} is already at Exalted.</p>`;
      const t = p.totals, target = p.target.name;
      const head = p.need === null ? `<p class="rp-need"><strong>Points to ${esc(target)} unknown.</strong></p>` : `<p class="rp-need"><strong>${p.need.toLocaleString()}</strong> reputation from ${esc(p.faction.standingName)} (as saved) to ${esc(target)}.</p>`;
      const once = t && t.openQuests + t.handIns ? `<p class="ldg-note">Every quest you can take now, and each hand-in once, gives ${t.questsExact ? "" : "about "}<strong>${t.questPoints.toLocaleString()}</strong> in all${t.questsCover === null ? "" : t.questsCover ? `: enough to reach ${esc(target)}` : `: not enough on its own for ${esc(target)}`}. ${t.doneQuests ? `${plural(t.doneQuests, "quest")} with this faction already finished.` : ""}</p>` : "";
      const bags = p.bagsSeenAt ? `bags seen ${esc(ago(p.bagsSeenAt))}` : "bags not saved yet", bank = p.bankKnown ? `bank seen ${esc(ago(p.bankSeenAt))}` : "bank never opened";
      return `${head}
        <h3>Goods hand-ins</h3>
        ${p.handIns.length ? `<p class="ldg-note">Source: quest reference for the hand-in, your saved Ledger for what you hold (${bags}; ${bank}).${t.handIns > p.handIns.length ? ` Showing ${p.handIns.length} of ${t.handIns}.` : ""}</p><ul class="rp-list">${p.handIns.map((h) => handIn(h, target)).join("")}</ul>` : `<p class="ldg-empty">The data has no goods hand-in for this faction that this character can take.</p>`}
        <h3>Quests</h3>${once}
        ${p.quests.length ? `<p class="ldg-note">Source: quest reference${p.referenceBuild ? ` (game build ${esc(p.referenceBuild)})` : ""}. A quest may need earlier quests first.${t.quests > p.quests.length ? ` Showing ${p.quests.length} of ${t.quests}.` : ""}</p><ul class="rp-list">${p.quests.map(questRow).join("")}</ul>` : `<p class="ldg-empty">The data has no open quest that pays reputation with this faction for this character.</p>`}
        <h3>Dungeon runs</h3><p class="ldg-empty">${esc(p.dungeons?.note || "No data.")}</p>
        ${p.notes.length ? `<ul class="rp-notes">${p.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`;
    }
    /** The planner card for one character and the faction picked in the plan above it. */
    function section(profileId, faction) {
      if (!profileId || !faction) return "";
      const tk = `${profileId}|${faction.id}`;
      const max = faction.standing >= 8;
      let target = targets.get(tk);
      if (!Number.isInteger(target) || target <= faction.standing) { target = Math.min(8, faction.standing + 1); targets.set(tk, target); }
      const options = [];
      for (let s = faction.standing + 1; s <= 8; s++) options.push(`<option value="${s}"${s === target ? " selected" : ""}>${STANDINGS[s]}</option>`);
      return `<section class="ldg-card rp-card" data-rep-planner data-rep-profile="${esc(profileId)}" data-rep-faction="${faction.id}">
        <div class="ldg-toolbar"><h2>Reach a standing with ${esc(faction.name)}</h2>${max ? "" : `<label class="ldg-pick">Standing to reach <select data-rep-target aria-label="Standing to reach">${options.join("")}</select></label>`}</div>
        <div data-rep-body>${planBody(plans.get(key(profileId, faction.id)))}</div></section>`;
    }
    async function loadPlan(node) {
      const profileId = node.dataset.repProfile, factionId = Number(node.dataset.repFaction), k = key(profileId, factionId);
      const target = targets.get(`${profileId}|${factionId}`) ?? null;
      let result;
      try { result = await api.repPlanner(profileId, factionId, target && target >= 2 ? target : null); } catch (e) { result = { error: e.message || "The reputation plan is unavailable." }; }
      plans.set(k, result);
      if (plans.size > 40) plans.delete(plans.keys().next().value);
      if (node.isConnected && key(profileId, factionId) === k) node.querySelector("[data-rep-body]").innerHTML = planBody(result);
    }
    function collectionBody(c) {
      if (!c) return `<p class="ldg-note" role="status">Looking through your bags…</p>`;
      if (c.error || c.status !== "available") return `<p class="ldg-empty">${esc(c.error || c.reason)}</p>`;
      const family = (f) => `<article class="co-family" data-collection="${esc(f.key)}"><h3>${esc(f.label)} <span class="ldg-count">${f.count}</span></h3>
        ${f.items.length ? `<ul>${f.items.map((it) => `<li data-card-item="${it.itemId}"><strong class="q-${quality(it.quality)}">${esc(it.name)}</strong>${it.count > 1 ? ` ×${it.count}` : ""}<small>${esc(it.where.join(", "))}</small></li>`).join("")}</ul>` : `<p class="co-none">None in your bags or bank.</p>`}</article>`;
      const known = `<article class="co-family" data-collection="known"><h3>Recipes you know <span class="ldg-count">${c.recipesKnown}</span></h3>
        ${c.recipes.length ? `<ul>${c.recipes.map((r) => `<li><strong>${esc(r.profession)}</strong><small>${plural(r.count, "recipe")}${r.rank ? ` · skill ${r.rank}` : ""}</small></li>`).join("")}</ul>` : `<p class="co-none">${c.recipesSeen ? "No recipes saved." : "Open a profession window in game, then /reload."}</p>`}</article>`;
      return `<div class="co-grid">${c.families.map(family).join("")}${known}</div><ul class="rp-notes">${c.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
    }
    /** The collections card for one character (Ledger → Bags & bank). */
    function collectionSection(characters, activeId) {
      if (!characters?.length) return "";
      const pick = characters.find((c) => c.profileId === collectionFor) || characters.find((c) => c.profileId === activeId) || characters[0];
      return `<section class="ldg-card co-card" data-collections data-collections-profile="${esc(pick.profileId)}">
        <div class="ldg-toolbar"><h2>Collections</h2><label class="ldg-pick">Character <select data-collections-pick aria-label="Collections of">${characters.map((c) => `<option value="${esc(c.profileId)}"${c === pick ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label></div>
        <p class="ldg-note">Mounts, companion pets, tabards and recipes that the saved bags, bank and worn gear prove you own. Nothing is guessed.</p>
        <div data-collections-body>${collectionBody(owned.get(pick.profileId))}</div></section>`;
    }
    let collectionFor = null;
    async function loadCollection(node) {
      const id = node.dataset.collectionsProfile;
      let result;
      try { result = await api.collections(id); } catch (e) { result = { error: e.message || "Collections are unavailable." }; }
      owned.set(id, result);
      if (owned.size > 40) owned.delete(owned.keys().next().value);
      if (node.isConnected && node.dataset.collectionsProfile === id) node.querySelector("[data-collections-body]").innerHTML = collectionBody(result);
    }
    function mounted(root) {
      if (!root) { mountedFor = null; return; }
      const fresh = mountedFor !== root;
      mountedFor = root;
      const node = root.querySelector("[data-rep-planner]");
      if (node) {
        if (fresh || !node.dataset.repBound) {
          node.dataset.repBound = "1";
          node.querySelector("[data-rep-target]")?.addEventListener("change", (e) => {
            targets.set(`${node.dataset.repProfile}|${node.dataset.repFaction}`, Number(e.target.value));
            node.querySelector("[data-rep-body]").innerHTML = planBody(plans.get(key(node.dataset.repProfile, Number(node.dataset.repFaction))));
            void loadPlan(node);
          });
          void loadPlan(node);
        }
      }
      const box = root.querySelector("[data-collections]");
      if (box && (fresh || !box.dataset.collectionsBound)) {
        box.dataset.collectionsBound = "1";
        box.querySelector("[data-collections-pick]")?.addEventListener("change", (e) => {
          collectionFor = e.target.value;
          box.dataset.collectionsProfile = collectionFor;
          box.querySelector("[data-collections-body]").innerHTML = collectionBody(owned.get(collectionFor));
          void loadCollection(box);
        });
        void loadCollection(box);
      }
    }
    return { section, collectionSection, mounted, invalidate: () => { plans.clear(); owned.clear(); } };
  })();

  // ---------------------------------------------------------------------------------------------
  // Attunements and keys (opened with a button on Dungeons & raids)
  // ---------------------------------------------------------------------------------------------
  window.AttunementsView = (() => {
    let data = null, error = "", loading = false, loadedAt = 0, loadedFor = null, mountedFor = null, show = "open";
    const STATUS = { done: "Done", started: "Under way", "not-started": "Not started", unknown: "Progress unknown", unconfirmed: "Not confirmed in WoW Forever" };
    const STEP = { done: "Done", "in-log": "In your quest log", "in-progress": "Under way", todo: "To do", unconfirmed: "Not confirmed in WoW Forever" };
    const WHERE = { worn: "you wear it", bags: "in your bags", bank: "in your bank", keyring: "on your key ring" };

    function step(s, n, current) {
      const detail = s.detail ? (WHERE[s.detail] || s.detail) : "";
      const seen = s.seenFrom ? ` Seen dropping from ${esc(s.seenFrom.boss)} in the Forever loot data.` : "";
      return `<li class="at-step s-${esc(s.state)}${current ? " at-current" : ""}"${s.itemId ? ` data-card-item="${s.itemId}"` : ""}>
        <span class="at-mark" aria-hidden="true">${s.state === "done" ? "✓" : s.state === "unconfirmed" ? "?" : n}</span>
        <div><p><strong>${esc(s.title)}</strong> <span class="at-type">${s.type === "item" ? "Item" : "Quest"}</span>${current ? '<span class="at-here">You are here</span>' : ""}</p>
          <p class="at-how">${esc(s.how)}${seen}</p></div>
        <span class="at-state">${esc(STEP[s.state])}${detail ? `<small>${esc(detail)}</small>` : ""}</span></li>`;
    }
    function chain(c) {
      const progress = c.status === "unconfirmed" ? "" : `${c.finishedSteps} of ${c.totalSteps} ${c.totalSteps === 1 ? "step" : "steps"}`;
      const key = c.key ? `<p class="at-key" data-card-item="${c.key.itemId}"><span>Key</span> <strong>${esc(c.key.name)}</strong>${c.key.held ? ` · ${esc(WHERE[c.key.held])}` : ""}${c.key.confirmed ? "" : " · not confirmed in WoW Forever"}</p>` : "";
      const next = c.current ? `<p class="at-next"><span>Next</span> ${esc(c.current.title)}: ${esc(c.current.how)}</p>` : c.status === "done" ? `<p class="at-next at-finished"><span>Done</span> Nothing left to do here.</p>` : "";
      return `<article class="at-chain st-${esc(c.status)}" data-attunement="${esc(c.id)}">
        <header><div><h3>${esc(c.name)}</h3><p class="at-meta">${esc(c.kind)}${c.side ? ` · ${esc(c.side)}` : ""} · level ${esc(c.levels)}</p></div>
          <span class="at-status">${esc(STATUS[c.status])}${progress ? `<small>${esc(progress)}</small>` : ""}</span></header>
        <p class="at-opens">${esc(c.opens)}</p>${key}${next}
        <details${c.status === "started" ? " open" : ""}><summary>${plural(c.steps.length, "step")}${c.unconfirmedSteps ? ` · ${c.unconfirmedSteps} not confirmed` : ""}</summary>
          <ol class="at-steps">${c.steps.map((s, i) => step(s, i + 1, i === c.currentIndex)).join("")}</ol></details></article>`;
    }
    function body() {
      if (error) return `<p class="at-empty">${esc(error)}</p>`;
      if (!data) return `<p class="at-empty">${loading || !loadedAt ? "Opening your keys…" : "Nothing to show."}</p>`;
      const list = data.chains.filter((c) => show === "all" || c.status !== "done");
      const who = data.profileId ? `${data.counts.done} of ${data.counts.total} done · ${data.counts.started} under way` : "No character picked";
      return `<div class="at-bar"><p class="at-reference"><strong>Reference.</strong> ${data.notes.map(esc).join(" ")}</p>
          <div class="at-filter"><span>${esc(who)}</span><button type="button" data-attunement-show="${show === "all" ? "open" : "all"}" aria-pressed="${show === "all"}">${show === "all" ? "Hide finished" : "Show finished too"}</button></div></div>
        ${list.length ? `<div class="at-grid">${list.map(chain).join("")}</div>` : `<p class="at-empty">Every key and attunement listed here is done.</p>`}
        <p class="at-source">Quest names and ids are checked against the bundled quest data${data.referenceBuild ? ` (game build ${esc(data.referenceBuild)})` : ""}; key items against your own game files. Where to go and what to do is classic-era reference text and was not checked in WoW Forever. Your progress comes from your saved quests and bags only.</p>`;
    }
    function page() {
      return `<section class="at-page" data-attunements>${PageHero.render({ art: "dungeons", eyebrow: "Adventure · Dungeons & raids", title: "Keys & attunements", subtitle: "The classic keys and attunement chains, and the step this character is on.", compact: true,
        aside: `<button type="button" class="atlas-history-link" data-nav="dungeons" data-shell-control="attunements-back"><span aria-hidden="true">←</span> Dungeons &amp; raids</button>` })}<div data-attunements-body>${body()}</div></section>`;
    }
    function paint() {
      const host = document.querySelector("[data-attunements] [data-attunements-body]");
      if (host) host.innerHTML = body();
    }
    async function load() {
      if (loading) return;
      loading = true;
      const id = active();
      let result = null, message = "";
      try { result = await api.attunements(id); } catch (e) { message = e.message || "This page is unavailable."; }
      loading = false;
      if (active() !== id) { if (document.querySelector("[data-attunements]")) void load(); return; }
      data = result; error = message; loadedAt = Date.now(); loadedFor = id;
      paint();
    }
    function mounted() {
      const root = document.querySelector("[data-attunements]");
      if (!root) { mountedFor = null; return; }
      if (mountedFor !== root) {
        mountedFor = root;
        root.addEventListener("click", (e) => {
          const b = e.target.closest("[data-attunement-show]");
          if (!b) return;
          show = b.dataset.attunementShow === "all" ? "all" : "open";
          paint();
          root.querySelector("[data-attunement-show]")?.focus({ preventScroll: true });
        });
        document.getElementById("active-character")?.addEventListener("change", () => { if (mountedFor === root) { data = null; error = ""; loadedAt = 0; paint(); void load(); } });
      }
      if (!loading && (loadedFor !== active() || !loadedAt || Date.now() - loadedAt > 3000)) void load();
    }
    return { page, mounted, invalidate: () => { loadedAt = 0; } };
  })();
})();
