"use strict";
// Help → Data coverage: how much the app knows per leveling zone and faction, honestly.
window.CoverageView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let data = null, error = "", faction = null, mountedFor = null, showAll = false;
  // What "good" looks like per category, so meters read at a glance.
  const KINDS = [
    ["questGivers", "Quest givers", "pins/quest-giver", 25],
    ["objectiveAreas", "Objective areas", "steps/quest", 15],
    ["classTrainers", "Class trainers", "steps/train", 3],
    ["professionTrainers", "Profession trainers", "pins/profession-trainer", 4],
    ["vendors", "Vendors", "pins/vendor", 6],
    ["flightMasters", "Flight masters", "pins/flight", 1],
  ];
  const level = (n, good) => (n >= good ? "rich" : n >= Math.ceil(good / 3) ? "some" : n > 0 ? "thin" : "none");
  function zoneCard(z) {
    const f = z[faction];
    const art = window.ZoneArt?.url(z.mapId);
    const meters = KINDS.map(([k, label, crest, good]) => {
      const n = f[k], l = level(n, good);
      return `<li class="cov-meter cov-${l}" title="${esc(label)}: ${n}"><img src="art/${crest}.png" alt="" width="22" height="22"><span class="cov-label">${esc(label)}</span><span class="cov-bar"><i data-w="${Math.min(100, Math.round((n / good) * 100))}"></i></span><span class="cov-n">${n}</span></li>`;
    }).join("");
    const score = KINDS.reduce((t, [k, , , good]) => t + Math.min(1, f[k] / good), 0) / KINDS.length;
    const verdict = score >= 0.7 ? ["Well covered", "good"] : score >= 0.35 ? ["Partly covered", "mid"] : ["Thin", "low"];
    return `<article class="cov-card ${z.faction === faction || z.faction === "Contested" ? "" : "cov-other"}">
      <header class="cov-head"${art ? ` data-art="${esc(art)}"` : ""}><div><h3>${esc(z.name)}</h3><span>Levels ${z.min}–${z.max} · ${esc(z.faction)}</span></div><em class="cov-verdict ${verdict[1]}">${verdict[0]}</em></header>
      <ul class="cov-meters">${meters}</ul></article>`;
  }
  function body() {
    if (error) return `<p class="cov-empty">${esc(error)}</p>`;
    if (!data) return `<p class="cov-empty">Counting what we know…</p>`;
    const zones = [...data.zones].sort((a, b) => a.min - b.min || a.name.localeCompare(b.name));
    const mine = zones.filter((z) => z.faction === faction || z.faction === "Contested");
    const thin = mine.filter((z) => KINDS.reduce((t, [k, , , g]) => t + Math.min(1, z[faction][k] / g), 0) / KINDS.length < 0.35);
    return `<p class="cov-summary"><strong>${mine.length - thin.length} of ${mine.length}</strong> zones for ${esc(faction)} players have useful coverage.${thin.length ? ` Thin so far: ${thin.slice(0, 8).map((z) => esc(z.name)).join(", ")}${thin.length > 8 ? "…" : ""}.` : ""}</p>
      <div class="cov-grid">${(showAll ? zones : mine).map(zoneCard).join("")}</div>
      <label class="cov-all"><input type="checkbox" data-cov-all ${showAll ? "checked" : ""}> Also show the other faction's zones</label>
      <p class="cov-foot">Counts come from community observations bundled with the app (${esc(data.source?.attribution || "Efficient Games, CC BY 4.0")}${data.source?.builds ? `; game builds ${esc(data.source.builds.map((b) => (typeof b === "string" ? b : b?.build)).filter(Boolean).join(", "))}` : ""}${data.source?.observedThrough ? `; observed through ${esc(data.source.observedThrough)}` : ""}). They grow as more players contribute and the app updates; your own game also fills in repair vendors and flight paths as you meet them.</p>`;
  }
  const PATCH_LABELS = {
    "desktop-route": "Desktop guided route",
    "frost-mage-guide": "Frost Mage DPS guide",
    "frost-mage-abilities": "Frost Mage action-bar and keybind checks",
  };
  const PATCH_STATUS = {
    reviewed: "Reviewed for this build",
    "needs-review": "Needs review for this build",
    "unknown-build": "Saved build unknown",
    "no-review": "No reviewed build available",
  };
  function patchImpact(profile, routeBuild) {
    const { savedBuild, rows } = window.PatchImpact.snapshot(profile, routeBuild);
    return `<section class="cov-patch" aria-labelledby="cov-patch-title">
      <h2 id="cov-patch-title">Patch impact</h2>
      ${savedBuild ? `<p>Saved client build: <strong>${esc(savedBuild)}</strong></p>` : "<p>Saved build unknown</p>"}
      <p>Based on the selected character’s addon save, not a live client check. A reviewed build does not prove quest readiness or learned ranks.</p>
      <ul>${rows.map(({ id, status, reviewedBuilds, carriedFrom }) => `<li data-patch-capability="${esc(id)}" data-patch-status="${esc(status)}"><strong>${esc(PATCH_LABELS[id])}</strong> — <span>${esc(carriedFrom ? "Reviewed on another build of this patch, in use" : PATCH_STATUS[status])}</span>${reviewedBuilds.length ? ` <small><span>Reviewed builds:</span> ${esc(reviewedBuilds.join(", "))}</small>` : ""}</li>`).join("")}</ul>
      <p>Game builds change every few days inside one patch. A review on one build covers the other builds of that patch; a new patch waits for a fresh review, and until then route suggestions are withheld while route coverage and your saved journal stay available.</p>
    </section>`;
  }
  // Scout notes (S1): what scout mode recorded in game, and one button to save it as a file.
  let scout = null, scoutSaid = "", scoutBusy = false;
  function scoutCard() {
    const n = scout?.records || 0;
    const who = (scout?.characters || []).slice(0, 6).map((c) => `${esc(c.name)} <b>${c.records}</b>`).join(" · ");
    const count = !scout ? "<p>Reading your saved file…</p>"
      : n ? `<p><strong>${n}</strong> <span>${n === 1 ? "record in your saved file" : "records in your saved file"}</span>${who ? `<span class="cov-scout-who"> · ${who}${scout.characters.length > 6 ? " …" : ""}</span>` : ""}</p>`
      : "<p>No scout notes in your saved file yet. Type <code>/bf scout on</code> in game, talk to quest givers, trainers, vendors and flight masters, then type <code>/reload</code> or log out.</p>";
    return `<section class="cov-patch cov-scout" data-cov-scout aria-labelledby="cov-scout-title">
      <h2 id="cov-scout-title">Your scout notes</h2>
      <p>Scout mode notes who you talked to in game and where they stand: quest givers, hand-ins, trainers, vendors and flight masters. It helps fill the thin zones above.</p>
      ${count}
      <div class="cov-scout-acts"><button type="button" class="cov-scout-save" data-cov-scout-save${n && !scoutBusy ? "" : " disabled"}>Save my scout notes…</button><span data-cov-scout-said role="status">${esc(scoutSaid)}</span></div>
      <p><small>Nothing is uploaded. The button writes one file to the place you pick; you decide whether to send it to anyone.</small></p>
    </section>`;
  }
  function paintScout() { const el = document.querySelector("[data-cov-scout]"); if (el) el.outerHTML = scoutCard(); }
  async function saveScout() {
    if (scoutBusy || !api.exportScoutNotes) return;
    scoutBusy = true; scoutSaid = ""; paintScout();
    try {
      const r = await api.exportScoutNotes();
      scoutSaid = r?.saved ? "Saved. The file stays on your computer." : r?.reason === "empty" ? "There is nothing to save yet." : "";
    } catch (e) { scoutSaid = e.message || "The file could not be saved."; }
    scoutBusy = false; paintScout();
  }
  function page(profile, routeBuild) {
    return `<section class="coverage-page" data-coverage>
      ${PageHero.render({ art: "coverage", eyebrow: "Help · Data coverage", title: "How much we know, zone by zone", subtitle: "Where the app's advice is rich and where it's still thin, for each faction.",
        aside: `<div class="cov-toggle" role="group" aria-label="Faction">${["Horde", "Alliance"].map((f) => `<button type="button" data-cov-faction="${f}" aria-pressed="${f === faction}">${f}</button>`).join("")}</div>` })}
      ${patchImpact(profile, routeBuild)}
      <div data-cov-body>${body()}</div>
      ${scoutCard()}</section>`;
  }
  function paint() {
    const b = document.querySelector("[data-cov-body]"); if (!b) return;
    b.innerHTML = body();
    for (const el of b.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`;
    for (const el of b.querySelectorAll("[data-art]")) el.style.backgroundImage = `linear-gradient(90deg, rgba(26,6,4,.85), rgba(26,6,4,.25)), url("${el.dataset.art}")`;
    for (const t of document.querySelectorAll("[data-cov-faction]")) t.setAttribute("aria-pressed", String(t.dataset.covFaction === faction));
  }
  async function mounted() {
    const root = document.querySelector("[data-coverage]");
    if (!root || mountedFor === root) return;
    mountedFor = root;
    root.addEventListener("click", (e) => { const b = e.target.closest("[data-cov-faction]"); if (b) { faction = b.dataset.covFaction; paint(); } else if (e.target.closest("[data-cov-scout-save]")) saveScout(); });
    if (api.scoutNotes) api.scoutNotes().then((s) => { scout = s; paintScout(); }).catch(() => { scout = { records: 0, characters: [] }; paintScout(); });
    root.addEventListener("change", (e) => { if (e.target.matches("[data-cov-all]")) { showAll = e.target.checked; paint(); } });
    if (!faction) { try { const s = await api.bootstrap(); const p = s.state.profiles.find((x) => x.id === s.state.activeProfileId); faction = p?.faction === "Alliance" ? "Alliance" : "Horde"; } catch { faction = "Horde"; } }
    if (!data) { try { data = await api.dataCoverage(); } catch (e) { error = e.message || "Coverage is unavailable."; } }
    paint();
  }
  return { page: (profile, routeBuild) => { faction = faction || "Horde"; return page(profile, routeBuild); }, mounted, KINDS, level, _state: () => ({ data, faction }) };
})();
