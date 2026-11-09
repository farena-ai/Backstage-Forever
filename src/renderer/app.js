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
  "Death Knight",
  "Demon Hunter",
  "Monk",
  "Evoker",
  "Other",
];
const nav = [
  ["adventure", "◈", "Adventure"],
  ["characters", "♙", "Characters"],
  ["assistant", "✧", "AI Companion"],
  ["game", "⚑", "Game Connection"],
  ["connections", "⌘", "Connections"],
  ["guide", "▤", "Field Guide"],
  ["updates", "⟲", "Updates"],
];
let stateMutationEpoch = 0,
  stateMutationBusy = 0;
let gameStatus = {},
  modelCatalogs = {},
  modelEpoch = 0,
  modelsLoading = false;
let shareCharacter = true;
try {
  shareCharacter = localStorage.getItem("bf-share-character") !== "false";
} catch {}
const reloadHint =
  "Levelled up or changed areas? Type /reload in WoW to refresh your companion.";
let state,
  metadata = [],
  keys = {},
  version = "",
  page = "adventure",
  connection = "ollama",
  messages = [],
  sending = false,
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
}
function editedState(edit) {
  const next = structuredClone(state);
  edit(next);
  return next;
}
function isEditing() {
  if (document.activeElement?.matches("input,textarea,select")) return true;
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
  return `<div class="form-grid"><label>Character name<input name="name" maxlength="100" value="${esc(p.name)}" required autocomplete="off" ${lock}></label><label>Realm<input name="realm" maxlength="100" value="${esc(p.realm)}" autocomplete="off" placeholder="Your home realm" ${lock}></label><label>Class<select name="className" ${imported ? "disabled" : ""}>${options(classes.includes(p.className) ? classes : [...classes, p.className].filter(Boolean), p.className || "Hunter")}</select></label><label>Level<input name="level" type="number" min="1" max="60" value="${esc(p.level || 1)}" required ${lock}></label><label>Faction<select name="faction" ${imported ? "disabled" : ""}><option value="">Not set</option>${options(["Alliance", "Horde"], p.faction)}</select></label><label>Race<input name="race" maxlength="100" value="${esc(p.race)}" ${lock} placeholder="Optional"></label></div>${imported ? '<p class="corner-note">Character details come from your saved game snapshot. Notes and goals remain editable.</p>' : ""}`;
}
function onboarding() {
  root.innerHTML = `<main class="onboarding"><section class="onboarding-art">${brand()}<div><div class="eyebrow">Your world. Your adventure.</div><h1>A companion for<br>the road ahead.</h1><p>Make room for the adventure.<br>We’ll keep your plans in order.</p></div><small>DESIGNED BY FRANK ARENA</small></section><section class="onboarding-form"><div class="eyebrow">Welcome, adventurer · 01 / 01</div><h2>Every adventure starts somewhere.</h2><p>Start with a character, then connect your game to import saved character snapshots. Your journal stays on this computer.</p><form id="onboard">${characterFields()}<div class="actions"><button class="primary" type="submit">Begin my adventure</button></div></form><div class="callout">◈ &nbsp; No account. No subscription required for the app.<br>Profiles and planning work offline. AI is optional and uses your own provider access.</div><p class="snapshot-hint">${reloadHint} Logging out also saves a snapshot.</p><p class="onboarding-footer">Independent companion for World of Warcraft: Forever.<br>Not affiliated with or endorsed by Blizzard Entertainment.</p></section></main>`;
}
function render() {
  const selected = profile();
  document.body.dataset.class = classKey(selected?.className);
  document.body.dataset.faction = ["Alliance", "Horde"].includes(
    selected?.faction,
  )
    ? selected.faction.toLowerCase()
    : "neutral";
  if (!state.onboarded) return onboarding();
  const current = nav.find((item) => item[0] === page);
  root.innerHTML = `<div class="shell"><aside class="rail">${brand()}<nav aria-label="Main navigation">${nav.map(([key, glyph, label]) => `<button data-nav="${key}" class="${page === key ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}><span class="glyph" aria-hidden="true">${glyph}</span>${label}</button>`).join("")}</nav><div class="rail-bottom"><button class="update-rail" data-nav="updates"><span aria-hidden="true">⟲</span><span data-update-label>Updates</span></button><div class="status"><i class="dot"></i>Local journal · private</div><small>BACKSTAGE CODING<br>Designed by Frank Arena<br>v${esc(version)} · Desktop preview</small></div></aside><main class="main"><header class="topbar"><div class="breadcrumb"><span>Your field journal</span><span>/</span><span>${current[2]}</span></div><label><span class="sr-only">Active character</span><select id="active-character" aria-label="Active character">${state.profiles.length ? state.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === state.activeProfileId ? "selected" : ""}>${esc(p.name)} · Level ${p.level}</option>`).join("") : "<option>No characters yet</option>"}</select></label></header><div class="content">${{ adventure: adventure, characters: characters, assistant: assistant, connections: connections, game: gameConnection, guide: guide, updates: updatesPage }[page]()}</div></main></div>`;
  if (page === "assistant") document.getElementById("chatlog").scrollTop = 1e6;
  refreshUpdateWidgets();
}
function classKey(className) {
  return String(className || "other")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}
function portrait(className) {
  const key = classKey(className);
  return [
    "warrior",
    "paladin",
    "hunter",
    "rogue",
    "priest",
    "shaman",
    "mage",
    "warlock",
    "druid",
  ].includes(key)
    ? `../../assets/class-${key}.png`
    : "../../assets/wolf-medallion.png";
}
function factionBanner(p) {
  return ["Alliance", "Horde"].includes(p?.faction)
    ? `<span class="faction-banner"><img src="../../assets/faction-${p.faction.toLowerCase()}.png" alt=""><span>${esc(p.faction)}<small>YOUR CHARACTER’S FACTION</small></span></span>`
    : `<span class="faction-banner neutral-faction">◈ <span>Unsworn journal<small>FACTION NOT SET</small></span></span>`;
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
function publicContext(p) {
  if (!p) return "No active character.";
  return `Public character context: ${p.name}; ${p.className}; level ${p.level}; realm ${p.realm || "not set"}${p.race ? "; race " + p.race : ""}${p.faction ? "; faction " + p.faction : ""}${p.location?.zone ? "; zone " + p.location.zone : ""}${p.location?.subZone ? "; subzone " + p.location.subZone : ""}${Number.isFinite(p.location?.mapId) ? "; map " + p.location.mapId : ""}${Number.isFinite(p.location?.x) && Number.isFinite(p.location?.y) ? "; position " + p.location.x + ", " + p.location.y : ""}${p.source?.updatedAt ? "; snapshot " + p.source.updatedAt : ""}.`;
}
function situationCards() {
  const p = profile();
  return `<section class="situation-cards" aria-label="Planning suggestions"><button class="illustrated-card dungeon-card" data-task="dungeon"><span class="eyebrow">PREPARE / PLANNING SUGGESTION</span><strong>Beyond the dungeon gate</strong><span>A checklist for ${esc(p?.className || "your character")}, level ${p?.level || 1} →</span></button><button class="illustrated-card forge-card" data-task="profession"><span class="eyebrow">CRAFT / PLANNING SUGGESTION</span><strong>Make something legendary</strong><span>Choose a profession and plan your next craft →</span></button><button class="illustrated-card expedition-card" data-task="session"><span class="eyebrow">EXPLORE / SAVED LOCATION</span><strong>${esc(p?.location?.zone || "The road ahead")}</strong><span>${esc(p?.location?.subZone || "Plan a relaxed session from your last saved location")} →</span></button></section>`;
}
function gameConnection() {
  return `<header class="section-head"><div class="eyebrow">Your world, remembered</div><h1>Bring your adventure home.</h1><p>Import characters from the optional Backstage Forever addon. Saved snapshots refresh automatically while this app is open.</p></header><section class="game-banner"><img src="../../assets/wolf-medallion.png" alt=""><div><span class="eyebrow">${gameStatus.connected ? "GAME FOLDER CONNECTED" : "BEGIN YOUR CONNECTION"}</span><h2>${gameStatus.connected ? "Your journal is listening for saved snapshots." : "One addon. Your own adventurers."}</h2><p>${esc(gameStatus.message || "Choose your WoW Forever installation to get started.")}</p></div></section><div class="grid"><section class="panel"><div class="panel-header"><h3>Game connection</h3><span class="tag">${esc(gameStatus.phase || "Not connected")}</span></div><div class="steps"><div class="step"><b>1</b><div><p>Find your game</p><small>Select the installation folder. Your account credentials are never needed.</small></div></div><div class="step"><b>2</b><div><p>Install the companion addon</p><small>Only this app’s addon files are installed or updated.</small></div></div><div class="step"><b>3</b><div><p>Play, then save a snapshot</p><small>Enable the addon in WoW. Reload the UI or log out to write a snapshot to disk.</small></div></div></div><label class="check-label"><input type="checkbox" id="follow-game-character" ${state.followGameCharacter !== false ? "checked" : ""}>Follow my last played character</label><p class="corner-note">Choosing another character pauses automatic selection; saved details still refresh for every character. Enable this to follow your last played character again.</p><div class="actions"><button class="primary" data-command="game-discover">Find my game</button><button data-command="game-connect">Choose game folder</button>${gameStatus.connected ? `<button data-command="game-install">${gameStatus.addonInstalled ? "Update" : "Install"} companion addon</button><button data-command="game-refresh">Refresh saved snapshot</button><button data-command="game-disconnect">Disconnect game</button>` : ""}</div></section><aside class="panel"><h3>Saved moments, honest context.</h3><p class="snapshot-hint">${reloadHint}</p><p>Logging out also saves. Newly installed addons may require restarting the game or reloading its UI yourself. This app never triggers a reload.</p><div class="callout brass"><span data-snapshot-age>${esc(snapshotLabel(profile()))}</span></div><p>${gameStatus.characterCount || 0} characters observed · Addon ${gameStatus.addonInstalled ? "installed" : "not installed"}</p><p class="corner-note">Saved snapshots are not a realtime feed. Notes and goals survive refreshes; private account names and local paths never enter AI context.</p></aside></div>`;
}
async function mutateGame(fn) {
  await applyGame(await mutateStateCall(fn));
}
async function applyGame(result) {
  if (!result) return;
  stateMutationEpoch++;
  if (result.state) state = result.state;
  gameStatus = result.gameStatus || result;
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
      const picker = document.getElementById("model-picker");
      if (picker) {
        const selected = picker.value;
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
function adventure() {
  const p = profile();
  const goals = p?.goals || [];
  const done = goals.filter((g) => g.done).length;
  return `<section class="hero"><img class="hero-class-art" src="${portrait(p?.className)}" alt=""><div class="hero-copy">${factionBanner(p)}<div class="eyebrow">The next chapter is yours</div><div class="hero-identity"><img class="hero-medallion" src="${portrait(p?.className)}" alt=""><div><h1>${esc(p?.name || "Your adventure awaits")}</h1><p>${p ? `${esc(p.className)} · Level ${p.level} · ${esc(p.realm || "Realm not set")}` : "Create your first character and make a little room for possibility."}</p></div></div><button class="primary" data-nav="assistant">Consult your companion &nbsp; ↗</button></div><div class="hero-caption">A WORLD OF POSSIBILITY / ORIGINAL FANTASY ART</div></section>${situationCards()}<section class="stats" aria-label="Journal overview"><div class="stat"><div><div class="eyebrow">Your roster</div><small>Characters on this computer</small></div><strong>${state.profiles.length.toString().padStart(2, "0")}</strong></div><div class="stat"><div><div class="eyebrow">On the horizon</div><small>Active character’s open goals</small></div><strong>${(goals.length - done).toString().padStart(2, "0")}</strong></div><div class="stat"><div><div class="eyebrow">Small victories</div><small>Goals you’ve completed</small></div><strong>${done.toString().padStart(2, "0")}</strong></div></section><div class="grid adventure-grid"><section class="panel adventure-journal"><div class="panel-header"><h3>Your next adventures</h3><span class="eyebrow">${done} / ${goals.length} complete</span></div>${goals.length ? goals.map((g) => `<div class="goal"><label class="${g.done ? "done" : ""}"><input type="checkbox" data-goal="${esc(g.id)}" ${g.done ? "checked" : ""}><span>${esc(g.text)}</span></label><button data-remove-goal="${esc(g.id)}" aria-label="Delete goal: ${esc(g.text)}">×</button></div>`).join("") : '<div class="empty">An open page. A whole world ahead.<br>Add a goal, from learning a profession to your next dungeon.</div>'}${p ? '<form id="goal-form" class="inline goal-form"><label>New goal<input name="goal" maxlength="1000" placeholder="What would you like to do next?" required></label><button type="submit" aria-label="Add goal">+ Add</button></form>' : '<button data-nav="characters">Create a character</button>'}</section><aside class="panel camp-panel"><div class="panel-header"><h3>A good place to begin</h3><span class="gold" aria-hidden="true">✧</span></div><p class="muted">Less tab juggling.<br>More time in the world.</p><div class="steps"><div class="step"><b>1</b><div><p>Keep your own field journal</p><small>Characters, goals and private notes.</small></div></div><div class="step"><b>2</b><div><p>Choose your AI companion</p><small>Local Ollama or your own cloud API.</small></div></div><div class="step"><b>3</b><div><p>Play on your terms</p><small>You make the decisions. You play the game.</small></div></div></div><button class="subtle" data-nav="connections">Set up a connection &nbsp; →</button><div class="corner-note"><span data-snapshot-age>${esc(snapshotLabel(p))}</span></div></aside></div>`;
}
function characters() {
  const p = profile();
  return `<header class="section-head"><div class="eyebrow">Your company of adventurers</div><h1>Every character has a story.</h1><p>Keep a separate journal for each adventure. Connect your game to refresh saved character details, or keep a manual journal. Notes and goals remain your own.</p></header><div class="grid"><section class="panel"><div class="panel-header"><h3>${p ? "Character journal" : "Create a character"}</h3><span class="tag">Stored locally</span></div><form id="character-form">${characterFields(p)}<label class="full notes-label">Private notes<textarea name="notes" maxlength="20000" placeholder="Build ideas, profession plans, places to revisit…">${esc(p?.notes || "")}</textarea></label><div class="actions"><button type="submit" class="primary">${p ? "Save character" : "Create character"}</button>${p ? '<button type="button" data-command="delete-character" class="danger">Delete character</button>' : ""}</div></form><p class="snapshot-hint"><span data-snapshot-age>${esc(snapshotLabel(p))}</span><br>${reloadHint} Logging out also saves.</p><p class="corner-note">Private notes and goals are never automatically included in AI requests.</p></section><aside class="panel"><div class="panel-header"><h3>Your roster</h3><button data-command="new-character" class="subtle">+ New</button></div><div class="character-list">${state.profiles.map((item) => `<button data-character="${esc(item.id)}" class="${item.id === p?.id ? "selected" : ""}"><span class="avatar class-sigil" data-class="${esc(item.className)}"><img src="${portrait(item.className)}" alt=""><span>${sigil(item.className)}</span></span><span>${esc(item.name)}<small>${esc(item.className)} · Level ${item.level} · ${esc(item.realm || "Realm not set")}</small></span></button>`).join("") || '<div class="empty">Your roster is ready for its first adventurer.</div>'}</div><div class="callout">Each installation belongs to its player. Friends use their own profiles and provider access; no connection to Frank’s accounts or computer is needed.</div></aside></div>`;
}
function assistant() {
  const p = profile();
  const provider = metadata.find((item) => item.id === state.provider.id);
  return `<header class="section-head"><div class="eyebrow">World of Warcraft: Forever specialist</div><h1>A little wisdom for the journey.</h1><p>Plan outside combat. Answers are AI suggestions, not verified Forever game data. Your companion specializes in WoW Forever and uses your approved saved character context. It cannot control the game.</p></header><div class="grid"><section class="panel"><div class="panel-header"><h3>Your companion</h3><span class="tag">${esc(provider?.name || state.provider.id)}</span></div><div class="chatlog" id="chatlog" role="log" aria-label="Conversation" aria-live="polite">${messages.length ? messages.map((m) => `<div class="message ${m.role}"><span class="eyebrow">${m.role === "user" ? "You" : "Companion · AI suggestion"}</span>${esc(m.text)}</div>`).join("") : '<div class="chat-intro"><img src="../../assets/crest.svg" alt=""><h3>Where shall we begin?</h3><p class="muted">A dungeon checklist. A profession plan.<br>A question you were almost afraid to ask.</p></div>'}</div><form id="chat-form" class="chat-form"><label>Your question<textarea name="prompt" maxlength="12000" required placeholder="Help me prepare for my next adventure…" ${sending ? "disabled" : ""}></textarea></label><div class="suggestions"><button type="button" data-prompt="Help me make a general dungeon preparation checklist. Clearly distinguish general advice from unverified Forever details.">Dungeon preparation</button><button type="button" data-prompt="Help me plan a relaxed 45-minute game session around a goal I will describe next.">Plan a short session</button></div><label class="check-label"><input type="checkbox" id="share-profile" ${shareCharacter ? "checked" : ""} ${sending ? "disabled" : ""}>Use my active character</label><p class="context-preview">${esc(publicContext(p))}<br><span data-snapshot-age>${esc(snapshotLabel(p))}</span><br>When enabled, only the public details above accompany this question. Notes, goals, account identifiers and local paths stay private. Earlier chat is not sent.</p><div class="button-row"><button class="primary" type="submit" ${sending ? "disabled" : ""}>${sending ? "Thinking…" : "Send question"}</button><button type="button" data-command="clear-chat" ${sending ? "disabled" : ""}>Clear conversation</button></div></form></section><aside class="panel"><h3>You’re in control.</h3><div class="steps"><div class="step"><b>◈</b><div><p>${esc(provider?.name || "Choose a provider")}</p><small>Model: ${esc(state.provider.model || "Not configured")}</small></div></div></div><div class="callout brass">${state.provider.id === "ollama" ? "Ollama requests go only to your configured loopback address. Choose a locally running model for an offline AI setup." : state.provider.authMode === "subscription" ? "Sending uses your selected subscription connection and its plan limits. No automatic API billing fallback. Character details are optional." : "Sending shares your question with the selected cloud API and may incur API charges. Character details are optional."}</div><hr class="rule"><p class="muted">This is a planning companion, not a live combat assistant. It has no verified quest database, browser tools, or a realtime game feed. Saved snapshots can be older than your current session.</p><div class="actions"><button data-nav="connections">Configure provider</button></div><p class="corner-note">Chat is kept in memory for this session only.</p></aside></div>`;
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
      "ollama-cloud":
        "Use an Ollama Cloud API key. Cloud requests leave this computer and follow your Ollama account limits; local Ollama is a separate connection.",
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
  return `<header class="section-head"><div class="eyebrow">Your companion, your choice</div>
    <h1>Choose your intelligence.</h1><p>Use your subscription, bring an API key, or run a local model. You choose the access method. Nothing silently switches to API billing.</p></header>
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
    <div class="actions"><button class="primary" type="submit">Save connection</button><button type="button" data-link="${connection}">Open ${connection === "ollama" ? "Ollama website" : "provider website"} ↗</button>${keys[connection] && !isSubscription ? '<button type="button" class="danger" data-command="delete-key">Remove saved key</button>' : ""}</div></form></section>
    <aside class="panel"><h3>One app. Your own access.</h3><div class="steps"><div class="step"><b>1</b><div><p>Choose how you connect</p><small>Subscription sign-in, your own API key, or a local model.</small></div></div><div class="step"><b>2</b><div><p>Sign in with the provider</p><small>Use the official browser flow or official installed tool. Your password never goes into this app.</small></div></div><div class="step"><b>3</b><div><p>Save access, choose a model, then ask</p><small>Saving makes no inference request. A reply verifies your selected model access.</small></div></div></div><div class="callout">Each friend signs in independently. We never bundle Frank’s credentials or share someone else’s subscription.</div><p class="corner-note">Subscription usage and API billing are separate modes. No automatic paid fallback.</p></aside></div>`;
}

function guide() {
  return `<header class="section-head"><div class="eyebrow">The adventurer’s field guide</div><h1>A little guidance. A longer adventure.</h1><p>Everything you need to get started, understand your privacy, and keep your journal safe.</p></header><div class="guide-grid"><section class="panel"><div class="eyebrow">01 · Getting started</div><h3>Your first five minutes</h3><p>Create a character in Characters. Add your next goal in Adventure. Keep private notes in the character journal. All of this works without AI, a WoW addon, or a Backstage account.</p><button data-nav="characters">Open characters →</button></section><section class="panel"><div class="eyebrow">02 · Optional intelligence</div><h3>One installer. Your own setup.</h3><p>Friends install the same app and choose their own access. ChatGPT and Claude offer subscription sign-in in this preview. All cloud providers also support separate API-key mode; Grok subscription integration is still pending.</p><button data-nav="connections">Choose a provider →</button></section><section class="panel"><div class="eyebrow">03 · Privacy & portability</div><h3>Your journal belongs to you.</h3><p>Export creates a JSON backup of profiles, goals, notes and preferences, without API keys or subscription credentials. Import replaces those records after confirmation, preserving existing credentials. Treat backups as private: notes are readable in them.</p><div class="actions"><button data-command="export">Export backup</button><button data-command="import">Import backup</button></div></section><section class="panel"><div class="eyebrow">04 · Game compatibility</div><h3>A companion beside the game.</h3><p>The desktop journal is independent of WoW. The optional addon uses guarded game APIs and exports saved character snapshots on UI reload or logout. Game Connection installs the addon and watches those saved snapshots while this app is open.</p><p>No game input, process inspection, live combat computation or automation. In-game compatibility is not certified.</p></section><section class="panel full"><h3>Questions from the road</h3><details><summary>How do I update?</summary><p>The installed Windows app checks for authenticated releases at startup and every six hours while open. It downloads updates automatically and installs on exit by default. Use Updates to change this or restart when ready. Version 0.1.0 needs one manual upgrade to gain this feature. Windows publisher signing remains pending.</p></details><details><summary>What gets sent to an AI provider?</summary><p>Your current question and a short companion instruction. Use my active character defaults on and remembers your opt-out. The preview shows the exact public name, class, level, realm, race, faction, saved location and snapshot time included. Notes, goals, other characters and previous messages are excluded. Providers process requests according to their own terms.</p></details><details><summary>What if the connection fails?</summary><p>Check that the model ID exists for your account, the API key is active and your provider has available quota. For Ollama, ensure the service is running and the model is downloaded. Cloud errors never trigger another provider automatically.</p></details><details><summary>Does uninstalling erase my journal?</summary><p>The installer preserves app data. Use Delete all local data below to remove profiles, preferences and keys from this installation. It also clears app-owned subscription credentials. It does not erase exported backups or remove data already held by a provider. Delete backup copies and revoke provider keys separately when needed.</p></details><div class="actions"><button class="danger" data-command="reset">Delete all local data</button></div></section></div><p class="corner-note">Backstage Forever v${esc(version)} · Backstage Coding · Designed by Frank Arena.<br>World of Warcraft is a trademark of Blizzard Entertainment. This independent project is not endorsed by Blizzard.</p>`;
}
function updateSummary() {
  if (updateInfo.phase === "ready")
    return updateInfo.automatic && updateInfo.installOnQuit
      ? "Your next version is ready. It installs when you close the app, or you can restart now."
      : "Your next version is ready. Choose Restart and update when you’re ready to install.";
  if (updateInfo.phase === "downloading")
    return "Downloading an authenticated update in the background…";
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
    available.textContent = updateInfo.availableVersion
      ? "Available: " + updateInfo.availableVersion
      : "Installed: " + version;
  const restart = document.querySelector('[data-command="install-update"]');
  if (restart) restart.disabled = updateSaving || updateInfo.phase !== "ready";
  const check = document.querySelector('[data-command="check-updates"]');
  if (check)
    check.disabled =
      updateSaving || ["checking", "downloading"].includes(updateInfo.phase);
}
function updatesPage() {
  return `<header class="section-head"><div class="eyebrow">A companion that keeps growing</div><h1>Keep your companion ready.</h1><p>The next adventure shouldn’t require a trip through a downloads folder. Updates run quietly while your journal stays yours.</p></header>
  <div class="grid"><section class="panel update-panel"><div class="panel-header"><h3>Windows updates</h3><span class="tag" data-update-version>Installed: ${esc(version)}</span></div><p class="update-summary" data-update-summary>${esc(updateSummary())}</p><progress data-update-progress max="100" value="${Number(updateInfo.progress) || 0}" ${updateInfo.phase === "downloading" ? "" : "hidden"} aria-label="Update download progress"></progress>
  <div class="update-options"><label class="check-label"><input type="checkbox" data-update-pref="automatic" ${updateInfo.automatic ? "checked" : ""}>Automatically check and download updates</label><p>Check after startup and every six hours while the app is open. Downloads come from this project’s GitHub Releases.</p><label class="check-label"><input type="checkbox" data-update-pref="installOnQuit" ${updateInfo.installOnQuit ? "checked" : ""}>Install downloaded updates when I close the app</label><p>No forced restart during your game. You can also restart here when you’re ready.</p></div>
  <div class="actions"><button class="primary" data-command="check-updates">Check for updates</button><button data-command="install-update" ${updateInfo.phase === "ready" ? "" : "disabled"}>Restart and update</button></div><p class="corner-note">Last checked: ${updateInfo.lastChecked ? esc(new Date(updateInfo.lastChecked).toLocaleString()) : "Not checked in this session"}</p></section>
  <aside class="panel"><h3>A trusted path forward.</h3><div class="steps"><div class="step"><b>1</b><div><p>Authenticate the release</p><small>Only releases signed by Backstage Forever’s update key are accepted.</small></div></div><div class="step"><b>2</b><div><p>Verify the download</p><small>The complete installer’s size and fingerprint must match before it can run.</small></div></div><div class="step"><b>3</b><div><p>Keep your journal</p><small>Profiles and provider settings remain in your Windows account’s app folder.</small></div></div></div><div class="callout brass">Upgrading from 0.1.0? Install 0.2.0 once manually. That earlier build has no updater to perform the first upgrade.</div><p class="corner-note">Application update signatures authenticate future downloads. This preview still lacks a Windows publisher certificate, so an initial manual installer may show an unknown-publisher notice.</p></aside></div>`;
}
root.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  action(async () => {
    if (button.dataset.nav) {
      if (pendingSnapshot?.epoch === stateMutationEpoch && !stateMutationBusy) {
        state = pendingSnapshot.result.state;
        gameStatus = pendingSnapshot.result.gameStatus || {};
        pendingSnapshot = null;
      }
      page = button.dataset.nav;
      render();
      if (page === "connections") await fetchModels();
      if (page === "game" && api.gameStatus) {
        gameStatus = await api.gameStatus();
        render();
      }
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
      await fetchModels();
    }
    if (button.dataset.link) await api.openLink(button.dataset.link);
    if (button.dataset.task) {
      const task = button.dataset.task;
      page = "assistant";
      render();
      const field = document.querySelector("[name=prompt]");
      field.value =
        task === "dungeon"
          ? "Help my active character prepare for a WoW Forever dungeon. Give a class-aware checklist and mark unverified Forever specifics."
          : task === "profession"
            ? "Help my active character choose a WoW Forever profession and a practical crafting plan. Ask about my preferences."
            : "Help my active character plan a relaxed 45-minute WoW Forever session from the saved location. Mark uncertain quest details.";
      field.focus();
    }
    if (button.dataset.prompt) {
      const field = document.querySelector("[name=prompt]");
      field.value = button.dataset.prompt;
      field.focus();
    }
    if (button.dataset.removeGoal) {
      await persist(
        editedState((next) => {
          const p = next.profiles.find((p) => p.id === next.activeProfileId);
          p.goals = p.goals.filter((g) => g.id !== button.dataset.removeGoal);
        }),
      );
      render();
    }
    switch (button.dataset.command) {
      case "refresh-models":
        await fetchModels(true);
        break;
      case "game-discover": {
        const found = await api.discoverGame();
        const candidates = Array.isArray(found)
          ? found
          : found.candidates || [];
        if (candidates.length === 1)
          await mutateGame(() => api.connectGame(candidates[0].path));
        else {
          toast(
            candidates.length
              ? "Several installations found. Choose your game folder."
              : "Choose your WoW Forever folder.",
          );
          await mutateGame(() => api.connectGame());
        }
        break;
      }
      case "game-connect":
        await mutateGame(() => api.connectGame());
        break;
      case "game-install":
        await mutateGame(() => api.installGameAddon());
        break;
      case "game-refresh":
        await mutateGame(() => api.refreshGame());
        break;
      case "game-disconnect":
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
        if (confirm("Delete this character, their goals and private notes?")) {
          await persist(
            editedState((next) => {
              next.profiles = next.profiles.filter(
                (p) => p.id !== next.activeProfileId,
              );
              next.activeProfileId = next.profiles[0]?.id || null;
            }),
          );
          render();
        }
        break;
      case "clear-chat":
        chatGeneration++;
        messages = [];
        render();
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
          chatGeneration++;
          state = next;
          connection = state.provider.id;
          authChoice = state.provider.authMode || "api";
          messages = [];
          render();
          toast("Backup imported. Existing API keys preserved.");
        }
        break;
      }
      case "reset": {
        stateMutationEpoch++;
        const next = await mutateStateCall(() => api.resetData());
        if (next) {
          chatGeneration++;
          modelEpoch++;
          modelCatalogs = {};
          modelsLoading = false;
          state = next;
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
      await persist({ ...state, followGameCharacter: event.target.checked });
    }
    if (event.target.id === "share-profile") {
      shareCharacter = event.target.checked;
      try {
        localStorage.setItem("bf-share-character", String(shareCharacter));
      } catch {}
    }
    if (event.target.id === "access-method") {
      authChoice = event.target.value;
      render();
      await fetchModels();
    }
    if (event.target.id === "active-character") {
      await persist({ ...state, activeProfileId: event.target.value });
      render();
    }
    if (event.target.dataset.goal) {
      await persist(
        editedState(
          (next) =>
            (next.profiles
              .find((p) => p.id === next.activeProfileId)
              .goals.find((g) => g.id === event.target.dataset.goal).done =
              event.target.checked),
        ),
      );
      render();
    }
  }),
);
root.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  action(async () => {
    if (form.id === "onboard" || form.id === "character-form") {
      const existing = form.id === "onboard" ? null : profile();
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
        editedState((next) =>
          next.profiles
            .find((p) => p.id === next.activeProfileId)
            .goals.push({ id: id(), text, done: false }),
        ),
      );
      render();
      document.querySelector("[name=goal]")?.focus();
    }
    if (form.id === "provider-form") {
      const input = {
        provider: connection,
        authMode: ["ollama", "ollama-cloud"].includes(connection)
          ? "api"
          : authChoice,
        model: String(
          data.get("manualModel") || data.get("model") || "",
        ).trim(),
        endpoint:
          connection === "ollama"
            ? String(data.get("endpoint")).trim()
            : metadata.find((p) => p.id === connection).endpoint,
      };
      const key = String(data.get("apiKey") || "").trim();
      if (key) input.apiKey = key;
      stateMutationEpoch++;
      const result = await mutateStateCall(() => api.saveProvider(input));
      state = result.state;
      keys = result.secretStatus;
      render();
      toast("Connection saved. Choose a model, then ask a question.");
      await fetchModels(true);
    }
    if (form.id === "chat-form" && !sending) {
      const prompt = String(data.get("prompt")).trim();
      if (!prompt) return;
      if (!state.provider.model) {
        toast("Choose a model in Connections first.", true);
        return;
      }
      const shareProfile = document.getElementById("share-profile").checked;
      const request = { provider: state.provider.id, prompt, shareProfile };
      if (profile()) request.profileId = profile().id;
      const generation = chatGeneration;
      messages.push({ role: "user", text: prompt });
      sending = true;
      render();
      try {
        const reply = await api.ask(request);
        if (generation === chatGeneration)
          messages.push({ role: "assistant", text: reply });
      } catch (error) {
        if (generation === chatGeneration)
          toast(
            error.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            ),
            true,
          );
      } finally {
        sending = false;
        if (page === "assistant") render();
      }
    }
  });
});
(async () => {
  try {
    const initial = await api.bootstrap();
    state = initial.state;
    metadata = initial.providers;
    keys = initial.secretStatus;
    version = initial.version;
    gameStatus = initial.gameStatus || {};
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
    const editing = isEditing();
    if (editing || sending) {
      pendingSnapshot = { result, epoch: pollingMutationEpoch };
      return;
    }
    pendingSnapshot = null;
    const changed =
      JSON.stringify(result.state) !== JSON.stringify(state) ||
      JSON.stringify(result.gameStatus) !== JSON.stringify(gameStatus);
    state = result.state;
    gameStatus = result.gameStatus || {};
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
