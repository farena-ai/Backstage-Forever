"use strict";
// Characters → Sheet (0.36, G5 + A12): the active character's gear as a paper doll with quality
// colours, item level and how each piece holds up, empty slots, base stats the addon read in
// game, upgrades already in the bags or bank, and the gear sets saved with /bf set with where
// every piece is now. An Atlas handoff looks up one exact item. Item hover cards come from
// data-card-item (hover-cards.js).
window.SheetView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const quality = (q) => QUALITY[q] || "common";
  const RATING = { fresh: "Holds up", aging: "Getting old", replace: "Time to replace" };
  const WHERE = { worn: "Worn", bags: "In your bags", bank: "In the bank", mail: "In the mail", other: "On", missing: "Not found" };
  let data = null, error = "", loadedAt = 0, loadedProfile = null, mountedFor = null, selection = null;
  let pair = null, pairFocus = null;
  const active = () => document.getElementById("active-character")?.value || null;
  const nowSec = () => Math.floor(Date.now() / 1000);
  function ago(at) {
    if (!Number.isFinite(at)) return "";
    const s = Math.max(0, nowSec() - at);
    if (s < 120) return "just now";
    if (s < 7200) return `${Math.round(s / 60)} minutes ago`;
    if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
  const icon = (it, size = 40) => (it?.iconFileId && window.GameIcons ? GameIcons.tag(it.iconFileId, size) : `<span class="sht-gem q-${quality(it?.quality)}" aria-hidden="true">◆</span>`);
  function hero() {
    const who = data ? [data.level ? `Level ${data.level}` : "", data.race, data.className, data.faction].filter(Boolean).join(" · ") : "";
    return PageHero.render({ art: "characters", eyebrow: "Characters · Sheet", title: esc(data?.name || "Character sheet"), character: data, subtitle: esc(who || "Your gear, stats and gear sets.") });
  }
  function empty(what) {
    return `<p class="sht-empty">${what} Log in with the addon on, then type <code>/reload</code> (or log out) once so the desktop app receives it.</p>`;
  }

  function slotTile(s) {
    if (!s.item) return `<li class="sht-slot sht-empty-slot${s.missing ? " sht-missing" : ""}" data-sheet-slot="${s.slot}"><span class="sht-frame" aria-hidden="true"></span><span class="sht-words"><small>${esc(s.label)}</small><strong>${s.missing ? "Empty" : "—"}</strong></span></li>`;
    const it = s.item;
    return `<li class="sht-slot q-${quality(it.quality)}${it.rating ? " r-" + it.rating : ""}" data-sheet-slot="${s.slot}" data-card-item="${it.itemId}"><span class="sht-frame">${icon(it)}</span><span class="sht-words"><small>${esc(s.label)}${Number.isFinite(it.itemLevel) && it.itemLevel > 0 ? ` · item level ${it.itemLevel}` : ""}</small><strong class="q-${quality(it.quality)}">${esc(it.name)}</strong>${it.rating ? `<em class="sht-rating">${esc(RATING[it.rating])}</em>` : ""}</span></li>`;
  }
  function stats() {
    const s = data.stats;
    if (!s) return `<p class="sht-note">Stats arrive after a /reload with the addon on.</p>`;
    const row = (label, v) => (Number.isFinite(v) ? `<li><span>${label}</span><strong>${v.toLocaleString()}</strong></li>` : "");
    const resist = s.resist ? Object.entries(s.resist).filter(([, v]) => v > 0).map(([k, v]) => `<li><span>${esc(k[0].toUpperCase() + k.slice(1))} resistance</span><strong>${v}</strong></li>`).join("") : "";
    const power = s.powerKind ? s.powerKind[0].toUpperCase() + s.powerKind.slice(1) : "Power";
    return `<ul class="sht-stats" data-sheet-stats>${row("Strength", s.strength)}${row("Agility", s.agility)}${row("Stamina", s.stamina)}${row("Intellect", s.intellect)}${row("Spirit", s.spirit)}</ul>
      <ul class="sht-stats">${row("Armor", s.armor)}${row("Attack power", s.attackPower)}${row("Ranged attack power", s.rangedAttackPower)}${row("Health", s.health)}${row(esc(power), s.power)}${resist}</ul>
      <p class="sht-note">With your gear and buffs, as the game reported ${esc(ago(s.seenAt))}.</p>`;
  }
  function doll() {
    const side = (name) => data.slots.filter((s) => s.side === name).map(slotTile).join("");
    const summary = data.equipmentKnown
      ? `<div class="sht-ilvl"><strong>${data.averageItemLevel ?? "?"}</strong><span>average item level</span><small>${data.countedSlots} piece${data.countedSlots === 1 ? "" : "s"}; shirt and tabard not counted</small></div>`
      : `<p class="sht-note">Equipment arrives after a /reload in game.</p>`;
    return `<section class="sht-doll" aria-label="Equipped gear">
      <ul class="sht-col sht-left">${side("left")}</ul>
      <div class="sht-center">${summary}${data.wornScore !== null && data.wornScore !== undefined ? `<p class="sht-score">Gear score for your class: <strong>${data.wornScore}</strong></p>` : ""}${stats()}</div>
      <ul class="sht-col sht-right">${side("right")}</ul>
      <ul class="sht-bottom">${side("bottom")}</ul></section>`;
  }
  function advice() {
    const parts = [];
    if (data.missing.length) parts.push(`<li><strong>Empty:</strong> ${data.missing.map(esc).join(", ")}. Any piece here is a free upgrade.</li>`);
    for (const w of data.weakest) parts.push(`<li><strong>${esc(w.label)}:</strong> ${esc(w.name)}, item level ${w.itemLevel}, ${w.rating === "replace" ? "well below your level: replace it first" : "a little behind your level"}.</li>`);
    const ups = data.upgrades.map((u) => `<li class="sht-up" data-sheet-upgrade="${u.itemId}" data-card-item="${u.itemId}">${icon(u, 28)}<span><strong class="q-${quality(u.quality)}">${esc(u.name)}</strong> <small>${u.where === "bank" ? "in your bank" : "in your bags"}</small></span><em>${esc(u.text)}${Number.isFinite(u.delta) && u.delta > 0 ? ` (+${u.delta})` : ""}</em></li>`).join("");
    if (!parts.length && !ups) return "";
    return `<section class="sht-card"><h2>Upgrades and gaps</h2>${parts.length ? `<ul class="sht-advice">${parts.join("")}</ul>` : ""}${ups ? `<h3 class="sht-sub">Already yours</h3><ul class="sht-ups">${ups}</ul><p class="sht-note">Compared with what you wear, the same way as item cards. Bags and bank as the ledger last saw them.</p>` : ""}</section>`;
  }
  function placeText(i) {
    if (i.where === "other") return `On ${esc(i.holder)} (${esc(i.place)})`;
    if ((i.where === "bank" || i.where === "mail") && Number.isFinite(i.seenAt)) return `${WHERE[i.where]} <small>seen ${esc(ago(i.seenAt))}</small>`;
    return WHERE[i.where];
  }
  function sets() {
    const intro = `<p class="sht-note">Save the gear you wear with <code>/bf set save NAME</code> and put it back on with <code>/bf set wear NAME</code> (out of combat, from your bags). Pieces in the bank, mail or on another character are listed here so you can fetch them.</p>`;
    if (!data.setsKnown) return `<section class="sht-card"><h2>Gear sets</h2>${intro}${empty("No gear sets seen yet.")}</section>`;
    if (!data.sets.length) return `<section class="sht-card"><h2>Gear sets</h2>${intro}<p class="sht-empty">No gear sets saved on this character yet.</p></section>`;
    return `<section class="sht-card"><h2>Gear sets</h2>${intro}<div class="sht-sets">${data.sets.map((s) => `<article class="sht-set" data-sheet-set="${esc(s.name)}">
      <header><h3>${esc(s.name)}</h3><span>${s.items.length} pieces${s.score !== null ? ` · score ${s.score}` : ""}</span></header>
      <p class="sht-counts">${s.counts.worn} worn · ${s.counts.bags} in bags${s.counts.away ? ` · <strong>${s.counts.away} to fetch</strong>` : ""}${s.counts.missing ? ` · <strong class="sht-bad">${s.counts.missing} not found</strong>` : ""}</p>
      <ul>${s.items.map((i) => `<li class="w-${i.where}" data-card-item="${i.itemId}">${icon(i, 24)}<span class="sht-slotname">${esc(i.label)}</span><strong class="q-${quality(i.quality)}">${esc(i.name)}</strong><span class="sht-where">${placeText(i)}</span></li>`).join("")}</ul>
      <p class="sht-cmd"><code>/bf set wear ${esc(s.name)}</code></p></article>`).join("")}</div></section>`;
  }
  function body() {
    if (error) return `<p class="sht-empty">${esc(error)}</p>`;
    if (!data) return `<p class="sht-empty">${!loadedAt ? "Opening your character sheet…" : "Pick or create a character first."}</p>`;
    if (!data.equipmentKnown && !data.stats && !data.setsKnown) return empty("No gear seen for this character yet.");
    return `${doll()}${advice()}${sets()}`;
  }
  function comparison() {
    if (!selection || selection.profileId !== active()) return "";
    const { itemId, card, failed } = selection, verdict = card?.verdict;
    const owned = card?.ownership, when = owned?.seenAt > 0 ? ago(owned.seenAt) : "";
    return `<section class="sht-card sht-comparison" data-sheet-comparison="${itemId}" aria-labelledby="sheet-compare-heading">
      <h2 id="sheet-compare-heading" tabindex="-1">Gear comparison</h2>
      <p data-card-item="${itemId}"><strong>${esc(card?.item?.name || `Item #${itemId}`)}</strong>${card?.item?.name ? ` · #${itemId}` : ""}</p>
      ${card ? `<p><strong>${esc(verdict?.text || "Not equipment")}</strong>${Number.isFinite(verdict?.delta) ? ` · ${verdict.delta > 0 ? "+" : ""}${verdict.delta}` : ""}</p>
        ${verdict?.replaces?.length ? `<p><span>Compared with:</span> ${verdict.replaces.map((it) => `${esc(it.name)} (#${it.itemId})`).join(", ")}</p>` : ""}
        ${verdict?.reasons?.length ? `<ul>${verdict.reasons.filter((r) => r !== verdict.text).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
        <p><strong>${esc(owned ? WHERE[owned.where] : "Ownership unknown")}</strong>${when ? ` <span>· Last saved</span> · ${esc(when)}` : ""}</p>
        <p class="sht-note">Leveling estimate from saved equipment. Check all equip restrictions in game. Loot listings and wishes do not prove ownership.</p>` : `<p role="status">${failed ? "Could not load this item comparison." : "Opening the item comparison…"}</p>`}
    </section>`;
  }
  const signed = n => n > 0 ? `+${n}` : String(n);
  function pairResult(model) {
    const verdict = model.delta === null ? "No ranked result." : model.delta === 0 ? "The base scores tie." :
      `Option ${model.delta < 0 ? "A" : "B"} leads by ${Math.abs(model.delta)} points.`;
    return `<h2 class="sht-pair-result-heading" tabindex="-1">Comparison result</h2>
      <p><strong>${verdict}</strong> ${esc(model.className)} · ${esc(model.role)} · Installed build ${esc(model.build)}</p>
      ${model.sameCoverage ? "" : '<p>The saved sets cover different slots. No overall delta is shown.</p>'}
      <div class="sht-pair-options">${model.options.map((o, i) => `<article><h3>Option ${i ? "B" : "A"} · ${esc(o.name)}</h3>
        <p>${o.score === null ? "Score unavailable" : `Base score: ${o.score}`}</p>
        <ul>${o.pieces.map(p => `<li>${esc(p.name)} (#${p.itemId})${p.slot ? ` · ${esc(p.slot)}` : ""}${p.wished ? " · On your wish list" : ""}</li>`).join("")}</ul>
        ${o.issues.length ? `<ul>${o.issues.map(issue => `<li>${esc(issue)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</div>
      ${model.rows.length ? `<div class="sht-pair-table"><table><caption>Known base stats and role weights${model.delta === null ? " (zeros may omit unknown stats)" : ""}</caption>
        <thead><tr><th scope="col">Stat</th><th scope="col">Weight</th><th scope="col">A</th><th scope="col">B</th><th scope="col">Points (B − A)</th></tr></thead>
        <tbody>${model.rows.map(r => `<tr><th scope="row">${esc(r.stat)}</th><td>${r.weight}</td><td>${r.a}</td><td>${r.b}</td><td>${signed(r.points)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="sht-note">Weight × stat amount gives points. This is a base-item estimate, not a simulation or a comparison against what you wear. Saved sets sum listed combat slots only. Random affixes, enchants, procs, sockets, set bonuses and other instance effects are not scored and may change the result. Check all equip and reward restrictions in game. Wish list stars and source leads do not prove ownership or availability.</p>`;
  }
  function renderPairForm(node, model, seed) {
    const suggestions = new Map(model.leads.map(l => [l.itemId, `${l.itemName} · ${l.sourceName}`]));
    for (const id of model.wished) suggestions.set(id, `${suggestions.get(id) || `Item #${id}`} · Wish list`);
    const select = (label, key) => `<label>${label}<select name="${key}" aria-label="${label}" required><option value="">Choose a set</option>${model.sets.map(s => `<option>${esc(s)}</option>`).join("")}</select></label>`;
    const input = (label, key, value) => `<label>${label}<input name="${key}" inputmode="numeric" list="sheet-pair-items" pattern="[0-9]{1,10}" maxlength="10" value="${value}" required></label>`;
    node.innerHTML = `<form class="sht-pair-form">
      <label>Options<select name="mode" aria-label="Options"><option value="items">Items / quest rewards</option><option value="sets"${model.sets.length < 2 ? " disabled" : ""}>Saved gear sets</option></select></label>
      <label>Role<select name="role" aria-label="Role" required><option value="">Choose a role</option>${Object.entries(model.roles).map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join("")}</select></label>
      <div class="sht-pair-fields" data-pair-mode="items">${input("Option A item ID", "itemA", seed || "")}${input("Option B item ID", "itemB", "")}</div>
      <div class="sht-pair-fields" data-pair-mode="sets" hidden>${select("Option A gear set", "setA")}${select("Option B gear set", "setB")}</div>
      <datalist id="sheet-pair-items">${[...suggestions].map(([id, label]) => `<option value="${id}" label="${esc(label)}"></option>`).join("")}</datalist>
      <button class="primary" type="submit">Compare</button>
    </form><p class="sht-note" data-pair-hint>Enter exact item IDs, or use suggestions from chest acquisition leads and your wish list.</p>
    <p data-pair-status role="status" class="sht-note"></p><div data-pair-result></div>`;
  }
  function mountPair(root, profile) {
    const host = root.querySelector("[data-sheet-pair-host]");
    if (!host || !profile || profile.id !== active()) { pair = null; pairFocus = null; return; }
    const scope = JSON.stringify([profile.id, profile.clientBuild, profile.source?.kind, profile.source?.id, profile.className, profile.level, profile.gearSets]);
    if (pair?.scope === scope) {
      if (pair.panel.parentElement !== host) host.append(pair.panel);
      if (pairFocus && pair.panel.contains(pairFocus)) pairFocus.focus({ preventScroll: true });
      pairFocus = null;
      return;
    }
    pairFocus = null;
    const panel = document.createElement("details");
    panel.className = "sht-card sht-pair";
    panel.dataset.sheetPair = "";
    panel.innerHTML = '<summary>Compare two options</summary><div data-pair-content></div>';
    host.append(panel);
    const local = pair = { scope, panel };
    const current = () => pair === local && panel.isConnected && active() === profile.id;
    const content = panel.querySelector("[data-pair-content]");
    let catalog = null, loading = false, request = 0;
    panel.addEventListener("toggle", async () => {
      if (!panel.open || !current() || catalog || loading) return;
      loading = true;
      content.innerHTML = '<p role="status">Loading comparison options…</p>';
      try {
        const model = await api.sheetComparison(profile.id);
        if (!current() || model.profileId !== profile.id) return;
        catalog = model;
        renderPairForm(content, model, selection?.profileId === profile.id ? selection.itemId : null);
        syncMode();
      } catch {
        if (current()) content.innerHTML = '<p role="status">Comparison options unavailable. Close and reopen to retry.</p>';
      } finally { loading = false; }
    });
    function syncMode() {
      const mode = content.querySelector('[name="mode"]').value;
      for (const fields of content.querySelectorAll("[data-pair-mode]")) {
        fields.hidden = fields.dataset.pairMode !== mode;
        for (const control of fields.querySelectorAll("input,select")) control.disabled = fields.hidden;
      }
      content.querySelector("[data-pair-hint]").hidden = mode !== "items";
    }
    panel.addEventListener("input", () => {
      if (!catalog || !current()) return;
      request++;
      syncMode();
      content.querySelector("[data-pair-status]").textContent = "";
      content.querySelector("[data-pair-result]").textContent = "";
    });
    panel.addEventListener("submit", async event => {
      event.preventDefault();
      if (!catalog || !current()) return;
      const ownRequest = ++request, fields = new FormData(event.target), mode = fields.get("mode");
      const submitFocus = event.target.contains(document.activeElement) ? document.activeElement : null;
      const values = mode === "sets" ? [fields.get("setA"), fields.get("setB")] : [fields.get("itemA"), fields.get("itemB")].map(Number);
      const status = content.querySelector("[data-pair-status]"), result = content.querySelector("[data-pair-result]");
      result.textContent = "";
      if (values[0] === values[1] || (mode === "items" && values.some(n => !Number.isSafeInteger(n) || n < 1 || n > 2147483647))) {
        status.textContent = "Choose two different options with valid IDs or set names."; return;
      }
      status.textContent = "Comparing…";
      try {
        const model = await api.sheetComparison(profile.id, fields.get("role"), mode, ...values);
        if (!current() || ownRequest !== request || model.profileId !== profile.id) return;
        status.textContent = model.reason || "Comparison ready.";
        // The template escapes display strings; IDs, scores and weights are numeric IPC projections.
        if (!model.reason) {
          result.innerHTML = pairResult(model);
          if (panel.open && submitFocus === document.activeElement) {
            const heading = result.querySelector("h2");
            heading.focus({ preventScroll: true });
            heading.scrollIntoView({ block: "start", behavior: "instant" });
          }
        }
      } catch {
        if (current() && ownRequest === request) status.textContent = "Could not compare these options. Review your choices and try again.";
      }
    });
  }
  function page() {
    pairFocus = pair?.panel.contains(document.activeElement) ? document.activeElement : null;
    // The "Gear plan" view (gear-planning.js) shares this page; the switch under the hero picks one.
    const plan = window.GearPlanView;
    return `<section class="sheet-page" data-sheet data-sheet-view="${plan?.view() === "plan" ? "plan" : "sheet"}">${hero()}${plan ? plan.frame() : ""}<div data-sheet-compare>${comparison()}</div><div data-sheet-pair-host></div><div data-sheet-body>${body()}</div></section>`;
  }
  function paintSheet(root) {
    // Both templates escape text from saved state and use validated numeric item IDs.
    root.querySelector(".page-hero").outerHTML = hero();
    root.querySelector("[data-sheet-body]").innerHTML = body();
  }
  const owns = (root, id) => mountedFor === root && document.querySelector("[data-sheet]") === root && active() === id;
  async function load(root, id) {
    let result, message = "";
    try { result = await api.characterSheet(); } catch (e) { message = e.message || "Your character sheet is unavailable."; }
    if (!owns(root, id) || (result && result.profileId !== id)) return;
    data = result || null; error = message; loadedAt = Date.now(); loadedProfile = id;
    // Leave the comparison and keyboard focus intact while refreshing the paper doll.
    paintSheet(root);
  }
  function mounted(profile) {
    const root = document.querySelector("[data-sheet]");
    if (!root) { mountedFor = null; selection = null; pair = null; pairFocus = null; window.GearPlanView?.mounted(null); return; }
    // An item sent here to compare is shown on the sheet itself, not behind the gear plan.
    if (selection && root.dataset?.sheetView === "plan" && !selection.card && !selection.failed) { window.GearPlanView?.show("sheet"); root.dataset.sheetView = "sheet"; for (const b of root.querySelectorAll("[data-gear-view]")) b.setAttribute("aria-selected", String(b.dataset.gearView === "sheet")); }
    window.GearPlanView?.mounted(root, profile?.id || null);
    mountPair(root, profile);
    if (mountedFor === root) return;
    mountedFor = root;
    const id = active();
    if (loadedProfile !== id) { data = null; error = ""; loadedAt = 0; }
    if (selection && selection.profileId !== id) selection = null;
    document.getElementById("active-character")?.addEventListener("change", () => {
      if (mountedFor !== root) return;
      mountedFor = null; selection = null; data = null; error = ""; loadedAt = 0;
      pair?.panel.remove(); pair = null; pairFocus = null;
      root.querySelector("[data-sheet-compare]").innerHTML = "";
      paintSheet(root);
    });
    if (!loadedAt || Date.now() - loadedAt > 3000) void load(root, id);
    const target = selection, panel = root.querySelector("[data-sheet-compare]");
    if (!target || !panel || target.card || target.failed) return;
    void (async () => {
      let card;
      try { card = await api.itemCard(id, target.itemId); } catch {}
      if (!owns(root, id) || selection !== target) return;
      if (card?.itemId === target.itemId) target.card = card; else target.failed = true;
      panel.innerHTML = comparison();
      const heading = panel.querySelector("h2");
      heading?.focus({ preventScroll: true });
      heading?.closest(".sht-comparison")?.scrollIntoView({ block: "start", behavior: "instant" });
    })();
  }
  function focusItem(profileId, itemId) {
    selection = profileId && Number.isSafeInteger(itemId) && itemId > 0 && itemId <= 2147483647 ? { profileId, itemId } : null;
  }
  return { page, mounted, focusItem, invalidate: () => { data = null; loadedAt = 0; }, _state: () => ({ data }) };
})();
