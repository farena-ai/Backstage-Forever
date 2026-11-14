"use strict";
// This module presents server-approved facts. Destination selection stays in main.
window.QuestGuide = (() => {
  let api, root, esc, notify, onStatus, portrait, selectedMemoryIds=()=>[], ready=()=>Promise.resolve(), guard, painting=false, focus=null,suspendedFocus=null,focusRevision=0;
  const disclosures=new Map();
  const active=()=>Boolean(root?.querySelector(".quest-guide"));
  const seal=()=>`<svg class="atlas-engraving" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="48"/><circle cx="60" cy="60" r="39"/><path d="M60 3v21m0 72v21M3 60h21m72 0h21M20 20l15 15m50 50l15 15M20 100l15-15m50-50l15-15M60 23l10 37-10 37-10-37zM23 60l37-10 37 10-37 10z"/><path class="atlas-foil" d="M60 23l10 37H60zM60 97L50 60h10z"/></svg>`;
  const intent=(kind,id)=>esc(JSON.stringify({kind,id,generation,profileId:profile?.id??null}));
  function remember(){const n=document.activeElement;focus=(n?.dataset?.questControl||n?.dataset?.shellControl)?{key:n.dataset.questControl||n.dataset.shellControl,start:n.selectionStart,end:n.selectionEnd,revision:focusRevision}:suspendedFocus?.revision===focusRevision?suspendedFocus:null;root.querySelectorAll(".quest-guide details[open] summary[data-interaction-key]").forEach(n=>disclosures.set(n.dataset.interactionKey,true));root.querySelectorAll(".quest-guide details:not([open]) summary[data-interaction-key]").forEach(n=>disclosures.set(n.dataset.interactionKey,false));}
  function restore(){root.querySelectorAll(".quest-guide summary[data-interaction-key]").forEach(n=>{if(disclosures.has(n.dataset.interactionKey))n.parentElement.open=disclosures.get(n.dataset.interactionKey);});if(!focus||focus.revision!==focusRevision)return;const n=[...root.querySelectorAll("[data-quest-control],[data-shell-control]")].find(n=>(n.dataset.questControl||n.dataset.shellControl)===focus.key);if(!n||n.disabled){suspendedFocus=focus;return;}if(n){n.focus({preventScroll:true});suspendedFocus=null;if(typeof focus.start==="number"&&n.setSelectionRange)try{n.setSelectionRange(focus.start,focus.end);}catch{}}}
  function beginRender(){remember();painting=true;}function endRender(){painting=false;}
  function paintRegion(selector,markup,kind){if(guard?.defer(()=>paintRegion(selector,markup,kind),kind))return;const n=root.querySelector(selector);if(n){beginRender();try{PlayerNavigation.remember(root);n.innerHTML=markup();PlayerNavigation.mounted(root);restore();}finally{endRender();}}}
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
  let queryTimer, contextTimer, opening=false,copying=false, detailError="",copyError="";
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
    `${details?.mapNames?.[p.mapId] || `Map ${p.mapId}`} · ${(p.x * 100).toFixed(1)}, ${(p.y * 100).toFixed(1)}`;
  function invalidate(clearQuery = false,preserveGesture=false) {
    generation++;
    opening=false;copying=false;detailError="";copyError="";if(!preserveGesture)guard?.invalidate();
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
    if (clearQuery) { disclosures.clear(); if(focus?.key!=="active-character")focus=null; }
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
      const previous=selected;
      invalidate(switched,!switched);
      if(!switched)selected=previous;
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
    ({ api, root, esc, notify, onStatus, portrait } = options);
    selectedMemoryIds=options.selectedMemoryIds||selectedMemoryIds;ready=options.ready||ready;
    const newerFocus=()=>{focusRevision++;suspendedFocus=null;};
    document.addEventListener("focusin",e=>{if(active()&&!painting&&e.target!==document.body)newerFocus();});
    document.addEventListener("pointerdown",()=>{if(active()&&!painting)newerFocus();},true);
    document.addEventListener("keydown",e=>{if(active()&&!painting&&e.key==="Tab")newerFocus();},true);
    guard=InteractionGuard.create({root,active,painting:()=>painting});
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
      let displayed;try{displayed=JSON.parse(button.dataset.questIntent||"null");}catch{return;}
      if ((button.dataset.questId || button.dataset.questCopy) && (!displayed || displayed.generation!==generation || displayed.profileId!==(profile?.id??null)))return;
      if (button.dataset.questId) open(displayed.id);
      if (button.dataset.questCopy) copy(displayed.id,displayed);
      if(button.dataset.questRetry==="search")search();
      if(button.dataset.questRetry==="detail"&&selected)open(selected);
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
    return `<section class="knowledge-status" aria-label="Quest reference status"><div class="knowledge-status-main"><span class="knowledge-sigil" aria-hidden="true">◈</span><div><strong>${esc(labels[s.phase] || "Quest reference")}</strong><p>${esc(s.message || "Bundled quest facts work without a connection.")}</p></div></div>${PlayerNavigation.disclosure("quest-details", "Reference details & updates", `<small>Reference ${esc(s.packBuild || s.bundledBuild || "unknown")} · Observed through ${esc(safeDate(s.observedThrough))}${s.build ? ` · Game ${esc(s.build)}` : " · Game build not yet saved"}</small><div class="knowledge-actions"><label class="check-label"><input data-quest-control="automatic" id="knowledge-automatic" aria-label="Automatic reference updates" type="checkbox" ${s.automatic ? "checked" : ""}>Automatic updates</label>${s.phase === "refreshing" ? '<button data-quest-control="cancel" data-knowledge-action="cancel">Cancel refresh</button>' : '<button data-quest-control="refresh" data-knowledge-action="refresh">Refresh reference</button>'}</div>`)}</section>`;
  }
  function page() {
    const faction=["Alliance","Horde"].includes(profile?.faction)?profile.faction.toLowerCase():null;
    return `<div class="quest-guide" data-atlas-faction="${faction||"neutral"}"><header class="quest-guide-heading"><img class="quest-atlas-art" src="${portrait?portrait(profile?.className):"../../assets/citadel-journey.png"}" alt=""><div class="atlas-heading-copy"><div class="eyebrow">THE EXPEDITION ATLAS · LOCAL, WITHOUT AI</div><h1>Your next chapter.</h1><p>Saved quests. Reported connections. A little direction for the road.</p><span class="atlas-owner">${esc(profile?.name||"An uncharted adventure")} · ${esc(profile?.className||"Manual journal")} · ${esc(profile?.source?.kind==="wow-addon"?"Saved game observations":"Reference browsing · availability unknown")}</span></div>${faction?`<img class="atlas-faction" src="../../assets/faction-${faction}.png" alt="${esc(profile.faction)}">`:""}<div class="atlas-seal">${seal()}<span>FIELD EDITION<br>FOREVER</span></div></header><div data-knowledge-status>${statusMarkup()}</div><section class="quest-ledger" aria-label="Quest Guide"><aside class="quest-index"><div class="atlas-index-label"><span>01 / QUEST INDEX</span><span aria-hidden="true">✦</span></div><label class="quest-search-label" for="quest-search">Find a quest<span>Title or exact quest ID</span></label><input data-quest-control="search" id="quest-search" type="search" maxlength="120" autocomplete="off" aria-label="Find a quest" placeholder="Search this character’s journey…" value="${esc(query)}">${PlayerNavigation.disclosure("quest-filters", "More quest filters", `<label class="check-label reference-toggle"><input data-quest-control="references" id="reference-quests" type="checkbox" ${includeReference?"checked":""}>Include unobserved reference quests</label>`)}<p class="ledger-caption">${profile?.quests?.length?"YOUR CURRENT QUESTS FIRST":"OBSERVED PUBLIC QUESTS"}<span>Saved, never live · coverage is partial</span></p><div class="quest-results" aria-live="polite">${resultsMarkup()}</div></aside><div class="quest-detail-host">${detailMarkup()}</div></section><p class="ledger-footnote">Built locally. Reported links are not a complete prerequisite graph. You choose every action in game.</p></div>`;
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
    if (error) return `<div class="quest-empty" role="alert">${esc(error)}<button data-quest-control="retry-search" data-quest-retry="search">Retry quest index</button></div>`;
    if (!loaded && loading)
      return '<p class="quest-empty">Opening saved quest references…</p>';
    return rows.length
      ? rows
          .map(
            (row) =>
              `<button class="quest-ledger-row ${selected === row.id ? "selected" : ""}" data-quest-control="quest:${row.id}" data-quest-intent="${intent("open",row.id)}" data-quest-id="${row.id}" aria-pressed="${selected === row.id}"><span class="quest-row-mark" aria-hidden="true">${row.active ? (row.complete ? "◆" : "◇") : "○"}</span><span><strong>${esc(row.title)}</strong><small>#${row.id}${row.active ? (row.complete ? " · Ready to turn in" : " · In your saved log") : " · Check availability"}</small>${row.status === "conflict" ? "<em>Current title differs from reference</em>" : row.status === "missing" ? "<em>No matching reference</em>" : row.referenceTitle ? `<em>English reference: ${esc(row.referenceTitle)}</em>` : ""}</span><span aria-hidden="true">›</span></button>`,
          )
          .join("")
      : `<div class="quest-empty"><strong>${query ? "No matching quests." : "A fresh page awaits."}</strong><p>${status?.phase === "mismatch" ? "This game build has no matching reference pack. Your saved quests stay available; refresh later for compatible coverage." : "Try a quest title or exact ID. Include unobserved references to browse the wider cache; their availability is unknown."}</p></div>`;
  }
  function chainMarkup(chain) {
    if (!chain.length) return "";
    chain=chain.slice(0,30);
    const nodes = new Map(chain.map(node => [node.id, node]));
    return `<section class="quest-section"><h3>Reported chain</h3><p class="section-note">Each arrow is a reported next link, not a proven prerequisite. This list is a bounded view, not a required sequence.</p><ul class="quest-chain">${chain.map(node => {
      const next = nodes.get(node.nextQuestId);
      const seen=new Set([node.id]);let cursor=next,cycle=false;while(cursor){if(seen.has(cursor.id)){cycle=true;break;}seen.add(cursor.id);cursor=nodes.get(cursor.nextQuestId);}

      const qualifier = node.referenceTitle
        ? `<small class="chain-reference">${node.referenceStatus === "conflict" ? "Reference conflict" : "English reference"}: ${esc(node.referenceTitle)}${node.referenceStatus === "conflict" ? " \u00b7 Current game title wins" : ""}</small>`
        : "";
      return `<li class="chain-${esc(node.status)}" data-chain-node="${node.id}"><span class="chain-status">${esc({ active: "In your log", completed: "Completed", unknown: "Status unknown", missing: "Reference missing" }[node.status] || "Unknown")}</span><button data-quest-control="chain:${node.id}" data-quest-intent="${intent("open",node.id)}" data-quest-id="${node.id}" ${node.id === selected ? 'aria-current="step"' : ""}>${esc(node.title || `Quest #${node.id}`)} <small>#${node.id}</small></button>${qualifier}${cycle?'<small class="chain-reference">Reported cycle · no travel sequence inferred.</small>':""}${node.nextQuestId ? `<div class="chain-link" data-chain-from="${node.id}" data-chain-to="${node.nextQuestId}"><span>Reported next \u2192 </span><button data-quest-control="next:${node.id}:${node.nextQuestId}" data-quest-intent="${intent("open",node.nextQuestId)}" data-quest-id="${node.nextQuestId}">${esc(next?.title || `Quest #${node.nextQuestId}`)} <small>#${node.nextQuestId}${!next ? " \u00b7 Outside this view" : next.status === "missing" ? " \u00b7 Reference missing" : ""}</small></button></div>` : '<small class="chain-reference">No next link reported.</small>'}</li>`;
    }).join("")}</ul></section>`;
  }
  function detailMarkup() {
    if (!selected)
      return `<section class="quest-detail quest-detail-empty"><div class="ledger-compass">${seal()}</div><div class="eyebrow">A LITTLE DIRECTION FOR THE ROAD</div><h2>Choose your next quest.</h2><p>Start with a quest in your saved log. The ledger keeps game destinations and approximate community locations clearly labelled.</p><div class="ledger-how"><span><b>01</b>Choose a quest</span><span><b>02</b>Review the evidence</span><span><b>03</b>Copy a waypoint, if available</span></div><small>No provider, account or database download needed.</small></section>`;
    if(detailError)return `<section class="quest-detail"><div class="quest-empty" role="alert">${esc(detailError)}<button data-quest-control="retry-detail:${selected}" data-quest-retry="detail">Retry quest evidence</button></div></section>`;
    if (!details)
      return '<section class="quest-detail"><p class="quest-empty">Opening quest evidence…</p></section>';
    const d = details,
      q = profile?.quests?.find((q) => q.id === selected),
      title = q?.title || d.record?.title || `Quest #${selected}`;
    const chain = d.chain || [];
    return `<article class="quest-detail" data-quest-control="detail:${selected}" tabindex="-1" aria-label="Quest details"><header class="quest-detail-heading"><img class="quest-chapter-scene" src="../../assets/${["Alliance","Horde"].includes(profile?.faction)?`faction-${profile.faction.toLowerCase()}`:"citadel-journey"}.png" alt=""><div class="quest-chapter-mark">${seal()}</div><span class="eyebrow">QUEST #${selected}${q ? " · YOUR SAVED LOG" : " · PUBLIC REFERENCE"}</span><h2>${esc(title)}</h2><p>${q ? (q.complete ? "Ready to turn in in your saved snapshot." : "Continue the objectives in your saved quest log.") : "Check availability in game. A public record does not prove eligibility."}</p>${d.status === "conflict" ? `<p class="quest-notice">Your current game title wins. Reference title: ${esc(d.record?.title)}. Conflicting reference facts cannot supply an automatic marker.</p>` : ""}${d.status === "missing" ? '<p class="quest-notice">No matching reference for this quest and saved game build. Your quest remains in your log. Check the in-game journal and refresh references later.</p>' : ""}</header>${copyError?`<p class="quest-notice" role="alert">${esc(copyError)}</p>`:""}${d.waypoint?.canCopy ? waypointMarkup(d) : ""}${howToMarkup(d)}${whereMarkup(d, title)}${rewardsMarkup(d.rewards)}${linksMarkup(d.links)}${d.waypoint?.canCopy ? "" : waypointMarkup(d)}${insightsMarkup(d.insights)}${q?.objectives?.length ? `<section class="quest-section"><h3>Your objectives</h3><ul class="quest-objectives">${q.objectives.map((o) => `<li>${o.done ? "✓" : "○"} ${esc(o.text)}</li>`).join("")}</ul></section>` : ""}${chainMarkup(chain)}${npcsMarkup("Quest givers", d.givers)}${npcsMarkup("Turn-in observations", d.turnIns)}${npcsMarkup("Mentioned in an objective", d.mentions)}${d.objectiveLocations?.length ? `<section class="quest-section"><h3>Objective observations</h3>${d.objectiveLocations.map((o) => `<p>Objective ${esc(o.index)} · ${esc(sourceFiles(o.sources))}${o.positions?.length ? ` · ${esc(point(o.positions[0]))}` : " · No position"}</p>`).join("")}<p class="section-note">Gain observations are approximate positions, not a route.</p></section>` : ""}${sourceMarkup(d, Boolean(q))}</article>`;
  }
  function waypointMarkup(d) {
    const w = d.waypoint,
      p = w?.destination;
    const isReference = w?.source === "reference" || w?.phase === "r";
    const clue=isReference&&p?.evidence==="mentioned-in-objective";
    const namedClue=!p&&Boolean(d.mentions?.length);
    const olderCapture = !w?.canCopy && /capture|reload|addon/i.test(w?.reason || "");
    const heading=w?.source==="game"?"Game-reported quest marker":p?.name||p?.text||"Quest waypoint";
    const copyIntent=esc(JSON.stringify({kind:"copy",id:selected,generation,profileId:profile?.id??null,phase:w?.phase,canCopy:w?.canCopy===true}));
    return `<section class="quest-waypoint ${w?.canCopy ? "has-waypoint" : ""}"><div class="eyebrow">${w?.source === "game" ? "SAVED GAME DESTINATION" : clue||namedClue?"NPC CLUE · DESTINATION UNCONFIRMED":isReference && p ? "APPROXIMATE COMMUNITY LOCATION" : "YOUR NEXT DESTINATION"}</div><h3>${p ? esc(heading) : namedClue?esc(d.mentions[0].name)+" · named in an objective":"Check your in-game quest log"}</h3>${p ? `<p class="waypoint-coordinates">${esc(point(p))}</p>${w.source === "reference" ? `<p class="section-note">Approximate player observation · ${esc(sourceFiles(p.sources))} · ${esc(safeDate(p.observedThrough || d.provenance?.observedThrough))}. ${esc(evidenceLabel(p.evidence))}</p>` : `<p class="section-note">Saved game snapshot · saved ${esc(safeDate(profile?.source?.updatedAt))}. ${p.text?esc(p.text):"Point reported by the game; check your in-game journal."}</p>`}` : ""}<button class="primary" data-quest-control="copy:${selected}" data-quest-intent="${copyIntent}" data-quest-copy="${selected}" ${w?.canCopy&&!copying ? "" : "disabled"}>${clue?"Copy NPC clue marker":w?.source==="reference"?"Copy reference marker":"Copy game waypoint"}</button><p class="waypoint-instruction">${w?.canCopy ? (clue?"Copies an approximate historical NPC interaction point. This does not confirm the NPC’s current location, this quest destination or availability. Paste into game chat yourself.":isReference ? "Paste into game chat and press Enter. This marker does not confirm quest availability." : "Paste into game chat and press Enter. The addon rechecks your quest and build.") : olderCapture ? "This desktop snapshot was saved before the waypoint feature. A newer save is needed for this desktop action." : esc(w?.reason || "No compatible destination was observed. Check the quest log in game.")}</p>${olderCapture ? '<p class="section-note">Prepare current companion files in Game Connection. They load on the next game launch; if the addon is already listed, you can choose a voluntary UI reload. Your current Compass may already work. Desktop waypoint evidence catches up after logout.</p>' : ""}</section>`;
  }
  function insightsMarkup(facts) {
    if (!facts) return "";
    if (facts.status !== "available") return `<section class="quest-section quest-insights" aria-label="Supplementary reference facts"><h3>Supplementary reference facts</h3><p>${esc(facts.reason || "Compatible supplementary facts are unavailable.")}</p><p class="section-note">Your saved quest and primary waypoint evidence remain separate.</p></section>`;
    const sharing = facts.sharing;
    const shareLabel = { mixed: "Sharing was reported mixed.", supported: "Sharing was reported supported.", unsupported: "Sharing was reported not supported.", unknown: "Sharing observations unknown." }[sharing.status];
    const card = (symbol, label, body) => `<div class="quest-fact"><span class="quest-fact-mark" aria-hidden="true">${symbol}</span><div><h4>${label}</h4>${body}</div></div>`;
    return `<section class="quest-section quest-insights" aria-label="Supplementary reference facts"><div class="quest-facts-heading"><span class="eyebrow">BUNDLED FIELD NOTES · OFFLINE</span><h3>Supplementary reference facts</h3></div><div class="quest-facts-grid">${card("⇄", "Reported sharing", `<p>${esc(shareLabel)}</p>${sharing.status !== "unknown" ? `<p>${sharing.supportedCount} supported · ${sharing.unsupportedCount} not supported · ${sharing.scanSources} scan source files.</p>` : ""}<small>Counts are recorded answers, not distinct people, independent witnesses or probabilities. Current sharing may differ.</small>`)}${facts.timeLimitSeconds ? card("◷", "Reported duration", `<p>${facts.timeLimitSeconds} seconds · static reported limit.</p><small>No countdown or time remaining is known. Check the current game quest window.</small>`) : ""}${facts.startItem ? card("◇", "Reported starting item", `<p>${esc(facts.startItem.name)}${facts.startItem.named ? ` <span>· Item #${facts.startItem.id}</span>` : ""}</p><small>Item ownership and quest access are unknown.</small>`) : ""}${facts.itemDrops?.length ? card("⋄", "Reported quest drops", `<ul>${facts.itemDrops.map(item => `<li>${esc(item.name)} × ${item.count}${item.name !== `Item #${item.itemId}` ? ` <span>· Item #${item.itemId}</span>` : ""}</li>`).join("")}</ul><small>Drop rate, location and guarantee are unknown. These are reported item/count entries.</small>`) : ""}</div><p class="quest-facts-qualification">Static historical reference; player availability remains unknown. These facts do not establish prerequisites, faction restrictions or a destination.</p><p class="quest-facts-source">${esc(facts.source.attribution)}<br>Build ${esc(facts.source.build)} · Observed through ${esc(safeDate(facts.source.observedThrough))} · ${facts.sources} quest-cache source files.<br>English cache names (enUS) · observation names locale unspecified. One publisher; partial coverage.<br>App updates supply these field notes. Refresh reference updates the separate quest ledger.<br><span>Source commit ${esc(facts.source.sourceCommit)}</span></p></section>`;
  }
  // How to do it: plain steps, each from the most trusted source we have.
  const HOW_ICON = { kill: "quest", item: "hand-in", other: "zone", "turn-in": "hand-in" };
  function howToMarkup(d) {
    const h = d.howTo; if (!h?.steps?.length) return "";
    return `<section class="quest-section quest-howto" aria-label="How to do it"><h3>How to do it</h3><ol>${h.steps.map((s) => `<li class="how-${esc(s.kind)}${s.guess ? " guess" : ""}"><img src="art/steps/${HOW_ICON[s.kind] || "quest"}.png" alt="" width="30" height="30"><div><p>${esc(s.text)}</p>${s.warn ? `<p class="how-warn">${esc(s.warn)}</p>` : ""}</div></li>`).join("")}</ol>
      ${h.questSays?.length ? `<blockquote class="how-says"><span>The quest says</span>${h.questSays.map((x) => esc(x)).join(" ")}</blockquote>` : ""}
      ${h.basis?.length ? `<p class="section-note">Based on ${esc(h.basis.join(", "))}. In game, <code>/bf how</code> shows this too.</p>` : ""}</section>`;
  }
  // Where to go: pick up, objectives and hand in, each one click from a dialed-in map.
  const mapFocus = (payload, label = "Show on map") => `<button type="button" class="quest-map-btn" data-map-focus='${esc(JSON.stringify(payload))}'>${esc(label)}</button>`;
  function mainSpot(positions) {
    const byMap = new Map();
    for (const p of positions || []) if (Number.isSafeInteger(p.mapId) && Number.isFinite(p.x) && Number.isFinite(p.y)) (byMap.get(p.mapId) || byMap.set(p.mapId, []).get(p.mapId)).push(p);
    const best = [...byMap.values()].sort((a, b) => b.length - a.length)[0];
    if (!best) return null;
    return { mapId: best[0].mapId, x: best.reduce((t, p) => t + p.x, 0) / best.length, y: best.reduce((t, p) => t + p.y, 0) / best.length, count: best.length, mapName: details?.mapNames?.[best[0].mapId] || null };
  }
  function whereMarkup(d, title) {
    const tile = (cls, eyebrow, name, detail, button, chips = "") => `<div class="quest-where-tile ${cls}"><span class="quest-where-eyebrow">${eyebrow}</span><strong>${esc(name)}</strong>${chips}${detail ? `<small>${esc(detail)}</small>` : ""}${button || ""}</div>`;
    const npcTile = (cls, eyebrow, npc, goal) => {
      const at = npc && mainSpot(npc.positions);
      return tile(cls, eyebrow, npc?.name || "Not recorded yet", at ? `${at.mapName ? at.mapName + " · " : ""}${(at.x * 100).toFixed(1)}, ${(at.y * 100).toFixed(1)}` : npc ? "Position not observed" : "", at ? mapFocus({ mapId: at.mapId, x: at.x, y: at.y, npcId: npc.kind === "npc" ? npc.id : null, label: npc.name, sub: eyebrow, goal }) : "");
    };
    const giver = d.givers?.[0], turnIn = d.turnIns?.[0];
    const objectiveTiles = (d.objectiveLocations || []).slice(0, 3).map((o) => {
      const at = mainSpot(o.positions);
      const named = d.objectiveNames?.[o.index];
      const what = named ? `${{ monster: "Kill", item: "Collect", object: "Use", event: "" }[named.type] ?? ""} ${o.required > 1 ? o.required + " " : ""}${named.name}`.trim() : d.record?.objectiveEvidence && (d.objectiveLocations.length === 1) ? d.record.objectiveEvidence : `Objective ${o.index}${o.required ? ` · ${o.required} needed` : ""}`;
      // Creature level range and an elite warning for kill objectives, when the creature reference knows them.
      const cr = d.objectiveCreatures?.[o.index];
      const lv = cr && Number.isInteger(cr.minLevel) ? `lvl ${cr.minLevel === cr.maxLevel ? cr.minLevel : `${cr.minLevel}–${cr.maxLevel}`}` : "";
      const chips = lv || cr?.elite ? `<span class="quest-where-chips">${lv ? `<span class="quest-chip quest-chip-level">${esc(lv)}</span>` : ""}${cr.elite ? '<span class="quest-chip quest-chip-elite" title="Elite: much tougher than a normal enemy; bring a group">Elite</span>' : ""}</span>` : "";
      return at ? tile("quest-where-objective", "Objective area", what, `${at.count} spot${at.count === 1 ? "" : "s"} where players made progress`, mapFocus({ mapId: at.mapId, x: at.x, y: at.y, label: `“${title}” objective`, sub: what, kind: "objective-area", questId: selected, index: o.index, goal: { title: `Objective: ${title}`, questId: selected, steps: [what, "Players made progress around this spot; spread out nearby if it's busy.", ...(cr?.elite ? [`${cr.name || "This enemy"} is elite: much tougher than a normal enemy. Bring a group.`] : []), "Your quest log shows how many you still need."] } }), chips) : "";
    }).filter(Boolean);
    if (!giver && !turnIn && !objectiveTiles.length) return "";
    return `<section class="quest-section quest-where" aria-label="Where to go"><h3>Where to go</h3><div class="quest-where-row">
      ${npcTile("quest-where-pickup", "Pick up from", giver, giver && { title: `Pick up “${title}”`, questId: selected, steps: [`Find ${giver.name}; look for the yellow ! over their head.`, `Talk to them and accept “${title}”.`] })}
      ${objectiveTiles.join("") || tile("quest-where-objective", "Objectives", "Area not recorded yet", "Check the quest text in game", "")}
      ${npcTile("quest-where-handin", "Hand in to", turnIn, turnIn && { title: `Hand in “${title}”`, questId: selected, steps: [`Go back to ${turnIn.name}; a yellow ? shows when it's ready.`, `Talk to them and choose “${title}”.`, "Pick your reward and click Complete Quest."] })}
    </div></section>`;
  }
  // Rewards as cards: quality colour, counts, money as coins, experience, reputation and spells.
  const QUALITY = ["poor", "common", "uncommon", "rare", "epic", "legendary", "artifact", "heirloom"];
  function coins(copper) {
    const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
    return `<span class="quest-coins">${g ? `<span class="coin gold">${g}g</span>` : ""}${s ? `<span class="coin silver">${s}s</span>` : ""}${c || (!g && !s) ? `<span class="coin copper">${c}c</span>` : ""}</span>`;
  }
  const TIER = { 1: "a little", 2: "a little", 3: "some", 4: "good", 5: "big", 6: "big", 7: "huge" };
  function linksMarkup(links) {
    const row = (label, list) => list?.length ? `<div class="quest-link-row"><span>${label}</span>${list.slice(0, 4).map((q) => `<button type="button" class="quest-link" data-quest-open="${q.id}">${esc(q.title || `Quest #${q.id}`)}</button>`).join("")}</div>` : "";
    const html = row("Comes after", links?.previous) + row("Leads to", links?.next);
    return html ? `<section class="quest-section quest-links" aria-label="Quest chain">${html}</section>` : "";
  }
  function rewardsMarkup(rewards) {
    if (rewards && (rewards.items?.length || rewards.choices?.length || rewards.moneyCopper !== undefined || rewards.reputation?.length || rewards.xp || rewards.spells?.length)) {
      const pick = details?.rewardPick;
      const statLine = (d) => [
        d.damage ? `${d.damage.min}–${d.damage.max} damage${d.speed ? ` · ${d.speed.toFixed(2)} speed` : ""}${d.dps ? ` · ${d.dps.toFixed(1)} DPS` : ""}` : "",
        d.armor ? `${d.armor} armor` : "",
        ...(d.stats || []).map((s) => `${s.amount > 0 ? "+" : ""}${s.amount} ${s.stat}`),
      ].filter(Boolean);
      const card = (item) => {
        const d = item.details, q = d?.quality ?? item.quality, best = pick && pick.itemId === item.itemId;
        const name = d?.name || (item.name && !/^Item #/.test(item.name) ? item.name : `Unnamed item #${item.itemId}`);
        const kind = d ? [d.slot, d.kind, d.requiredLevel > 1 ? `requires level ${d.requiredLevel}` : ""].filter(Boolean).join(" · ") : "";
        const stats = d ? statLine(d) : [];
        return `<li class="reward-card q-${QUALITY[q] || "unknown"}${best ? " is-best" : ""}${d ? " has-details" : ""}"${Number.isSafeInteger(item.itemId) ? ` data-card-item="${item.itemId}"` : ""}>${d?.iconFileId && window.GameIcons ? `<span class="reward-icon">${GameIcons.tag(d.iconFileId, 40)}</span>` : `<span class="reward-gem" aria-hidden="true">◆</span>`}<span class="reward-body"><span class="reward-name">${esc(name)}</span>${kind ? `<span class="reward-kind">${esc(kind)}</span>` : ""}${stats.length ? `<span class="reward-stats">${stats.map((s) => `<span>${esc(s)}</span>`).join("")}</span>` : ""}${d?.bonding ? `<span class="reward-kind">${esc(d.bonding)}</span>` : ""}</span>${item.count > 1 ? `<span class="reward-count">×${item.count}</span>` : ""}${best ? `<span class="reward-best">${pick.upgrade ? "Best for you" : "Closest fit"}</span>` : ""}</li>`;
      };
      const pickBox = pick && rewards.choices?.length > 1 ? `<div class="reward-pick${pick.upgrade ? "" : " meh"}"><span class="reward-pick-eyebrow">${pick.upgrade ? "Best choice for you" : "No clear upgrade"}</span><strong>${esc(pick.name || "")}</strong><ul>${(pick.reasons || []).slice(0, 5).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>${pick.equipmentKnown ? "" : `<small>Compared without your saved gear; /reload in game once so the app can see what you wear.</small>`}</div>` : "";
      const lvl = profile?.level;
      const xpNow = rewards.xp?.atYourLevel?.xp;
      const observed = rewards.xp?.observed?.find((o) => o.level === lvl) || rewards.xp?.observed?.[0];
      const chips = [
        rewards.moneyCopper !== undefined ? `<li class="reward-chip">${coins(rewards.moneyCopper)}</li>` : "",
        xpNow ? `<li class="reward-chip xp">≈ ${xpNow.toLocaleString()} XP at level ${lvl}</li>` : observed ? `<li class="reward-chip xp">${observed.xp.toLocaleString()} XP seen at level ${observed.level}</li>` : "",
        ...(rewards.reputation || []).map((r) => `<li class="reward-chip rep">${r.amount ? `${r.amount > 0 ? "+" : ""}${r.amount} ` : TIER[r.tier] ? `${TIER[r.tier]} ` : ""}${esc(r.name || "faction")} reputation</li>`),
        ...(rewards.spells || []).map((sp) => `<li class="reward-chip spell">Teaches ${esc(sp.name || `spell #${sp.spellId}`)}</li>`),
      ].filter(Boolean).join("");
      return `<section class="quest-section quest-rewards-section"><h3>Rewards</h3>
        ${chips ? `<ul class="reward-chips">${chips}</ul>` : ""}
        ${rewards.items?.length ? `<h4>You receive</h4><ul class="reward-cards">${rewards.items.map(card).join("")}</ul>` : ""}
        ${rewards.choices?.length ? `<h4>Choose one</h4>${pickBox}<ul class="reward-cards">${rewards.choices.map(card).join("")}</ul>` : ""}
        <p class="section-note">From community observations; the game's quest window has the final say.</p></section>`;
    }
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
    return `<section class="quest-section"><h3>Rewards</h3><p class="section-note">Historical listed rewards, not earned loot. Check the current quest window.</p>${rewards.items?.length ? `<h4>Observed guaranteed items</h4>${items(rewards.items)}` : ""}${rewards.choices?.length ? `<h4>Observed choices · choose one</h4>${items(rewards.choices)}` : ""}${copper !== undefined ? `<p class="quest-money">Listed money: ${Math.floor(copper / 10000)}g ${Math.floor((copper % 10000) / 100)}s ${copper % 100}c</p><p class="section-note">Listed source amount; your scaled payout may differ.</p>` : ""}</section>`;
  }
  function npcsMarkup(label, list) {
    return list?.length
      ? `<section class="quest-section"><h3>${label}</h3>${list.map((npc) => `<div class="quest-npc"><strong>${esc(npc.name)} <small>${npc.kind === "object" ? "Object" : "NPC"} #${npc.id}</small></strong><p>${npc.positions?.length ? esc(npc.positions.map(point).join(" · ")) : "Position not observed"}</p><small>${esc(sourceFiles(npc.sources))} · ${esc(safeDate(npc.lastSeen))} · Approximate interaction position</small></div>`).join("")}</section>`
      : "";
  }
  function sourceMarkup(d, active) {
    return `<details class="quest-source"><summary data-quest-control="source:${selected}" data-interaction-key="${esc(JSON.stringify([profile?.id??null,selected,"quest-source"]))}">Sources & what remains unknown</summary>${d.provenance ? `<p>${esc(d.provenance.attribution || "Efficient Games · CC BY 4.0")}</p><p>Build ${esc(d.provenance.build)} · Observed through ${esc(safeDate(d.provenance.observedThrough))}</p><p class="source-url">${esc(d.provenance.url)}</p><p>Source commit <code>${esc(d.provenance.sourceCommit)}</code></p>` : ""}<p>${esc(status?.coverage || "Public observation coverage is partial.")}</p>${d.record?.sources !== undefined ? `<p>Quest cache: ${esc(sourceFiles(d.record.sources))}.</p>` : ""}<p>Counts describe contributor files, not universal verification. Approximate interaction positions are not guaranteed spawns or routes.</p>${!active && d.record && !d.record.observedInPlay ? "<p>Availability has not been observed in play for this cache-only record.</p>" : ""}${(
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
  function paintResults(){paintRegion(".quest-results",resultsMarkup,"results");}
  function paintDetail(){
    paintRegion(".quest-detail-host",detailMarkup,"detail");
    root.querySelectorAll(".quest-ledger-row").forEach(node=>{const current=Number(node.dataset.questId)===selected;node.classList.toggle("selected",current);node.setAttribute("aria-pressed",String(current));});
  }
  function paintStatus(){paintRegion("[data-knowledge-status]",statusMarkup,"status");}
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
    if(selected!==id)copyError="";
    selected = id;
    opening=true;detailError="";
    details = null;
    paintDetail();
    try {
      const result = await api.questDetails(pid, id);
      if (request !== detailRequest || epoch !== generation) return;
      opening=false;details = result;
      paintDetail();

    } catch {
      if (request === detailRequest && epoch === generation) {
        opening=false;detailError="Quest evidence could not be opened. Your saved quest log is safe. Try again.";
        paintDetail();
      }
    }
  }
  async function copy(id, descriptor) {
    if (copying || id !== selected || !descriptor?.canCopy || descriptor.generation!==generation) return;
    copying=true;copyError="";root.querySelectorAll("[data-quest-copy]").forEach(n=>n.disabled=true);
    const epoch = generation;
    try {
      const result = await api.copyQuestWaypoint(
        profile.id,
        id,
        descriptor.phase,
      );
      if (epoch === generation && id===selected) {copyError="";notify(result.message);paintDetail();}
    } catch (error) {
      if (epoch !== generation || id!==selected) return;
      copyError="The saved quest changed or its marker is unavailable. Refresh your snapshot and try again.";
      notify(
        "The saved quest changed or its marker is unavailable. Refresh your snapshot and try again.",
        true,
      );
      open(id);
    }finally{if(epoch===generation){copying=false;paintDetail();}}
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
    ]
      .filter(Boolean)
      .join(" · ");
    return `<div class="context-preview"><span class="eyebrow">EXACT PUBLIC CONTEXT · REVIEW BEFORE SENDING</span><strong>Public character context:</strong><p class="context-selection">Selected character: ${esc(selectedLabel || "No character")} · Last saved location: ${esc(profile?.location?.zone || "Not received")} · Selection stays visible locally when sharing is off.</p><div data-context-body>Opening the public context preview…</div><small>Private notes, goals, full completion history, account identifiers and local paths stay here. Saved exchanges are included only when you select them separately in Memory.</small></div>`;
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
  function invalidateContext() {
    contextRequest++;
    clearTimeout(contextTimer);
    contextKey = "";
    contextResolvedKey = "";
    contextValue = null;
    paintContext(null, "Opening the public context preview…");
  }
  async function updateContext(force = false) {
    if (!root.querySelector("[data-context-body]")) return;
    const prompt =
      root.querySelector('#chat-form [name="prompt"]')?.value || "";
    const share = root.querySelector("#share-profile")?.checked === true;
    const memoryIds=selectedMemoryIds();
    const key = JSON.stringify([signature, share, prompt, memoryIds]);
    if(force)contextKey="";
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
      await ready();
      if(request!==contextRequest||epoch!==generation)return;
      const result = await api.contextPreview(
        profile?.id || null,
        share,
        prompt,
        memoryIds,
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
    if(active()){const n=root.querySelector("#active-character");if(n)n.dataset.questControl="active-character";restore();}
    if (root.querySelector(".quest-guide") && !loaded && !loading) search();
    if(active()&&selected&&!details&&!opening&&!detailError)open(selected);
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
    invalidateContext,
    open, beginRender,endRender,deferRender:callback=>guard?.defer(callback,"root")||false,
  };
})();
