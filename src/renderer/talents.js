"use strict";
// Characters → Talents: your real talent trees with a leveling path laid on top.
window.TalentsView = (() => {
  const api = window.backstage;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CLASSES = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
  let data = null, error = "", who = null, preview = null, mountedFor = null, loading = false;
  const patch = window.PatchImpact;
  const guideBuilds = () => patch.MAGE_GUIDE_BUILDS.join(", ");
  function academy(profile) {
    const build = patch.savedBuild(profile, Date.now());
    const guideStatus = patch.reviewStatus(build, patch.MAGE_GUIDE_BUILDS);
    const abilityStatus = patch.reviewStatus(build, patch.MAGE_ABILITY_BUILDS);
    const matchingMage = profile?.className === "Mage" && Number.isInteger(profile.level) && profile.level >= 23 && profile.level <= 25;
    const eligible = matchingMage && guideStatus === "reviewed";
    return `<section class="tal-academy" data-academy-dps aria-labelledby="academy-dps-title">
      <h2 id="academy-dps-title">Academy · Frost Mage DPS</h2>
      <p>Solo, one target · levels 23–25 · WoW Forever · <span>Reviewed builds:</span> ${guideBuilds()} · offline</p>
      ${eligible ? `<fieldset><legend>Check ${esc(profile.name || "your selected Mage")}’s current spellbook</legend>
        <p>The app does not read your spellbook. Only check ranks you see learned on this character while still in the listed level band and build. These checks aren't saved.</p>
        <label><input type="checkbox" data-academy-rank="frostbolt"> Frostbolt, Rank 4</label>
        <label><input type="checkbox" data-academy-rank="iceLance"> Ice Lance, Rank 1</label>
      </fieldset><div data-academy-result data-ability-status="${abilityStatus}" aria-live="polite"></div>` : matchingMage && guideStatus === "needs-review" ? `<p>Frost Mage DPS guidance needs review for this saved build. The talent planner is still available.</p>` : `<p>No recommendations for this selection. Select an imported Mage save with a matching build and level.</p>`}
    </section>`;
  }
  function spellbookReview() {
    const choices = `<option value="unknown">Not checked / unsure</option><option value="yes">Yes</option><option value="no">No</option>`;
    return `<details class="tal-spellbook" data-spellbook-review><summary>Just learned this?</summary>
      <h3>Manual solo Frost layout</h3>
      <p>Ice Lance · Rank 1 (spell 1312002) · learned rank self-reported above.</p>
      <p>Compare the rank in your spellbook with the tooltip on your action bar. For this two-spell setup, put Frostbolt (Rank 4) in a comfortable primary slot and Ice Lance (Rank 1) in a separate, easy-to-reach slot. Choose your own keys in game; this is a template, not your current layout.</p>
      <p>Check for that exact Ice Lance rank on your bars. If you find it, check the binding for that same slot. Leave either answer unconfirmed if you’re unsure. The app can’t inspect or change your bars or keys, and these answers aren’t saved.</p>
      <label for="tal-ice-lance-placement">Ice Lance (Rank 1) on an action bar?</label>
      <select id="tal-ice-lance-placement" data-spellbook-placement>${choices}</select>
      <label for="tal-ice-lance-binding">A key bound to the Ice Lance slot?</label>
      <select id="tal-ice-lance-binding" data-spellbook-binding disabled>${choices}</select>
      <p data-spellbook-readout role="status">Action bar: unknown · Keybind: unknown</p>
    </details>`;
  }
  function updateSpellbookReview(review) {
    const placement = review.querySelector("[data-spellbook-placement]");
    const binding = review.querySelector("[data-spellbook-binding]");
    const readout = review.querySelector("[data-spellbook-readout]");
    binding.disabled = placement.value !== "yes";
    if (binding.disabled) binding.value = "unknown";
    const bar = placement.value === "yes" ? "placed (self-reported)" : placement.value === "no" ? "not placed (self-reported)" : "unknown";
    const key = binding.value === "yes" ? "key bound (self-reported)" : binding.value === "no" ? "no key bound (self-reported)" : "unknown";
    readout.textContent = `Action bar: ${bar} · Keybind: ${key}`;
  }
  function mountAcademy() {
    const panel = document.querySelector("[data-academy-dps]");
    const result = panel?.querySelector("[data-academy-result]");
    if (!result || panel.onchange) return;
    panel.onchange = ({ target }) => {
      if (!target.matches("[data-academy-rank]")) {
        const review = target.closest("[data-spellbook-review]");
        if (review) updateSpellbookReview(review);
        return;
      }
      const confirmed = panel.querySelector('[data-academy-rank="frostbolt"]').checked &&
        panel.querySelector('[data-academy-rank="iceLance"]').checked;
      // Only bundled copy and the fixed pilot build go into this result.
      result.innerHTML = confirmed ? `<h3>Opener</h3>
        <p>Start with Frostbolt (Rank 4) from range. It deals damage and slows the target's approach. [1, 2]</p>
        <h3>Single-target priority</h3>
        <ol><li>If the target is visibly frozen and Ice Lance (Rank 1) is ready, use it for the frozen-target bonus. A slow alone is not a freeze. [1, 3]</li>
        <li>Otherwise, use Frostbolt when you can stand still and cast safely. This is a two-spell practice priority, not a complete rotation. [1, 2]</li></ol>
        <p><strong>Mana:</strong> Both casts spend mana. Save Ice Lance for a frozen window rather than spending mana on its weaker unfrozen hit. [2, 3]</p>
        <details><summary>Evidence and limits</summary><ol>
          <li>wow4ever.quest Mage guide, Frost single-target section.</li>
          <li>wow4ever.quest Frostbolt spellbook, Rank 4 (7322).</li>
          <li>wow4ever.quest Ice Lance spellbook, Rank 1 (1312002).</li>
        </ol><p>Community spellbook entries reviewed for ${guideBuilds()}, updated 19 Nov 2026. Not a live combat check or a DPS benchmark.</p></details>
        ${result.dataset.abilityStatus === "reviewed" ? spellbookReview() : "<p>Action-bar and keybind checks need review for this saved build.</p>"}` : "";
    };
  }
  const crest = (cls) => `<img class="tal-crest" src="art/classes/${esc(String(cls).toLowerCase())}.png" alt="" width="96" height="96">`;
  function tree(tab, c) {
    const now = new Map(), planned = new Map();
    for (const s of c.spentByNow) if (s.tab === tab.name) now.set(s.talentId, s.rank);
    for (const s of c.order) if (s.tab === tab.name) planned.set(s.talentId, s.rank);
    const next = c.next[0];
    const rows = Math.max(7, ...tab.talents.map((t) => t.row + 1));
    const cells = [];
    for (let r = 0; r < rows; r++) for (let col = 0; col < 4; col++) {
      const t = tab.talents.find((x) => x.row === r && x.column === col);
      if (!t) { cells.push(`<div class="tal-cell empty"></div>`); continue; }
      const have = now.get(t.id) || 0, plan = planned.get(t.id) || 0, isNext = next && next.talentId === t.id;
      const state = isNext ? "is-next" : have ? (have >= t.maxRank ? "full" : "some") : plan ? "planned" : "off";
      cells.push(`<div class="tal-cell tal-${state}" data-tal-id="${t.id}" data-tal-have="${have}" data-tal-path="${plan}">
        ${t.iconFileId && window.GameIcons ? GameIcons.tag(t.iconFileId, 40) : `<span class="tal-noicon">?</span>`}
        <span class="tal-rank">${have}/${t.maxRank}</span>${isNext ? `<span class="tal-next-badge">Next</span>` : ""}</div>`);
    }
    const pts = c.order.slice(0, c.spentByNow.length).filter((s) => s.tab === tab.name).length;
    return `<section class="tal-tree${tab.name === c.tree ? " main" : ""}"><header>${tab.iconFileId && window.GameIcons ? GameIcons.tag(tab.iconFileId, 28) : ""}<h3>${esc(tab.name)}</h3><span>${pts} point${pts === 1 ? "" : "s"}</span></header><div class="tal-grid">${cells.join("")}</div></section>`;
  }
  // 1.3 (J9): class quests and key unlocks for this class, past ones dimmed.
  function unlocksCard(u) {
    if (!u?.rows?.length) return "";
    return `<section class="tal-unlocks" data-tal-unlocks><h3>Class quests and key unlocks</h3><ol>${u.rows.map((r) => `<li class="tal-u-${r.state}"><span class="tal-u-lv">${r.level}</span><div><strong>${esc(r.what)}</strong>${r.kind === "quest" ? ' <span class="tal-u-kind">quest</span>' : ""}<p>${esc(r.how)}</p></div></li>`).join("")}</ol><p class="tal-note">Your class trainer has the details; Forever may move a level or two.</p></section>`;
  }
  const coins = (copper) => { const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100; return `<span class="tal-coins">${g ? `<span class="tal-gold">${g.toLocaleString()}g</span>` : ""}${s ? `<span class="tal-silver">${s}s</span>` : ""}${c || (!g && !s) ? `<span class="tal-copper">${c}c</span>` : ""}</span>`; };
  // C6: what the class trainer newly teaches at this level and the next two. Facts only, no advice.
  function trainingCard(t) {
    if (!t) return "";
    if (!t.available) return `<section class="tal-train" data-tal-train><h3>At the trainer</h3><p class="tal-train-none">${esc(t.reason || "No trainer costs are recorded for this class.")}</p></section>`;
    const tag = (r) => (r.from === "portal" ? ' <span class="tal-train-tag">portal trainer</span>' : r.from === "pet" ? ' <span class="tal-train-tag">pet trainer</span>' : "");
    const level = (l) => `<li class="tal-train-level${l.level === t.level ? " now" : ""}"><header><span class="tal-u-lv">${l.level}</span><strong>${l.level === t.level ? "Trainable now" : `At level ${l.level}`}</strong><span class="tal-train-sum">${l.rows.length ? `${l.rows.length} skill${l.rows.length === 1 ? "" : "s"} · ${coins(l.total)}${l.unpriced ? ` + ${l.unpriced} without a price` : ""}` : "nothing new recorded"}</span></header>${l.rows.length ? `<ul>${l.rows.map((r) => `<li><span class="tal-train-name">${esc(r.name)}${r.rank ? ` <small>${esc(r.rank)}</small>` : ""}${tag(r)}</span><span class="tal-train-cost">${r.copper === null ? "price not recorded" : (r.estimated ? "about " : "") + coins(r.copper)}</span></li>`).join("")}</ul>` : ""}</li>`;
    const purse = t.money === null ? `<span class="tal-train-purse">Your gold is not in the saved data.</span>` : `<span class="tal-train-purse">You have ${coins(t.money)}${t.levels[0].total > t.money ? `, ${coins(t.levels[0].total - t.money)} short for this level` : ""}.</span>`;
    return `<section class="tal-train" data-tal-train><h3>At the trainer <small>levels ${t.level}–${t.level + t.levels.length - 1}</small></h3>
      <ol class="tal-train-levels">${t.levels.map(level).join("")}</ol>
      <p class="tal-train-total"><strong>Total for these levels: ${coins(t.total)}</strong>${preview ? "" : purse}${t.nextLevel ? ` <span>After that, new skills come at level ${t.nextLevel}.</span>` : ""}</p>
      <ul class="tal-train-notes">${t.notes.map((n) => `<li>${esc(n)}</li>`).join("")}<li>${esc(t.source)}</li></ul></section>`;
  }
  // --- Talent planner (roadmap C1) ---------------------------------------------------------------
  // "My plan": click talents to place points. Every click is checked in the main process on the
  // trees read from the player's own game files (talent-planner.cjs); this file only draws the answer.
  let mode = "path", plan = null, planLevel = 60;
  const icon = (id, size) => (id && window.GameIcons ? GameIcons.tag(id, size) : "");
  const talentOf = (id) => { for (const tab of data?.trees?.tabs || []) for (const t of tab.talents) if (t.id === id) return { ...t, tab: tab.name }; return null; };
  const myLevel = () => (preview ? null : Number.isInteger(who?.level) ? who.level : null);
  const say = (text, bad = false) => { if (plan) plan.status = text ? { text, bad } : null; };
  async function ask(op, extra = {}) {
    const r = await api.talentPlanner({ op, className: plan.className, order: plan.order, planLevel, level: myLevel(), ...extra });
    plan.order = r.order; plan.view = r.view; plan.saved = r.saved; plan.respec = r.respec; plan.maxName = r.maxName; plan.current = r.current || null;
    return r;
  }
  async function openPlan(cls) {
    const key = `${who.id}|${cls}`;
    if (!plan || plan.key !== key) plan = { key, className: cls, order: [], view: null, saved: null, respec: [], id: null, name: "", status: null, code: "", paste: "", diff: null, confirm: null };
    const first = !plan.view;
    const r = await ask("open");
    if (!first) return;
    // A fresh visit starts from the build this character uses in game, when there is one.
    const active = r.saved.builds.find((b) => b.id === r.saved.active);
    if (active) { plan.order = active.order; plan.id = active.id; plan.name = active.name; await ask("open"); mode = "plan"; }
  }
  const cellState = (v) => (v.rank >= v.maxRank ? "full" : v.rank ? "some" : v.canAdd ? "open" : "off");
  // The talents this character has spent in game, as the addon saved them (null for a previewed class).
  const current = () => (preview ? null : plan?.current || null);
  const ownRank = (id) => current()?.ranks?.[id] || 0;
  const shortDay = (at) => new Date(at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  function currentHtml() {
    if (preview || !plan?.saved?.inGame) return "";
    const c = current();
    if (!c) return `<div class="tal-current none" data-tal-current><p><strong>In game now</strong><span>Your spent talents are not in this character's save yet. They come with the next save from the current addon.</span></p></div>`;
    const waiting = c.unspent === null ? "" : c.unspent > 0 ? `<span class="tal-current-wait"><b>${c.unspent}</b> <span>${c.unspent === 1 ? "point waiting to be spent" : "points waiting to be spent"}</span></span>` : `<span>no point waiting</span>`;
    const odd = c.unmatched.length ? `<p class="tal-current-odd"><span>Not found in your talent trees:</span> ${c.unmatched.slice(0, 4).map((u) => esc(u.name)).join(", ")}${c.unmatched.length > 4 ? "…" : ""}</p>` : "";
    return `<div class="tal-current" data-tal-current><p><strong>In game now</strong><span class="tal-current-split">${c.tabs.map((t) => `${esc(t.name)} <b>${t.points}</b>`).join(" · ")}</span>${waiting}<span class="tal-current-day"><span>saved</span> ${esc(shortDay(c.at))}</span></p>
      <div class="tal-current-acts"><button type="button" class="tal-btn" data-tal-act="from-current"${c.usable ? "" : " disabled"}>Start from my current talents</button><button type="button" class="tal-btn quiet" data-tal-act="compare-current"${c.usable ? "" : " disabled"}>Compare with this plan</button></div>${odd}
      <p class="tal-current-key"><span class="tal-own">2</span><span>A green number on a talent is the rank you have in game.</span></p></div>`;
  }
  const cellLabel = (t, v) => `${t.name || "Unknown talent"}, rank ${v.rank} of ${v.maxRank}, ${t.tab}`;
  function planTree(tab) {
    const rows = Math.max(7, ...tab.talents.map((t) => t.row + 1)), cells = [];
    for (let r = 0; r < rows; r++) for (let col = 0; col < 4; col++) {
      const t = tab.talents.find((x) => x.row === r && x.column === col);
      if (!t) { cells.push(`<div class="tal-cell empty"></div>`); continue; }
      const v = plan.view.talents[t.id] || { rank: 0, maxRank: t.maxRank, canAdd: false };
      const own = ownRank(t.id);
      cells.push(`<button type="button" class="tal-cell tal-click tal-${cellState(v)}" data-tal-id="${t.id}" aria-label="${esc(cellLabel({ ...t, tab: tab.name }, v))}">
        ${icon(t.iconFileId, 40) || `<span class="tal-noicon">?</span>`}${own ? `<span class="tal-own" data-tal-own="${own}">${own}</span>` : ""}<span class="tal-rank">${v.rank}/${v.maxRank}</span></button>`);
    }
    const pts = plan.view.tabs.find((x) => x.name === tab.name)?.points || 0;
    return `<section class="tal-tree"><header>${icon(tab.iconFileId, 28)}<h3>${esc(tab.name)}</h3><span data-tal-tab-points="${esc(tab.name)}">${pts} point${pts === 1 ? "" : "s"}</span><button type="button" class="tal-mini" data-tal-act="reset-tree" data-tab="${esc(tab.name)}" aria-label="Reset ${esc(tab.name)}">Reset</button></header><div class="tal-grid">${cells.join("")}</div></section>`;
  }
  function budgetHtml() {
    const v = plan.view;
    return `<strong>${v.total}</strong> of ${v.budget} points placed<span>${v.left} left</span>`;
  }
  const statusHtml = () => (plan.status ? `<p class="tal-status ${plan.status.bad ? "bad" : "said"}">${esc(plan.status.text)}</p>` : `<p class="tal-status">Left click a talent to add a point. Right click takes one back. The rules are checked on your own talent trees.</p>`);
  function orderHtml() {
    const steps = plan.view.steps, lvl = myLevel();
    if (!steps.length) return `<p class="tal-order-empty">No points placed yet. Left click a talent to add a point.</p>${data.coach?.order?.length ? `<button type="button" class="tal-btn" data-tal-act="from-path">Start from the suggested path</button>` : ""}`;
    const groups = [];
    for (const s of steps) {
      const g = groups[groups.length - 1];
      if (g && g.talentId === s.talentId) { g.toRank = s.rank; g.toLevel = s.level; } else groups.push({ ...s, fromRank: s.rank, toRank: s.rank, fromLevel: s.level, toLevel: s.level });
    }
    let marked = false;
    return `<ol class="tal-order">${groups.map((g) => {
      const mark = lvl !== null && !marked && g.fromLevel > lvl ? `<li class="tal-order-mark"><span>You are level ${lvl}</span></li>` : "";
      if (mark) marked = true;
      return `${mark}<li${lvl !== null && g.fromLevel <= lvl ? ' class="due"' : ""}><span class="tal-order-lv">${g.fromLevel === g.toLevel ? `Level ${g.fromLevel}` : `Levels ${g.fromLevel}–${g.toLevel}`}</span>${icon(talentOf(g.talentId)?.iconFileId, 28)}<div><strong>${esc(g.name)}</strong><small>${g.fromRank === g.toRank ? `rank ${g.toRank}` : `ranks ${g.fromRank}–${g.toRank}`} of ${g.maxRank} · ${esc(g.tab)}</small></div></li>`;
    }).join("")}</ol>`;
  }
  function buildsHtml() {
    const s = plan.saved;
    if (!s.canSave) return `<p class="tal-note">Choose a character to save builds.</p>`;
    const mine = !preview && s.inGame;
    const rows = s.builds.map((b) => {
      const active = s.active === b.id, loaded = plan.id === b.id;
      return `<li${loaded ? ' class="loaded"' : ""}><div class="tal-build-name"><strong>${esc(b.name)}</strong><small>${b.split.join(" / ")}${active && mine ? ' · <span class="tal-ingame">used in game</span>' : ""}</small></div>
        <div class="tal-build-acts"><button type="button" class="tal-btn" data-tal-act="load" data-id="${b.id}">Load</button><button type="button" class="tal-btn quiet" data-tal-act="compare" data-id="${b.id}">Compare</button>${mine ? `<button type="button" class="tal-btn quiet" data-tal-act="activate" data-id="${active ? "" : b.id}">${active ? "Stop using" : "Use in game"}</button>` : ""}<button type="button" class="tal-btn quiet" data-tal-act="${plan.confirm === b.id ? "delete" : "ask-delete"}" data-id="${b.id}">${plan.confirm === b.id ? "Really delete?" : "Delete"}</button></div></li>`;
    }).join("");
    const note = preview ? "Builds for a previewed class are kept with this character but never sent to the game."
      : s.inGame ? "The build marked Use in game goes to the game at its next login or /reload. There, type /bf talents to see your next point. The app never spends points for you."
      : "This character was not imported from the game, so no build is sent to the game.";
    return `<div class="tal-save"><input type="text" data-tal-name maxlength="${plan.maxName || 40}" placeholder="Name this build" aria-label="Build name" value="${esc(plan.name)}"><button type="button" class="tal-btn" data-tal-act="save">Save</button></div>
      ${rows ? `<ul class="tal-builds">${rows}</ul>` : `<p class="tal-note">No saved builds for this class yet.</p>`}<p class="tal-note">${note}</p>`;
  }
  function shareHtml() {
    return `<p class="tal-note first">A short code that holds this build and its order. Anyone with the same talent trees can load it.</p>
      <div class="tal-save"><input type="text" readonly data-tal-code aria-label="Share code for this build" placeholder="Copy makes a code" value="${esc(plan.code)}"><button type="button" class="tal-btn" data-tal-act="copy">Copy code</button></div>
      <div class="tal-save"><input type="text" data-tal-paste maxlength="400" aria-label="Paste a share code" placeholder="Paste a code here" value="${esc(plan.paste)}"><button type="button" class="tal-btn" data-tal-act="import">Load code</button></div>`;
  }
  function respecHtml() {
    const nth = (i) => `${i + 1}${["st", "nd", "rd"][i] || "th"}`;
    const list = plan.respec || [];
    return `<ol class="tal-respec">${list.map((g, i) => `<li><span>${i === list.length - 1 ? `${nth(i)} and later` : nth(i)}</span><strong>${g}g</strong></li>`).join("")}</ol>
      <p class="tal-note">Reference: the classic schedule for unlearning talents at a class trainer. Not checked on WoW Forever; your trainer shows the real price.</p>`;
  }
  function compareHtml() {
    const d = plan.diff;
    if (!d) return "";
    const head = `<header><h3>This plan and “${esc(d.name)}”</h3><button type="button" class="tal-btn quiet" data-tal-act="close-compare">Close</button></header>`;
    const totals = `<p class="tal-compare-totals">${d.tabs.map((t) => `<span><strong>${esc(t.name)}</strong> ${t.a} / ${t.b}</span>`).join("")}<span><strong>Points</strong> ${d.totalA} / ${d.totalB}</span></p>`;
    if (d.same) return `<section class="tal-compare" data-tal-compare-card>${head}${totals}<p class="tal-note">Both builds hold the same talents.</p></section>`;
    return `<section class="tal-compare" data-tal-compare-card>${head}${totals}<table><thead><tr><th>Talent</th><th>Tree</th><th>This plan</th><th>${esc(d.name)}</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.tab)}</td><td class="${r.a > r.b ? "more" : ""}">${r.a} of ${r.maxRank}</td><td class="${r.b > r.a ? "more" : ""}">${r.b} of ${r.maxRank}</td></tr>`).join("")}</tbody></table></section>`;
  }
  function modeBar() {
    const tab = (key, label) => `<button type="button" data-tal-mode="${key}" aria-pressed="${mode === key}">${label}</button>`;
    const levels = [...new Set([60, 50, 40, 30, 20, myLevel()].filter((l) => Number.isInteger(l) && l >= 10 && l <= 60))].sort((a, b) => b - a);
    const tools = mode === "plan" && plan?.view ? `<span class="tal-budget" data-tal-budget>${budgetHtml()}</span>
      <label class="tal-level">Plan up to level <select data-tal-level>${levels.map((l) => `<option${l === planLevel ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <button type="button" class="tal-btn quiet" data-tal-act="reset-all">Reset all</button>` : "";
    return `<div class="tal-bar"><div class="tal-modes" role="group" aria-label="Talent view">${tab("path", "Suggested path")}${tab("plan", "My plan")}</div>${tools}</div>`;
  }
  function planBody() {
    if (!plan?.view) return `<p class="tal-empty">${esc(plan?.error || "Opening the planner…")}</p>`;
    return `<div data-tal-status aria-live="polite">${statusHtml()}</div>${currentHtml()}
      <div class="tal-layout tal-plan"><div class="tal-trees">${data.trees.tabs.map(planTree).join("")}</div><aside class="tal-side"><h3>Level-up order</h3><div data-tal-order>${orderHtml()}</div></aside></div>
      <div data-tal-compare>${compareHtml()}</div>
      <div class="tal-bench"><section class="tal-panel"><h3>Saved builds</h3><div data-tal-builds>${buildsHtml()}</div></section>
        <section class="tal-panel"><h3>Share code</h3>${shareHtml()}</section>
        <section class="tal-panel"><h3>Respec cost</h3>${respecHtml()}</section></div>`;
  }
  // After a point is added or taken back only the changed parts are redrawn, so icons do not blink.
  function syncPlan() {
    const root = document.querySelector("[data-talents]");
    if (!root || !plan?.view) return;
    for (const b of root.querySelectorAll("button[data-tal-id]")) {
      const t = talentOf(Number(b.dataset.talId)), v = plan.view.talents[b.dataset.talId];
      if (!t || !v) continue;
      b.className = `tal-cell tal-click tal-${cellState(v)}`;
      b.setAttribute("aria-label", cellLabel(t, v));
      b.querySelector(".tal-rank").textContent = `${v.rank}/${v.maxRank}`;
    }
    for (const s of root.querySelectorAll("[data-tal-tab-points]")) {
      const pts = plan.view.tabs.find((x) => x.name === s.dataset.talTabPoints)?.points || 0;
      s.textContent = `${pts} point${pts === 1 ? "" : "s"}`;
    }
    const set = (sel, html) => { const el = root.querySelector(sel); if (el) el.innerHTML = html; };
    set("[data-tal-budget]", budgetHtml()); set("[data-tal-order]", orderHtml()); set("[data-tal-status]", statusHtml()); set("[data-tal-compare]", compareHtml());
    const code = root.querySelector("[data-tal-code]"); if (code) code.value = plan.code;
  }
  // The hover card: name, rank and the rank text from the player's own game files.
  let card = null;
  function hideCard() { if (card) card.hidden = true; }
  function showCard(cell) {
    const id = Number(cell.dataset.talId), t = talentOf(id);
    if (!t) return;
    const v = mode === "plan" ? plan?.view?.talents[id] : null;
    const rank = v ? v.rank : Number(cell.dataset.talHave) || 0, path = v ? 0 : Number(cell.dataset.talPath) || 0;
    // Some ranks have no text of their own in the game files; the nearest rank that has one is shown and named.
    const text = (r) => {
      const d = t.descriptions || [];
      if (d[r - 1]) return esc(d[r - 1]);
      let near = -1;
      for (let i = 0; i < d.length; i++) if (d[i] && (near < 0 || Math.abs(i + 1 - r) < Math.abs(near + 1 - r))) near = i;
      return near < 0 ? "Your game files have no text for this talent." : `${esc(d[near])} <small>(text of rank ${near + 1}; your game files have none for rank ${r})</small>`;
    };
    const parts = [`<strong>${esc(t.name || "Unknown talent")}</strong><span class="tal-card-rank">Rank ${rank} of ${t.maxRank} · ${esc(t.tab)}${path ? ` · path takes ${path}` : ""}</span>`];
    if (v && current()) parts.push(`<span class="tal-card-own">In game: rank ${ownRank(id)} of ${t.maxRank}</span>`);
    if (rank > 0) parts.push(`<p><em>${rank >= t.maxRank ? "Highest rank" : "Now"}</em>${text(rank)}</p>`);
    if (rank < t.maxRank) parts.push(`<p><em>${rank ? "Next rank" : "Rank 1"}</em>${text(rank + 1)}</p>`);
    if (v && rank < t.maxRank && v.addWhy) parts.push(`<p class="tal-card-why">${esc(v.addWhy)}</p>`);
    if (v) parts.push(`<p class="tal-card-hint">Left click adds a point. Right click takes one back.</p>`);
    if (!card) { card = document.createElement("div"); card.className = "tal-card"; card.setAttribute("role", "tooltip"); document.body.appendChild(card); }
    card.innerHTML = parts.join("");
    card.hidden = false;
    const r = cell.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
    const left = r.right + 10 + w <= window.innerWidth - 8 ? r.right + 10 : Math.max(8, r.left - 10 - w);
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(Math.max(8, Math.min(r.top, window.innerHeight - h - 8)))}px`;
  }
  async function point(op, id) {
    if (!plan?.view || plan.working) return;
    plan.working = true;
    try {
      const r = await ask(op, { talentId: id });
      say(r.ok ? "" : r.reason, true);
      if (r.ok) { plan.code = ""; plan.diff = null; plan.confirm = null; }
    } catch (e) { say(e.message || "That did not work.", true); }
    plan.working = false;
    syncPlan();
    const cell = document.querySelector(`button[data-tal-id="${id}"]`);
    if (cell && card && !card.hidden) showCard(cell);
  }
  async function act(name, el) {
    if (!plan?.view) return;
    const build = plan.saved.builds.find((b) => b.id === el.dataset.id);
    try {
      if (name === "reset-all") { await ask("resetAll"); plan.code = ""; plan.diff = null; say("All points taken back."); }
      else if (name === "reset-tree") { await ask("resetTree", { tab: el.dataset.tab }); plan.code = ""; plan.diff = null; say(`${el.dataset.tab} is empty again.`); }
      else if (name === "from-path") {
        plan.order = data.coach.order.map((s) => s.talentId); plan.id = null; plan.name = plan.name || `${data.coach.tree} leveling`;
        const r = await ask("open"); say(r.ok ? "The suggested path is now your plan. Change it as you like." : r.reason, !r.ok);
      } else if (name === "load" && build) {
        plan.order = build.order; plan.id = build.id; plan.name = build.name; plan.code = ""; plan.diff = null;
        const r = await ask("open"); say(r.ok ? `Loaded “${build.name}”.` : r.reason, !r.ok);
      } else if (name === "save") {
        const same = plan.saved.builds.find((b) => b.id === plan.id && b.name.toLowerCase() === plan.name.trim().toLowerCase());
        const r = await ask("save", { name: plan.name, id: same ? same.id : undefined });
        plan.id = r.savedId; plan.name = plan.saved.builds.find((b) => b.id === r.savedId)?.name || plan.name;
        say(same ? "Build updated." : "Build saved.");
      } else if (name === "ask-delete" && build) { plan.confirm = build.id; }
      else if (name === "delete" && build) { await ask("delete", { id: build.id }); if (plan.id === build.id) plan.id = null; plan.confirm = null; say(`Deleted “${build.name}”.`); }
      else if (name === "activate") {
        await ask("activate", { id: el.dataset.id || null });
        say(el.dataset.id ? "This build goes to the game at its next login or /reload." : "No build is sent to the game now.");
      } else if (name === "compare" && build) {
        const r = await ask("compare", { other: build.order }); plan.diff = { ...r.diff, name: build.name }; say("");
      } else if (name === "from-current") {
        const r = await ask("fromCurrent");
        if (r.ok) { plan.id = null; plan.name = plan.name || "My talents"; plan.code = ""; plan.diff = null; say("Your current talents are now the plan. Add the points you want next, then save it."); } else say(r.reason, true);
      } else if (name === "compare-current") {
        const r = await ask("compareCurrent");
        if (r.ok) { plan.diff = { ...r.diff, name: "In game now" }; say(""); } else say(r.reason, true);
      } else if (name === "close-compare") { plan.diff = null; }
      else if (name === "copy") {
        const r = await ask("export"); plan.code = r.code;
        try { await navigator.clipboard.writeText(r.code); say("Code copied."); } catch { say("Select the code and copy it."); }
      } else if (name === "import") {
        const r = await ask("import", { code: plan.paste });
        if (r.ok) { plan.id = null; plan.paste = ""; plan.code = ""; plan.diff = null; say("Build loaded from the code. Save it to keep it."); } else say(r.reason, true);
      }
      if (name !== "ask-delete" && name !== "delete") plan.confirm = null;
    } catch (e) { say(e.message || "That did not work.", true); }
    hideCard(); paint();
  }
  function body() {
    if (error) return `<p class="tal-empty">${esc(error)}</p>`;
    if (!who) return `<p class="tal-empty">Choose a character with a class in Characters to see talents.</p>`;
    if (!data) return `<p class="tal-empty">Reading your talent trees…</p>`;
    if (!data.available) return unlocksCard(data.unlocks) + trainingCard(data.training) + `<div class="tal-empty"><strong>Talent trees aren't available yet.</strong><p>${esc(data.reason || "")} Connect your WoW Forever folder in Settings → Game connection; the app reads your talents from your own game files.</p></div>`;
    const c = data.coach, trees = data.trees;
    const descOf = (s) => { const t = trees.tabs.find((x) => x.name === s.tab)?.talents.find((x) => x.id === s.talentId); return t?.descriptions?.[s.rank - 1] || t?.descriptions?.[0] || ""; };
    const iconOf = (s) => trees.tabs.find((x) => x.name === s.tab)?.talents.find((x) => x.id === s.talentId)?.iconFileId;
    const groups = [];
    c.order.slice(c.spentByNow.length, c.spentByNow.length + 8).forEach((s, i) => {
      const lvl = 10 + c.spentByNow.length + i, g = groups[groups.length - 1];
      if (g && g.talentId === s.talentId) { g.toRank = s.rank; g.toLevel = lvl; } else groups.push({ ...s, fromRank: s.rank, toRank: s.rank, fromLevel: lvl, toLevel: lvl });
    });
    const when = (g) => (g.fromLevel <= c.level ? "Spend now" : g.fromLevel === g.toLevel ? `Level ${g.fromLevel}` : `Levels ${g.fromLevel}–${g.toLevel}`);
    const next = groups.length ? `<ol class="tal-next-list">${groups.slice(0, 4).map((g, i) => `<li${i === 0 ? ' class="first"' : ""}>${iconOf(g) && window.GameIcons ? GameIcons.tag(iconOf(g), 36) : ""}<div><strong>${esc(g.name)} <small>${g.fromRank === g.toRank ? `rank ${g.toRank}` : `ranks ${g.fromRank}–${g.toRank}`} of ${g.maxRank} · ${esc(g.tab)}</small></strong><span class="tal-when">${when(g)}</span>${i === 0 && descOf(g) ? `<p>${esc(descOf(g))}</p>` : ""}</div></li>`).join("")}</ol>` : `<p class="tal-empty">Every point on this path is spent.</p>`;
    const nextOld = c.next.length ? `<ol class="tal-next-list">${c.next.map((s, i) => `<li${i === 0 ? ' class="first"' : ""}>${iconOf(s) && window.GameIcons ? GameIcons.tag(iconOf(s), 36) : ""}<div><strong>${esc(s.name)} <small>rank ${s.rank}/${s.maxRank} · ${esc(s.tab)}</small></strong>${i === 0 ? `<span class="tal-when">${c.points >= 1 ? "Spend now" : "At level 10"}</span>` : `<span class="tal-when">Level ${9 + c.spentByNow.length + i + 1}</span>`}${descOf(s) ? `<p>${esc(descOf(s))}</p>` : ""}</div></li>`).join("")}</ol>` : `<p class="tal-empty">Every point on this path is spent. 🎉</p>`;
    const totals = Object.entries(c.totals).map(([k, v]) => `${v} ${esc(k)}`).join(" / ") || "none yet";
    return `<div class="tal-summary"><div class="tal-points"><strong>${c.points}</strong><span>talent point${c.points === 1 ? "" : "s"} at level ${c.level}</span></div><p>${c.points ? `By now: ${totals}.` : "Talents start at level 10: one point every level after that."} The path leans <strong>${esc(c.tree)}</strong>. ${esc(c.why)}</p></div>
      ${unlocksCard(data.unlocks)}
      ${trainingCard(data.training)}
      ${modeBar()}
      ${mode === "plan" ? planBody() : `<div class="tal-layout"><div class="tal-trees">${trees.tabs.map((t) => tree(t, c)).join("")}</div><aside class="tal-side"><h3>Spend next</h3>${next}<p class="tal-note">In game: press <code>N</code> to open Talents. This path is a suggestion for solo leveling; your choices are yours.</p></aside></div>`}`;
  }
  function page() {
    const cls = preview || who?.className;
    return `<section class="talents-page" data-talents>
      ${PageHero.render({ art: "talents", eyebrow: "Characters · Talents", title: `${esc(cls || "Talents")}${who?.name && !preview ? ` <small>· ${esc(who.name)}</small>` : ""}`, crestHtml: cls && CLASSES.includes(cls) ? crest(cls) : "",
        aside: `<label class="tal-pick">Preview another class <select data-tal-class><option value="">${esc(who?.className || "Your class")}</option>${CLASSES.filter((c) => c !== who?.className).map((c) => `<option ${c === preview ? "selected" : ""}>${c}</option>`).join("")}</select></label>` })}
      <div data-tal-body>${body()}</div></section>`;
  }
  function paint() { hideCard(); const b = document.querySelector("[data-tal-body]"); if (b) b.innerHTML = body(); }
  async function load() {
    if (loading) return; loading = true;
    try {
      const s = await api.bootstrap(); const p = s.state.profiles.find((x) => x.id === s.state.activeProfileId);
      who = p?.className ? { id: p.id, name: p.name, className: p.className, level: p.level } : null;
      const cls = preview || who?.className;
      data = cls ? await api.talentCoach({ className: cls, level: preview ? 60 : who.level }) : null; error = "";
      if (data?.available && api.talentPlanner) {
        try { await openPlan(cls); } catch (e) { plan = { key: "", error: e.message || "The planner is unavailable." }; }
      }
    } catch (e) { error = e.message || "Talents are unavailable."; }
    loading = false;
    const root = document.querySelector("[data-talents]");
    if (root) { root.outerHTML = page(); mountedFor = null; mounted(); }
  }
  function mounted() {
    mountAcademy();
    const root = document.querySelector("[data-talents]");
    if (!root || mountedFor === root) return;
    mountedFor = root;
    root.addEventListener("change", (e) => {
      if (e.target.matches("[data-tal-class]")) { preview = e.target.value || null; data = null; paint(); load(); }
      else if (e.target.matches("[data-tal-level]") && plan?.view) { planLevel = Number(e.target.value) || 60; ask("open").then(() => { say(plan.view.total > plan.view.budget ? `This plan holds more points than level ${planLevel} gives.` : ""); paint(); }).catch(() => {}); }
    });
    root.addEventListener("input", (e) => {
      if (!plan) return;
      if (e.target.matches("[data-tal-name]")) plan.name = e.target.value;
      else if (e.target.matches("[data-tal-paste]")) plan.paste = e.target.value;
    });
    root.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tal-mode]"), cell = e.target.closest("button[data-tal-id]"), button = e.target.closest("[data-tal-act]");
      if (tab) { mode = tab.dataset.talMode === "plan" ? "plan" : "path"; paint(); }
      else if (cell) point("add", Number(cell.dataset.talId));
      else if (button) act(button.dataset.talAct, button);
    });
    root.addEventListener("contextmenu", (e) => {
      const cell = e.target.closest("button[data-tal-id]");
      if (cell) { e.preventDefault(); point("remove", Number(cell.dataset.talId)); }
    });
    root.addEventListener("keydown", (e) => {
      const cell = e.target.closest?.("button[data-tal-id]");
      if (cell && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); point("remove", Number(cell.dataset.talId)); }
    });
    root.addEventListener("mouseover", (e) => { const cell = e.target.closest("[data-tal-id]"); if (cell) showCard(cell); });
    root.addEventListener("mouseout", (e) => { const cell = e.target.closest("[data-tal-id]"); if (cell && !cell.contains(e.relatedTarget)) hideCard(); });
    root.addEventListener("focusin", (e) => { const cell = e.target.closest("button[data-tal-id]"); if (cell) showCard(cell); });
    root.addEventListener("focusout", hideCard);
    if (!data && !loading) load();
  }
  return { page, academy, mounted, invalidate: () => { data = null; }, _state: () => ({ data, who, preview, mode, plan }) };
})();
