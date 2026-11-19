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
  let repFaction = null, focusRepFor = null, loadGeneration = 0;
  let activeProfile = () => data?.activeProfileId;
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
      <details class="ldg-source"><summary>When bags, banks and mail were last seen</summary><p class="ldg-note">Bags update whenever the addon saves. Bank and mail reflect the last time you opened them in game.</p>${seenChips()}</details></section>`;
  }

  // Gold & prices.
  function priceRows() {
    const rows = search(data.prices, query.prices);
    if (!rows.length) return `<p class="ldg-empty">${data.prices.length ? "No remembered price matches that." : "Browse the Auction House in game with price memory on (/bf prices on) and the prices you see show up here."}</p>`;
    return table("prices", "Price memory", [["Item"], ["Last seen, each", true], ["Lowest seen", true], ["Last seen when"]], `<tbody>${rows.slice(0, LIMIT).map((r) => `<tr data-ledger-price="${r.itemId}"><th scope="row" data-card-item="${r.itemId}"><span class="ldg-name q-${quality(r.quality)}">${esc(r.name)}</span></th><td${num}>${coins(r.latest)}</td><td${num}>${coins(r.low)}${r.low < r.latest ? `<small class="ldg-cell-note">${esc(ago(r.lowAt))}</small>` : ""}</td><td>${esc(ago(r.latestAt))}</td></tr>`).join("")}</tbody>`, rows.length) + resultLimit(rows.length);
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
  function coinsText(copper) {
    const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
    return [g ? `${g.toLocaleString()}g` : "", s ? `${s}s` : "", c || (!g && !s) ? `${c}c` : ""].filter(Boolean).join(" ");
  }
  function gold() {
    const chars = ledgered();
    if (!chars.length) return empty("No gold or prices yet.");
    const g = data.gold;
    const balances = table("balances", "Gold per character", [["Character"], ["On hand", true]], `<tbody>${g.characters.map((c) => `<tr data-ledger-gold="${esc(c.profileId)}"><th scope="row">${esc(c.name)}${c.faction ? ` <small>${esc(c.faction)}</small>` : ""}</th><td${num}>${coins(c.money)}</td></tr>`).join("")}</tbody>`);
    const worth = table("value", "Estimated auction value", [["Item"], ["Qty", true], ["Each", true], ["Value", true]], `<tbody>${data.value.items.slice(0, 15).map((v) => `<tr><th scope="row" data-card-item="${v.itemId}"><span class="ldg-name q-${quality(v.quality)}">${esc(v.name)}</span></th><td${num}>${v.count.toLocaleString()}</td><td${num}>${coins(v.unit)}</td><td${num}>${coins(v.value)}</td></tr>`).join("")}</tbody>`);
    const mail = chars.filter((c) => c.mail?.money);
    return `<div class="ldg-summary"><div><strong>${coins(g.total)}</strong><span>gold on ${g.characters.length} character${g.characters.length === 1 ? "" : "s"}</span></div><div><strong>${data.value.items.length ? coins(data.value.total) : "—"}</strong><span>estimated auction value</span></div><div><strong>${data.prices.length.toLocaleString()}</strong><span>prices remembered</span></div></div>
      <section class="ldg-card">${searchBar("prices", "Price memory", "Search remembered prices")}<p class="ldg-note">Lowest buyout per item on Auction House pages you opened. The addon never searches or buys.</p><div data-ledger-list="prices">${priceRows()}</div></section>
      <div class="ldg-two"><section class="ldg-card"><h2>Gold per character</h2>${balances}${mail.length ? `<p class="ldg-note ldg-after">Waiting in the mail: ${mail.map((c) => `${esc(c.name)} ${coins(c.mail.money)}`).join(", ")}.</p>` : ""}</section>
      <section class="ldg-card"><h2>Estimated auction value</h2>${data.value.items.length ? `${worth}<p class="ldg-note ldg-after">Based on last seen prices; actual sales vary.${data.value.items.length > 15 ? " Showing the 15 highest-value items." : ""}</p>` : `<p class="ldg-empty">Nothing you carry has a remembered auction price yet.</p>`}</section></div>${savingsReview()}${goalCard()}`;
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
      ${list.length ? `<ul class="ldg-rep-quests">${list.map(q => repQuest(q, c, isActive && !browseOnly, browseOnly)).join("")}</ul>` : '<p class="ldg-empty">No matching quests in the available reference. Check eligibility and rewards in game.</p>'}</section>`;
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
    const generation = loadGeneration;
    try { const fresh = await api.ledger(); if (generation === loadGeneration) { data = fresh; error = ""; } }
    catch (e) { if (generation === loadGeneration) error = e.message || "Your ledger is unavailable."; }
    loading = false; loadedAt = Date.now();
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
    const setGoal = async (input, review = null) => {
      if (savingGoal) return;
      savingGoal = true;
      try {
        const goal = await api.setGoldGoal(input);
        if (data) data.goal = goal;
        goalNote = "";
        if (savings === review) savings = null;
      } catch (e) { goalNote = e.message || "That goal could not be saved."; }
      finally { savingGoal = false; }
      repaint();
    };
    const apply = root.querySelector("[data-ledger-savings-apply]");
    const review = savings;
    apply?.addEventListener("click", () => {
      if (review !== savings || !ownsSavings(review) || !root.isConnected || savingGoal) return;
      apply.disabled = true;
      void setGoal({ gold: review.gold, label: `Materials: ${review.recipe}`.slice(0, 60) }, review);
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
    if (!loading && (!data || Date.now() - loadedAt > 3000)) load();
  }
  function selectReputation(profileId, factionId) {
    repFor = profileId; repFaction = factionId; focusRepFor = profileId;
    data = null; error = ""; loadGeneration++;
  }
  return { init: readActive => { activeProfile = readActive; }, bags: () => page("ledger"), gold: () => page("ledger-gold"), reputation: () => page("ledger-reputation"), cooldowns: () => page("ledger-cooldowns"), page, mounted, selectReputation, reviewSavings, invalidate: () => { data = null; }, _state: () => ({ data, query, route }) };
})();
