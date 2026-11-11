"use strict";
window.AdventureMap = (() => {
  const prefix = "bf-adventure-map-v1:",
    keys = ["quest", "herbs", "ore", "supplies", "finds", "olderReferences"],
    labels = {
      quest: "Saved quests",
      herbs: "Herb references",
      ore: "Ore references",
      supplies: "Material sources",
      finds: "Your recorded finds",
      olderReferences: "Older / uncertain references",
    };
  let host,
    guard,
    model = null,
    signature = "",
    modelSignature = "",
    generation = 0,
    read = 0,
    selected = null,
    error = "",
    loading = false,
    agePending = false,
    ageUnavailable = false,
    ageRetryAt = 0,
    painting = false,
    focus = null;
  const disclosures = new Map(),
    active = () => host?.active(),
    esc = (v) => host.esc(v);
  function clean(v) {
    const out = { layers: {} };
    if (Number.isSafeInteger(v?.mapId) && v.mapId > 0 && v.mapId <= 2147483647)
      out.mapId = v.mapId;
    for (const k of keys)
      if (typeof v?.layers?.[k] === "boolean") out.layers[k] = v.layers[k];
    return out;
  }
  function options(id) {
    try {
      return clean(JSON.parse(localStorage.getItem(prefix + id)));
    } catch {
      return clean();
    }
  }
  function save(id, value) {
    if (!id) return;
    try {
      localStorage.setItem(prefix + id, JSON.stringify(clean(value)));
      Object.keys(localStorage)
        .filter((k) => k.startsWith(prefix))
        .slice(0, -128)
        .forEach((k) => localStorage.removeItem(k));
    } catch {}
  }
  function remove(id) {
    try {
      if (id) localStorage.removeItem(prefix + id);
      else
        Object.keys(localStorage)
          .filter((k) => k.startsWith(prefix))
          .forEach((k) => localStorage.removeItem(k));
    } catch {}
  }
  const current = () =>
    JSON.stringify([
      host.profileId() ?? null,
      options(host.profileId()),
      Preparation.options(host.profileId()),
      host.sourceSignature?.(),
    ]);
  function beginRender() {
    painting = true;
    const node = document.activeElement;
    focus =
      node?.dataset.mapControl || node?.dataset.shellControl
        ? {
            key: node.dataset.mapControl || node.dataset.shellControl,
            start: node.selectionStart,
            end: node.selectionEnd,
          }
        : null;
    host.root
      .querySelectorAll("[data-adventure-map] details[data-map-disclosure]")
      .forEach((n) => disclosures.set(n.dataset.mapDisclosure, n.open));
  }
  function restore() {
    host.root
      .querySelectorAll("[data-adventure-map] details[data-map-disclosure]")
      .forEach((n) => {
        if (disclosures.has(n.dataset.mapDisclosure))
          n.open = disclosures.get(n.dataset.mapDisclosure);
      });
    if (focus) {
      const n = [
        ...host.root.querySelectorAll(
          "[data-map-control],[data-shell-control]",
        ),
      ].find(
        (n) => (n.dataset.mapControl || n.dataset.shellControl) === focus.key,
      );
      n?.focus({ preventScroll: true });
      if (typeof focus.start === "number" && n?.setSelectionRange)
        try {
          n.setSelectionRange(focus.start, focus.end);
        } catch {}
    }
  }
  function endRender() {
    painting = false;
  }
  function paint() {
    if (!active() || guard.defer(paint)) return;
    const n = host.root.querySelector("[data-adventure-map]");
    if (!n) return;
    beginRender();
    try {
      n.outerHTML = page();
      restore();
    } finally {
      endRender();
    }
  }
  function invalidate() {
    generation++;
    read++;
    model = null;
    signature = "";
    modelSignature = "";
    selected = null;
    loading = false;
    agePending = false;
    ageUnavailable = false;
    ageRetryAt = 0;
    error = "";
    focus = null;
    disclosures.clear();
    guard?.invalidate();
  }
  function savedAge(m) {
    if (!m?.source?.savedAt) return "No saved addon location";
    const status =
      m === model && agePending
        ? "Checking saved age…"
        : m === model && ageUnavailable
          ? "Saved age unavailable"
          : m.source.freshness || "saved";
    return `Saved ${m.source.savedAt.replace("T", " ").replace(".000Z", " UTC")} · ${status}`;
  }
  function paintAge() {
    if (!active() || modelSignature !== current()) return;
    const caption = host.root.querySelector("[data-map-age]");
    // Text-only updates preserve native menus, physical owners and the dossier.
    if (caption) caption.textContent = savedAge(model);
  }
  async function refreshAge() {
    const source = model?.source,
      now = Date.now(),
      stamp = Date.parse(source?.savedAt);
    // Guidance's authority uses floor(age / minute) > 15. Ask main once at
    // that boundary; never infer a new freshness status from renderer time.
    if (
      loading ||
      agePending ||
      source?.freshness !== "fresh" ||
      !Number.isFinite(stamp) ||
      now < stamp + 16 * 60000 ||
      now < ageRetryAt
    )
      return;
    const request = read,
      token = generation,
      next = signature,
      epoch = host.epoch();
    agePending = true;
    ageUnavailable = false;
    ageRetryAt = now + 60000;
    paintAge();
    try {
      const result = await host.api.adventureMap(host.profileId() ?? null, {
        ...options(host.profileId()),
        goal: Preparation.options(host.profileId()),
      });
      if (
        !active() ||
        request !== read ||
        token !== generation ||
        next !== current()
      )
        return;
      agePending = false;
      if (
        epoch !== host.epoch() ||
        result?.character?.id !== model?.character?.id ||
        result?.source?.savedAt !== source.savedAt ||
        result.source.kind !== source.kind ||
        result.source.build !== source.build
      )
        ageUnavailable = true;
      else model.source.freshness = result.source.freshness;
      paintAge();
    } catch {
      if (
        !active() ||
        request !== read ||
        token !== generation ||
        next !== current()
      )
        return;
      agePending = false;
      ageUnavailable = true;
      paintAge();
    }
  }
  async function refresh() {
    if (!active()) return;
    const next = current();
    if (next === signature) return refreshAge();
    signature = next;
    selected = null;
    model = null;
    modelSignature = "";
    error = "";
    loading = true;
    agePending = false;
    ageUnavailable = false;
    ageRetryAt = 0;
    const request = ++read,
      token = generation,
      epoch = host.epoch();
    paint();
    try {
      const result = await host.api.adventureMap(host.profileId() ?? null, {
        ...options(host.profileId()),
        goal: Preparation.options(host.profileId()),
      });
      if (
        !active() ||
        request !== read ||
        token !== generation ||
        next !== current()
      )
        return;
      if (epoch !== host.epoch()) {
        signature = "";
        return;
      }
      model = result;
      modelSignature = next;
      loading = false;
      paint();
    } catch {
      if (
        !active() ||
        request !== read ||
        token !== generation ||
        next !== current()
      )
        return;
      loading = false;
      error = "This saved map could not be opened. Your journal is safe.";
      paint();
    }
  }
  const qualification = (p) =>
    ({
      game: "Saved game marker",
      "qualified-historical": "Historical reference",
      "browse-only": "Older / uncertain reference",
      "own-recorded": "Your recorded find",
    })[p.qualification] || "Unknown evidence";
  function dossier(p) {
    if (!p)
      return '<div class="map-empty-dossier"><span aria-hidden="true">⌖</span><h2>Choose a marker</h2><p>Select a point or its list entry to see why it is here.</p></div>';
    return `<div class="map-dossier-copy"><span class="eyebrow">${esc(qualification(p))}</span><h2>${esc(p.title)}</h2><p>${esc(p.detail)}</p><p class="map-coordinate">${(p.x * 100).toFixed(2)}%, ${(p.y * 100).toFixed(2)}% · Map ${p.mapId}</p>${p.itemIds.length ? `<small>Material IDs · ${p.itemIds.join(" / ")}</small>` : ""}<details data-map-disclosure="evidence"><summary data-map-control="evidence" data-interaction-key="map-evidence">How we know</summary>${p.sources.map((s) => `<article><b>${esc(s.authority.replaceAll("-", " "))}</b>${s.itemIds?.length ? `<small>Material IDs · ${s.itemIds.join(" / ")}</small>` : ""}<p>Build ${esc(s.build || "unknown")} · observed ${esc(s.observedAt || "date unknown")}</p>${s.reason ? `<p>${esc(s.reason)}</p>` : ""}${s.context?.length ? `<p>Observed context: ${esc(s.context.join(", "))}. Not an inferred requirement.</p>` : ""}${s.limitedStock !== undefined ? `<p>${s.limitedStock === true ? "Limited stock was observed." : s.limitedStock === false ? "Listing was not marked limited." : "Stock limit unknown."} Current stock, price and access are unverified.</p>` : ""}</article>`).join("")}</details><button data-map-open="${p.kind === "quest" ? "quest-guide" : "preparation"}" data-map-owner="${read}" data-map-control="open">${p.kind === "quest" ? "Review saved quests" : "Review profession plan"} →</button><p class="corner-note">Open your world map in WoW for live terrain. You perform every game action.</p></div>`;
  }
  function page(brief) {
    const m =
        brief === undefined
          ? modelSignature === signature && modelSignature === current()
            ? model
            : null
          : brief,
      c = m?.character || {},
      points = m?.points || [],
      choice = options(host.profileId()),
      layers = m?.layers || {
        quest: true,
        finds: true,
        supplies: true,
        ...choice.layers,
      },
      chosen = points.find((p) => p.id === selected),
      faction = ["Alliance", "Horde"].includes(c.faction)
        ? c.faction.toLowerCase()
        : "neutral";
    const markers = points
      .map(
        (p, i) =>
          `<g class="map-mark ${p.kind} ${p.qualification === "browse-only" ? "old" : ""} ${p.id === selected ? "chosen" : ""}" data-map-point="${esc(p.id)}" data-map-control="svg:${esc(p.id)}" data-map-owner="${read}" role="button" tabindex="0" aria-label="${esc(p.title + " · " + qualification(p))}" aria-pressed="${p.id === selected}"><circle cx="${Number((p.x * 1000).toFixed(4))}" cy="${Number((p.y * 1000).toFixed(4))}" r="19"/><text x="${Number((p.x * 1000).toFixed(4))}" y="${Number((p.y * 1000).toFixed(4))}" dy="6" text-anchor="middle">${i + 1}</text></g>`,
      )
      .join("");
    return `<section data-adventure-map class="adventure-map ${faction}"><header class="map-hero"><div class="map-title"><span class="eyebrow">YOUR ADVENTURE ATLAS</span><h1>Places worth remembering.</h1><p>Last-saved location view; full live map in WoW.</p></div><div class="map-hero-emblem"><img src="${host.portrait?.(c.className) || "../../assets/wolf-medallion.png"}" alt=""><span>${esc(c.name || "Your next adventure")}<small>${esc(c.className || "Choose a character")} · ${esc(c.faction || "Private journal")}</small></span></div></header>
 <div class="map-toolbar"><label>Area<select data-map-control="area" data-map-area aria-label="Map area">${m?.view?.maps?.length ? m.view.maps.map((a) => `<option value="${a.mapId}" ${a.mapId === m.view.mapId ? "selected" : ""}>${esc(a.label)}${m.view.kind === "reference" && a.mapId === m.view.mapId ? " · reference area" : ""}</option>`).join("") : '<option value="">No saved area</option>'}</select></label><button data-nav="preparation" data-map-control="focus">Your profession focus →</button><details data-map-disclosure="layers" class="map-layer-menu"><summary data-map-control="layers" data-interaction-key="map-layers">Map layers</summary><div>${keys.map((k) => `<label><input type="checkbox" data-map-layer="${k}" data-map-control="layer:${k}" ${layers[k] ? "checked" : ""}>${labels[k]}</label>`).join("")}<button data-map-defaults data-map-control="defaults">Choose for me</button></div></details></div>
 <div class="map-freshness"><span>${esc(m?.view?.kind === "reference" ? "Reference area · character location not established here" : m?.view?.label || "Waiting for a saved area")}</span><span data-map-age>${esc(savedAge(m))}</span></div>
 ${error ? `<p role="status">${esc(error)} <button data-map-retry data-map-control="retry">Try again</button></p>` : ""}
 <div class="map-legend" aria-label="Map legend"><span class="quest">● Saved quest</span><span class="material">○ Historical source</span><span class="find">◆ Your find</span><span class="player">⊙ Saved position</span></div><div class="map-layout"><div><div class="map-frame"><svg viewBox="-30 -30 1060 1060" role="group" aria-label="${esc(m?.view?.label || "Saved coordinate view")}" class="map-chart"><defs><pattern id="atlas-grid" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M 100 0 L 0 0 0 100" class="map-gridline"/></pattern></defs><rect x="0" y="0" width="1000" height="1000" fill="url(#atlas-grid)" class="map-plane"/><circle cx="500" cy="500" r="360" class="map-compass-ring"/><path d="M500 160 L520 480 L840 500 L520 520 L500 840 L480 520 L160 500 L480 480 Z" class="map-compass"/><text x="500" y="85" text-anchor="middle" class="map-axis">N · COORDINATE REFERENCE</text><text x="25" y="980" class="map-axis">0%</text><text x="920" y="980" class="map-axis">100%</text>${markers}${m?.playerPosition ? `<g class="map-player" aria-label="Last-saved position"><circle cx="${m.playerPosition.x * 1000}" cy="${m.playerPosition.y * 1000}" r="24"/><circle cx="${m.playerPosition.x * 1000}" cy="${m.playerPosition.y * 1000}" r="8"/></g>` : ""}</svg>${!points.length ? `<div class="map-no-points">${loading ? "Opening your saved map…" : "No matching points in this area."}<small>${loading ? "Reading your local journal" : "Try another area or Map layers. Missing references do not mean unobtainable."}</small></div>` : ""}<span class="map-frame-caption">COORDINATES ONLY · NO TERRAIN OR ROUTES</span></div><p class="map-location-note">${esc(m?.limitations?.[1] || "Position not recorded; no character marker is shown.")}</p></div><aside class="map-dossier" aria-label="Selected map point">${dossier(chosen)}</aside></div>
 <section class="map-index"><div class="map-index-heading"><h2>In this view</h2><span>${points.length} saved / reference points${m?.counts?.omitted ? ` · ${m.counts.omitted} omitted` : ""}</span></div><div class="map-point-list">${points.map((p, i) => `<button data-map-point="${esc(p.id)}" data-map-owner="${read}" data-map-control="point:${esc(p.id)}" aria-pressed="${p.id === selected}"><span class="map-number ${p.kind}">${i + 1}</span><span>${esc(p.title)}<small>${esc(qualification(p))}</small></span></button>`).join("")}</div></section>
 <details class="map-notes" data-map-disclosure="notes"><summary data-map-control="notes" data-interaction-key="map-notes">Sources, limits & your private finds</summary><p>Build ${esc(m?.source?.build || "unknown")}. ${esc(m?.references?.acquisition?.attribution || "Acquisition reference unavailable")}. ${esc(m?.references?.sellers?.scope || "")}</p><p>Your gathering history: ${esc(m?.gathering?.status || "missing")} · ${m?.gathering?.shown || 0} shown${m?.gathering?.limited ? " · partial history" : ""}. ${m?.gathering?.recording ? "Recording enabled in the saved snapshot." : "Recording was off or unobserved."}</p>${(m?.limitations || []).map((t) => `<p>${esc(t)}</p>`).join("")}<p>Desktop history changes do not erase the game's own SavedVariables. Clear native history separately in WoW, then let the game save.</p></details></section>`;
  }
  function validOwner(n) {
    return (
      active() &&
      model &&
      modelSignature === current() &&
      Number(n.dataset.mapOwner) === read
    );
  }
  function select(n) {
    if (
      !validOwner(n) ||
      !model.points.some((p) => p.id === n.dataset.mapPoint)
    )
      return;
    selected = n.dataset.mapPoint;
    paint();
  }
  function mounted() {
    if (!active()) return;
    restore();
    refresh();
  }
  function init(value) {
    host = value;
    guard = InteractionGuard.create({
      root: host.root,
      active,
      painting: () => painting,
    });
    host.root.addEventListener("click", (e) => {
      const n = e.target.closest("[data-map-point]");
      if (n) {
        select(n);
        return;
      }
      const open = e.target.closest("[data-map-open]");
      if (open && validOwner(open)) {
        host.open?.(open.dataset.mapOpen);
        return;
      }
      if (e.target.closest("[data-map-retry]")) {
        signature = "";
        refresh();
      }
      if (e.target.closest("[data-map-defaults]")) {
        remove(host.profileId());
        signature = "";
        refresh();
      }
    });
    host.root.addEventListener("keydown", (e) => {
      const n = e.target.closest("[data-map-point]");
      if (
        n &&
        n.tagName.toLowerCase() === "g" &&
        ["Enter", " "].includes(e.key)
      ) {
        e.preventDefault();
        select(n);
      }
    });
    host.root.addEventListener("change", (e) => {
      if (!active()) return;
      const n = e.target,
        choice = options(host.profileId());
      if (n.hasAttribute?.("data-map-area")) {
        if (n.value) choice.mapId = Number(n.value);
        else delete choice.mapId;
      } else if (keys.includes(n.dataset.mapLayer))
        choice.layers[n.dataset.mapLayer] = n.checked;
      else return;
      save(host.profileId(), choice);
      signature = "";
      refresh();
    });
  }
  return {
    init,
    page,
    mounted,
    refresh,
    paint,
    invalidate,
    beginRender,
    endRender,
    options,
    save,
    remove,
    deferRender: (fn) => guard?.defer(fn, "root") || false,
  };
})();
