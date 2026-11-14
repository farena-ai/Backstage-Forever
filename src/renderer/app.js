"use strict";
const api = window.backstage;
const root = document.getElementById("app");
const classes = [
  "Hunter",
  "Warrior",
  "Paladin",
  "Rogue",
  "Priest",
  "Shaman",
  "Mage",
  "Warlock",
  "Druid",
  "Other",
];
let stateMutationEpoch = 0,
  stateMutationBusy = 0;
let knowledgeStatus = null, questStatusRequest=0, questNavigationRequest=0;
let gameStatus = {},
  modelCatalogs = {},
  modelEpoch = 0,
  modelsLoading = false;
let questionRevision=0;
let chatScrollTop=0, lastPaintedMessage=null;
let currentQuestion = null, questionRecovery = null;
let shareCharacter = true;
try {
  shareCharacter = localStorage.getItem("bf-share-character") !== "false";
} catch {}
let setupChoice = "";
try {
  setupChoice = localStorage.getItem("bf-setup-v4") || "";
} catch {}
let setupOpen = !["complete", "manual", "deferred"].includes(setupChoice),
  setupBusy = false;
let setupCandidates = null, setupGeneration = 0, launchBusy = false;
let livingDisclosureOwner = "", livingDisclosureGeneration = 0;
let adventureBrief = null,
  briefProfileId = null,
  briefEpoch = 0;
let guidance = null, guidanceProfileId = null, guidanceSignature = "", guidanceContextSignature = "", guidanceEpoch = 0;
function paintGuidance() {
  if (Director.deferPaint(paintGuidance)) return;
  const region = root.querySelector('[aria-label="Your next steps"]');
  if (page !== "adventure" || !region) return;
  const focusedOption = document.activeElement?.dataset.planOption;
  region.outerHTML = CommandCenter.steps(guidance, CommandCenter.options(state.activeProfileId), esc);
  Director.paint();
  if (focusedOption) root.querySelector(`[data-plan-option="${focusedOption}"]`)?.focus();
}
function syncGuidance() {
  const selectedId = state?.activeProfileId;
  if (guidanceProfileId !== selectedId) Director.invalidate();
  const selected = CommandCenter.options(selectedId);
  const brief = briefProfileId === selectedId ? adventureBrief : null;
  const selectedProfile = profile();
  const context = JSON.stringify([selectedId, selected, selectedProfile?.source?.kind, selectedProfile?.source?.id, selectedProfile?.clientBuild]);
  const signature = JSON.stringify([context, brief?.guidance]);
  if (signature === guidanceSignature) return;
  guidanceSignature = signature;
  const epoch = ++guidanceEpoch;
  // Keep the dated current plan readable during an ordinary same-context refresh.
  if (context !== guidanceContextSignature || !brief) guidance = null;
  guidanceContextSignature = context;
  guidanceProfileId = selectedId;
  if (!selectedId || !brief) return;
  if (selected.minutes === 30 && selected.focus === "balanced" && brief.guidance) {
    guidance = { ...brief.guidance, director: brief.director };
    return;
  }
  if (!api.guidancePlan) return;
  api.guidancePlan(selectedId, selected).then(result => {
    if (epoch !== guidanceEpoch || selectedId !== state?.activeProfileId) return;
    guidance = result;
    paintGuidance();
  }).catch(() => {
    if (epoch !== guidanceEpoch || selectedId !== state?.activeProfileId) return;
    guidance = { status: "unavailable", headline: "Quest guidance could not be opened.", steps: [], counts: {}, limitations: ["Try refreshing the saved snapshot in Game Connection."] };
    paintGuidance();
  });
}
function chooseSetup(choice) {
  setupChoice = choice;
  try {
    if (choice) localStorage.setItem("bf-setup-v4", choice);
    else localStorage.removeItem("bf-setup-v4");
  } catch {}
}
function acceptBrief(result) {
  if (result?.knowledgeStatus) { if(JSON.stringify(knowledgeStatus)!==JSON.stringify(result.knowledgeStatus))questStatusRequest++;knowledgeStatus = result.knowledgeStatus; }
  if (result && Object.hasOwn(result, "brief")) {
    briefEpoch++;
    adventureBrief = result.brief;
    briefProfileId =
      result.briefProfileId ?? result.state?.activeProfileId ?? null;
    syncGuidance();
  }
}
async function refreshBrief() {
  const selectedId = state?.activeProfileId,
    epoch = ++briefEpoch,
    mutation = stateMutationEpoch;
  adventureBrief = null;
  briefProfileId = null;
  guidance = null;
  guidanceProfileId = selectedId;
  guidanceSignature = "";
  guidanceContextSignature = "";
  guidanceEpoch++;
  if (!api.adventureBrief || !selectedId) return;
  const [brief, referenceStatus] = await Promise.all([api.adventureBrief(selectedId), api.knowledgeStatus()]);
  if (
    epoch !== briefEpoch ||
    mutation !== stateMutationEpoch ||
    selectedId !== state?.activeProfileId
  )
    return;
  adventureBrief = brief;
  knowledgeStatus = referenceStatus;
  briefProfileId = selectedId;
  syncGuidance();
}
// Drafts live only in renderer memory; credentials never enter browser storage.
const formDrafts = new Map();
let autosaveQueue = Promise.resolve(),
  autosaveGeneration = 0;
function draftKey(form) {
  return `${form.id}:${state?.activeProfileId || ""}:${connection}:${authChoice}`;
}
function rememberDrafts() {
  root.querySelectorAll("form[data-draft-key]").forEach((form) => {
    if (form.closest("[data-company]")) return;
    const fields = [...form.elements].filter(
      (e) => e.name && !e.disabled && !e.readOnly,
    );
    if (
      fields.some((e) =>
        e.tagName === "SELECT"
          ? e.selectedIndex !==
            Math.max(
              0,
              [...e.options].findLastIndex((o) => o.defaultSelected),
            )
          : e.value !== e.defaultValue,
      )
    )
      formDrafts.set(
        form.dataset.draftKey,
        Object.fromEntries(fields.map((e) => [e.name, e.value])),
      );
  });
}
function restoreDrafts() {
  root.querySelectorAll("form").forEach((form) => {
    if (form.closest("[data-company]")) return;
    const key = draftKey(form);
    form.dataset.draftKey = key;
    const draft = formDrafts.get(key);
    if (draft)
      for (const [name, value] of Object.entries(draft)) {
        const field = form.elements.namedItem(name);
        if (field) field.value = value;
      }
  });
}
function savedFields(form, values) {
  formDrafts.delete(form.dataset.draftKey);
  if (!form.isConnected) return;
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (field && field.value === value) {
      field.defaultValue = value;
      if (field.tagName === "SELECT")
        [...field.options].forEach((o) => (o.defaultSelected = o.selected));
    }
  }
  formDrafts.delete(form.dataset.draftKey);
}
function saveStatus(message, error = false) {
  let node = document.getElementById("autosave-status");
  if (!node) {
    node = document.createElement("p");
    node.id = "autosave-status";
    node.setAttribute("role", "status");
    root.querySelector(".content, .onboarding-form")?.prepend(node);
  }
  node.textContent = message;
  node.className = error ? "error" : "corner-note";
}
function autosaveForm(form) {
  if (!["character-form", "provider-form"].includes(form?.id)) return;
  if (!form.checkValidity()) {
    saveStatus("Complete the required fields to save this edit.", true);
    return;
  }
  const values = Object.fromEntries(new FormData(form)),
    selectedId = form.dataset.profileId || null;
  const selectedProvider = connection,
    selectedAuth = authChoice,
    generation = autosaveGeneration;
  const imported =
    state.profiles.find((p) => p.id === selectedId)?.source?.kind ===
    "wow-addon";
  const task = async () => {
    if (generation !== autosaveGeneration) return;
    saveStatus("Saving…");
    try {
      if (form.id === "character-form") {
        const original = state.profiles.find((p) => p.id === selectedId);
        if (!original) return;
        const next = structuredClone(state),
          target = next.profiles.find((p) => p.id === selectedId);
        target.notes = String(values.notes || "");
        if (!imported) {
          if (!String(values.name || "").trim()) return;
          for (const name of ["name", "realm", "className", "race", "faction"])
            target[name] = String(values[name] || "").trim();
          target.level = Number(values.level);
        }
        await persist(next);
      } else {
        const input = {
          provider: selectedProvider,
          authMode: ["ollama", "ollama-cloud"].includes(selectedProvider)
            ? "api"
            : selectedAuth,
          model: String(values.manualModel || values.model || "").trim(),
          endpoint:
            selectedProvider === "ollama"
              ? String(values.endpoint || "").trim()
              : metadata.find((p) => p.id === selectedProvider)?.endpoint,
        };
        if (values.apiKey?.trim()) input.apiKey = values.apiKey.trim();
        const refreshCatalog =
          Boolean(input.apiKey) ||
          input.endpoint !== state.provider.endpoint ||
          input.provider !== state.provider.id ||
          input.authMode !== state.provider.authMode;
        retireCompanion();
        const result = await mutateStateCall(() => api.saveProvider(input));
        if (generation !== autosaveGeneration) return;
        state = result.state;
        keys = result.secretStatus;
        if (
          input.apiKey &&
          form.isConnected &&
          form.elements.namedItem("apiKey")?.value === values.apiKey
        ) {
          form.elements.namedItem("apiKey").value = "";
          values.apiKey = "";
          form.elements.namedItem("apiKey").placeholder =
            "Key saved securely — leave blank to keep it";
        }
        if (refreshCatalog && connection === selectedProvider)
          fetchModels(true).catch(() => {});
      }
      if (generation === autosaveGeneration) {
        savedFields(form, values);
        saveStatus("Saved automatically.");
      }
    } catch (error) {
      if (generation === autosaveGeneration) {
        saveStatus(
          "Could not save. Your edit is still here; change the field or use Save to retry.",
          true,
        );
        toast(error.message, true);
      }
    }
  };
  autosaveQueue = autosaveQueue.then(task, task);
  return autosaveQueue;
}
function setupReady() {
  return LivingSetup.prepared(gameStatus);
}
function setupChecks() {
  return (gameStatus.checks || []).map(c => `<div class="setup-check" data-state="${esc(c.state)}"><span aria-hidden="true">${c.state === "done" ? "✓" : "◇"}</span><div><strong>${esc(c.label)}</strong><p>${esc(c.detail)}</p></div></div>`).join("");
}
function setupJourney() {
  return LivingSetup.journey({ status: gameStatus, candidates: setupCandidates, busy: setupBusy, brand, checks: setupChecks, esc });
}
function setupDock() {
  if (setupReady() || (setupChoice === "manual" && !LivingSetup.unavailable(gameStatus))) return "";
  return `<div class="companion-dock"><span class="companion-gem" aria-hidden="true">✧</span><span><strong>${LivingSetup.unavailable(gameStatus) ? "Your game folder is unavailable." : "Connect WoW Forever to fill these pages."}</strong><br>${LivingSetup.unavailable(gameStatus) ? "Reconnect its folder. Your saved characters and private journals are preserved." : "One setup finds the game, installs the addon and turns on the live link."}</span><button data-command="setup-open">Companion setup</button></div>`;
}
const savedHelp = "Live guidance runs inside WoW. The desktop journal catches up after the game saves on logout.";
function closeSetup(choice) {
  setupGeneration++;
  setupBusy = false;
  setupCandidates = null;
  setupOpen = false;
  chooseSetup(choice);
}
async function enterPrepared(generation) {
  if (generation !== setupGeneration || !setupOpen || !setupReady()) return;
  if (!state.onboarded) {
    const next = await mutateStateCall(() => api.saveState({ ...state, onboarded: true }, state));
    if (generation !== setupGeneration || !setupOpen || !setupReady()) return;
    state = next;
    await refreshBrief();
    if (generation !== setupGeneration || !setupOpen || !setupReady()) return;
  }
  closeSetup("complete");
  page = "now";
  render();
}
async function prepareCompanion(fn) {
  if (setupBusy) return;
  const generation = ++setupGeneration;
  setupBusy = true;
  render();
  try {
    const result = await mutateStateCall(fn);
    if (generation !== setupGeneration || !setupOpen) return;
    setupCandidates = Object.hasOwn(result, "setupCandidates") ? result.setupCandidates : null;
    await applyGame(result);
    await enterPrepared(generation);
  } finally {
    if (generation === setupGeneration) { setupBusy = false; render(); }
  }
}
async function planWithoutCharacter() {
  if (setupBusy) return;
  const generation = ++setupGeneration;
  setupBusy = true;
  render();
  try {
    if (!state.onboarded) {
      const epoch = stateMutationEpoch;
      const next = await mutateStateCall(() => api.saveState({ ...state, onboarded: true }, state));
      if (generation !== setupGeneration || stateMutationEpoch !== epoch + 2) return;
      state = next;
    }
    if (generation !== setupGeneration) return;
    closeSetup("deferred");
    page = "company";
    render();
  } finally {
    if (generation === setupGeneration) { setupBusy = false; render(); }
  }
}
let state,
  metadata = [],
  keys = {},
  version = "",
  page = "now",
  connection = "ollama",
  messages = [],
  sending = false,
  chatStarting = false,
  subscriptions = {},
  authChoice = "api",
  authPending = false,
  updateInfo = {
    phase: "unsupported",
    automatic: true,
    installOnQuit: true,
    progress: 0,
  },
  updateSaving = false,
  updatePendingPrefs = null,
  updateEpoch = 0,
  chatGeneration = 0,
  toastTimer;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const profile = () =>
  state.profiles.find((item) => item.id === state.activeProfileId);
const id = () => crypto.randomUUID();
const brand = () =>
  '<div class="brand"><img src="../../assets/crest.svg" alt=""><div><strong>Backstage<br>Forever</strong><div class="eyebrow">Backstage Coding</div></div></div>';
function toast(message, error = false) {
  const element = document.getElementById("toast");
  element.textContent = message;
  element.className = `visible${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (element.className = ""), 6500);
}
async function action(fn) {
  try {
    await fn();
  } catch (error) {
    toast(
      error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      ),
      true,
    );
  }
}
async function mutateStateCall(fn) {
  pendingSnapshot = null;
  QuestGuide.invalidate();
  stateMutationEpoch++;
  stateMutationBusy++;
  try {
    return await fn();
  } finally {
    stateMutationBusy--;
    stateMutationEpoch++;
  }
}
async function persist(next) {
  state = await mutateStateCall(() => api.saveState(next, state));
  await refreshBrief();
}
function editedState(edit) {
  const next = structuredClone(state);
  edit(next);
  return next;
}
function isEditing() {
  if (document.activeElement?.matches("input,textarea,select:not([data-plan-option])")) return true;
  return [
    ...document.querySelectorAll("form input,form textarea,form select"),
  ].some((el) => {
    if (el.tagName === "SELECT") {
      const original = [...el.options].findLastIndex(
        (option) => option.defaultSelected,
      );
      return el.selectedIndex !== Math.max(0, original);
    }
    return el.value !== el.defaultValue;
  });
}
function refreshGameStatusWidget(status = gameStatus) {
  const chip = root.querySelector(".game-status-chip");
  if (!chip) return;
  const unavailable = LivingSetup.unavailable(status);
  chip.dataset.connectionState = unavailable ? "unavailable" : status.connected ? "connected" : "disconnected";
  const label = chip.querySelector("[data-game-connection-label]");
  if (label) label.textContent = unavailable ? "Game folder unavailable" : status.connected ? LivingSetup.prepared(status) ? "Compass prepared" : "Game connected" : "Connect game";
}
function companyChromeSignature(saved, status) {
  const selected = saved.profiles.find(p => p.id === saved.activeProfileId);
  return JSON.stringify([
    saved.activeProfileId,
    saved.profiles.map(p => [p.id, p.name, p.level]),
    selected?.className, selected?.faction, selected?.source?.kind, selected?.source?.updatedAt,
    LivingSetup.signature(status),
  ]);
}
function options(values, selected) {
  return values
    .map(
      (value) =>
        `<option${value === selected ? " selected" : ""}>${esc(value)}</option>`,
    )
    .join("");
}
function characterFields(p = {}) {
  const imported = p.source?.kind === "wow-addon";
  const lock = imported ? "readonly" : "";
  return `<div class="form-grid"><label>Character name<input name="name" maxlength="100" value="${esc(p.name)}" required autocomplete="off" ${lock}></label><label>Realm<input name="realm" maxlength="100" value="${esc(p.realm)}" autocomplete="off" placeholder="Your home realm" ${lock}></label><label>Class<select name="className" ${imported ? "disabled" : ""}>${options(classes.includes(p.className) ? classes : [...classes, p.className].filter(Boolean), p.className || "Hunter")}</select></label><label>Level<input name="level" type="number" min="1" max="60" value="${esc(p.level || 1)}" required ${lock}></label><label>Faction<select name="faction" ${imported ? "disabled" : ""}><option value="">Not set</option>${options([...new Set(["Alliance", "Horde", p.faction].filter(Boolean))], p.faction)}</select></label><label>Race<input name="race" maxlength="100" value="${esc(p.race)}" ${lock} placeholder="Optional"></label></div>${imported ? '<p class="corner-note">Character details come from your saved game snapshot. Notes and goals remain editable.</p>' : ""}`;
}
function onboarding() {
  root.innerHTML = `<main class="onboarding"><section class="onboarding-art">${brand()}<div><div class="eyebrow">Your world. Your adventure.</div><h1>A companion for<br>the road ahead.</h1><p>Your next quest, your trainer and your map,<br>right beside the game.</p></div><small>DESIGNED BY FRANK ARENA</small></section><section class="onboarding-form"><div class="eyebrow">Welcome, adventurer · 01 / 01</div><h2>Every adventure starts somewhere.</h2><p>Start with a character, then connect your game to import saved character snapshots. Your journal stays on this computer.</p><form id="onboard">${characterFields()}<div class="actions"><button class="primary" type="submit">Begin my adventure</button></div></form><div class="callout">◈ &nbsp; No account. No subscription required for the app.<br>Profiles and planning work offline. AI is optional and uses your own provider access.</div><p class="snapshot-hint">${savedHelp}</p><button type="button" class="subtle" data-command="setup-company" ${setupBusy ? "disabled" : ""}>Plan without a character</button><p class="onboarding-footer">Independent companion for World of Warcraft: Forever.<br>Not affiliated with or endorsed by Blizzard Entertainment.</p></section></main>`;
}
function render() {
  syncCompanion();
  Support.sync();
  Recovery.sync();
  if (Recovery.deferRender(render)) return;
  if (Support.deferRender(render)) return;
  if (Voice.deferRender(render) || Memory.deferRender(render)) return;
  if (AdventureCoach.deferRender(render) || CharacterGuidance.deferRender(render) || QuestGuide.deferRender(render) || Company.deferRender(render) || Director.deferRender(render) || Preparation.deferRender(render) || Party.deferRender(render)) return;
  // Snapshot the executed paint, after native interaction guards have released.
  // Disclosure choices belong only to this screen, character and setup lifecycle.
  const disclosureOwner = JSON.stringify([page, setupOpen, setupGeneration, autosaveGeneration,
    state?.onboarded, state?.activeProfileId, Boolean(gameStatus.connected), livingDisclosureGeneration]);
  const disclosures = livingDisclosureOwner === disclosureOwner
    ? new Map([...root.querySelectorAll("details[data-living-disclosure]")].map(node => [node.dataset.livingDisclosure, node.open]))
    : new Map();
  const focusedSummary = livingDisclosureOwner === disclosureOwner && document.activeElement?.tagName === "SUMMARY"
    ? document.activeElement.closest("details[data-living-disclosure]")?.dataset.livingDisclosure : null;
  livingDisclosureOwner = disclosureOwner;
  const focusedOption = document.activeElement?.dataset.planOption;
  // A background repaint must not steal keyboard focus from shell controls (character picker, skip link, main).
  const focusedShell = document.activeElement && document.activeElement !== document.body
    ? (document.activeElement.id ? `#${CSS.escape(document.activeElement.id)}` : document.activeElement.dataset?.shellControl ? `[data-shell-control="${CSS.escape(document.activeElement.dataset.shellControl)}"]` : null) : null;
  CharacterGuidance.beginRender();
  QuestGuide.beginRender();
  Company.beginRender();
  Preparation.beginRender();
  Party.beginRender();
  AdventureCoach.beginRender();
  Director.beginRender();
  try {
  QuestGuide.sync(profile(), knowledgeStatus);
  syncGuidance();
  AdventureCoach.sync();
  rememberDrafts();
  PlayerNavigation.remember(root);
  const previousChat=document.getElementById("chatlog");
  if(previousChat)chatScrollTop=previousChat.scrollTop;
  const selected = profile();
  document.body.dataset.page = page;
  document.body.dataset.class = classKey(selected?.className);
  document.body.dataset.faction = ["Alliance", "Horde"].includes(
    selected?.faction,
  )
    ? selected.faction.toLowerCase()
    : "neutral";
  document.body.classList.toggle("setup-mode", setupOpen);
  if (setupOpen) {
    root.innerHTML = setupJourney();
    return;
  }
  if (!state.onboarded) {
    onboarding();
    root.insertAdjacentHTML("beforeend", setupDock());
    restoreDrafts();
    return;
  }
  const current = PlayerNavigation.current(page);
  root.innerHTML = `<button type="button" class="skip-content" data-shell-control="skip-content" data-action="skip-content">Skip to content</button><div class="shell"><aside class="rail">${brand()}${PlayerNavigation.main(page)}<div class="rail-bottom">${PlayerNavigation.secondary(page)}<div class="status"><i class="dot"></i>Local journal · private</div><small>BACKSTAGE CODING<br>Designed by Frank Arena<br>v${esc(version)} · Desktop preview</small></div></aside><main class="main" id="main-content" tabindex="-1" aria-labelledby="page-heading"><header class="topbar"><div class="breadcrumb"><span>Your field journal</span><span>/</span><span id="page-heading" role="heading" aria-level="1">${current.label}${current.label !== current.pageLabel ? " / " + current.pageLabel : ""}</span></div><button data-shell-control="connection-status" class="game-status-chip" data-nav="game" aria-label="Review Game Connection"><i class="dot" aria-hidden="true"></i><span><span data-game-connection-label>${LivingSetup.unavailable(gameStatus) ? "Game folder unavailable" : gameStatus.connected ? setupReady() ? "Compass prepared" : "Game connected" : "Connect game"}</span><small>${esc(profile() ? "Desktop · " + CommandCenter.age(profile()) : "Desktop · no saved character")}</small></span></button><label><span class="sr-only">Active character</span><select data-shell-control="active-character" id="active-character" aria-label="Active character">${state.profiles.length ? state.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === state.activeProfileId ? "selected" : ""}>${esc(p.name)} · Level ${p.level}</option>`).join("") : "<option>No characters yet</option>"}</select></label></header><div class="content${["game", "connections", "updates", "assistant"].includes(page) ? " bf-parchment" : ""}">${PlayerNavigation.subtabs(page)}${setupDock()}${{ now: NowView.page, adventure: adventure, company: Company.page, party: Party.page, preparation: Preparation.page, "world-map": WorldMapView.page, dungeons: DungeonAtlas.page, "quest-guide": QuestGuide.page, characters: characters, assistant: assistant, connections: connections, game: gameConnection, guide: guide, commands: CommandsView.page, coverage: CoverageView.page, talents: TalentsView.page, journey: JourneyView.page, updates: updatesPage }[page]()}</div></main></div>`;
  PlayerNavigation.mounted(root);
  refreshGameStatusWidget();
  restoreDrafts();
  if (page === "assistant") {
    const chat=document.getElementById("chatlog"), newest=messages.at(-1);
    CompanionTravel.mounted(chat,messages);
    window.FreeAI?.mounted(state.provider.id);
    if(newest!==lastPaintedMessage){
      const message=chat.lastElementChild;
      chat.scrollTop=message ? message.getBoundingClientRect().top-chat.getBoundingClientRect().top : 0;
    } else chat.scrollTop=chatScrollTop;
    lastPaintedMessage=newest;
    chatScrollTop=chat.scrollTop;
  }
  // Actions keep the character shown when rendered, even if an autosave later
  // receives a newer active-character selection from the game watcher.
  root
    .querySelectorAll(
      '#character-form,#goal-form,#chat-form,[data-goal],[data-remove-goal],[data-command="delete-character"]',
    )
    .forEach((node) => {
      node.dataset.profileId = selected?.id || "";
    });
  refreshUpdateWidgets();
  QuestGuide.mounted();
  Company.mounted();
  CharacterGuidance.mounted();
  WorldMapView.mounted();
  NowView.mounted();
  CommandsView.mounted();
  CoverageView.mounted();
  TalentsView.mounted();
  JourneyView.mounted();
  DungeonAtlas.mounted();
  Preparation.mounted();
  Party.mounted();
  Director.mounted();
  AdventureCoach.mounted();
  Voice.mounted();
  Memory.mounted();
  Recovery.paint();
  if (focusedOption) root.querySelector(`[data-plan-option="${focusedOption}"]`)?.focus();
  } finally {
    for (const node of root.querySelectorAll("details[data-living-disclosure]")) {
      if (disclosures.has(node.dataset.livingDisclosure)) node.open = disclosures.get(node.dataset.livingDisclosure);
      if (node.dataset.livingDisclosure === focusedSummary && document.activeElement === document.body)
        node.querySelector(":scope > summary")?.focus({preventScroll:true});
    }
    if (focusedShell && (!document.activeElement || document.activeElement === document.body)) root.querySelector(focusedShell)?.focus({ preventScroll: true });
    CharacterGuidance.endRender();
    QuestGuide.endRender();
    Company.endRender();
    Preparation.endRender();
  Party.endRender();
    Director.endRender();
    AdventureCoach.endRender();
  }
}
function classKey(className) {
  return String(className || "other")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}
// One painted set of class crests everywhere (art/classes); other classes keep the wolf medallion.
function portrait(className) {
  return PageHero.classCrest(className) || "../../assets/wolf-medallion.png";
}
function sigil(className) {
  return (
    {
      Hunter: "➶",
      Warrior: "⚔",
      Paladin: "✠",
      Rogue: "⚒",
      Priest: "✧",
      Shaman: "ϟ",
      Mage: "❄",
      Warlock: "☽",
      Druid: "❧",
      "Death Knight": "☠",
      "Demon Hunter": "◭",
      Monk: "☯",
      Evoker: "♜",
    }[className] || "◈"
  );
}
function snapshotLabel(p) {
  const timestamp = p?.source?.updatedAt;
  if (!timestamp) return "Manual character · no saved game snapshot";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000),
  );
  return `Saved snapshot · ${Number.isFinite(minutes) ? (minutes < 1 ? "less than a minute ago" : minutes < 60 ? minutes + " min ago" : Math.floor(minutes / 60) + " hr ago") : "time unavailable"} · ${timestamp}`;
}
// Three painted doors out of Adventure; each opens the page its title names.
function situationCards() {
  const p = profile(), loc = p?.location || {};
  const mapId = Number.isSafeInteger(loc.mapId) ? loc.mapId : window.ZoneArt?.idFor(loc.zone);
  const biome = mapId ? window.ZoneArt?.biome(mapId) : null;
  const craft = p?.workshop?.professions?.items?.find((x) => x?.name);
  const lvl = Number(p?.level) || 1;
  const zone = loc.zone ? `<button class="illustrated-card expedition-card${biome ? ` zone-${esc(biome)}` : ""}" data-task="session" data-map-zone="${esc(mapId || loc.zone)}"><span class="eyebrow">EXPLORE · SAVED LOCATION</span><strong>${esc(loc.zone)}</strong><span>${loc.subZone ? esc(loc.subZone) + " · " : ""}Open it on the World Map →</span></button>`
    : `<button class="illustrated-card expedition-card" data-task="session" data-nav="world-map"><span class="eyebrow">EXPLORE · WORLD MAP</span><strong>The road ahead</strong><span>Quest givers, trainers, flight masters and herbs on the map →</span></button>`;
  return `<section class="situation-cards" aria-label="Explore more"><button class="illustrated-card dungeon-card" data-task="dungeon" data-nav="dungeons"><span class="eyebrow">DUNGEONS & RAIDS</span><strong>Beyond the dungeon gate</strong><span>Dungeons around level ${lvl}, their bosses and loot →</span></button><button class="illustrated-card forge-card" data-task="profession" data-nav="preparation"><span class="eyebrow">PROFESSIONS</span><strong>${craft ? esc(craft.name) + (Number.isFinite(craft.rank) ? ` <small>${esc(craft.rank)}${Number.isFinite(craft.maxRank) ? " / " + esc(craft.maxRank) : ""}</small>` : "") : "Learn a profession"}</strong><span>${craft ? "Your next craft, skill-ups and shopping list" : "Pick two, find a trainer and plan your first crafts"} →</span></button>${zone}</section>`;
}
// The in-game helpers and how to switch each one (they live in the addon; the app can only explain).
function inGameHelpers() {
  const rows = [
    ["Pop-up tips", "Level-ups, finished quests, deaths, repairs and nearby flight masters.", "/bf toasts"],
    ["Danger warnings", "Plain words above risky targets: elites, skulls, much higher levels.", "/bf danger"],
    ["Sell junk button", "On vendor windows; sells grey items only when you click it.", "/bf junk"],
    ["Live strip", "The tiny line in a corner of the game (top-left unless you move it with /bf live pos) that lets this app follow you.", "/bf live"],
    ["Adventure Compass", "The small next-step panel.", "/bf"],
  ];
  return `<section class="panel ingame-helpers"><h2>In-game helpers</h2><p>These run inside WoW. Type the command in chat to switch one on or off; add <code>on</code> or <code>off</code> to be explicit.</p><ul>${rows.map(([n, d, c]) => `<li><strong>${esc(n)}</strong><span>${esc(d)}</span><code>${esc(c)}</code></li>`).join("")}</ul><button type="button" class="subtle" data-nav="commands">All commands →</button></section>`;
}
function gameConnection() {
  return `${PageHero.render({ art: "settings", compact: true, eyebrow: "Settings · Game connection", title: "Connect WoW Forever", subtitle: gameStatus.connected ? (gameStatus.addonCurrent ? "Connected · addon up to date" : "Connected · addon needs an update") : "Not connected yet: find your game folder below." })}<section class="panel"><h2>${setupReady() ? "Companion files prepared" : "Game connection"}</h2><p class="setup-status">${esc(gameStatus.companionMessage || gameStatus.message || "Choose your game folder to begin.")}</p><div class="actions">${LivingSetup.unavailable(gameStatus) ? '<button class="primary" data-command="game-connect">Choose game folder</button>' : ""}<button class="${LivingSetup.unavailable(gameStatus) ? "subtle" : "primary"}" data-command="setup-open">Set up my companion</button></div>${LivingSetup.activation(gameStatus, esc)}${LivingSetup.coverage(gameStatus, esc)}<hr class="rule"><h3>Desktop saved characters</h3><label class="check-label"><input type="checkbox" id="follow-game-character" ${state.followGameCharacter !== false ? "checked" : ""}>Follow my last played character</label><p>After the game saves, follow the last played character in this desktop journal. Pausing keeps your manual selection; live guidance in WoW keeps working.</p><p>${esc(profile() ? snapshotLabel(profile()) : "Desktop · no saved character yet")}</p><p>${savedHelp}</p><details data-living-disclosure="connection-checks"><summary>Connection checks and tools</summary>${setupChecks()}<div class="actions"><button data-command="game-discover">Find my game</button><button data-command="game-connect">Choose game folder</button>${gameStatus.connected ? '<button data-command="game-install">Repair companion addon</button><button data-command="game-refresh">Refresh saved snapshot</button><button data-command="game-disconnect">Disconnect game</button>' : ""}</div><p>Refresh reads existing saved files. It does not request a save or interrupt your game.</p></details>${window.LiveLink ? LiveLink.markup() : ""}${window.MomentsView ? MomentsView.settingsMarkup() : ""}</section>${inGameHelpers()}`;
}
async function mutateGame(fn) {
  const generation = setupGeneration;
  const result = await mutateStateCall(fn);
  if (generation === setupGeneration) await applyGame(result);
}
async function applyGame(result) {
  if (!result) return;
  stateMutationEpoch++;
  if (result.state) state = result.state;
  gameStatus = result.gameStatus || result;
  acceptBrief(result);
  render();
}
const catalogKey = () =>
  `${connection}:${["ollama", "ollama-cloud"].includes(connection) ? "api" : authChoice}`;
function modelOptions(selected) {
  const models = modelCatalogs[catalogKey()]?.models || [];
  const entries =
    selected && !models.some((m) => m.id === selected)
      ? [{ id: selected, label: selected + " (saved selection)" }, ...models]
      : models;
  return entries
    .map(
      (m) =>
        `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(m.label || m.id)}</option>`,
    )
    .join("");
}
function catalogStatus() {
  const result = modelCatalogs[catalogKey()];
  return modelsLoading
    ? "Reading the provider’s model catalog…"
    : result
      ? `${result.message || "Catalog read complete. Model access depends on your account."}${result.checkedAt ? " Checked " + new Date(result.checkedAt).toLocaleTimeString() : ""}`
      : "Save your access first, then refresh the model catalog. No model is chosen for you.";
}
async function fetchModels(refresh = false) {
  if (!api.listModels) return;
  const epoch = ++modelEpoch,
    key = catalogKey(),
    provider = connection;
  const endpoint =
    document.querySelector('[name="endpoint"]')?.value ||
    (state.provider.id === connection
      ? state.provider.endpoint
      : metadata.find((p) => p.id === connection)?.endpoint);
  modelsLoading = true;
  refreshModelWidgets();
  const status = document.querySelector("[data-model-status]");
  if (status) status.textContent = catalogStatus();
  try {
    const result = await api.listModels({
      provider,
      authMode: ["ollama", "ollama-cloud"].includes(provider)
        ? "api"
        : authChoice,
      endpoint,
      refresh,
    });
    if (epoch !== modelEpoch || key !== catalogKey()) return;
    modelCatalogs[key] = result;
  } catch (error) {
    if (epoch === modelEpoch)
      modelCatalogs[key] = {
        models: modelCatalogs[key]?.models || [],
        message: error.message,
      };
  } finally {
    if (epoch === modelEpoch) {
      modelsLoading = false;
      refreshModelWidgets();
      const picker = document.getElementById("model-picker");
      if (picker) {
        const selected = picker.value;
        const saved = modelCatalogs[catalogKey()]?.models || [];
        if (selected && !saved.some((m) => m.id === selected))
          modelCatalogs[catalogKey()].models = [
            ...saved,
            { id: selected, label: selected + " (saved selection)" },
          ];
        picker.innerHTML =
          '<option value="">Choose a model after connecting</option>' +
          modelOptions(selected);
        picker.value = selected;
      }
      const status = document.querySelector("[data-model-status]");
      if (status) status.textContent = catalogStatus();
    }
  }
}
function refreshModelWidgets() {
  document.querySelectorAll('[data-command="refresh-models"]').forEach(button=>{
    button.textContent=modelsLoading ? "Checking…" : "Refresh models";
    button.disabled=modelsLoading;
  });
}
function adventure() {
  const p = profile();
  const plan = guidanceProfileId === p?.id ? guidance : null;
  const brief = briefProfileId === p?.id ? adventureBrief : null;
  const quests = p?.quests || [], ready = quests.filter((q) => q.complete).length;
  const goals = p?.goals || [], done = goals.filter((g) => g.done).length;
  const facts = p ? [`Level ${esc(p.level)} ${esc(p.className || "adventurer")}`,
    quests.length ? `<strong>${ready}</strong> of ${quests.length} quest${quests.length === 1 ? "" : "s"} ready to hand in` : "No saved quests yet",
    goals.length ? `<strong>${done}</strong> of ${goals.length} goal${goals.length === 1 ? "" : "s"} done` : ""].filter(Boolean).join(" · ") : "";
  const paused = p && state.followGameCharacter === false ? `<span class="follow-paused"><span class="ph-chip">Saved-game follow paused · showing your pick</span><button data-command="follow-saved">Follow saved game</button></span>` : "";
  const hero = PageHero.render({ art: "adventure", eyebrow: "Adventure · Your next step", title: p ? esc(p.name) : "Your next step", crest: PageHero.classCrest(p?.className),
    subtitle: facts || "Connect the game and log in once: your quests, goals and professions turn into next steps here.", aside: paused });
  if (!p) return `<div class="bf-page adventure-page">${hero}${LivingSetup.empty(gameStatus, esc)}${AdventureCoach.render()}${PlayerNavigation.disclosure("coach-quest-plan", "Quest plan & session details", Director.panel(null))}</div>`;
  const goalCard = `<section class="bf-card adventure-journal"><h2>Your goals <small>${done} / ${goals.length} complete</small></h2>${goals.length ? goals.map((g) => `<div class="goal"><label class="${g.done ? "done" : ""}"><input type="checkbox" data-goal="${esc(g.id)}" ${g.done ? "checked" : ""}><span>${esc(g.text)}</span></label><button data-remove-goal="${esc(g.id)}" aria-label="Delete goal: ${esc(g.text)}">×</button></div>`).join("") : `<p>Write down what you want from this character: a profession at 150, your first mount at 40, a dungeon with friends. Tick them off as you go.</p>`}<form id="goal-form" class="inline goal-form"><label>New goal<input name="goal" maxlength="1000" placeholder="e.g. Reach 150 in Tailoring" required></label><button type="submit" aria-label="Add goal">+ Add</button></form></section>`;
  return `<div class="bf-page adventure-page">${hero}${LivingSetup.coverage(gameStatus, esc)}<div class="bf-grid"><div class="bf-col">${AdventureCoach.render()}${CommandCenter.steps(plan, CommandCenter.options(p.id), esc)}${PlayerNavigation.disclosure("coach-quest-plan", "Quest plan & session details", Director.panel(plan?.director || null))}</div><div class="bf-col">${goalCard}${CommandCenter.readiness(brief, esc)}</div></div>${situationCards()}${PlayerNavigation.disclosure("voice", "Voice · optional local reading", Voice.markup("plan"))}</div>`;
}
function characters() {
  const p = profile();
  return `<div class="bf-page bf-parchment characters-page">${PageHero.render({ art: "characters", eyebrow: "Characters · Journal", title: p ? esc(p.name) : "Your characters", crest: PageHero.classCrest(p?.className), subtitle: p ? `Level ${esc(p.level)} ${esc(p.className || "")} · ${esc(CommandCenter.age(p))}` : "Play a character with the addon on and log out: they appear here. Or add one by hand below.", aside: `<span class="ph-chip">${state.profiles.length} character${state.profiles.length === 1 ? "" : "s"}</span>` })}${CharacterGuidance.page()}<div class="grid"><section class="panel"><div class="panel-header"><h3>${p ? "Character journal" : "Create a character"}</h3><span class="tag">Stored locally</span></div><form id="character-form">${characterFields(p)}<label class="full notes-label">Private notes<textarea name="notes" maxlength="20000" placeholder="Build ideas, profession plans, places to revisit…">${esc(p?.notes || "")}</textarea></label><div class="actions"><button type="submit" class="${p ? "subtle" : "primary"}">${p ? "Save character" : "Create character"}</button>${p ? '<button type="button" data-command="delete-character" class="danger">Delete character</button>' : ""}</div></form><p class="snapshot-hint"><span data-snapshot-age>${esc(snapshotLabel(p))}</span><br>${savedHelp}</p><p class="corner-note">Private notes and goals are never automatically included in AI requests.</p></section><aside class="panel"><div class="panel-header"><h3>Your roster</h3><button data-command="new-character" class="subtle">+ New</button></div><div class="character-list">${state.profiles.map((item) => `<button data-character="${esc(item.id)}" class="${item.id === p?.id ? "selected" : ""}"><span class="avatar class-sigil" data-class="${esc(item.className)}"><img src="${portrait(item.className)}" alt=""><span>${sigil(item.className)}</span></span><span>${esc(item.name)}<small>${esc(item.className)} · Level ${item.level} · ${esc(item.realm || "Realm not set")}</small><small>${item.source?.kind === "wow-addon" ? "Game snapshot · " + esc(CommandCenter.age(item)) : "Manual journal"}</small></span></button>`).join("") || '<div class="empty">No characters yet.</div>'}</div><div class="callout">Another character missing? Play them with the addon on and log out (or type /reload): they appear here.</div></aside></div></div>`;
}
function assistant() {
  const p = profile();
  const provider = metadata.find((item) => item.id === state.provider.id);
  return `${PageHero.render({ art: "companion", eyebrow: "Companion", title: "Ask about WoW Forever", subtitle: "Where is someone, how do I get there: answered offline from the bundled reference. Anything else goes to the AI you choose, only when you press Send." })}<div class="grid companion-grid"><section class="panel companion-conversation"><p class="corner-note" data-conversation-notice role="status">${esc(conversationNotice)}</p><div class="chatlog" id="chatlog" role="log" aria-label="Conversation" aria-live="polite">${messages.length ? messages.map((m, index) => `<div class="message ${m.role}"><span class="eyebrow">${m.role === "user" ? "You" : m.kind === "travel" ? "Forever travel reference · local" : m.kind === "npc" ? "Forever NPC reference · local" : m.lookups?.length ? "Companion · AI with local reference lookups" : "Companion · AI suggestion"}</span><div class="message-text ${m.role === "assistant" ? "companion-reply" : ""}">${m.kind === "travel" && m.travel ? CompanionTravel.render(m.travel,index,m.text) : m.kind === "npc" ? CompanionReply.renderNpc(m.text,m.npc,body => PlayerNavigation.disclosure("npc-source-"+index,"Source & evidence",body)) : m.role === "assistant" ? CompanionReply.render(m.text) : esc(m.text)}</div>${m.role === "assistant" && m.lookups?.length ? `<small class="lookup-trail" data-lookup-trail>Checked: ${m.lookups.map(esc).join(" · ")}</small>` : ""}</div>`).join("") : ""}</div>${!state.provider.model ? '<div class="ai-setup-hint"><span>Local NPC locations and travel need no model. Other questions need an AI connection.</span><button type="button" data-nav="connections">Configure AI connection</button></div>' : ""}<p class="companion-cost" data-companion-cost>Local NPC locations and travel send nothing to a provider. ${esc(provider?.name || state.provider.id)} · ${state.provider.id === "ollama" ? "Your local Ollama service" : state.provider.authMode === "subscription" ? "Your subscription and its plan limits" : "Cloud API · charges may apply"}. Nothing is sent until you ask.</p><form id="chat-form" class="chat-form"><label>Your question<textarea name="prompt" maxlength="12000" required placeholder="Help me prepare for my next adventure…" ${sending ? "disabled" : ""}></textarea></label><label class="check-label"><input type="checkbox" id="share-profile" ${shareCharacter ? "checked" : ""} ${sending ? "disabled" : ""}>Use my active character</label>${QuestGuide.contextMarkup()}<small data-memory-selection-summary>${Memory.summary()}</small><div class="button-row"><button class="primary" type="submit" ${sending ? "disabled" : ""}>${sending ? "Thinking…" : "Send question"}</button>${sending ? '<button type="button" data-command="stop-response">Stop response</button>' : ""}<button type="button" data-command="clear-chat">Clear conversation</button></div><div class="suggestions"><button type="button" data-prompt="What is the fastest way from Orgrimmar to Thunder Bluff?">Plan a trip · local reference</button><button type="button" data-prompt="Help me make a general dungeon preparation checklist. Clearly distinguish general advice from unverified Forever details.">Dungeon preparation</button><button type="button" data-prompt="Help me plan a relaxed 45-minute game session around a goal I will describe next.">Plan a short session</button></div>${PlayerNavigation.disclosure("voice", "Voice · optional dictation and reading", Voice.markup())}</form>${questionRecovery ? `<div class="callout" data-question-recovery role="status"><p>${esc(questionRecovery.message)}</p><button type="button" data-command="edit-question">Edit question</button></div>` : ""}${PlayerNavigation.disclosure("memory", Memory.summary(), Memory.markup())}</section><aside class="panel companion-intel">${window.FreeAI ? FreeAI.card(state.provider.id) : ""}<img class="hero-medallion" src="${portrait(p?.className)}" alt=""><h2>${esc(p?.name || "Choose your character")}</h2><p>${p ? `Level ${p.level} ${esc(p.className)} · ${esc(p.race || "Race not yet received")} · ${esc(p.faction || "Faction not yet received")}` : "Your character snapshot will bring this page to life."}</p><p>${esc(p?.location?.zone || "Location not yet received")}${p?.location?.subZone ? " · " + esc(p.location.subZone) : ""}</p>${window.LiveLink ? LiveLink.line() : ""}<div class="callout brass">${esc(snapshotLabel(p))}<br>${esc(briefProfileId === p?.id ? adventureBrief?.freshness?.message : "Desktop saved data arrives after the game saves on logout.")}</div><h3>Observed quest log</h3><p>${esc(briefProfileId === p?.id ? adventureBrief?.quests?.message : "Quest data unavailable.")}</p>${(
    p?.quests || []
  )
    .slice(0, 5)
    .map(
      (q) =>
        `<p><strong>${esc(q.title)}</strong><br><small>${q.complete ? "Ready to turn in" : "In progress"}</small></p>`,
    )
    .join(
      "",
    )}<h3>Experience</h3><p>${esc(briefProfileId === p?.id ? adventureBrief?.progress?.message : "Experience data unavailable.")}</p>${briefProfileId === p?.id && adventureBrief?.progress?.percent != null ? `<p>${adventureBrief.progress.percent}% of this level</p>` : ""}${p?.source?.kind !== "wow-addon" || !p?.race || !p?.faction ? '<div class="callout"><p>Connect your game to receive your character’s race, faction, quests and progress. Missing details are never guessed.</p><button data-command="setup-open">Set up my companion</button></div>' : ""}<hr class="rule"><p class="corner-note">${esc(provider?.name || "Choose a provider")} · ${esc(state.provider.model || "No model selected")}<br>${state.provider.id === "ollama" ? "Uses your local Ollama service." : state.provider.authMode === "subscription" ? "Uses your subscription and its plan limits." : "Cloud API questions may cost money."} Nothing is sent until you press Send; private notes and goals stay here.</p><button data-nav="connections">Configure provider</button></aside></div>`;
}
const providerNotes = {
  ollama:
    "Install Ollama and download a model first. Use the exact installed model name. A local model stays on your machine; cloud-backed models may still contact their own service.",
  openai:
    "A ChatGPT subscription is not an API key. Choose subscription sign-in to use eligible ChatGPT plan access, or choose API key for separate API billing.",
  anthropic:
    "Use your Claude plan through the official installed Claude tool, or choose an Anthropic API key for API billing. Never paste website cookies or session tokens.",
  "ollama-cloud":
    "Use an Ollama Cloud API key. Cloud requests leave this computer and follow your Ollama account limits; local Ollama is a separate connection.",
  xai: "Grok subscription access uses the official provider sign-in route when available. API key access is a separate billing mode. Never paste browser cookies or session tokens.",
};
function providerTitle(id) {
  return (
    {
      ollama: "Ollama",
      "ollama-cloud": "Ollama Cloud",
      openai: "ChatGPT / OpenAI",
      anthropic: "Claude / Anthropic",
      xai: "Grok / xAI",
    }[id] || id
  );
}
function connections() {
  const selected = metadata.find((item) => item.id === connection);
  const saved = state.provider.id === connection;
  const subscription = subscriptions[connection] || {};
  const isSubscription =
    !["ollama", "ollama-cloud"].includes(connection) &&
    authChoice === "subscription";
  const subscriptionNames = {
    openai: "Continue with ChatGPT",
    anthropic: "Sign in with Claude",
    xai: "Sign in with Grok",
  };
  return `${PageHero.render({ art: "settings", compact: true, eyebrow: "Settings · AI connection", title: "Choose an AI for the companion", subtitle: "A free local model, your subscription, or your own API key. Nothing switches to paid API billing by itself." })}
    <div class="providers">${metadata.map((item) => `<button aria-label="${esc(item.name)}" data-provider="${item.id}" class="provider ${connection === item.id ? "selected" : ""}"><strong>${esc(item.id === "openai" ? "ChatGPT / OpenAI" : item.id === "anthropic" ? "Claude / Anthropic" : item.id === "xai" ? "Grok / xAI" : item.name)}</strong><small>${item.id === "ollama" ? "LOCAL MODEL OPTION" : item.id === "ollama-cloud" ? "CLOUD API" : item.id === "xai" ? "API · SUBSCRIPTION PENDING" : "SUBSCRIPTION OR API"}</small></button>`).join("")}</div>
    <div class="grid"><section class="panel"><div class="panel-header"><h3>${esc(providerTitle(connection))} connection</h3><span class="tag">${saved ? "Selected provider" : "Not selected"}</span></div>
    <div class="callout brass">${esc(providerNotes[connection])}</div>
    <form id="provider-form"><div class="form-grid provider-fields">
    ${!["ollama", "ollama-cloud"].includes(connection) ? `<label class="full">Access method<select id="access-method" name="authMode"><option value="subscription" ${isSubscription ? "selected" : ""}>Subscription sign-in (OAuth)</option><option value="api" ${!isSubscription ? "selected" : ""}>API key (API billing)</option></select></label>` : ""}
    <label class="full">Available models<select name="model" id="model-picker"><option value="">Choose a model after connecting</option>${modelOptions(saved ? state.provider.model : "")}</select></label>
    <div class="full model-status"><span data-model-status>${esc(catalogStatus())}</span><button type="button" data-command="refresh-models">${modelsLoading ? "Checking…" : "Refresh models"}</button></div>
    <details class="full"><summary>Advanced: enter a model ID manually</summary><label>Manual model ID<input name="manualModel" maxlength="200" placeholder="Only if your model is missing from the list" autocomplete="off"></label></details>
    ${connection === "ollama" ? `<label class="full">Ollama address<input name="endpoint" value="${esc(saved ? state.provider.endpoint : selected?.endpoint)}" required></label>` : !isSubscription ? `<label class="full">API key<input name="apiKey" type="password" maxlength="2000" placeholder="${keys[connection] ? "Key saved securely — leave blank to keep it" : "Paste your own API key"}" autocomplete="off" spellcheck="false"></label>` : ""}</div>
    ${isSubscription ? `<div class="callout subscription-box"><strong>${subscription.connected ? "Signed in" : "Not signed in"}</strong><p>${esc(subscription.message || "Sign-in availability is being checked.")}</p>${subscription.account ? `<p>${esc(subscription.account)}</p>` : ""}<div class="actions"><button type="button" class="primary" data-command="subscription-login" ${authPending || !subscription.supported ? "disabled" : ""}>${authPending ? "Waiting for browser sign-in…" : subscriptionNames[connection]}</button>${subscription.connected ? '<button type="button" data-command="subscription-logout">Sign out</button>' : ""}<button type="button" data-command="refresh-subscriptions">Refresh status</button></div></div>` : ""}
    <p class="corner-note">${connection === "ollama" ? "Loopback addresses only: localhost, 127.0.0.1, or [::1]. Default port: 11434." : isSubscription ? "Your provider controls plan eligibility, model access and usage limits. Credentials are excluded from backups. Sign-in and inference require internet." : `Endpoint: ${esc(selected?.endpoint)}<br>Key stored: ${keys[connection] ? "Yes" : "No"}. Keys are encrypted by your operating system and excluded from backups.`}</p>
    <p class="corner-note">Changes save automatically. Model choices save immediately; text saves when you leave the field.</p><div class="actions"><button class="subtle" type="submit">Retry saving</button><button type="button" data-link="${connection}">Open ${connection === "ollama" ? "Ollama website" : "provider website"} ↗</button>${keys[connection] && !isSubscription ? '<button type="button" class="danger" data-command="delete-key">Remove saved key</button>' : ""}</div></form></section>
    <aside class="panel"><h3>One app. Your own access.</h3><div class="steps"><div class="step"><b>1</b><div><p>Choose how you connect</p><small>Subscription sign-in, your own API key, or a local model.</small></div></div><div class="step"><b>2</b><div><p>Sign in with the provider</p><small>Use the official browser flow or official installed tool. Your password never goes into this app.</small></div></div><div class="step"><b>3</b><div><p>Choose a model, then ask</p><small>Changes save automatically. No AI question is sent until you ask.</small></div></div></div><div class="callout">Each friend signs in independently. We never bundle Frank’s credentials or share someone else’s subscription.</div><p class="corner-note">Subscription usage and API billing are separate modes. No automatic paid fallback.</p></aside></div>`;
}

function guide() {
  return `${PageHero.render({ art: "settings", eyebrow: "Help · Field guide", title: "How to play with Backstage Forever", subtitle: "Start here, look up a word, or find how to do one thing." })}
  <div class="guide-grid bf-parchment">
    <section class="panel guide-start"><div class="eyebrow">New to WoW? · Start here</div><h3>Four steps and you're playing with a guide.</h3><ol class="guide-steps"><li><strong>Connect the game.</strong> Settings → Game connection finds your WoW Forever folder and installs the addon.</li><li><strong>Log in and type <code>/reload</code>.</strong> Do this once per new character so the app can read it.</li><li><strong>Open Now.</strong> It tells you the next thing to do and follows you while you play.</li><li><strong>Ask the game for directions.</strong> In chat type <code>/bf next</code> for an arrow to your next quest, <code>/bf train</code> for your class trainer, <code>/bf find flight master</code> to find anyone, and <code>/bf help</code> for the rest. Every command is explained under Help → Commands.</li></ol><p>The addon also warns you about dangerous enemies, points you back to your body when you die, celebrates level-ups and adds a <strong>Sell junk</strong> button at vendors.</p></section>
    <section class="panel guide-glossary"><div class="eyebrow">Words you'll see</div><h3>A pocket glossary.</h3><dl>
      <dt>Quest giver <span class="gls-ico">!</span></dt><dd>A yellow ! over someone's head means they have a quest for you.</dd>
      <dt>Hand in <span class="gls-ico">?</span></dt><dd>A yellow ? means a finished quest goes back to them for your reward. Also called "turn in".</dd>
      <dt>Rested</dt><dd>Bonus experience you build while logged out in an inn or city. Kills give double XP until it runs out (the blue part of your XP bar).</dd>
      <dt>Hearthstone</dt><dd>A stone in your bags that teleports you to the inn you chose as home, once an hour. Change it by talking to an innkeeper.</dd>
      <dt>Trainer</dt><dd>Teaches your class new spells and abilities, usually every two levels. It costs a little money.</dd>
      <dt>Flight master</dt><dd>Flies you between places you've already visited. Talk to every flight master you pass so you can fly back later.</dd>
      <dt>Enemy level colours</dt><dd>Grey: no XP. Green: easy. Yellow: fair. Orange: hard. Red or a skull: avoid.</dd>
      <dt>Elite</dt><dd>A dragon border on their portrait. Several times stronger than normal enemies; bring a group.</dd>
      <dt>Pull and aggro</dt><dd>Attacking draws an enemy to you (a pull). Getting too close also does, and nearby friends of theirs may join.</dd>
      <dt>Corpse run</dt><dd>When you die, release your spirit and run back to your body as a ghost to come back to life.</dd>
      <dt>Durability and repair</dt><dd>Gear wears out when you die or fight. Repair it at blacksmiths and many vendors.</dd>
      <dt>Vendor trash</dt><dd>Grey items. They're only for selling to any vendor for money.</dd>
      <dt>Dungeon</dt><dd>A private area for a group of five with tougher enemies and better rewards.</dd>
    </dl></section>
    <section class="panel"><div class="eyebrow">01 · Find your next quest</div><h3>Where do I go now?</h3><p><strong>Now</strong> lists what to do next: hand-ins first, then training, then the quest you're on. Every step has <strong>Show on map</strong>. In game, <code>/bf next</code> puts an arrow on it.</p><p><strong>Quests</strong> searches every quest by name or number and shows who gives it, where its objectives are, the rewards and a plain how-to. Rest the mouse on any quest name anywhere in the app for a quick card.</p><div class="actions"><button data-nav="now">Open Now</button><button data-nav="quest-guide">Open Quests</button></div></section>
    <section class="panel"><div class="eyebrow">02 · Plan your character</div><h3>Notes, talents and goals.</h3><p><strong>Characters</strong> keeps private notes for each character and shows gear and class training from your last save. <strong>Talents</strong> suggests a talent path for leveling; <strong>Journey</strong> shows your badges and how fast each level went.</p><p>Write goals on <strong>Adventure</strong> and tick them off. <strong>Plans</strong> holds longer checklists you can assign to characters.</p><div class="actions"><button data-nav="characters">Open Characters</button><button data-nav="company">Open Plans</button></div></section>
    <section class="panel"><div class="eyebrow">03 · Level a profession</div><h3>What do I craft next?</h3><p>Open your profession window once in game, then <strong>Professions</strong> shows the next recipe worth making (orange and yellow recipes give skill), how many crafts to the next rank and a shopping list with who sells each material.</p><p>Herbs and ore are on the <strong>World Map</strong> layers. Other characters' bags are never counted for you.</p><div class="actions"><button data-nav="preparation">Open Professions</button><button data-nav="world-map">Open World Map</button></div></section>
    <section class="panel"><div class="eyebrow">04 · Group up for a dungeon</div><h3>Ready for a dungeon?</h3><p><strong>Dungeons</strong> lists the dungeons around your level with their bosses and loot. <strong>Party</strong> builds a five-check role list (roles, bag space, consumables, repairs, meeting point) and can save a portable party-plan file you send to friends yourself; importing one shows it first and adds only unchecked steps.</p><div class="actions"><button data-nav="dungeons">Open Dungeons</button><button data-nav="party">Open Party</button></div></section>
    <section class="panel"><div class="eyebrow">05 · Ask the companion</div><h3>Questions in plain words.</h3><p><strong>Companion</strong> answers "where is…" and "how do I get to…" from the bundled reference, offline and without AI. Other questions need an AI connection: Settings → AI connection lets you pick a free local model or your own account.</p><p>Nothing is sent until you press <strong>Send question</strong>. Chat is session-only; saved memory is off by default for each question and you choose what to share. Dictation creates text only (no audio files).</p><div class="actions"><button data-nav="assistant">Open Companion</button><button data-nav="connections">AI connection</button></div></section>
    <section class="panel"><div class="eyebrow">06 · Keep your journal safe</div><h3>Backups, updates and starting over.</h3><p><strong>Export backup</strong> saves your characters, notes, goals and plans to a file; it leaves out credentials and saved memory. <strong>Import backup</strong> replaces them, clears saved memory and disconnects game observation until you reconnect.</p><p>There's no reload needed for the native Compass: it follows quests, levels and zones as you play, and the desktop catches up when the game saves. Quest reference updates and app updates are separate from AI and send nothing from your journal.</p><div class="actions"><button data-command="export">Export backup</button><button data-command="import">Import backup</button><button data-nav="game">Game connection</button><button data-nav="updates">Updates</button></div><details><summary>Something not working?</summary><p>No characters? Open Game connection and use Find my game or Repair companion addon. AI errors: check the model and your access in Settings → AI connection (for Ollama, that it is running). A stuck update: Retry update or Open Releases in Updates.</p><p>If the journal can't start, the app offers Restore and restart from the newest good copy and keeps the damaged original until you clear it.</p></details><details><summary>Delete everything</summary><p>Delete all local data clears characters, plans, memory, preferences, keys and app sign-ins after you confirm. It does not delete backups you exported or anything stored by your AI provider.</p></details><button class="danger" data-command="reset">Delete all local data</button></section>
    ${Recovery.markup()}
    ${Support.markup()}
  </div><p class="corner-note">Backstage Forever v${esc(version)} · Backstage Coding · Designed by Frank Arena.<br>World of Warcraft is a trademark of Blizzard Entertainment. This independent project is not endorsed by Blizzard.</p>`;
}

function updateSummary() {
  if (updateInfo.phase === "ready" && updateInfo.message)
    return updateInfo.message + (updateInfo.readyVersion ? " Version " + updateInfo.readyVersion + " is still verified and ready to install." : " A verified update is still ready to install.");
  if (updateInfo.phase === "ready")
    return updateInfo.automatic && updateInfo.installOnQuit
      ? "Your next version is ready. It installs when you close the app, or you can restart now."
      : "Your next version is ready. Choose Restart and update when you’re ready to install.";
  if (updateInfo.phase === "downloading")
    return updateInfo.retryAttempt > 1
      ? "Retrying the authenticated download (attempt " + updateInfo.retryAttempt + " of 3)…"
      : "Downloading an authenticated update in the background…";
  if (updateInfo.phase === "checking") return "Checking for a newer release…";
  if (updateInfo.phase === "current") return "You’re up to date.";
  if (updateInfo.phase === "error")
    return (
      updateInfo.message ||
      "Could not check for updates. Your current app is unaffected."
    );
  if (!updateInfo.automatic) return "Automatic update checks are off.";
  if (updateInfo.phase === "unsupported")
    return "Automatic checks start in the installed Windows app. Source builds never install updates.";
  return "Your companion checks for updates while it is open.";
}
function refreshUpdateWidgets() {
  document.querySelectorAll("[data-update-pref]").forEach((node) => {
    node.disabled = updateSaving;
    node.checked = Boolean(
      (updatePendingPrefs || updateInfo)[node.dataset.updatePref],
    );
  });
  document
    .querySelectorAll("[data-update-label]")
    .forEach(
      (node) =>
        (node.textContent =
          updateInfo.phase === "ready"
            ? "Update ready"
            : updateInfo.phase === "downloading"
              ? "Downloading update"
              : updateInfo.automatic
                ? "Updates enabled"
                : "Updates paused"),
    );
  const summary = document.querySelector("[data-update-summary]");
  if (summary) summary.textContent = updateSummary();
  const progress = document.querySelector("[data-update-progress]");
  if (progress) {
    progress.value = Number(updateInfo.progress) || 0;
    progress.hidden = updateInfo.phase !== "downloading";
  }
  const available = document.querySelector("[data-update-version]");
  if (available)
    available.textContent = updateInfo.readyVersion && updateInfo.availableVersion !== updateInfo.readyVersion
      ? "Available: " + updateInfo.availableVersion + " · Ready: " + updateInfo.readyVersion
      : updateInfo.availableVersion
      ? "Available: " + updateInfo.availableVersion
      : "Installed: " + version;
  const restart = document.querySelector('[data-command="install-update"]');
  if (restart) restart.disabled = updateSaving || updateInfo.phase !== "ready";
  const check = document.querySelector('[data-command="check-updates"]');
  if (check) {
    check.textContent = updateInfo.message && !["checking", "downloading"].includes(updateInfo.phase) ? "Retry update" : "Check for updates";
    check.disabled =
      updateSaving || ["checking", "downloading"].includes(updateInfo.phase);
  }
}
function updatesPage() {
  return `${PageHero.render({ art: "settings", compact: true, eyebrow: "Settings · Updates", title: "Keep the app up to date", subtitle: `Installed: version ${esc(version)}. Updates download in the background and install when you close the app.` })}
  <div class="grid"><section class="panel update-panel"><div class="panel-header"><h3>Backstage Forever updates</h3><span class="tag" data-update-version>Installed: ${esc(version)}</span></div><p class="update-summary" data-update-summary>${esc(updateSummary())}</p><progress data-update-progress max="100" value="${Number(updateInfo.progress) || 0}" ${updateInfo.phase === "downloading" ? "" : "hidden"} aria-label="Update download progress"></progress>
  <div class="update-options"><label class="check-label"><input type="checkbox" data-update-pref="automatic" ${updateInfo.automatic ? "checked" : ""}>Automatically check and download updates</label><p>Check after startup and every six hours while the app is open. Downloads come from this project’s GitHub Releases.</p><label class="check-label"><input type="checkbox" data-update-pref="installOnQuit" ${updateInfo.installOnQuit ? "checked" : ""}>Install downloaded updates when I close the app</label><p>No forced restart during your game. You can also restart here when you’re ready.</p></div>
  <div class="actions"><button class="primary" data-command="check-updates">Check for updates</button><button data-command="install-update" ${updateInfo.phase === "ready" ? "" : "disabled"}>Restart and update</button><button data-link="releases">Open Releases ↗</button></div><p class="corner-note">Last checked: ${updateInfo.lastChecked ? esc(new Date(updateInfo.lastChecked).toLocaleString()) : "Not checked in this session"}</p></section>
  <aside class="panel"><h3>A trusted path forward.</h3><div class="steps"><div class="step"><b>1</b><div><p>Authenticate the release</p><small>Only releases signed by Backstage Forever’s update key are accepted.</small></div></div><div class="step"><b>2</b><div><p>Verify the download</p><small>The complete installer’s size and fingerprint must match before it can run.</small></div></div><div class="step"><b>3</b><div><p>Keep your journal</p><small>Profiles and provider settings remain in your Windows account’s app folder.</small></div></div></div><div class="callout brass">Older updater stuck? Open Releases and run the latest installer once. Older installed apps cannot receive these retry and recovery improvements until they are upgraded.</div><p class="corner-note">Application update signatures authenticate future downloads. This preview still lacks a Windows publisher certificate, so an initial manual installer may show an unknown-publisher notice.</p></aside></div>`;
}
let companionSignature = "", conversationOwner = "", conversationScope = null, companionReady = Promise.resolve();
let localConversationClears = 0;
let conversationNotice = "Recent messages accompany follow-ups in this session (up to 6 exchanges; older text may be omitted). Saved memory is separate: select it for each question.";
function companionView() { return page === "assistant" && !setupOpen ? "ai" : "other"; }
function retireCompanion(notify = true, preserveMemory = false) {
  chatGeneration++;
  sending = false;
  chatStarting = false;
  currentQuestion = null;
  questionRecovery = null;
  Voice.invalidate();
  if (preserveMemory) Memory.retireDraft(); else Memory.invalidate();
  if (notify && state && api.companionContext) {
    companionReady = api.companionContext({profileId: state.activeProfileId ?? null, view: companionView()});
    companionReady.catch(() => {});
  }
}
function resetConversationView(preserveMemory = false, preserveRecovery = false) {
  QuestGuide.invalidateContext();
  const recovery = !sending && preserveRecovery ? questionRecovery : null;
  retireCompanion(false, preserveMemory);
  questionRecovery = recovery;
  messages = [];
  conversationScope = null;
  conversationNotice = "Recent messages accompany follow-ups. A fresh conversation starts when character, provider, sharing or selected memory changes. Saved memory remains separate and per question.";
}
function clearMainConversation(preserveMemory = false, preserveRecovery = false) {
  resetConversationView(preserveMemory, preserveRecovery);
  if (api.clearConversation) {
    localConversationClears++;
    companionReady = api.clearConversation().catch(error => { localConversationClears = Math.max(0, localConversationClears - 1); throw error; });
  } else companionReady = api.companionContext?.({profileId: state.activeProfileId ?? null, view: companionView()}) || Promise.resolve();
  companionReady.catch(() => {});
  render();
  return companionReady;
}
api.onConversationReset?.(reason => {
  if (reason === "clear" && localConversationClears) { localConversationClears--; return; }
  resetConversationView();
  if (state) render();
});
function syncCompanion() {
  if (!state) return;
  const selected = profile();
  const owner = JSON.stringify([state.activeProfileId ?? null, state.provider, selected?.source?.kind, selected?.source?.id]);
  if (conversationOwner && owner !== conversationOwner) resetConversationView();
  conversationOwner = owner;
  const signature = JSON.stringify([owner, companionView(), page, setupOpen]);
  if (signature === companionSignature) return;
  const previous = companionSignature;
  companionSignature = signature;
  retireCompanion(Boolean(previous) || companionView() === "ai");
}
Support.init({ api, root, esc, active: () => Boolean(state?.onboarded) && !setupOpen && page === "guide" });
async function refreshRecoveryDetails() {
  const restoredState = state, mutation = stateMutationEpoch;
  const [briefResult, statusResult] = await Promise.allSettled([refreshBrief(), api.gameStatus()]);
  if (state !== restoredState || mutation !== stateMutationEpoch) return false;
  if (statusResult.status === "fulfilled") gameStatus = statusResult.value;
  render();
  return briefResult.status === "fulfilled" && statusResult.status === "fulfilled";
}
Recovery.init({ api, root, esc, active: () => Boolean(state?.onboarded) && !setupOpen && page === "guide",
  refreshDetails: refreshRecoveryDetails,
  restore: async input => {
    await autosaveQueue;
    const next = await mutateStateCall(() => api.restoreCheckpoint(input));
    if (next) {
      retireCompanion(false); Support.invalidate();
      Company.invalidate(true); Director.invalidate(); QuestGuide.invalidate(true);
      CharacterGuidance.invalidate(true); Preparation.invalidate(); Preparation.remove(); Party.invalidate(); Party.remove();
      autosaveGeneration++; formDrafts.clear(); state = next; messages = [];
      gameStatus = { connected: false };
      connection = state.provider.id; authChoice = state.provider.authMode || "api";
      // Replacement has committed; optional display failures cannot undo it.
      const detailsAvailable = await refreshRecoveryDetails().catch(() => false);
      return { detailsUnavailable: !detailsAvailable };
    }
    return next;
  }
});
Voice.init({api, root, esc, render,
  active: () => Boolean(state?.onboarded) && !setupOpen && ["assistant", "adventure"].includes(page),
  profileId: () => state?.activeProfileId,
  busy: () => sending || chatStarting,
  ready: () => companionReady,
  answer: () => messages.findLast(m => m.role === "assistant")?.text,
  plan: () => guidanceProfileId === state?.activeProfileId ? guidance : null,
});
Memory.init({api, root, esc,
  active: () => Boolean(state?.onboarded) && !setupOpen && page === "assistant",
  profileId: () => state?.activeProfileId,
  character: () => profile(),
  selectionChanged: ids => {
    const nextScope = JSON.stringify([shareCharacter, [...ids].sort()]);
    if (conversationScope !== null && conversationScope !== nextScope) void clearMainConversation(true, true);
    void QuestGuide.updateContext(true);
  },
  cleanError: e => e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
  mutate: (kind, input, valid) => {
    const generation = autosaveGeneration;
    const task = async () => {
      if (generation !== autosaveGeneration || !valid()) return null;
      const epoch = stateMutationEpoch;
      const result = await mutateStateCall(() => kind === "save" ? api.saveMemory(input) : kind === "delete" ? api.deleteMemory(input) : api.clearMemory(input.profileId));
      if (generation !== autosaveGeneration || !valid() || stateMutationEpoch !== epoch + 2) return null;
      chatGeneration++;
      sending = false;
      chatStarting = false;
      Voice.invalidate();
      state = result;
      render();
      return result;
    };
    const result = autosaveQueue.then(task, task);
    autosaveQueue = result.catch(() => {});
    return result;
  },
});
QuestGuide.init({ api, root, esc, portrait, selectedMemoryIds: () => Memory.selectedIds(), ready: () => companionReady, notify: toast, onStatus: value => { questStatusRequest++;knowledgeStatus = value; } });
AdventureCoach.init({api,root,esc,profile,active:()=>page === "adventure" && !setupOpen && Boolean(state?.onboarded)});
Director.init({
  root, esc,
  active: () => page === "adventure" && !setupOpen && Boolean(state?.onboarded),
  profileId: () => state?.activeProfileId,
  options: () => CommandCenter.options(state?.activeProfileId),
  model: () => guidanceProfileId === state?.activeProfileId ? guidance?.director : null,
  mutate: (id, options, valid) => {
    const generation = autosaveGeneration;
    const task = async () => {
      // Accepted queued writes finish after navigation; only replies depend on the view.
      if (generation !== autosaveGeneration) return null;
      const epoch = stateMutationEpoch;
      const result = await mutateStateCall(() => api.startDirectorSession(id, options));
      if (generation !== autosaveGeneration || !valid() || stateMutationEpoch !== epoch + 2) return null;
      state = result.state;
      return result;
    };
    const result = autosaveQueue.then(task, task);
    autosaveQueue = result.catch(() => {});
    return result;
  },
  open: result => {
    Director.invalidate();
    Company.showJourney(result.journeyId);
    page = "company";
    render();
    toast(result.created ? "Quest session saved. Tracking starts from this saved capture." : "Opened your existing quest session. No duplicate plan was created.");
  },
});
async function openQuestionDraft(question,valid=()=>true){
  const revision=questionRevision,generation=autosaveGeneration;
  await autosaveQueue;
  if(!valid()||revision!==questionRevision||generation!==autosaveGeneration||sending)return;
  retireCompanion();
  page="assistant";render();
  const field=root.querySelector('#chat-form [name="prompt"]');
  if(!field)return;
  field.value=question;questionRevision++;
  field.dispatchEvent(new Event("input",{bubbles:true}));field.focus();
  QuestGuide.updateContext();
}
root.addEventListener("input",event=>{if(event.target.matches?.('#chat-form [name="prompt"]'))questionRevision++;});
CharacterGuidance.init({
  api, root, esc, portrait, openDraft: openQuestionDraft,
  active: () => page === "characters" && !setupOpen && Boolean(state?.onboarded),
  profileId: () => state?.activeProfileId ?? null,
  sourceSignature: () => { const p=profile(); return JSON.stringify(p ? [p.id,p.name,p.className,p.race,p.faction,p.level,p.realm,p.clientBuild,p.locale,p.source,p.readiness?.equipment] : null); },
  mutate: (choice, valid) => {
    const generation=autosaveGeneration;
    const task=async()=>{
      if(generation!==autosaveGeneration||!valid())return null;
      const epoch=stateMutationEpoch;
      const result=await mutateStateCall(()=>api.createCharacterChecklist(choice));
      if(generation!==autosaveGeneration||!valid()||stateMutationEpoch!==epoch+2)return null;
      state=result.state;return result;
    };
    const result=autosaveQueue.then(task,task);autosaveQueue=result.catch(()=>{});return result;
  },
  open: result => { CharacterGuidance.invalidate(); Company.showJourney(result.journeyId); page="company"; render(); toast("Character checklist saved. Every step is a manual check."); }
});
Preparation.init({
  api, root, esc, portrait,
  openDraft: openQuestionDraft,
  character: () => profile(),
  active: () => page === "preparation" && !setupOpen && Boolean(state?.onboarded),
  profileId: () => state?.activeProfileId,
  sourceSignature: () => JSON.stringify(state?.profiles.map(p => [p.id,p.clientBuild,p.source,p.readiness,p.name,p.className,p.faction])),
  epoch: () => stateMutationEpoch,
  mutate: (id, options, valid) => {
    const generation = autosaveGeneration;
    const task = async () => {
      if (generation !== autosaveGeneration) return null;
      const epoch = stateMutationEpoch;
      const result = await mutateStateCall(() => api.createPreparationJourney(id, options));
      // Accepted writes persist; only their presentation depends on the current view.
      if (generation !== autosaveGeneration || !valid() || stateMutationEpoch !== epoch + 2) return null;
      state = result.state;
      return result;
    };
    const result = autosaveQueue.then(task, task);
    autosaveQueue = result.catch(() => {});
    return result;
  },
  open: result => {
    Preparation.invalidate();
    Company.showJourney(result.journeyId);
    page = "company";
    render();
    toast("Shopping checklist saved. Check off each step manually in Company.");
  },
});
Party.init({
  api, root, esc, portrait, notify: toast,
  character: () => profile(), profileId: () => state?.activeProfileId,
  active: () => page === "party" && !setupOpen && Boolean(state?.onboarded),
  sourceSignature: () => JSON.stringify([state?.provider,state?.profiles.map(p=>[p.id,p.source,p.readiness,p.name,p.className,p.faction])]),
  contextSignature: () => { const p=profile();return JSON.stringify([state?.provider,p?.id,p?.source?.kind,p?.source?.id,p?.clientBuild,p?.name,p?.realm,p?.className,p?.faction]); },
  epoch: () => stateMutationEpoch, ready: () => autosaveQueue,
  cancelPreview: () => { companionReady=api.companionContext({profileId:state.activeProfileId??null,view:companionView()});companionReady.catch(()=>{}); },
  cleanError: e => String(e?.message||"").replace(/^Error invoking remote method '[^']+': Error: /,""),
  mutate: (kind,input,valid) => {
    const generation=autosaveGeneration;
    const task=async()=>{
      // Reviewed portable content must still belong to the visible editor before dispatch.
      if(generation!==autosaveGeneration || (kind==="commit"&&!valid()))return null;
      const epoch=stateMutationEpoch;
      const result=await mutateStateCall(()=>kind==="create"?api.createPartyJourney(input):api.commitPartyPlan(input));
      if(generation!==autosaveGeneration||!valid()||stateMutationEpoch!==epoch+2)return null;
      state=result.state;return result;
    };
    const result=autosaveQueue.then(task,task);autosaveQueue=result.catch(()=>{});return result;
  },
  show: () => { Company.invalidate(); Party.invalidate(); page="party"; render(); },
  open: result => { Party.invalidate(); Company.showJourney(result.journeyId);page="company";render();toast("Manual plan saved. Check off each step yourself in Company."); },
});
Company.init({
  api, root, esc, portrait,
  active: () => page === "company" && !setupOpen && Boolean(state?.onboarded),
  epoch: () => stateMutationEpoch,
  mutate: (input, valid) => {
    const generation = autosaveGeneration;
    const task = async () => {
      // A blurred edit is accepted work, even after its view has closed.
      // Replacement generations cancel obsolete writes; view validity only gates replies.
      if (generation !== autosaveGeneration) return null;
      const epoch = stateMutationEpoch;
      const result = await mutateStateCall(() => api.journeyAction(input));
      // Another mutation or a replacement lifecycle may finish while IPC waits.
      if (generation !== autosaveGeneration || !valid() || stateMutationEpoch !== epoch + 2) return null;
      state = result.state;
      return result.company;
    };
    const result = autosaveQueue.then(task, task);
    autosaveQueue = result.catch(() => {});
    return result;
  },
  open: selectedId => action(async () => {
    Company.invalidate();
    await autosaveQueue;
    await persist({ ...state, activeProfileId: selectedId });
    page = "now";
    render();
  }),
});
root.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action === "skip-content") {
    root.querySelector("#main-content")?.focus();
    return;
  }
  if (button.hasAttribute("data-company-share")) { if(page==="company")Party.shareJourney(button.dataset.companyShare); return; }
  if (button.closest("[data-support], [data-recovery]")) return;
  if (button.closest("[data-party]") && !button.dataset.nav) return;
  if (button.hasAttribute("data-director-start") || button.hasAttribute("data-preparation-add") || button.hasAttribute("data-preparation-retry") || button.hasAttribute("data-preparation-ask")) return;
  if (button.hasAttribute("data-company-command") || button.hasAttribute("data-company-open") || button.closest("[data-company-form]")) return;
  if (button.dataset.nav || button.dataset.character || ["reset", "import", "new-character", "delete-character"].includes(button.dataset.command) || button.dataset.command?.startsWith("setup-")) { questNavigationRequest++;questStatusRequest++;CharacterGuidance.invalidate(); QuestGuide.invalidate(); Company.invalidate(); Director.invalidate(); Preparation.invalidate(); Party.invalidate(); }
  if (button.dataset.nav || button.dataset.character || button.dataset.provider || ["clear-chat", "reset", "import", "new-character", "delete-character", "delete-key", "subscription-login", "subscription-logout", "explain-plan"].includes(button.dataset.command) || button.dataset.command?.startsWith("setup-")) retireCompanion();
  // A click owns its navigation before the save barrier; reference polls cannot retarget it.
  const navigation=button.dataset.nav?Object.freeze({page:button.dataset.nav,request:questNavigationRequest}):null;
  action(async () => {
    await autosaveQueue;
    if (navigation) {
      if(navigation.request!==questNavigationRequest)return;
      if (pendingSnapshot?.epoch === stateMutationEpoch && !stateMutationBusy) {
        state = pendingSnapshot.result.state;
        gameStatus = pendingSnapshot.result.gameStatus || {};
        acceptBrief(pendingSnapshot.result);
        pendingSnapshot = null;
      }
      page = navigation.page;
      render();
      if (page === "quest-guide") {
        const epoch = stateMutationEpoch;
        const id = state.activeProfileId,request=++questStatusRequest,saved=JSON.stringify(profile());
        const nextStatus = await api.knowledgeStatus();
        if (page==="quest-guide"&&request===questStatusRequest&&saved===JSON.stringify(profile())&&epoch === stateMutationEpoch && id === state.activeProfileId) {
          knowledgeStatus = nextStatus;
          QuestGuide.sync(profile(), nextStatus);
        }
      }
      if (page === "connections") await fetchModels();
      if (page === "game" && api.gameStatus) {
        gameStatus = await api.gameStatus();
        render();
      }
    }
    if (button.dataset.setupCandidate !== undefined) {
      const candidate = setupCandidates?.[Number(button.dataset.setupCandidate)];
      if (candidate) await prepareCompanion(() => api.connectGame(candidate.path));
    }
    if (button.dataset.mapFocus) {
      // Focus first, so the map mounts straight onto the target instead of racing a load of the old zone.
      try { const f = JSON.parse(button.dataset.mapFocus); WorldMapView.focus(f); page = "world-map"; render(); } catch {}
    }
    if (button.dataset.questOpen) {
      page = "quest-guide";
      render();
      await QuestGuide.open(Number(button.dataset.questOpen));
    }
    if (button.dataset.character) {
      await persist({ ...state, activeProfileId: button.dataset.character });
      render();
    }
    if (button.dataset.provider) {
      connection = button.dataset.provider;
      authChoice =
        state.provider.id === connection
          ? state.provider.authMode || "api"
          : ["ollama", "ollama-cloud"].includes(connection)
            ? "api"
            : "subscription";
      render();
      await autosaveForm(document.getElementById("provider-form"));
      await fetchModels();
    }
    if (button.dataset.link) await api.openLink(button.dataset.link);
    if (button.dataset.mapZone) {
      const where = Number(button.dataset.mapZone);
      WorldMapView.focusZone(Number.isSafeInteger(where) && where > 0 ? where : button.dataset.mapZone);
      page = "world-map";
      render();
    }
    if (button.dataset.prompt) {
      const field = document.querySelector("[name=prompt]");
      field.value = button.dataset.prompt;
      field.focus();
      QuestGuide.updateContext();
    }
    if (button.dataset.removeGoal) {
      await persist(
        editedState((next) => {
          const p = next.profiles.find(
            (p) => p.id === button.dataset.profileId,
          );
          if (p)
            p.goals = p.goals.filter((g) => g.id !== button.dataset.removeGoal);
        }),
      );
      render();
    }
    switch (button.dataset.command) {
      case "copy-travel": {
        const message = messages[Number(button.dataset.messageIndex)];
        if (message?.kind === "travel") { await api.copyTravelGuidance(message.travel.choiceToken); toast("Full qualified guidance copied."); }
        break;
      }
      case "open-travel-source":
        await api.openTravelSource(button.dataset.sourceId);
        break;
      case "save-travel-plan": {
        const message = messages[Number(button.dataset.messageIndex)], token = message?.travel?.choiceToken;
        if (!token) break;
        const generation=chatGeneration, epoch=stateMutationEpoch, profileId=state.activeProfileId;
        const result = await mutateStateCall(() => api.createTravelPlan({profileId,token,optionId:button.dataset.optionId}));
        if(generation!==chatGeneration || stateMutationEpoch!==epoch+2 || profileId!==state.activeProfileId) break;
        state=result.state;
        const option=message.travel.options.find(o=>o.id===button.dataset.optionId);
        if(option)option.saved=true;
        button.textContent="Saved to Plans";
        toast(result.reused ? "This trip is already in Plans." : "Saved to Plans. Check off each step yourself.");
        break;
      }
      case "explain-plan": {
        if (guidanceProfileId !== state.activeProfileId || !guidance?.steps?.length) break;
        const draft = shareCharacter ? CommandCenter.draft(guidance, CommandCenter.options(state.activeProfileId)) : "Explain how to plan a quest session in general. Character sharing is off; ask me for any details you need.";
        const selectedId=state.activeProfileId,chosenGuidance=guidance;
        void openQuestionDraft(draft,()=>page==="adventure"&&selectedId===state.activeProfileId&&guidance===chosenGuidance);
        break;
      }
      case "setup-open":
        setupGeneration++;
        setupBusy = false;
        setupCandidates = null;
        setupOpen = true;
        render();
        break;
      case "setup-manual":
        closeSetup("manual");
        render();
        break;
      case "setup-company":
        await planWithoutCharacter();
        break;
      case "setup-defer":
        closeSetup("deferred");
        render();
        break;
      case "setup-ai":
        closeSetup("deferred");
        page = "connections";
        if (!state.onboarded) await persist({ ...state, onboarded: true });
        render();
        await fetchModels();
        break;
      case "setup-enter":
        await enterPrepared(setupGeneration);
        break;
      case "setup-prepare":
        await prepareCompanion(() => api.startCompanion());
        break;
      case "setup-folder":
        await prepareCompanion(() => api.connectGame());
        break;
      case "game-launch": {
        if (launchBusy) break;
        const generation = setupGeneration;
        launchBusy = true;
        button.disabled = true;
        try {
          const result = await mutateStateCall(() => api.launchGame());
          if (generation !== setupGeneration) break;
          await applyGame(result);
          const launch = result.launchResult;
          if (launch?.state !== "cancelled" && launch?.state !== "already-running")
            toast(launch?.state === "requested" ? "Launch requested. Sign in through the game as usual; this does not confirm the game or Compass loaded." : launch?.message || "Use your usual game launcher. Your prepared companion is ready.");
        } catch {
          if (generation === setupGeneration)
            toast("Forever could not be opened here. Use your usual game launcher; your prepared companion is ready.", true);
        } finally { launchBusy = false; if (button.isConnected) button.disabled = false; }
        break;
      }
      case "follow-saved":
        rememberDrafts();
        await persist({ ...state, followGameCharacter: true });
        render();
        break;
      case "refresh-models":
        await fetchModels(true);
        break;
      case "game-discover":
        setupOpen = true;
        setupCandidates = null;
        await prepareCompanion(() => api.startCompanion());
        break;
      case "game-connect":
        livingDisclosureGeneration++;
        await mutateGame(() => api.connectGame());
        break;
      case "game-install":
        await mutateGame(() => api.installGameAddon());
        break;
      case "game-refresh":
        await mutateGame(() => api.refreshGame());
        break;
      case "game-disconnect":
        setupGeneration++;
        setupBusy = false;
        setupCandidates = null;
        await mutateGame(() => api.disconnectGame());
        break;
      case "check-updates":
        if (updateSaving) break;
        const checkingEpoch = ++updateEpoch;
        updateInfo = { ...updateInfo, phase: "checking" };
        refreshUpdateWidgets();
        try {
          const status = await api.checkForUpdates();
          if (checkingEpoch === updateEpoch) updateInfo = status;
        } finally {
          refreshUpdateWidgets();
        }
        break;
      case "install-update":
        if (
          confirm(
            "Close Backstage Forever, install the verified update and restart? Your saved journal is preserved.",
          )
        )
          await api.installUpdate();
        break;

      case "stop-response": {
        if (!sending || !currentQuestion) break;
        const question = currentQuestion;
        retireCompanion(false);
        const generation = chatGeneration;
        questionRecovery = { ...question, message: "Response stopped. Review your question and sharing choices before sending again. Stopping locally does not undo provider processing or charges." };
        // Queue cancellation before another request can be sent through this renderer.
        companionReady = api.cancelAsk();
        companionReady.catch(() => {});
        render();
        if (generation === chatGeneration) document.querySelector('[data-command="edit-question"]')?.focus();
        await companionReady;
        break;
      }
      case "edit-question": {
        if (!questionRecovery || sending) break;
        const field = document.querySelector('#chat-form [name="prompt"]');
        if (!field) break;
        if (field.value || questionRevision !== questionRecovery.revision) {
          questionRecovery.message = "Your newer draft was kept. The earlier question is still in the conversation above.";
          const message = document.querySelector('[data-question-recovery] p');
          if (message) message.textContent = questionRecovery.message;
          field.focus();
          break;
        }
        field.value = questionRecovery.prompt;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
        break;
      }
      case "subscription-login": {
        const generation = chatGeneration;
        const selectedProvider = connection;
        authPending = true;
        render();
        try {
          const status = await api.connectSubscription(selectedProvider);
          if (generation === chatGeneration) {
            subscriptions = status;
            toast("Sign-in finished. Save this connection to use it.");
          }
        } finally {
          authPending = false;
          if (page === "connections") render();
          await fetchModels(true);
        }
        break;
      }
      case "subscription-logout": {
        if (
          !confirm(
            "Sign out of this provider connection? For an external official tool, this may also sign out that tool.",
          )
        )
          break;
        chatGeneration++;
        messages = [];
        subscriptions = await api.disconnectSubscription(connection);
        render();
        await fetchModels(true);
        toast("Provider connection signed out.");
        break;
      }
      case "refresh-subscriptions":
        subscriptions = await api.subscriptionStatus();
        render();
        break;

      case "new-character":
        await persist({ ...state, activeProfileId: null });
        render();
        break;
      case "delete-character":
        if (confirm("Delete this character, their goals, private notes and saved memory? This also clears ALL local recovery points and any preserved damaged original. Exported backups remain separate.")) {
          CommandCenter.remove(button.dataset.profileId);
          Preparation.remove(button.dataset.profileId);
          Party.remove(button.dataset.profileId);
          await persist(
            editedState((next) => {
              const target = button.dataset.profileId;
              next.profiles = next.profiles.filter((p) => p.id !== target);
              if (next.activeProfileId === target)
                next.activeProfileId = next.profiles[0]?.id || null;
            }),
          );
          render();
        }
        break;
      case "clear-chat":
        await clearMainConversation();
        toast("Conversation cleared from this session.");
        break;
      case "delete-key":
        keys = await api.deleteKey(connection);
        render();
        await fetchModels(true);
        toast("Saved key removed. Revoke it with the provider if needed.");
        break;
      case "export":
        if (await api.exportData())
          toast("Backup exported. API keys were excluded.");
        break;
      case "import": {
        stateMutationEpoch++;
        const next = await mutateStateCall(() => api.importData());
        if (next) {
          Company.invalidate(true);
          CharacterGuidance.invalidate(true);
          Preparation.invalidate();
          Preparation.remove();
          Party.invalidate(); Party.remove();
          chatGeneration++;
          autosaveGeneration++;
          formDrafts.clear();
          state = next;
          // A restored profile may keep its ID while replacing all quest evidence.
          // Refresh also invalidates plans still running against the old backup.
          await refreshBrief();
          gameStatus = await api.gameStatus();
          connection = state.provider.id;
          authChoice = state.provider.authMode || "api";
          messages = [];
          render();
          toast("Backup imported. Existing API keys preserved.");
        }
        break;
      }
      case "reset": {
        setupGeneration++;
        setupBusy = false;
        setupCandidates = null;
        await autosaveQueue;
        autosaveGeneration++;
        stateMutationEpoch++;
        const next = await mutateStateCall(() => api.resetData());
        if (next) {
          Company.invalidate(true);
          CharacterGuidance.invalidate(true);
          Preparation.invalidate();
          Preparation.remove();
          Party.invalidate(); Party.remove();
          CommandCenter.remove();
          QuestGuide.invalidate(true);
          knowledgeStatus = null;
          chatGeneration++;
          modelEpoch++;
          modelCatalogs = {};
          modelsLoading = false;
          state = next;
          autosaveGeneration++;
          formDrafts.clear();
          chooseSetup("");
          setupOpen = true;
          gameStatus = {};
          adventureBrief = null;
          briefProfileId = null;
          briefEpoch++;
          keys = {};
          subscriptions = {};
          authPending = false;
          authChoice = "api";
          updateEpoch++;
          updateSaving = false;
          updatePendingPrefs = null;
          updateInfo = {
            ...updateInfo,
            phase: "disabled",
            automatic: false,
            availableVersion: null,
            progress: 0,
            lastChecked: null,
            message: "",
          };
          messages = [];
          page = "adventure";
          connection = "ollama";
          render();
          toast("Local data and saved keys deleted.");
          subscriptions = await api.subscriptionStatus();
        }
        break;
      }
    }
  });
});
root.addEventListener("change", (event) =>
  action(async () => {
    if (event.target.closest("[data-company],[data-preparation],[data-party]")) return;
    if (event.target.id === "active-character" || event.target.id === "access-method") retireCompanion();
    if (event.target.id === "active-character") { questNavigationRequest++;questStatusRequest++;CharacterGuidance.invalidate(); QuestGuide.invalidate(); Company.invalidate(); Director.invalidate(); Preparation.invalidate(); Party.invalidate(); }
    if (event.target.dataset.planOption && state.activeProfileId) {
      const selected = CommandCenter.options(state.activeProfileId);
      const key = event.target.dataset.planOption;
      selected[key] = key === "minutes" ? Number(event.target.value) : event.target.value;
      CommandCenter.save(state.activeProfileId, selected);
      Director.invalidate();
      syncGuidance();
      render();
      document.querySelector(`[data-plan-option="${key}"]`)?.focus();
    }
    if (event.target.dataset.updatePref) {
      if (updateSaving) {
        refreshUpdateWidgets();
        return;
      }
      const candidate = {
        automatic: updateInfo.automatic,
        installOnQuit: updateInfo.installOnQuit,
      };
      candidate[event.target.dataset.updatePref] = event.target.checked;
      const savingEpoch = ++updateEpoch;
      updateSaving = true;
      updatePendingPrefs = candidate;
      refreshUpdateWidgets();
      try {
        const status = await api.setUpdatePreferences(candidate);
        if (savingEpoch === updateEpoch) updateInfo = status;
      } finally {
        if (savingEpoch === updateEpoch) {
          updateSaving = false;
          updatePendingPrefs = null;
          refreshUpdateWidgets();
        }
      }
    }
    if (event.target.id === "follow-game-character") {
      await autosaveQueue;
      rememberDrafts();
      await persist({ ...state, followGameCharacter: event.target.checked });
      render();
    }
    if (event.target.id === "share-profile") {
      shareCharacter = event.target.checked;
      await clearMainConversation(true, true);
      document
        .querySelector(".context-preview")
        ?.classList.toggle("context-disabled", !shareCharacter);
      try {
        localStorage.setItem("bf-share-character", String(shareCharacter));
      } catch {}
    }
    if (event.target.id === "access-method") {
      authChoice = event.target.value;
      await autosaveForm(event.target.form);
      render();
      await fetchModels();
    }
    if (event.target.id === "active-character") {
      await persist({ ...state, activeProfileId: event.target.value });
      render();
    }
    if (event.target.dataset.goal) {
      await persist(
        editedState((next) => {
          const goal = next.profiles
            .find((p) => p.id === event.target.dataset.profileId)
            ?.goals.find((g) => g.id === event.target.dataset.goal);
          if (goal) goal.done = event.target.checked;
        }),
      );
      render();
    }
  }),
);
root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.dataset.companyForm) return;
  if (form.id === "chat-form") {
    if (sending || chatStarting) return;
    chatStarting = true;
    Voice.invalidate();
  }
  const submitGeneration = chatGeneration;
  const data = new FormData(form);
  const renderedProfileId = form.dataset.profileId;
  action(async () => {
    await autosaveQueue;
    if (form.id === "onboard" || form.id === "character-form") {
      const existing =
        form.id === "onboard"
          ? null
          : state.profiles.find((p) => p.id === renderedProfileId);
      if (form.id === "character-form" && renderedProfileId) {
        if (!existing) {
          toast(
            "This character is no longer available. Reopen the journal.",
            true,
          );
          return;
        }
        await autosaveForm(form);
        render();
        return;
      }
      const next = {
        ...existing,
        id: existing?.id || id(),
        name: String(data.get("name")).trim(),
        realm: String(data.get("realm")).trim(),
        className: String(data.get("className")),
        level: Number(data.get("level")),
        notes: String(data.get("notes") || ""),
        goals: existing?.goals || [],
        race: String(data.get("race") || ""),
        faction: String(data.get("faction") || ""),
      };
      if (existing?.source?.kind === "wow-addon") {
        for (const key of [
          "name",
          "realm",
          "className",
          "level",
          "race",
          "faction",
        ])
          next[key] = existing[key];
      }
      if (!next.name) {
        toast(
          "Enter a character name with at least one visible character.",
          true,
        );
        return;
      }
      await persist(
        editedState((candidate) => {
          if (existing)
            candidate.profiles[
              candidate.profiles.findIndex((p) => p.id === next.id)
            ] = next;
          else candidate.profiles.push(next);
          candidate.activeProfileId = next.id;
          candidate.onboarded = true;
        }),
      );
      savedFields(form, Object.fromEntries(data));
      render();
      toast(
        existing
          ? "Character journal saved."
          : "Your adventure journal is ready.",
      );
    }
    if (form.id === "goal-form") {
      const text = String(data.get("goal")).trim();
      if (!text) {
        toast("Give your goal a few words first.", true);
        return;
      }
      await persist(
        editedState((next) => {
          const target = next.profiles.find((p) => p.id === renderedProfileId);
          if (target) target.goals.push({ id: id(), text, done: false });
        }),
      );
      render();
      document.querySelector("[name=goal]")?.focus();
    }
    if (form.id === "provider-form") {
      await autosaveForm(form);
    }
    if (form.id === "chat-form" && !sending) {
      if (submitGeneration !== chatGeneration || page !== "assistant") return;
      const prompt = String(data.get("prompt"));
      if (!prompt.trim()) return;
      const shareProfile = document.getElementById("share-profile").checked;
      const request = { provider: state.provider.id, prompt, shareProfile };
      if (renderedProfileId) request.profileId = renderedProfileId;
      const generation = chatGeneration;
      await companionReady;
      const memoryIds = await Memory.forQuestion(prompt);
      if (generation !== chatGeneration || page !== "assistant" || renderedProfileId !== (state.activeProfileId || "")) return;
      request.memoryIds = memoryIds;
      const nextScope = JSON.stringify([shareProfile, [...memoryIds].sort()]);
      if (conversationScope !== null && conversationScope !== nextScope) {
        messages = [];
        conversationNotice = "Recent messages accompany follow-ups. Sharing choices changed, so this question starts a fresh conversation. Saved memory must be selected for each question.";
      }
      conversationScope = nextScope;
      Voice.invalidate();
      Memory.beginQuestion();
      formDrafts.delete(form.dataset.draftKey);
      form.elements.namedItem("prompt").value = "";
      form.elements.namedItem("prompt").defaultValue = "";
      currentQuestion = { prompt, revision: questionRevision };
      questionRecovery = null;
      messages.push({ role: "user", text: prompt });
      chatStarting = false;
      sending = true;
      render();
      try {
        const result = api.askCompanion ? await api.askCompanion(request) : { text: await api.ask(request), kind: "ai" };
        if (generation === chatGeneration) {
          if (result.conversation?.resetReason) messages = [{ role: "user", text: prompt }];
          if (result.conversation?.omittedTurns) conversationNotice = "Recent messages accompany follow-ups; older exchanges were omitted to keep this request bounded. Your current question and selected saved memory stay intact.";
          messages.push({ role: "assistant", text: result.text, kind: result.kind, travel: result.travel, npc: result.npc, lookups: Array.isArray(result.lookups) ? result.lookups.slice(0, 10).map(String) : undefined });
          void QuestGuide.updateContext(true);
          await Memory.review();
        }
      } catch (error) {
        if (generation === chatGeneration) {
          questionRecovery = { ...currentQuestion, message: error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") };
        }
      } finally {
        if (generation === chatGeneration) {
          sending = false;
          currentQuestion = null;
          if (page === "assistant") render();
        }
      }
    }
  }).finally(() => {
    if (form.id === "chat-form" && submitGeneration === chatGeneration) {
      chatStarting = false;
      Voice.mounted();
    }
  });
});
// The free AI card changed the companion's provider: reload the saved settings and redraw.
window.addEventListener?.("bf-provider-changed", async () => {
  try { const fresh = await api.bootstrap(); state = fresh.state; keys = fresh.secretStatus; authChoice = state.provider.authMode || "api"; connection = state.provider.id; render(); fetchModels(); } catch {}
});
(async () => {
  try {
    const initial = await api.bootstrap();
    state = initial.state;
    metadata = initial.providers;
    keys = initial.secretStatus;
    version = initial.version;
    gameStatus = initial.gameStatus || {};
    acceptBrief(initial);
    updateInfo = initial.updateStatus || updateInfo;
    subscriptions = initial.subscriptionStatus || {};
    authChoice = state.provider.authMode || "api";
    connection = state.provider.id;
    render();
    fetchModels();
  } catch {
    root.innerHTML =
      '<main class="content"><h1>Your journal could not be opened.</h1><p>Your files were preserved. Close the app and consult the troubleshooting instructions in the README.</p></main>';
  }
})();

setInterval(() => {
  const pollingEpoch = updateEpoch;
  if (state?.onboarded && !updateSaving)
    api
      .updateStatus()
      .then((status) => {
        if (updateSaving || pollingEpoch !== updateEpoch) return;
        updateInfo = status;
        refreshUpdateWidgets();
      })
      .catch(() => {});
}, 5000);

// Refresh saved snapshots without replacing controls the player is editing.
let snapshotPolling = false,
  snapshotRenderPending = false,
  pendingSnapshot = null;
setInterval(async () => {
  if (!state || !api.gameSnapshot || snapshotPolling || stateMutationBusy)
    return;
  snapshotPolling = true;
  const pollingMutationEpoch = stateMutationEpoch;
  try {
    const result = await api.gameSnapshot();
    if (
      !result?.state ||
      stateMutationBusy ||
      pollingMutationEpoch !== stateMutationEpoch
    )
      return;
    refreshGameStatusWidget(result.gameStatus || {});
    const editing = isEditing();
    if (page === "party") {
      if(state.activeProfileId!==result.state.activeProfileId)Party.invalidate();
      pendingSnapshot=null;
      const chromeChanged=companyChromeSignature(state,gameStatus)!==companyChromeSignature(result.state,result.gameStatus);
      state=result.state;gameStatus=result.gameStatus||{};acceptBrief(result);
      if(chromeChanged)render();
      Party.refresh();return;
    }
    if (page === "characters" && state.activeProfileId === result.state.activeProfileId) {
      // Keep edited controls in place, but retain the surrounding roster/identity refresh until idle.
      const changed = JSON.stringify(state) !== JSON.stringify(result.state) ||
        LivingSetup.signature(gameStatus) !== LivingSetup.signature(result.gameStatus);
      snapshotRenderPending ||= changed;
      pendingSnapshot=null; state=result.state; gameStatus=result.gameStatus||{}; acceptBrief(result);
      if (snapshotRenderPending && !editing && !sending) {
        render(); // Existing interaction guards defer held buttons/native menus through their dispatch.
        snapshotRenderPending=false;
      }
      document.querySelectorAll("[data-snapshot-age]").forEach(node => { node.textContent=snapshotLabel(profile()); });
      const savedAge=root.querySelector(".game-status-chip small");
      if (savedAge) savedAge.textContent=profile() ? "Desktop · " + CommandCenter.age(profile()) : "Desktop · no saved character";
      CharacterGuidance.refresh(); return;
    }
    if (page === "preparation") {
      if (state.activeProfileId !== result.state.activeProfileId) { Preparation.invalidate(); }
      pendingSnapshot = null;
      const chromeChanged = companyChromeSignature(state, gameStatus) !== companyChromeSignature(result.state, result.gameStatus);
      state = result.state;
      gameStatus = result.gameStatus || {};
      acceptBrief(result);
      if (chromeChanged) render();
      const savedAge = root.querySelector(".game-status-chip small");
      if (savedAge) savedAge.textContent = profile() ? "Desktop · " + CommandCenter.age(profile()) : "Desktop · no saved character";
      Preparation.refresh();
      return;
    }
    if (page === "company") {
      // Company fields keep their drafts independently of captured evidence.
      // Refresh only that region so newer proof can arrive during a text edit.
      pendingSnapshot = null;
      const chromeChanged = companyChromeSignature(state, gameStatus) !== companyChromeSignature(result.state, result.gameStatus);
      state = result.state;
      gameStatus = result.gameStatus || {};
      acceptBrief(result);
      if (chromeChanged) render();
      const savedAge = root.querySelector(".game-status-chip small");
      if (savedAge) savedAge.textContent = profile() ? "Desktop · " + CommandCenter.age(profile()) : "Desktop · no saved character";
      Company.refresh();
      return;
    }
    if (editing || sending) {
      pendingSnapshot = { result, epoch: pollingMutationEpoch };
      return;
    }
    pendingSnapshot = null;
    const changed =
      JSON.stringify(result.state) !== JSON.stringify(state) ||
      LivingSetup.signature(result.gameStatus) !== LivingSetup.signature(gameStatus) ||
      JSON.stringify(result.brief) !== JSON.stringify(adventureBrief) ||
      result.briefProfileId !== briefProfileId ||
      JSON.stringify(result.knowledgeStatus) !== JSON.stringify(knowledgeStatus);
    state = result.state;
    gameStatus = result.gameStatus || {};
    acceptBrief(result);
    snapshotRenderPending ||= changed;
    document.querySelectorAll("[data-snapshot-age]").forEach((node) => {
      node.textContent = snapshotLabel(profile());
    });
    if (snapshotRenderPending && !editing && !sending) {
      render();
      snapshotRenderPending = false;
    }
  } catch {
  } finally {
    snapshotPolling = false;
  }
}, 5000);

document.addEventListener("visibilitychange", () => {
  document.body.dataset.paused = String(document.hidden);
});
document.body.dataset.paused = String(document.hidden);

root.addEventListener("focusout", (event) => {
  if (
    event.target.matches("input,textarea") &&
    ["character-form", "provider-form"].includes(event.target.form?.id)
  )
    autosaveForm(event.target.form);
});
root.addEventListener("change", (event) => {
  if (
    event.target.matches("select") &&
    event.target.id !== "access-method" &&
    ["character-form", "provider-form"].includes(event.target.form?.id)
  ) {
    if (event.target.name === "model") {
      const manual = event.target.form.elements.namedItem("manualModel");
      if (manual) manual.value = "";
    }
    autosaveForm(event.target.form);
  }
});
root.addEventListener("keydown", (event) => {
  if (
    event.target.matches('#chat-form textarea[name="prompt"]') &&
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  ) {
    event.preventDefault();
    if (!sending) event.target.form.requestSubmit();
  }
});
