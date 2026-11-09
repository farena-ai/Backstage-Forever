"use strict";
// This module presents server-approved facts. Destination selection stays in main.
window.QuestGuide = (() => {
  let api, root, esc, notify, onStatus;
  let profile = null,
    signature = "",
    sourceSignature = "",
    generation = 0;
  let status = null,
    query = "",
    includeReference = false,
    rows = [],
    details = null,
    selected = null;
  let searchRequest = 0,
    detailRequest = 0,
    statusRequest = 0,
    contextRequest = 0;
  let loading = false,
    error = "",
    loaded = false,
    contextKey = "",
    contextResolvedKey = "",
    contextValue = null;
  let queryTimer, contextTimer;
  const safeDate = (value) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleDateString(
          undefined,
          /^\d{4}-\d{2}-\d{2}$/.test(value) ? { timeZone: "UTC" } : undefined,
        )
      : "Date unknown";
  const sourceFiles = (count) =>
    `${count ?? "Unknown"} contributor ${count === 1 ? "file" : "files"}`;
  const evidenceLabel = (value) =>
    ({
      "observed-quest-giver": "Quest giver observation",
      "observed-turn-in": "Quest turn-in observation",
      "observed-turn-in-npc": "Quest turn-in observation",
      "mentioned-in-objective": "Named in a quest objective",
      "objective-gain": "Objective progress observation",
      "observed-objective": "Objective progress observation",
      "observed-objective-gain": "Objective progress observation",
      "observed-npc-window": "NPC interaction observation",
    })[value] || "Published player observation";
  const point = (p) =>
    `Map ${p.mapId} · ${(p.x * 100).toFixed(2)}%, ${(p.y * 100).toFixed(2)}%`;
  function invalidate(clearQuery = false) {
    generation++;
    searchRequest++;
    detailRequest++;
    statusRequest++;
    contextRequest++;
    clearTimeout(queryTimer);
    clearTimeout(contextTimer);
    rows = [];
    details = null;
    selected = null;
    loaded = false;
    loading = false;
    error = "";
    contextKey = "";
    contextResolvedKey = "";
    contextValue = null;
    if (clearQuery) {
      query = "";
      includeReference = false;
      signature = "";
      sourceSignature = "";
      status = null;
    }
  }
  function sync(p, nextStatus) {
    const next = JSON.stringify(p || null);
    if (signature !== next) {
      const switched = profile?.id !== p?.id;
      invalidate(switched);
      signature = next;
      profile = p || null;
    }
    if (nextStatus) {
      const source = JSON.stringify([
        nextStatus.build,
        nextStatus.packBuild,
        nextStatus.sourceCommit,
      ]);
      if (sourceSignature && sourceSignature !== source) {
        invalidate();
        paintResults();
        paintDetail();
        queueMicrotask(mounted);
      }
      sourceSignature = source;
      status = nextStatus;
      paintStatus();
    }
  }
  function init(options) {
    ({ api, root, esc, notify, onStatus } = options);
    root.addEventListener("input", (event) => {
      if (event.target.id === "quest-search") {
        query = event.target.value.slice(0, 120);
        searchRequest++;
        rows = [];
        loaded = false;
        loading = true;
        error = "";
        paintResults();
        details = null;
        selected = null;
        detailRequest++;
        paintDetail();
        clearTimeout(queryTimer);
        queryTimer = setTimeout(search, 120);
      }
      if (event.target.matches('#chat-form [name="prompt"]')) {
        clearTimeout(contextTimer);
        contextRequest++;
        contextKey = "";
        paintContext(null, "Updating the public context preview…");
        contextTimer = setTimeout(updateContext, 160);
      }
    });
    root.addEventListener("change", (event) => {
      if (event.target.id === "reference-quests") {
        includeReference = event.target.checked;
        search();
      }
      if (event.target.id === "knowledge-automatic")
        runStatus(() => api.setKnowledgeAutomatic(event.target.checked));
      if (event.target.id === "share-profile") updateContext();
    });
    root.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.questId) open(Number(button.dataset.questId));
      if (button.dataset.questCopy) copy(Number(button.dataset.questCopy));
      if (button.dataset.knowledgeAction === "refresh")
        runStatus(() => api.refreshKnowledge(), true);
      if (button.dataset.knowledgeAction === "cancel")
        runStatus(() => api.setKnowledgeAutomatic(false));
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && root.querySelector(".quest-guide")) {
        detailRequest++;
        details = null;
        selected = null;
        paintDetail();
        root.querySelector("#quest-search")?.focus();
      }
    });
  }
  function statusMarkup() {
    const s = status;
    if (!s)
      return '<div class="knowledge-status"><span class="eyebrow">FOREVER REFERENCE</span><p>Opening the bundled quest ledger…</p></div>';
    const labels = {
      ready: "Reference ready",
      reference: "Reference edition",
      mismatch: "Build not covered",
      refreshing: "Checking reference",
      offline: "Reference offline",
    };
    return `<section class="knowledge-status" aria-label="Quest reference status"><div class="knowledge-status-main"><span class="knowledge-sigil" aria-hidden="true">◈</span><div><strong>${esc(labels[s.phase] || "Quest reference")}</strong><p>${esc(s.message || "Bundled quest facts work without a connection.")}</p><small>Reference ${esc(s.packBuild || s.bundledBuild || "unknown")} · Observed through ${esc(safeDate(s.observedThrough))}${s.build ? ` · Game ${esc(s.build)}` : " · Game build not yet saved"}</small></div></div><div class="knowledge-actions"><label class="check-label"><input id="knowledge-automatic" aria-label="Automatic reference updates" type="checkbox" ${s.automatic ? "checked" : ""}>Automatic updates</label>${s.phase === "refreshing" ? '<button data-knowledge-action="cancel">Cancel refresh</button>' : '<button data-knowledge-action="refresh">Refresh reference</button>'}</div></section>`;
  }
  function page() {
    return `<div class="quest-guide"><header class="section-head quest-guide-heading"><div><div class="eyebrow">THE QUEST LEDGER · NO AI REQUIRED</div><h1>Your next chapter.</h1><p>Your saved quests, connected to public Forever observations. Pick a quest to find its next step, reported chain and rewards.</p></div><span class="ledger-seal" aria-hidden="true">✧</span></header><div data-knowledge-status>${statusMarkup()}</div><section class="quest-ledger" aria-label="Quest Guide"><aside class="quest-index"><label class="quest-search-label" for="quest-search">Find a quest<span>Title or exact quest ID</span></label><input id="quest-search" type="search" maxlength="120" autocomplete="off" aria-label="Find a quest" placeholder="Search this character’s journey…" value="${esc(query)}"><label class="check-label reference-toggle"><input id="reference-quests" type="checkbox" ${includeReference ? "checked" : ""}>Include unobserved reference quests</label><p class="ledger-caption">${profile?.quests?.length ? "YOUR CURRENT QUESTS FIRST" : "OBSERVED PUBLIC QUESTS"} <span>Saved, never live</span></p><div class="quest-results" aria-live="polite">${resultsMarkup()}</div></aside><div class="quest-detail-host">${detailMarkup()}</div></section><p class="ledger-footnote">Built locally. Community coverage is partial; reported links are not a complete prerequisite graph. You choose every action in game.</p></div>`;
  }
  function mergedRows(found) {
    const active = profile?.quests || [];
    const needle = query.trim().toLocaleLowerCase();
    const byId = new Map(found.map((row) => [row.id, row]));
    const matches = active.filter(
      (q) =>
        !needle ||
        byId.has(q.id) ||
        String(q.id) === needle ||
        q.title.toLocaleLowerCase().includes(needle),
    );
    const current = matches.map((q) => ({
      ...byId.get(q.id),
      id: q.id,
      title: q.title,
      active: true,
      status: byId.get(q.id)?.status || "missing",
      complete: q.complete,
    }));
    return [
      ...current,
      ...found
        .filter(
          (row) =>
            !active.some((q) => q.id === row.id) && (needle || !active.length),
        )
        .slice(0, 30 - current.length),
    ];
  }
  function resultsMarkup() {
    if (error) return `<p class="quest-empty">${esc(error)}</p>`;
    if (!loaded && loading)
      return '<p class="quest-empty">Opening saved quest references…</p>';
    return rows.length
      ? rows
          .map(
            (row) =>
              `<button class="quest-ledger-row ${selected === row.id ? "selected" : ""}" data-quest-id="${row.id}" aria-pressed="${selected === row.id}"><span class="quest-row-mark" aria-hidden="true">${row.active ? (row.complete ? "◆" : "◇") : "○"}</span><span><strong>${esc(row.title)}</strong><small>#${row.id}${row.active ? (row.complete ? " · Ready to turn in" : " · In your saved log") : " · Check availability"}</small>${row.status === "conflict" ? "<em>Current title differs from reference</em>" : row.status === "missing" ? "<em>No matching reference</em>" : row.referenceTitle ? `<em>English reference: ${esc(row.referenceTitle)}</em>` : ""}</span><span aria-hidden="true">›</span></button>`,
          )
          .join("")
      : `<div class="quest-empty"><strong>${query ? "No matching quests." : "A fresh page awaits."}</strong><p>${status?.phase === "mismatch" ? "This game build has no matching reference pack. Your saved quests stay available; refresh later for compatible coverage." : "Try a quest title or exact ID. Include unobserved references to browse the wider cache; their availability is unknown."}</p></div>`;
  }
  function chainMarkup(chain) {
    if (!chain.length) return "";
    const nodes = new Map(chain.map(node => [node.id, node]));
    return `<section class="quest-section"><h3>Reported chain</h3><p class="section-note">Each arrow is a reported next link, not a proven prerequisite. This list is a bounded view, not a required sequence.</p><ul class="quest-chain">${chain.map(node => {
      const next = nodes.get(node.nextQuestId);
      const qualifier = node.referenceTitle
        ? `<small class="chain-reference">${node.referenceStatus === "conflict" ? "Reference conflict" : "English reference"}: ${esc(node.referenceTitle)}${node.referenceStatus === "conflict" ? " \u00b7 Current game title wins" : ""}</small>`
        : "";
      return `<li class="chain-${esc(node.status)}" data-chain-node="${node.id}"><span class="chain-status">${esc({ active: "In your log", completed: "Completed", unknown: "Status unknown", missing: "Reference missing" }[node.status] || "Unknown")}</span><button data-quest-id="${node.id}" ${node.id === selected ? 'aria-current="step"' : ""}>${esc(node.title || `Quest #${node.id}`)} <small>#${node.id}</small></button>${qualifier}${node.nextQuestId ? `<div class="chain-link" data-chain-from="${node.id}" data-chain-to="${node.nextQuestId}"><span>Reported next \u2192 </span><button data-quest-id="${node.nextQuestId}">${esc(next?.title || `Quest #${node.nextQuestId}`)} <small>#${node.nextQuestId}${!next ? " \u00b7 Outside this view" : next.status === "missing" ? " \u00b7 Reference missing" : ""}</small></button></div>` : '<small class="chain-reference">No next link reported.</small>'}</li>`;
    }).join("")}</ul></section>`;
  }
  function detailMarkup() {
    if (!selected)
      return `<section class="quest-detail quest-detail-empty"><div class="ledger-compass" aria-hidden="true">✧</div><div class="eyebrow">A LITTLE DIRECTION FOR THE ROAD</div><h2>Choose your next quest.</h2><p>Start with a quest in your saved log. The ledger keeps game destinations and approximate community locations clearly labelled.</p><div class="ledger-how"><span><b>01</b>Choose a quest</span><span><b>02</b>Review the evidence</span><span><b>03</b>Copy a waypoint, if available</span></div><small>No provider, account or database download needed.</small></section>`;
    if (!details)
      return '<section class="quest-detail"><p class="quest-empty">Opening quest evidence…</p></section>';
    const d = details,
      q = profile?.quests?.find((q) => q.id === selected),
      title = q?.title || d.record?.title || `Quest #${selected}`;
    const chain = d.chain || [];
    return `<article class="quest-detail" tabindex="-1" aria-label="Quest details"><header class="quest-detail-heading"><span class="eyebrow">QUEST #${selected}${q ? " · YOUR SAVED LOG" : " · PUBLIC REFERENCE"}</span><h2>${esc(title)}</h2><p>${q ? (q.complete ? "Ready to turn in in your saved snapshot." : "Continue the objectives in your saved quest log.") : "Check availability in game. A public record does not prove eligibility."}</p>${d.status === "conflict" ? `<p class="quest-notice">Your current game title wins. Reference title: ${esc(d.record?.title)}. Conflicting reference facts cannot supply an automatic marker.</p>` : ""}${d.status === "missing" ? '<p class="quest-notice">No matching reference for this quest and saved game build. Your quest remains in your log. Check the in-game journal and refresh references later.</p>' : ""}</header>${waypointMarkup(d)}${q?.objectives?.length ? `<section class="quest-section"><h3>Your objectives</h3><ul class="quest-objectives">${q.objectives.map((o) => `<li>${o.done ? "✓" : "○"} ${esc(o.text)}</li>`).join("")}</ul></section>` : ""}${chainMarkup(chain)}${rewardsMarkup(d.rewards)}${npcsMarkup("Quest givers", d.givers)}${npcsMarkup("Turn-in observations", d.turnIns)}${npcsMarkup("Mentioned in an objective", d.mentions)}${d.objectiveLocations?.length ? `<section class="quest-section"><h3>Objective observations</h3>${d.objectiveLocations.map((o) => `<p>Objective ${esc(o.index)} · ${esc(sourceFiles(o.sources))}${o.positions?.length ? ` · ${esc(point(o.positions[0]))}` : " · No position"}</p>`).join("")}<p class="section-note">Gain observations are approximate positions, not a route.</p></section>` : ""}${sourceMarkup(d, Boolean(q))}</article>`;
  }
  function waypointMarkup(d) {
    const w = d.waypoint,
      p = w?.destination;
    const isReference = w?.source === "reference" || w?.phase === "r";
    const olderCapture = !w?.canCopy && /capture|reload|addon/i.test(w?.reason || "");
    return `<section class="quest-waypoint ${w?.canCopy ? "has-waypoint" : ""}"><div class="eyebrow">${w?.source === "game" ? "SAVED GAME DESTINATION" : isReference && p ? "APPROXIMATE COMMUNITY LOCATION" : "YOUR NEXT DESTINATION"}</div><h3>${p ? esc(p.name || p.text || "Quest waypoint") : "Check your in-game quest log"}</h3>${p ? `<p class="waypoint-coordinates">${esc(point(p))}</p>${w.source === "reference" ? `<p class="section-note">Approximate player observation · ${esc(sourceFiles(p.sources))} · ${esc(safeDate(p.observedThrough || d.provenance?.observedThrough))}. ${esc(evidenceLabel(p.evidence))}</p>` : '<p class="section-note">This point came from your saved game snapshot.</p>'}` : ""}<button class="primary" data-quest-copy="${selected}" ${w?.canCopy ? "" : "disabled"}>${w?.phase === "r" ? "Copy reference marker" : "Copy game waypoint"}</button><p class="waypoint-instruction">${w?.canCopy ? (w.phase === "r" ? "Paste into game chat and press Enter. This marker does not confirm quest availability." : "Paste into game chat and press Enter. The addon rechecks your quest and build.") : olderCapture ? "This desktop snapshot was saved before the waypoint feature. A newer save is needed for this desktop action." : esc(w?.reason || "No compatible destination was observed. Check the quest log in game.")}</p>${olderCapture ? '<p class="section-note">Prepare current companion files in Game Connection. They load on the next game launch; if the addon is already listed, you can choose a voluntary UI reload. Your current Compass may already work. Desktop waypoint evidence catches up after logout.</p>' : ""}</section>`;
  }
  function rewardsMarkup(rewards) {
    if (
      !rewards ||
      (!rewards.items?.length &&
        !rewards.choices?.length &&
        rewards.moneyCopper === undefined)
    )
      return '<section class="quest-section"><h3>Rewards</h3><p class="section-note">No reward details in this reference. Check the game’s quest window.</p></section>';
    const items = (list) =>
      `<ul class="quest-rewards">${list.map((item) => `<li><span aria-hidden="true">◈</span>${esc(item.name || `Item #${item.itemId}`)}${item.count > 1 ? ` × ${item.count}` : ""}<small>Item #${item.itemId}</small></li>`).join("")}</ul>`;
    const copper = rewards.moneyCopper;
    return `<section class="quest-section"><h3>Rewards</h3>${rewards.items?.length ? `<h4>Guaranteed items</h4>${items(rewards.items)}` : ""}${rewards.choices?.length ? `<h4>Choose one</h4>${items(rewards.choices)}` : ""}${copper !== undefined ? `<p class="quest-money">Listed money: ${Math.floor(copper / 10000)}g ${Math.floor((copper % 10000) / 100)}s ${copper % 100}c</p><p class="section-note">Listed source amount; your scaled payout may differ.</p>` : ""}</section>`;
  }
  function npcsMarkup(label, list) {
    return list?.length
      ? `<section class="quest-section"><h3>${label}</h3>${list.map((npc) => `<div class="quest-npc"><strong>${esc(npc.name)} <small>${npc.kind === "object" ? "Object" : "NPC"} #${npc.id}</small></strong><p>${npc.positions?.length ? esc(npc.positions.map(point).join(" · ")) : "Position not observed"}</p><small>${esc(sourceFiles(npc.sources))} · ${esc(safeDate(npc.lastSeen))} · Approximate interaction position</small></div>`).join("")}</section>`
      : "";
  }
  function sourceMarkup(d, active) {
    return `<details class="quest-source"><summary>Sources & what remains unknown</summary>${d.provenance ? `<p>${esc(d.provenance.attribution || "Efficient Games · CC BY 4.0")}</p><p>Build ${esc(d.provenance.build)} · Observed through ${esc(safeDate(d.provenance.observedThrough))}</p><p class="source-url">${esc(d.provenance.url)}</p><p>Source commit <code>${esc(d.provenance.sourceCommit)}</code></p>` : ""}<p>${esc(status?.coverage || "Public observation coverage is partial.")}</p>${d.record?.sources !== undefined ? `<p>Quest cache: ${esc(sourceFiles(d.record.sources))}.</p>` : ""}<p>Counts describe contributor files, not universal verification. Approximate interaction positions are not guaranteed spawns or routes.</p>${!active && d.record && !d.record.observedInPlay ? "<p>Availability has not been observed in play for this cache-only record.</p>" : ""}${(
      d.warnings || []
    )
      .filter(
        (warning) =>
          !active || !/availability|playable|observed in play/i.test(warning),
      )
      .map((warning) => `<p>${esc(warning)}</p>`)
      .join(
        "",
      )}<p>Race, class, reputation and unreported prerequisites remain unknown. Check the game before travelling.</p><p>Last successful reference check: ${esc(safeDate(status?.lastChecked))}. Collection date and check date are separate.</p></details>`;
  }
  function paintResults() {
    const host = root.querySelector(".quest-results");
    if (host) host.innerHTML = resultsMarkup();
  }
  function paintDetail() {
    const host = root.querySelector(".quest-detail-host");
    if (host) host.innerHTML = detailMarkup();
    root.querySelectorAll(".quest-ledger-row").forEach((node) => {
      const active = Number(node.dataset.questId) === selected;
      node.classList.toggle("selected", active);
      node.setAttribute("aria-pressed", String(active));
    });
  }
  function paintStatus() {
    root.querySelectorAll("[data-knowledge-status]").forEach((node) => {
      node.innerHTML = statusMarkup();
    });
  }
  async function search() {
    if (!api.searchQuests || !root.querySelector(".quest-guide")) return;
    const request = ++searchRequest,
      epoch = generation,
      id = profile?.id || null;
    loading = true;
    error = "";
    paintResults();
    try {
      const found = await api.searchQuests(query, id, {
        includeReferenceOnly: includeReference,
      });
      if (request !== searchRequest || epoch !== generation) return;
      rows = mergedRows(found);
      loaded = true;
    } catch {
      if (request === searchRequest && epoch === generation) {
        error =
          "The local reference could not be opened. Try again, or check your saved quest log in game.";
        loaded = true;
      }
    } finally {
      if (request === searchRequest && epoch === generation) {
        loading = false;
        paintResults();
      }
    }
  }
  async function open(id) {
    if (!root.querySelector(".quest-guide")) return;
    const request = ++detailRequest,
      epoch = generation,
      pid = profile?.id || null;
    selected = id;
    details = null;
    paintDetail();
    try {
      const result = await api.questDetails(pid, id);
      if (request !== detailRequest || epoch !== generation) return;
      details = result;
      paintDetail();
      root.querySelector(".quest-detail")?.focus({ preventScroll: true });
    } catch {
      if (request === detailRequest && epoch === generation) {
        selected = null;
        paintDetail();
        notify("Quest evidence could not be opened. Try again.", true);
      }
    }
  }
  async function copy(id) {
    const descriptor = details?.waypoint;
    if (id !== selected || !descriptor?.canCopy) return;
    const epoch = generation;
    try {
      const result = await api.copyQuestWaypoint(
        profile.id,
        id,
        descriptor.phase,
      );
      if (epoch === generation) notify(result.message);
    } catch (error) {
      if (epoch !== generation) return;
      notify(
        "The saved quest changed or its marker is unavailable. Refresh your snapshot and try again.",
        true,
      );
      open(id);
    }
  }
  async function runStatus(operation, refreshing = false) {
    const request = ++statusRequest,
      epoch = generation;
    if (refreshing) {
      status = {
        ...status,
        phase: "refreshing",
        message:
          "Checking the public Forever reference. No character data is sent.",
      };
      paintStatus();
    }
    try {
      const result = await operation();
      if (request !== statusRequest || epoch !== generation) return;
      status = result;
      onStatus?.(result);
      loaded = false;
      paintStatus();
      search();
      if (selected) open(selected);
    } catch {
      if (request === statusRequest && epoch === generation) {
        status = {
          ...status,
          phase: "offline",
          message:
            "Reference check unavailable. Your bundled or last-good facts remain here.",
        };
        paintStatus();
      }
    }
  }
  function contextMarkup() {
    const selectedLabel = [
      profile?.name,
      profile?.race,
      profile?.faction,
      profile?.location?.zone,
    ]
      .filter(Boolean)
      .join(" · ");
    return `<div class="context-preview"><span class="eyebrow">EXACT PUBLIC CONTEXT · REVIEW BEFORE SENDING</span><strong>Public character context:</strong><p class="context-selection">Selected: ${esc(selectedLabel || "No character")} · Selection stays visible locally when sharing is off.</p><div data-context-body>Opening the public context preview…</div><small>Private notes, goals, full completion history, account identifiers and local paths stay here. Earlier chat is not sent.</small></div>`;
  }
  function paintContext(value, message) {
    const host = root.querySelector("[data-context-body]");
    if (!host) return;
    host.innerHTML = message
      ? `<p>${esc(message)}</p>`
      : value
        ? `<details><summary>Review public character & source facts</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`
        : "<p>No character context will be sent with this question.</p>";
  }
  async function updateContext() {
    if (!root.querySelector("[data-context-body]")) return;
    const prompt =
      root.querySelector('#chat-form [name="prompt"]')?.value || "";
    const share = root.querySelector("#share-profile")?.checked === true;
    const key = JSON.stringify([signature, share, prompt]);
    if (key === contextKey) {
      if (contextResolvedKey === key) paintContext(contextValue);
      else paintContext(null, "Opening the public context preview…");
      return;
    }
    contextKey = key;
    contextResolvedKey = "";
    contextValue = null;
    const request = ++contextRequest,
      epoch = generation;
    if (!share) {
      contextResolvedKey = key;
      paintContext(null);
      return;
    }
    paintContext(null, "Opening the public context preview…");
    try {
      const result = await api.contextPreview(
        profile?.id || null,
        share,
        prompt,
      );
      if (
        request !== contextRequest ||
        epoch !== generation ||
        !root.querySelector("#share-profile")?.checked
      )
        return;
      contextValue = result;
      contextResolvedKey = key;
      paintContext(result);
    } catch {
      if (request === contextRequest && epoch === generation) {
        contextKey = "";
        contextResolvedKey = "";
        paintContext(
          null,
          "Context preview unavailable. Reopen this page before sending character context.",
        );
      }
    }
  }
  function mounted() {
    if (root.querySelector(".quest-guide") && !loaded && !loading) search();
    if (root.querySelector("[data-context-body]"))
      queueMicrotask(updateContext);
  }
  return {
    init,
    sync,
    invalidate,
    page,
    mounted,
    statusMarkup,
    contextMarkup,
    updateContext,
    open,
  };
})();
