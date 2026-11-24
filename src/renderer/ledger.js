"use strict";
// Ledger (0.35): Bags & bank, Gold & prices, Reputation and Cooldowns for every character, from
// the addon's ledger (bank and mail as last seen, prices from Auction House pages the player
// opened). Read-only: one `ledger` request, searched here.
window.LedgerView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  const LIMIT = 150;
  let data = null, error = "", loading = false, loadedAt = 0, mountedFor = null, route = "ledger", repFor = null;
  let repFaction = null, focusRepFor = null, loadGeneration = 0, loadedFor = null;
  let activeProfile = () => data?.activeProfileId;
  let characterPending = () => false;
  let cdGroup = "readiness";
  const query = { items: "", prices: "" };
  const nowSec = () => Math.floor(Date.now() / 1000);
  function coins(copper) {
    if (!Number.isFinite(copper)) return "?";
    const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
    return `<span class="ldg-coins">${g ? `<span class="ldg-gold">${g.toLocaleString()}g</span>` : ""}${s ? `<span class="ldg-silver">${s}s</span>` : ""}${c || (!g && !s) ? `<span class="ldg-copper">${c}c</span>` : ""}</span>`;
  }
  function ago(at) {
    if (!Number.isFinite(at)) return "never";
    const s = Math.max(0, nowSec() - at);
    if (s < 120) return "just now";
    if (s < 7200) return `${Math.round(s / 60)} minutes ago`;
    if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
    return `${Math.round(s / 86400)} days ago`;
  }
  function wait(seconds) {
    const minutes = Math.ceil(seconds / 60);
    const h = Math.floor(minutes / 60), m = minutes % 60;
    if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  }
  const quality = (q) => QUALITY[q] || "common";
  const ledgered = () => (data?.characters || []).filter((c) => c.hasLedger);
  const active = () => data?.characters.find((c) => c.profileId === data.activeProfileId) || null;
  function search(rows, q) {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((r) => String(r.itemId) === q.trim() || words.every((w) => r.name.toLowerCase().includes(w)));
  }
  function empty(what) {
    return `<p class="ldg-empty">${what} Log in with the addon on, then type <code>/reload</code> (or log out) once so the desktop app receives it.</p>`;
  }
  const num = ' class="ldg-num"';
  function table(id, label, columns, content, count = 0) {
    const heading = `ldg-${id}-heading`;
    return `<div class="ldg-table-frame${count > 10 ? " ldg-long" : ""}" data-table-heading="${heading}"><table class="ldg-table ldg-table-${id}" aria-labelledby="${heading}">
      <caption id="${heading}" class="sr-only">${label}</caption><thead><tr>${columns.map(([text, numeric]) => `<th scope="col"${numeric ? num : ""}>${text}</th>`).join("")}</tr></thead>${content}</table></div>`;
  }
  const resultLimit = (count) => count > LIMIT ? `<p class="ldg-more">Showing ${LIMIT} of ${count}. Search to narrow it down.</p>` : "";
  function rowGroup(label, columns, rows) {
    return `<tbody><tr class="ldg-group"><th scope="rowgroup" colspan="${columns}">${esc(label)}</th></tr>${rows}</tbody>`;
  }
  function searchBar(id, heading, placeholder) {
    const label = id === "items" ? "Search items" : "Search prices";
    return `<div class="ldg-toolbar"><h2>${heading}</h2><label class="ldg-search"><span class="sr-only">${label}</span><input type="search" data-ledger-search="${id}" placeholder="${placeholder}" value="${esc(query[id])}" autocomplete="off" aria-label="${label}"></label></div>`;
  }
  function hero(art, page, title, subtitle) {
    const cls = String(active()?.className || "").toLowerCase();
    return PageHero.render({ art, eyebrow: `Ledger · ${page}`, title: esc(title), crest: PageHero.classCrest(cls), subtitle, compact: true });
  }

  // Bags & bank: one row per item, with who holds it where.
  function placeLine(h) {
    const parts = [h.bags ? `bags ${h.bags}` : "", h.bank ? `bank ${h.bank}` : "", h.mail ? `mail ${h.mail}` : ""].filter(Boolean).join(" · ");
    const seen = [h.bank ? `bank seen ${ago(h.bankSeenAt)}` : "", h.mail ? `mail seen ${ago(h.mailSeenAt)}` : ""].filter(Boolean).join(", ");
    return `<li><strong>${esc(h.name)}</strong><span>${esc(parts)}</span>${seen ? `<small>${esc(seen)}</small>` : ""}</li>`;
  }
  function itemRows() {
    const rows = search(data.items, query.items);
    if (!rows.length) return `<p class="ldg-empty">${data.items.length ? "Nothing your characters carry matches that." : "No items yet."}</p>`;
    return table("inventory", "Inventory", [["Item"], ["Quantity", true], ["Held by"]], `<tbody>${rows.slice(0, LIMIT).map((r) => `<tr data-ledger-item="${r.itemId}">
      <th scope="row" data-card-item="${r.itemId}"><span class="ldg-name q-${quality(r.quality)}">${esc(r.name)}</span></th><td${num}><strong>${r.total.toLocaleString()}</strong></td>
      <td><ul class="ldg-holders">${r.holders.map(placeLine).join("")}</ul></td></tr>`).join("")}</tbody>`, rows.length) + resultLimit(rows.length);
  }
  function seenChips() {
    return `<ul class="ldg-chips">${ledgered().map((c) => `<li><strong>${esc(c.name)}</strong> <span>bags ${esc(ago(c.bagsSeenAt))}</span> · <span>${c.bankSeenAt ? `bank ${esc(ago(c.bankSeenAt))}` : "bank never opened"}</span> · <span>${c.mailSeenAt ? `mail ${esc(ago(c.mailSeenAt))}` : "mailbox never opened"}</span></li>`).join("")}</ul>`;
  }
  function bags() {
    const chars = ledgered();
    if (!chars.length) return empty("No ledger yet.");
    const neverBank = chars.filter((c) => !c.bankSeenAt).length;
    return `<div class="ldg-summary"><div><strong>${data.items.length.toLocaleString()}</strong><span>different items</span></div><div><strong>${chars.length}</strong><span>characters</span></div><div><strong>${data.items.reduce((s, r) => s + r.total, 0).toLocaleString()}</strong><span>items in all</span></div><div><strong>${neverBank}</strong><span>bank${neverBank === 1 ? "" : "s"} never opened</span></div></div>
      <section class="ldg-card">${searchBar("items", "Inventory", "Search items by name or ID")}<div data-ledger-list="items">${itemRows()}</div>
      <details class="ldg-source"><summary>When bags, banks and mail were last seen</summary><p class="ldg-note">Bags update whenever the addon saves. Bank and mail reflect the last time you opened them in game.</p>${seenChips()}</details></section>
      ${window.RepPlannerView?.collectionSection(chars, data.activeProfileId) || ""}`;
  }

  // Price history (E6): one point per Auction House visit, oldest on the left; the dashed line is the usual price.
  const stamp = (v, kind) => (window.I18n?.when ? window.I18n.when(v, kind) : new Date(v).toLocaleString()); // one date format, in the shown language (i18n.js)
  const day = (at) => stamp(at * 1000, "day");
  const fullDay = (at) => stamp(at * 1000, "date");
  function coinsText(copper) {
    const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
    return [g ? `${g.toLocaleString()}g` : "", s ? `${s}s` : "", c || (!g && !s) ? `${c}c` : ""].filter(Boolean).join(" ");
  }
  function spark(points, usual) {
    if (!points || points.length < 2) return `<span class="ldg-spark-none">${points?.length ? "Seen once" : ""}</span>`;
    const W = 104, H = 28, pad = 4, values = points.map((p) => p[0]);
    const lo = Math.min(...values, usual), hi = Math.max(...values, usual);
    const x = (i) => pad + ((W - 2 * pad) * i) / (points.length - 1);
    const y = (v) => (hi === lo ? H / 2 : pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo)));
    const fix = (n) => Math.round(n * 10) / 10;
    const last = points.length - 1;
    return `<svg class="ldg-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${points.length} visits from ${esc(day(points[0][1]))} to ${esc(day(points[last][1]))}: lowest ${esc(coinsText(Math.min(...values)))}, highest ${esc(coinsText(Math.max(...values)))}"><line class="ldg-spark-usual" x1="${pad}" x2="${W - pad}" y1="${fix(y(usual))}" y2="${fix(y(usual))}"/><polyline points="${points.map((p, i) => `${fix(x(i))},${fix(y(p[0]))}`).join(" ")}"/><circle cx="${fix(x(last))}" cy="${fix(y(values[last]))}" r="2.6"/></svg>`;
  }
  // Gold over time (E9): one sample per day played, per character.
  let moneyFor = null, craftFor = null;
  function goldChart(m) {
    const pts = m.points;
    if (pts.length < 2) return `<p class="ldg-empty">One sample so far: ${coins(pts[0][0])} on ${esc(fullDay(pts[0][1]))}. The chart appears after a second day of play.</p>`;
    const W = 860, H = 220, L = 88, R = 16, T = 14, B = 30;
    const t0 = pts[0][1], t1 = pts[pts.length - 1][1];
    let lo = m.low, hi = m.high;
    if (hi === lo) { hi = lo + 100; lo = Math.max(0, lo - 100); }
    const padY = (hi - lo) * 0.08; lo = Math.max(0, lo - padY); hi += padY;
    const fix = (n) => Math.round(n * 10) / 10;
    const x = (at) => fix(L + ((W - L - R) * (at - t0)) / Math.max(1, t1 - t0)), y = (v) => fix(T + (H - T - B) * (1 - (v - lo) / (hi - lo)));
    const line = pts.map((p) => `${x(p[1])},${y(p[0])}`).join(" ");
    const grid = [0, 0.5, 1].map((f) => { const v = lo + (hi - lo) * f, yy = y(v); return `<line class="ldg-chart-grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="ldg-chart-label" x="${L - 8}" y="${yy + 4}" text-anchor="end">${esc(coinsText(Math.round(v / 100) * 100))}</text>`; }).join("");
    const marks = pts.length <= 45 ? pts.map((p) => `<circle cx="${x(p[1])}" cy="${y(p[0])}" r="2.8"/>`).join("") : "";
    const dates = `<text class="ldg-chart-label" x="${L}" y="${H - 8}">${esc(day(t0))}</text><text class="ldg-chart-label" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(day(t1))}</text>${pts.length >= 5 ? `<text class="ldg-chart-label" x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle">${esc(day(Math.round((t0 + t1) / 2)))}</text>` : ""}`;
    return `<svg class="ldg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.name)}: gold from ${esc(fullDay(t0))} to ${esc(fullDay(t1))}, ${esc(coinsText(m.first))} to ${esc(coinsText(m.last))}">${grid}<polygon class="ldg-chart-area" points="${x(t0)},${y(lo)} ${line} ${x(t1)},${y(lo)}"/><polyline class="ldg-chart-line" points="${line}"/>${marks}${dates}</svg>`;
  }
  function signed(copper) {
    if (!copper) return `<span class="ldg-flat">no change</span>`;
    return `<span class="${copper > 0 ? "ldg-gain" : "ldg-loss"}">${copper > 0 ? "+" : "−"}${coins(Math.abs(copper))}</span>`;
  }
  const span = (seconds) => { const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`; };
  const clock = (at) => stamp(at * 1000, "time");
  // Gold per play session (E9): the purse when the addon loaded and when it last saw the character.
  function sessionsBlock(pick) {
    const s = pick.sessions;
    if (!s) return `<h3 class="ldg-sub">Gold per play session</h3><p class="ldg-empty" data-ledger-sessions="none">No play session is saved for this character yet. Sessions are saved from the next login with the current addon.</p>`;
    const rows = s.rows.map((r) => `<tr><th scope="row">${esc(fullDay(r.start))}<small class="ldg-cell-note">${esc(clock(r.start))} – ${esc(clock(r.end))}</small></th><td${num}>${esc(span(r.seconds))}</td><td${num}>${signed(r.change)}</td><td${num}>${r.perHour === null ? `<span class="ldg-flat">too short</span>` : signed(r.perHour)}</td></tr>`).join("");
    const total = s.total ? `<p class="ldg-note"><span>Across these sessions of ten minutes or more:</span> ${signed(s.total.change)} <span>in</span> ${esc(span(s.total.seconds))}<span>, per hour</span> ${signed(s.total.perHour)}</p>` : "";
    return `<h3 class="ldg-sub">Gold per play session</h3>${total}<div data-ledger-sessions>${table("sessions", "Gold per play session", [["Session"], ["Time logged in", true], ["Gold change", true], ["Per hour", true]], `<tbody>${rows}</tbody>`, s.rows.length)}</div>
      <p class="ldg-note ldg-after">The time is clock time from login (or /reload) to the last moment the addon saw you, time away from the keyboard included. The change is everything that moved your gold: loot, quests, selling, repairs, training, mail and auctions.</p>`;
  }
  function moneyCard() {
    const list = data.money || [];
    const missing = `<p class="ldg-note ldg-after">The value of what you looted is not shown: the addon does not record loot outside dungeons.</p>`;
    if (!list.length) return `<section class="ldg-card" data-ledger-money-card><h2>Gold over time</h2><p class="ldg-empty">No gold samples yet. They build up one per day you play with the addon on.</p>${missing}</section>`;
    const pick = list.find((m) => m.profileId === moneyFor) || list.find((m) => m.profileId === activeProfile()) || list[0];
    const rows = pick.changes.map((c) => `<tr><th scope="row">${esc(fullDay(c.at))}</th><td${num}>${coins(c.money)}</td><td${num}>${signed(c.change)}${c.days > 1 ? `<small class="ldg-cell-note">over ${c.days} days</small>` : ""}</td></tr>`).join("");
    return `<section class="ldg-card" data-ledger-money-card><div class="ldg-toolbar"><h2>Gold over time</h2><label class="ldg-pick ldg-inline">Character <select data-ledger-money aria-label="Gold over time of">${list.map((m) => `<option value="${esc(m.profileId)}"${m === pick ? " selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label></div>
      <p class="ldg-note">${esc(pick.name)}: ${coins(pick.last)} on ${esc(fullDay(pick.lastAt))}${pick.points.length > 1 ? `, ${signed(pick.change)} since ${esc(fullDay(pick.firstAt))}` : ""}. One sample per day played, as the game last saved it that day.</p>
      ${goldChart(pick)}
      ${rows ? `<div class="ldg-chart-days">${table("money", "Gold day by day", [["Day"], ["Gold", true], ["Change since the sample before", true]], `<tbody>${rows}</tbody>`, pick.changes.length)}</div>` : ""}${sessionsBlock(pick)}${missing}</section>`;
  }
  // Craft profit (E7): material cost against the selling price, only from prices the player saw.
  function materialLine(m) {
    const price = m.cost === null
      ? `<em class="ldg-unknown">price never seen${m.vendorListed ? " (vendors sell it: open one in game)" : ""}</em>`
      : `${coins(m.unit)} each · ${m.source === "vendor" ? "vendor" : "auction"}, ${esc(ago(m.at))}`;
    return `<li><span data-card-item="${m.itemId}"><strong>${m.required} ×</strong> <span class="ldg-name q-${quality(m.quality)}">${esc(m.name)}</span></span><small>${price}</small></li>`;
  }
  function craftRows(pick) {
    return pick.rows.map((r) => `<tr data-ledger-craft-row="${r.recipeId}">
      <th scope="row"><span class="ldg-name q-${quality(r.quality)}" data-card-item="${r.outputItemId}">${esc(r.outputName)}</span><small class="ldg-cell-note">${esc(r.profession || "Profession")}${r.made > 1 || r.madeUpTo ? ` · makes ${r.made}${r.madeUpTo ? `–${r.madeUpTo}` : ""}` : ""}</small></th>
      <td>${r.materialsKnown ? `<ul class="ldg-mats">${r.materials.map(materialLine).join("")}</ul>` : `<em class="ldg-unknown">Materials not read yet. Open the profession window in game.</em>`}</td>
      <td${num}>${r.cost === null ? `<em class="ldg-unknown">Unknown</em>` : coins(r.cost)}</td>
      <td${num}>${r.sell ? `${coins(r.sell.total)}<small class="ldg-cell-note">seen ${esc(ago(r.sell.at))}</small>` : `<em class="ldg-unknown">Never seen</em>${r.vendorPays ? `<small class="ldg-cell-note">vendors pay ${coins(r.vendorPays)}</small>` : ""}`}</td>
      <td${num}>${r.profit === null ? `<em class="ldg-unknown">Unknown</em>` : `<strong>${signed(r.profit)}</strong>`}</td></tr>`).join("");
  }
  function crafts() {
    const list = data.crafts || [];
    if (!list.length) return `<section class="ldg-card"><h2>Craft profit</h2><p class="ldg-empty">No recipes saved yet. Open a profession window in game with the addon on, then type <code>/reload</code> (or log out) once.</p></section>`;
    const pick = list.find((c) => c.profileId === craftFor) || list.find((c) => c.profileId === activeProfile()) || list[0];
    const best = pick.rows.find((r) => r.profit !== null && r.profit > 0);
    return `<div class="ldg-summary"><div><strong>${pick.rows.length}</strong><span>recipes that make an item</span></div><div><strong>${pick.known}</strong><span>with every price seen</span></div><div><strong>${best ? signed(best.profit) : "—"}</strong><span>${best ? `best: ${esc(best.outputName)}` : "no profitable craft seen yet"}</span></div></div>
      <section class="ldg-card"><div class="ldg-toolbar"><h2>Craft profit</h2><label class="ldg-pick ldg-inline">Character <select data-ledger-craft aria-label="Craft profit of">${list.map((c) => `<option value="${esc(c.profileId)}"${c === pick ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label></div>
      <p class="ldg-note">Material cost against what the result sold for, only from prices you saw: Auction House pages and vendor windows you opened. A price you never saw stays unknown. Fees and deposits are not included.</p>
      ${pick.rows.length ? table("crafts", "Craft profit", [["Makes"], ["Materials"], ["Cost", true], ["Sells for", true], ["Profit", true]], `<tbody>${craftRows(pick)}</tbody>`, pick.rows.length) : `<p class="ldg-empty">None of ${esc(pick.name)}'s saved recipes makes an item.</p>`}
      <p class="ldg-note ldg-after">${pick.complete ? "" : "The recipe list was only partly read. "}Vendor prices are remembered from vendor windows you open in game${data.vendorPricesSeen ? ` (${data.vendorPricesSeen} so far)` : " (none yet)"}; the bundled seller list has no prices.</p></section>`;
  }

  // Gold & prices.
  function priceRows() {
    const rows = search(data.prices, query.prices);
    if (!rows.length) return `<p class="ldg-empty">${data.prices.length ? "No remembered price matches that." : "Browse the Auction House in game with price memory on (/bf prices on) and the prices you see show up here."}</p>`;
    return table("prices", "Price memory", [["Item"], ["Last seen, each", true], ["Usual", true], ["History"], ["Lowest seen", true], ["Last seen when"]], `<tbody>${rows.slice(0, LIMIT).map((r) => `<tr data-ledger-price="${r.itemId}"><th scope="row" data-card-item="${r.itemId}"><span class="ldg-name q-${quality(r.quality)}">${esc(r.name)}</span></th><td${num}>${coins(r.latest)}${r.below ? `<small class="ldg-cell-note ldg-below" data-ledger-below>${r.belowPercent}% below your usual price</small>` : ""}</td><td${num}>${r.visits >= 2 ? coins(r.usual) : "—"}<small class="ldg-cell-note">${r.visits === 1 ? "1 visit" : `${r.visits || 0} visits`}</small></td><td class="ldg-spark-cell">${spark(r.spark, r.usual)}</td><td${num}>${coins(r.low)}${r.low < r.latest ? `<small class="ldg-cell-note">${esc(ago(r.lowAt))}</small>` : ""}</td><td>${esc(ago(r.latestAt))}</td></tr>`).join("")}</tbody>`, rows.length) + resultLimit(rows.length);
  }
  // Gold goal (0.36, E4): the player's own target, progress across characters, a pace estimate.
  let goalNote = "";
  let savings = null, focusSavings = false, savingGoal = false;
  const ownsSavings = review => review && review.profileId === activeProfile() &&
    review.profileId === document.querySelector("#active-character")?.value;
  function reviewSavings(review) {
    savings = { ...review, gold: Math.ceil(review.copper / 10000) };
    focusSavings = true;
    goalNote = "";
    data = null; error = ""; loadGeneration++;
  }
  function savingsReview() {
    if (!ownsSavings(savings) || savings.profileId !== data.activeProfileId || !data.goal) return "";
    const { character, recipe, crafts, gold, copper } = savings;
    const current = data.goal.goal;
    return `<section class="ldg-card" data-ledger-savings-review><h2>Workshop savings estimate</h2>
      <p>${esc(character)} · ${esc(recipe)} · ${crafts} craft attempt${crafts === 1 ? "" : "s"}: ${coins(copper)} estimated, rounded up to <strong>${gold.toLocaleString()} gold</strong> for the goal.</p>
      <p class="ldg-note">Based on saved carried quantities and dated Auction House buyouts, not current prices. The goal tracks saved gold across characters, not purchases or crafting progress.</p>
      ${current ? `<p>Current goal: ${esc(current.label || "Gold goal")} · ${coins(current.copper)}. Replacing it keeps just one gold goal.</p>` : ""}
      <div class="actions"><button type="button" class="primary" data-ledger-savings-apply>${current ? "Replace gold goal" : "Set gold goal"}</button><button type="button" data-ledger-savings-cancel>${current ? "Keep current goal" : "Cancel"}</button></div>
      <p class="ldg-goal-msg" role="status">${esc(goalNote)}</p></section>`;
  }
  // 1.3 (J11): a riding-and-mount target from prices your characters saw at the riding trainer and a mount vendor.
  function mountHint(m) {
    if (!m) return `<p class="ldg-note">Saving for riding training and your first mount, or anything else? Set the amount yourself, or open your riding trainer's window and a mount vendor once in game (then /reload): the app adds up what they charge.</p>`;
    const parts = [m.riding ? `${esc(m.riding.name)} ${coins(m.riding.cost)}` : null, m.mount ? `${esc(m.mount.name)} ${coins(m.mount.cost)}` : null].filter(Boolean).join(" + ");
    if (!m.complete) return `<p class="ldg-note">Seen so far: ${parts}. Open ${m.riding ? "a mount vendor" : "your riding trainer"}'s window once in game too, and the app adds them up for a riding-and-mount goal.</p>`;
    return `<p class="ldg-note">From prices your characters saw in game: ${parts} = <strong>${coins(m.copper)}</strong>.</p><p><button type="button" class="primary" data-ledger-goal-mount="${m.gold}">Save ${m.gold.toLocaleString()} gold for riding and a mount</button></p>`;
  }
  function goalCard() {
    const v = data.goal;
    if (!v) return "";
    const g = v.goal, r = v.rate;
    const pace = !r ? "No pace yet: the addon notes your gold once a day, so an estimate appears after two days of play."
      : r.perDay > 0 ? `Your gold grew by about ${coinsText(r.perDay)} a day over the last ${r.days} days (all characters).`
      : `Your gold did not grow over the last ${r.days} days (all characters), so there is no estimate.`;
    const inputs = `<div class="ldg-goal-form"><label>Target in gold<input type="number" min="1" max="10000000" step="1" data-ledger-goal="gold" value="${g ? Math.round(g.copper / 10000) : ""}" aria-label="Gold goal in gold"></label><label>What it's for<input type="text" maxlength="60" data-ledger-goal="label" value="${esc(g?.label || "")}" placeholder="e.g. riding and first mount" aria-label="What the gold goal is for"></label><button type="button" class="primary" data-ledger-goal-save>${g ? "Update goal" : "Set goal"}</button>${g ? `<button type="button" class="subtle" data-ledger-goal-clear>Clear</button>` : ""}</div><p class="ldg-goal-msg" role="status">${esc(goalNote)}</p>`;
    if (!g) return `<section class="ldg-card ldg-goal" data-ledger-goal-card><h2>Gold goal</h2>${mountHint(v.mountSuggestion)}${inputs}</section>`;
    const pct = Math.round(v.progress * 100);
    return `<section class="ldg-card ldg-goal${v.reached ? " done" : ""}" data-ledger-goal-card><div class="ldg-goal-head"><h2>${esc(g.label || "Gold goal")}</h2><span>${coins(v.have)} of ${coins(g.copper)}</span></div>
      <span class="ldg-bar ldg-goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Gold goal progress"><span data-w="${v.progress * 100}"></span></span>
      <p class="ldg-note" data-ledger-goal-status>${v.reached ? "<strong>Goal reached.</strong> Mail the gold to the character who needs it if it's spread out." : `<strong>${coins(v.left)}</strong> to go${v.daysLeft ? `, about <strong>${v.daysLeft} day${v.daysLeft === 1 ? "" : "s"}</strong> at your recent pace` : ""}.`} Counts gold on ${v.characters} character${v.characters === 1 ? "" : "s"}${v.activeName ? `; ${esc(v.activeName)} has ${coins(v.activeMoney)}` : ""}.</p>
      <p class="ldg-note">${esc(pace)}</p>${inputs}</section>`;
  }
  function gold() {
    const chars = ledgered();
    if (!chars.length) return empty("No gold or prices yet.");
    const g = data.gold;
    const balances = table("balances", "Gold per character", [["Character"], ["On hand", true]], `<tbody>${g.characters.map((c) => `<tr data-ledger-gold="${esc(c.profileId)}"><th scope="row">${esc(c.name)}${c.faction ? ` <small>${esc(c.faction)}</small>` : ""}</th><td${num}>${coins(c.money)}</td></tr>`).join("")}</tbody>`);
    const worth = table("value", "Estimated auction value", [["Item"], ["Qty", true], ["Each", true], ["Value", true]], `<tbody>${data.value.items.slice(0, 15).map((v) => `<tr><th scope="row" data-card-item="${v.itemId}"><span class="ldg-name q-${quality(v.quality)}">${esc(v.name)}</span></th><td${num}>${v.count.toLocaleString()}</td><td${num}>${coins(v.unit)}</td><td${num}>${coins(v.value)}</td></tr>`).join("")}</tbody>`);
    const mail = chars.filter((c) => c.mail?.money);
    return `<div class="ldg-summary"><div><strong>${coins(g.total)}</strong><span>gold on ${g.characters.length} character${g.characters.length === 1 ? "" : "s"}</span></div><div><strong>${data.value.items.length ? coins(data.value.total) : "—"}</strong><span>estimated auction value</span></div><div><strong>${data.prices.length.toLocaleString()}</strong><span>prices remembered</span></div></div>
      <section class="ldg-card">${searchBar("prices", "Price memory", "Search remembered prices")}<p class="ldg-note">Lowest buyout per item on Auction House pages you opened. The addon never searches or buys. Usual is the middle price of your visits; the mark appears after three visits when the newest price is at least 15% under it.</p><div data-ledger-list="prices">${priceRows()}</div></section>
      <div class="ldg-two"><section class="ldg-card"><h2>Gold per character</h2>${balances}${mail.length ? `<p class="ldg-note ldg-after">Waiting in the mail: ${mail.map((c) => `${esc(c.name)} ${coins(c.mail.money)}`).join(", ")}.</p>` : ""}</section>
      <section class="ldg-card"><h2>Estimated auction value</h2>${data.value.items.length ? `${worth}<p class="ldg-note ldg-after">Based on last seen prices; actual sales vary.${data.value.items.length > 15 ? " Showing the 15 highest-value items." : ""}</p>` : `<p class="ldg-empty">Nothing you carry has a remembered auction price yet.</p>`}</section></div>${moneyCard()}${savingsReview()}${goalCard()}`;
  }

  // Reputation: one character at a time; their own side's factions first.
  function reputation() {
    const chars = ledgered().filter((c) => c.reputations);
    if (!chars.length) return `<section class="ldg-card"><h2 tabindex="-1" data-ledger-rep-heading>Faction standings</h2>${empty("No reputations yet.")}</section>`;
    if (focusRepFor && !chars.some(c => c.profileId === focusRepFor)) return `<section class="ldg-card"><h2 tabindex="-1" data-ledger-rep-heading>Reputation plan</h2>${empty("No saved standings for this character.")}</section>`;
    const pick = chars.find((c) => c.profileId === repFor) || chars.find((c) => c.profileId === activeProfile()) || chars[0];
    const groups = [["Alliance", pick.reputations.factions.filter((f) => f.side === "Alliance")], ["Horde", pick.reputations.factions.filter((f) => f.side === "Horde")], ["Other factions", pick.reputations.factions.filter((f) => !f.side)]];
    if (pick.faction === "Horde") groups.unshift(groups.splice(1, 1)[0]);
    const count = pick.reputations.factions.length;
    const rows = groups.filter(([, list]) => list.length).map(([name, list]) => rowGroup(name, 3, list.map((f) => `<tr data-ledger-faction="${f.id}"><th scope="row">${esc(f.name)}</th><td>${esc(f.standingName)}</td><td${num}>${f.standing < 8 ? `${f.current.toLocaleString()} / ${f.need.toLocaleString()}` : "Max"}</td></tr>`).join(""))).join("");
    return `<section class="ldg-card"><div class="ldg-toolbar"><h2>Faction standings</h2><label class="ldg-pick">Character <select data-ledger-rep aria-label="Reputation of">${chars.map((c) => `<option value="${esc(c.profileId)}"${c === pick ? " selected" : ""}>${esc(c.name)}${c.faction ? ` · ${esc(c.faction)}` : ""}</option>`).join("")}</select></label></div>
      <p class="ldg-note">Seen ${esc(ago(pick.reputations.seenAt))}. Collapsed groups in game keep their last values.</p>${count ? table("factions", "Faction standings", [["Faction"], ["Standing"], ["Progress to next", true]], rows, count) : `<p class="ldg-empty">No factions recorded for this character.</p>`}</section>
      ${repPlan(pick)}`;
  }
  function repPlan(c) {
    const rows = c.reputations.factions;
    const f = rows.find(row => row.id === repFaction) || (repFaction === null ? rows[0] : null);
    const heading = `<h2 tabindex="-1" data-ledger-rep-heading>${f ? `${esc(f.name)} reputation plan` : "Reputation plan"}</h2>`;
    const picker = rows.length ? `<label class="ldg-pick">Plan for faction <select data-ledger-rep-faction>${f ? "" : '<option value="" selected disabled>Choose a saved faction</option>'}${rows.map(row => `<option value="${row.id}"${row === f ? " selected" : ""}>${esc(row.name)}</option>`).join("")}</select></label>` : "";
    if (!f) return `<section class="ldg-card" data-ledger-rep-plan>${heading}${picker}<p>No saved standing for the selected faction. Expand its group in WoW and save again.</p></section>`;
    const advice = c.repAdvice;
    const list = advice?.factions.find(row => row.id === f.id)?.quests || [];
    const isActive = c.profileId === activeProfile();
    const browseOnly = advice?.browseOnly === true;
    const reference = browseOnly
      ? `Browse only · Forever reference build ${esc(advice.referenceBuild)} does not match ${advice.characterBuild ? `saved build ${esc(advice.characterBuild)}` : "an unknown saved build"}. Quest matches are not checked against your log or eligibility.`
      : advice ? `Quest matches and requirements come from Forever reference build ${esc(advice.referenceBuild)}. In-log status comes from this character’s last save.` : "No quest reference available.";
    const view = window.ObjectiveView;
    const next = f.standing < 8 ? view?.standingName(f.standing + 1) : null;
    const pin = next && (!f.side || !c.faction || f.side === c.faction) && view.pin({ kind: "reputation", factionId: f.id, targetStanding: f.standing + 1 }, c.profileId);
    return `<section class="ldg-card" data-ledger-rep-plan>${heading}${picker}
      <p class="ldg-note">Saved Ledger: ${esc(f.standingName)}${f.observedAt ? ` · seen ${esc(ago(f.observedAt))}` : " · observation time unknown"}${next ? ` · ${Math.max(0, f.need - f.current).toLocaleString()} to ${esc(next)}` : ""}.</p>
      ${pin ? `${pin}<p class="ldg-note">Resume or clear this objective in Now. Only a qualifying saved standing change can complete it.</p>` : (next && !isActive ? '<p class="ldg-note">Switch the active character to pin their target.</p>' : "")}
      <h3>Quests and turn-ins</h3><p class="ldg-note">${reference} Current server reward amounts and unlisted requirements are unknown.</p>
      ${list.length && !isActive && !browseOnly ? `<p class="ldg-note">Switch the active character to ${esc(c.name)} to open quests from this plan.</p>` : ""}
      ${list.length ? `<ul class="ldg-rep-quests">${list.map(q => repQuest(q, c, isActive && !browseOnly, browseOnly)).join("")}</ul>` : '<p class="ldg-empty">No matching quests in the available reference. Check eligibility and rewards in game.</p>'}</section>
      ${window.RepPlannerView?.section(c.profileId, f) || ""}`;
  }
  function repQuest(q, character, canOpen, browseOnly) {
    const status = browseOnly ? "Reference only" : q.status === "turn-in" ? "Saved log: ready to turn in" : q.status === "in-log" ? "Saved log: in progress" : "Reference lead: check availability in game";
    const gates = [q.minLevel ? `Minimum level ${q.minLevel}` : null, q.sides.length ? q.sides.join(" / ") : null].filter(Boolean).join(" · ");
    const from = q.linkedFrom.map(p => `${p.title} (${p.completed === true ? "completion saved" : p.completed === false ? "not in completed history" : "completion unknown"})`).join("; ");
    const place = q.status === "turn-in" ? q.turnIn : q.giver;
    return `<li><strong>${esc(q.title)}</strong><small>${status}${gates ? ` · ${esc(gates)}` : ""}</small>
      ${from ? `<small>Reported chain link from ${esc(from)}.</small>` : ""}
      ${place ? `<small>${q.status === "turn-in" ? "Hand in to" : "Starts with"} ${esc(place.name)}${place.zone ? `, ${esc(place.zone)}` : ""} (reference)</small>` : ""}
      ${canOpen ? `<button type="button" data-quest-open="${q.id}" data-ledger-quest-profile="${esc(character.profileId)}" aria-label="Open quest: ${esc(q.title)}">Open quest</button>` : ""}
      ${q.materials ? `<div data-ledger-turn-in="${q.id}">
        <small>Reference materials · ${esc(character.name)}’s bags: ${q.materials.seenAt ? `last saved ${esc(ago(q.materials.seenAt))}` : "unknown"}. Bank, mail and alts are not counted.</small>
        ${q.materials.rows.map(row => `<div><small><strong>${esc(row.name)}</strong> · ${row.required.toLocaleString()} required · ${row.carried === null ? "carried unknown" : `${row.carried.toLocaleString()} carried`} · ${row.missing === null ? "shortfall unknown" : row.missing === 0 ? "quantity covered at save" : `${row.missing.toLocaleString()} short at save`}</small></div>`).join("")}
        <small>Materials do not verify a turn-in or reputation gain.</small>
      </div>` : ""}</li>`;
  }

  // Cooldowns: every character's profession cooldowns, ready now or when.
  function cooldownRows(chars, t) {
    const entries = chars.flatMap((c) => c.cooldowns.map((x) => ({ c, x })));
    const byTime = (a, b) => a.x.readyAt - b.x.readyAt;
    const groups = cdGroup === "character"
      ? [...chars].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.name, c.cooldowns.map((x) => ({ c, x })).sort(byTime)])
      : [["Ready now", entries.filter(({ x }) => x.readyAt <= t)], ["Waiting", entries.filter(({ x }) => x.readyAt > t).sort(byTime)]];
    const rows = groups.filter(([, list]) => list.length).map(([label, list]) => rowGroup(label, 4, list.map(({ c, x }) => {
      const left = Math.max(0, x.readyAt - t);
      return `<tr data-ledger-cd="${esc(c.profileId)}"><th scope="row">${esc(x.name)}</th><td>${esc(c.name)}</td><td>${esc(x.profession)}</td><td${num}>${left ? `Ready in ${esc(wait(left))}` : '<strong class="ldg-ready">Ready</strong>'}</td></tr>`;
    }).join(""))).join("");
    return table("cooldowns", "Profession cooldowns", [["Cooldown"], ["Character"], ["Profession"], ["Status", true]], rows, entries.length);
  }
  function cooldowns() {
    const chars = ledgered();
    if (!chars.length) return empty("No cooldowns yet.");
    const withCd = chars.filter((c) => c.cooldowns.length), t = nowSec();
    const ready = withCd.reduce((n, c) => n + c.cooldowns.filter((x) => x.readyAt <= t).length, 0);
    return `<section class="ldg-card"><div class="ldg-toolbar"><h2>Cooldown queue <span class="ldg-count" data-ledger-ready>${ready} ready now</span></h2>${withCd.length ? `<label class="ldg-pick">Group by <select data-ledger-cd-group aria-label="Group cooldowns by"><option value="readiness"${cdGroup === "readiness" ? " selected" : ""}>Readiness</option><option value="character"${cdGroup === "character" ? " selected" : ""}>Character</option></select></label>` : ""}</div>
      ${withCd.length ? `<div data-ledger-cd-list>${cooldownRows(withCd, t)}</div><p class="ldg-note ldg-after">Readiness is calculated from the last saved in-game times.</p>`
        : `<p class="ldg-empty">None of your characters has a tracked cooldown: Alchemy transmutes, Mooncloth (Tailoring) or the Salt Shaker (Leatherworking).</p>`}</section>`;
  }

  const PAGES = {
    ledger: ["ledger", "Bags & bank", "Everything you carry", "Bags, bank and mail of every character, searchable in one place.", bags],
    "ledger-gold": ["ledger-gold", "Gold & prices", "Gold and prices", "Gold on each character, and the Auction House prices you saw yourself.", gold],
    "ledger-crafts": ["ledger-gold", "Craft profit", "Craft profit", "What your recipes cost to make and what the result sold for, from prices you saw yourself.", crafts],
    "ledger-reputation": ["ledger-reputation", "Reputation", "Reputation", "Where each character stands with every faction, Alliance and Horde alike.", reputation],
    "ledger-cooldowns": ["ledger-cooldowns", "Cooldowns", "Profession cooldowns", "Transmutes, Mooncloth and the Salt Shaker: which are ready, and when the rest will be.", cooldowns],
  };
  function body() {
    if (error) return `<p class="ldg-empty">${esc(error)}</p>`;
    if (!data) return `<p class="ldg-empty">${loading ? "Opening your ledger…" : "Your ledger is loading."}</p>`;
    return PAGES[route][4]();
  }
  function page(which = route) {
    route = PAGES[which] ? which : "ledger";
    const [art, label, title, subtitle] = PAGES[route];
    return `<section class="ledger-page" data-ledger="${route}">${hero(art, label, title, subtitle)}<div data-ledger-body>${body()}</div></section>`;
  }
  function sizes(root) { for (const el of root.querySelectorAll("[data-w]")) el.style.width = `${Number(el.dataset.w)}%`; }
  function syncScroll(frame) {
    const vertical = frame.scrollHeight > frame.clientHeight + 1;
    const scrollable = vertical || frame.scrollWidth > frame.clientWidth + 1;
    frame.toggleAttribute("data-scroll-y", vertical);
    if (scrollable) {
      frame.tabIndex = 0;
      frame.setAttribute("role", "region");
      frame.setAttribute("aria-labelledby", frame.dataset.tableHeading);
    } else {
      frame.removeAttribute("tabindex");
      frame.removeAttribute("role");
      frame.removeAttribute("aria-labelledby");
    }
  }
  let tableResize;
  function watchTables(root) {
    tableResize?.disconnect();
    for (const frame of root?.querySelectorAll(".ldg-table-frame") || []) {
      syncScroll(frame);
      tableResize ??= new ResizeObserver((entries) => {
        for (const { target } of entries) if (target.isConnected) syncScroll(target);
      });
      tableResize.observe(frame);
    }
  }
  async function load() {
    if (loading) return; loading = true;
    const generation = loadGeneration, owner = activeProfile();
    try { const fresh = await api.ledger(); if (generation === loadGeneration) { data = fresh; error = ""; } }
    catch (e) { if (generation === loadGeneration) error = e.message || "Your ledger is unavailable."; }
    loading = false; loadedAt = Date.now(); loadedFor = owner;
    const root = document.querySelector("[data-ledger]");
    if (generation !== loadGeneration) { if (root) load(); return; }
    if (root) { root.outerHTML = page(root.dataset.ledger); mountedFor = null; mounted(); }
    const focus = focusRepFor === activeProfile() && route === "ledger-reputation" && document.querySelector("[data-ledger-rep-heading]");
    focusRepFor = null;
    if (focus) { focus.scrollIntoView({ block: "start" }); focus.focus({ preventScroll: true }); }
  }
  function mounted() {
    const root = document.querySelector("[data-ledger]");
    if (root?.dataset.ledger !== "ledger-gold" || !ownsSavings(savings)) { savings = null; focusSavings = false; }
    if (!root) { mountedFor = null; watchTables(null); return; }
    if (mountedFor === root) return;
    mountedFor = root; sizes(root); watchTables(root);
    window.RepPlannerView?.mounted(root);
    for (const input of root.querySelectorAll("[data-ledger-search]")) input.addEventListener("input", () => {
      const kind = input.dataset.ledgerSearch;
      query[kind] = input.value.slice(0, 100);
      const list = root.querySelector(`[data-ledger-list="${kind}"]`);
      if (list && data) { list.innerHTML = kind === "items" ? itemRows() : priceRows(); watchTables(root); }
    });
    root.querySelector("[data-ledger-rep]")?.addEventListener("change", (e) => {
      repFor = e.target.value; repFaction = null; focusRepFor = null; root.outerHTML = page(route); mountedFor = null; mounted();
      document.querySelector("[data-ledger-rep]")?.focus({ preventScroll: true });
    });
    root.querySelector("[data-ledger-rep-faction]")?.addEventListener("change", (e) => {
      // page() escapes saved titles and names; IDs are validated integers.
      repFaction = Number(e.target.value); root.outerHTML = page(route); mountedFor = null; mounted();
      document.querySelector("[data-ledger-rep-faction]")?.focus({ preventScroll: true });
    });
    root.querySelector("[data-ledger-cd-group]")?.addEventListener("change", (e) => {
      cdGroup = e.target.value;
      const t = nowSec(), chars = ledgered().filter((c) => c.cooldowns.length);
      root.querySelector("[data-ledger-ready]").textContent = `${chars.reduce((n, c) => n + c.cooldowns.filter((x) => x.readyAt <= t).length, 0)} ready now`;
      // The table templates escape player data before inserting it.
      root.querySelector("[data-ledger-cd-list]").innerHTML = cooldownRows(chars, t);
      watchTables(root);
    });
    const repaint = () => { const r = document.querySelector("[data-ledger]"); if (r) { r.outerHTML = page(route); mountedFor = null; mounted(); } };
    const setGoal = async (input, review = null, expectedGoal = null) => {
      if (savingGoal) return;
      savingGoal = true;
      try {
        const goal = review ? await api.setGoldGoal(input, { profileId: review.profileId, expectedGoal }) : await api.setGoldGoal(input);
        if (goal.reviewExpired) {
          if (savings === review) {
            savings = null;
            goalNote = "The character or gold goal changed. Review the Workshop estimate again before saving.";
          }
          data = null; error = ""; loadGeneration++;
        } else {
          if (data) data.goal = goal;
          goalNote = "";
          if (savings === review) savings = null;
        }
      } catch (e) { goalNote = e.message || "That goal could not be saved."; }
      finally { savingGoal = false; }
      repaint();
    };
    root.querySelector("[data-ledger-money]")?.addEventListener("change", (e) => { moneyFor = e.target.value; repaint(); document.querySelector("[data-ledger-money]")?.focus({ preventScroll: true }); });
    root.querySelector("[data-ledger-craft]")?.addEventListener("change", (e) => { craftFor = e.target.value; repaint(); document.querySelector("[data-ledger-craft]")?.focus({ preventScroll: true }); });
    const apply = root.querySelector("[data-ledger-savings-apply]");
    const review = savings;
    const expectedGoal = data?.goal?.goal ?? null;
    apply?.addEventListener("click", () => {
      if (review !== savings || !ownsSavings(review) || !root.isConnected || savingGoal) return;
      apply.disabled = true;
      void setGoal({ gold: review.gold, label: `Materials: ${review.recipe}`.slice(0, 60) }, review, expectedGoal);
    });
    const cancel = root.querySelector("[data-ledger-savings-cancel]");
    cancel?.addEventListener("click", () => {
      if (savingGoal) return;
      savings = null; goalNote = ""; repaint();
      document.querySelector('[data-ledger-goal="gold"]')?.focus();
    });
    if (cancel && focusSavings) {
      focusSavings = false;
      cancel.scrollIntoView({ block: "center" });
      cancel.focus({ preventScroll: true });
    }
    root.querySelector("[data-ledger-goal-save]")?.addEventListener("click", () => {
      const gold = Number(root.querySelector('[data-ledger-goal="gold"]')?.value);
      if (!Number.isInteger(gold) || gold < 1 || gold > 10000000) { goalNote = "Enter a whole number of gold, from 1 to 10,000,000."; repaint(); return; }
      setGoal({ gold, label: String(root.querySelector('[data-ledger-goal="label"]')?.value || "").slice(0, 60) });
    });
    root.querySelector("[data-ledger-goal-clear]")?.addEventListener("click", () => setGoal(null));
    root.querySelector("[data-ledger-goal-mount]")?.addEventListener("click", (e) => setGoal({ gold: Number(e.currentTarget.dataset.ledgerGoalMount), label: "Riding and first mount" }));
    // Each visit reads the newest saved ledger (a game save may have arrived since).
    if (!loading && !characterPending() && (loadedFor !== activeProfile() || (!data && !error) || Date.now() - loadedAt > 3000)) load();
  }
  function selectReputation(profileId, factionId) {
    repFor = profileId; repFaction = factionId; focusRepFor = profileId;
    data = null; error = ""; loadGeneration++;
  }
  return { init: (readActive, pending = () => false) => { activeProfile = readActive; characterPending = pending; }, bags: () => page("ledger"), gold: () => page("ledger-gold"), reputation: () => page("ledger-reputation"), crafts: () => page("ledger-crafts"), cooldowns: () => page("ledger-cooldowns"), page, mounted, selectReputation, reviewSavings, invalidate: () => { data = null; error = ""; loadGeneration++; }, _state: () => ({ data, query, route }) };
})();
