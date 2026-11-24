"use strict";
// Adventure → Travel: pick a place, compare walking, flying, boats and zeppelins and the Hearthstone,
// fastest first. A boat or zeppelin always shows "plus the wait": the wait is never known.
// All facts come from main (travelPlaces, travelPlan); this file only paints them.
window.TravelPlannerView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  let view = null, error = "", loading = false, mountedFor = null;
  let from = "saved", to = null, query = "", plan = null, planning = false, planError = "";

  function time(seconds) {
    seconds = Math.max(0, Math.round(seconds));
    if (seconds < 60) return `${seconds} s`;
    const m = Math.floor(seconds / 60), s = seconds % 60;
    if (m >= 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
    return s ? `${m} min ${String(s).padStart(2, "0")} s` : `${m} min`;
  }
  function coins(copper) {
    const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
    return `<span class="tp-coins">${g ? `<span class="tp-gold">${g.toLocaleString()}g</span>` : ""}${s ? `<span class="tp-silver">${s}s</span>` : ""}${c || (!g && !s) ? `<span class="tp-copper">${c}c</span>` : ""}</span>`;
  }
  // Rides show whole minutes: their time is worked out, not measured.
  function rough(seconds) {
    const m = Math.max(1, Math.round(seconds / 60));
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
  }
  const GLYPH = { walk: "➜", fly: "➶", hearth: "⌂", wait: "◷" };
  const KIND = { walk: "On foot", flight: "Flight", hearth: "Hearthstone" };
  const MODE = { boat: "Boat", zeppelin: "Zeppelin", airship: "Airship", tram: "Tram" };
  const TAKE = { boat: "Take the boat from", zeppelin: "Take the zeppelin from", airship: "Take the airship from", tram: "Take the tram from" };
  function matches() {
    const places = view?.places || [];
    const q = norm(query);
    if (!q) return places.filter((p) => p.kind === "flight").slice(0, 60);
    const words = q.split(" ");
    return places.map((p) => ({ p, hay: `${norm(p.label)} ${p.search}` })).filter(({ hay }) => words.every((w) => hay.includes(w)))
      .sort((a, b) => Number(norm(b.p.label).startsWith(q)) - Number(norm(a.p.label).startsWith(q)) || a.p.label.localeCompare(b.p.label)).slice(0, 60).map(({ p }) => p);
  }
  function results() {
    const list = matches();
    if (!list.length) return `<p class="tp-none">Nothing matches. Try a zone name, a town or a flight master's name.</p>`;
    return `<ul class="tp-results" data-tp-results>${list.map((p) => `<li><button type="button" class="tp-place${p.id === to ? " picked" : ""}" data-tp-to="${esc(p.id)}" aria-pressed="${p.id === to}"><span class="tp-place-glyph" aria-hidden="true">${p.kind === "flight" ? "➶" : "✥"}</span><span class="tp-place-words"><strong>${esc(p.label)}</strong><small>${esc(p.sub)}</small></span></button></li>`).join("")}</ul>`;
  }
  function facts() {
    const c = view.character;
    if (!c) return `<p class="tp-fact">No character is chosen, so every flight point counts and the start has to be picked by hand.</p>`;
    const lines = [];
    lines.push(c.knownFlightPoints === null ? "Flight points: not saved yet. Open any flight map in game, then /reload; until then routes say “if you know these flight points”." : `Flight points: ${c.knownFlightPoints} learned, as saved by the addon.`);
    lines.push(c.hearth ? `Hearthstone: ${esc(c.hearth.name)}${c.hearth.readyIn === null ? ", cooldown not known" : c.hearth.readyIn > 0 ? `, ready in ${time(c.hearth.readyIn)}` : ", ready"}${c.hearth.placed ? "" : ". Its spot on the map is not recorded yet"}.` : "Hearthstone: not in the saved data yet.");
    const t = view.transports;
    if (t?.known) lines.push(t.gameFiles ? `Boats and zeppelins: ${t.read} of ${t.known} have their stops in your game files.` : "Boats and zeppelins: where they stop is read from your game files. Connect your game folder to plan them.");
    if (view.gameFiles?.names) lines.push("Flight point names, and the places and prices nobody recorded, come from your own game files.");
    else if (!c.namedFlightPoints) lines.push("Flight points show by zone and flight master until the addon has seen a flight map, which gives their real names.");
    return lines.map((l) => `<p class="tp-fact">${l}</p>`).join("");
  }
  function ride(l) {
    const right = l.timing === "unknown" ? "time not recorded" : `<span>about ${rough(l.seconds)}</span> <span class="tp-wait">plus the wait</span>`;
    const more = [l.name ? `<small data-no-translate>${esc(l.name)}</small>` : "", ...(l.via || []).map((v) => `<small>Stay on board at ${esc(v)}.</small>`)].join("");
    return `<li class="tp-leg tp-leg-ride tp-leg-${l.mode}"><span class="tp-leg-glyph tp-leg-art" aria-hidden="true"><img src="art/icons/adventure-compass.png" alt=""></span><span class="tp-leg-words"><span class="tp-mode">${MODE[l.mode]}</span> ${TAKE[l.mode]} <strong>${esc(l.from)}</strong> to <strong>${esc(l.to)}</strong>${more}</span><span class="tp-leg-time">${right}</span></li>`;
  }
  function leg(l) {
    if (l.kind === "ride") return ride(l);
    if (l.change) return `<li class="tp-leg tp-leg-walk"><span class="tp-leg-glyph" aria-hidden="true">${GLYPH.walk}</span><span class="tp-leg-words">Walk to the next departure at <strong>${esc(l.to)}</strong></span><span class="tp-leg-time">about ${time(l.seconds)}</span></li>`;
    const right = `${l.timing === "observed" ? "" : l.timing === "unknown" ? "time not recorded · " : "about "}${l.timing === "unknown" && l.kind === "fly" ? "" : time(l.seconds)}${l.kind === "fly" ? ` · ${l.cost === null ? "price not recorded" : coins(l.cost)}` : ""}`;
    const words = l.kind === "walk" ? `Go on foot from <strong>${esc(l.from)}</strong> to <strong>${esc(l.to)}</strong> <small>${l.yards.toLocaleString()} yards in a straight line</small>`
      : l.kind === "fly" ? `Fly from <strong>${esc(l.from)}</strong> to <strong>${esc(l.to)}</strong>`
      : l.kind === "hearth" ? `Use your Hearthstone to <strong>${esc(l.to)}</strong>`
      : `Wait for your Hearthstone`;
    return `<li class="tp-leg tp-leg-${l.kind}"><span class="tp-leg-glyph" aria-hidden="true">${GLYPH[l.kind]}</span><span class="tp-leg-words">${words}</span><span class="tp-leg-time">${right}</span></li>`;
  }
  function card(o, i) {
    const price = o.cost === null ? `<span class="tp-price">price not recorded</span>` : o.cost === 0 ? `<span class="tp-price">free</span>` : `<span class="tp-price">${o.costEstimated ? "about " : ""}${coins(o.cost)}</span>`;
    return `<article class="tp-card tp-${o.kind}${i === 0 && !o.unknownTime ? " tp-best" : ""}" data-tp-option="${o.kind}"${o.kind === "ride" ? ` data-tp-mode="${o.mode}"` : ""}>
      <header><span class="tp-rank" aria-hidden="true">${o.unknownTime ? "?" : i + 1}</span><div class="tp-title"><span class="tp-kind">${i === 0 && !o.unknownTime ? "<span>Fastest</span> · " : ""}<span>${o.kind === "ride" ? MODE[o.mode] : KIND[o.kind]}</span>${o.reference ? " · <span>reference</span>" : ""}</span><h3>${o.unknownTime ? "time not recorded" : o.plusWait ? `<span>about ${rough(o.seconds)}</span> <span class="tp-wait">plus the wait</span>` : `${o.exact ? "" : "about "}${time(o.seconds)}`}</h3></div>${price}</header>
      <ol class="tp-legs">${o.legs.map(leg).join("")}</ol>
      ${o.notes.length ? `<ul class="tp-notes">${o.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    </article>`;
  }
  function output() {
    if (!to) return `<div class="tp-empty"><strong>Pick where you want to go.</strong><p>Choose a flight point or a zone on the left. The planner compares going on foot, flying, boats and zeppelins and your Hearthstone, with the time and the price of each.</p></div>`;
    if (planning && !plan) return `<div class="tp-empty"><p>Working out the trip…</p></div>`;
    if (planError) return `<div class="tp-empty"><strong>The trip could not be planned.</strong><p>${esc(planError)}</p></div>`;
    if (!plan) return "";
    const head = plan.from && plan.to ? `<h2 class="tp-trip">${esc(plan.from.label)} <span aria-hidden="true">→</span> ${esc(plan.to.label)}</h2>` : "";
    const cards = plan.options.length ? plan.options.map(card).join("") : `<div class="tp-empty"><strong>No way found.</strong></div>`;
    const notes = plan.notes.length ? `<ul class="tp-notes tp-plan-notes">${plan.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
    return `${head}<div class="tp-cards">${cards}</div>${notes}${plan.coverage ? `<p class="tp-coverage">${esc(plan.coverage)}</p>` : ""}${plan.transportNote ? `<p class="tp-coverage">${esc(plan.transportNote)}</p>` : ""}`;
  }
  function body() {
    if (error) return `<div class="tp-empty"><p>${esc(error)}</p></div>`;
    if (!view) return `<div class="tp-empty"><p>Reading the flight map…</p></div>`;
    if (!view.available) return `<div class="tp-empty"><strong>The travel planner is off for this game patch.</strong><p>${esc(view.reason || "")}</p></div>`;
    const c = view.character;
    const saved = c?.hasPosition ? `<option value="saved"${from === "saved" ? " selected" : ""}>Where ${esc(c.name)} last saved${c.zone ? ` (${esc(c.zone)})` : ""}</option>` : `<option value="saved"${from === "saved" ? " selected" : ""} disabled>Saved position not known</option>`;
    return `<div class="tp-layout">
      <aside class="tp-pick" aria-label="Trip">
        <label class="tp-field"><span>From</span><select data-tp-from>${saved}${view.places.map((p) => `<option value="${esc(p.id)}"${p.id === from ? " selected" : ""}>${esc(p.label)}${p.kind === "zone" ? " (zone)" : ""}</option>`).join("")}</select></label>
        <label class="tp-field"><span>Where to?</span><input type="search" data-tp-search placeholder="Zone, town or flight master" value="${esc(query)}" autocomplete="off" spellcheck="false"></label>
        <div data-tp-list>${results()}</div>
        <div class="tp-facts">${facts()}</div>
      </aside>
      <div class="tp-out" data-tp-out aria-live="polite">${output()}</div>
    </div>
    <p class="tp-source">${esc(view.attribution)} ${view.counts.nodes} flight points and ${view.counts.edges} connections seen by players; ${view.counts.timedEdges} connections have a recorded flight time. ${view.note ? esc(view.note) : ""}</p>`;
  }
  function page() {
    return `<section class="travel-page" data-travel>${PageHero.render({ art: "adventure", eyebrow: "Adventure · Travel", title: "Travel planner", subtitle: "On foot, by flight, by boat or zeppelin, or by Hearthstone: the time and the price of each, fastest first." })}
      <div data-travel-body>${body()}</div></section>`;
  }
  const paint = (selector, html) => { const n = document.querySelector(selector); if (n) n.innerHTML = html; };
  async function run() {
    if (!to) return;
    planning = true; planError = ""; plan = null; paint("[data-tp-out]", output());
    const asked = `${from}|${to}`;
    try { const r = await api.travelPlan({ from, to }); if (asked === `${from}|${to}`) plan = r; }
    catch (e) { if (asked === `${from}|${to}`) planError = e.message || "The planner is unavailable."; }
    planning = false;
    paint("[data-tp-out]", output());
  }
  async function load() {
    if (loading) return; loading = true;
    try {
      view = await api.travelPlaces(); error = "";
      if (view.available && from === "saved" && !view.character?.hasPosition) from = view.places.find((p) => p.kind === "flight")?.id || "saved";
      if (to && !view.places?.some((p) => p.id === to)) { to = null; plan = null; }
    } catch (e) { error = e.message || "The travel planner is unavailable."; }
    loading = false;
    const root = document.querySelector("[data-travel]");
    if (root) { root.outerHTML = page(); mountedFor = null; mounted(); }
  }
  function mounted() {
    const root = document.querySelector("[data-travel]");
    if (!root || mountedFor === root) return;
    mountedFor = root;
    root.addEventListener("input", (e) => { if (e.target.matches("[data-tp-search]")) { query = e.target.value; paint("[data-tp-list]", results()); } });
    root.addEventListener("change", (e) => { if (e.target.matches("[data-tp-from]")) { from = e.target.value; run(); } });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tp-to]");
      if (!b) return;
      to = b.dataset.tpTo; paint("[data-tp-list]", results()); run();
    });
    if (!view && !loading) load();
  }
  return { page, mounted, invalidate: () => { view = null; plan = null; }, _format: { time, rough } };
})();
